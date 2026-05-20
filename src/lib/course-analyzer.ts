// ============================================================
// Анализатор курсовых работ через OpenAI GPT API
// Принципиально иной формат вывода относительно ВКР-анализатора:
// не pass/fail чек-лист, а структурированные рекомендации по
// улучшению (структура, объёмы, логика, качество текста, top-5).
// ============================================================

import OpenAI from 'openai';
import { ParsedDocument, prepareTextForGPT } from './parser';
import { CourseType, getMethodologyForCourse } from './methodology';

// ---------- Public types ----------

export type SectionVerdict = 'ok' | 'too_short' | 'too_long' | 'missing';

export interface SectionAnalysis {
  section: string;
  present: boolean;
  wordCount: number | null;
  verdict: SectionVerdict;
  comment: string;
}

export type RecommendationCategory =
  | 'structure'
  | 'content'
  | 'logic'
  | 'text_quality'
  | 'formatting';

export interface Recommendation {
  category: RecommendationCategory;
  section: string | null;
  issue: string;
  suggestion: string;
}

export interface CourseAnalysisResult {
  overallSummary: string;
  structuralAnalysis: {
    expectedSections: string[];
    missingSections: string[];
    extraSections: string[];
    sections: SectionAnalysis[];
  };
  logicAndCoherence: {
    issues: string[];
    strengths: string[];
  };
  textQuality: {
    issues: string[];
    strengths: string[];
  };
  recommendations: Recommendation[];
  top5: string[];
  disclaimer: string;
}

// ---------- Constants ----------

const DISCLAIMER =
  'Итоговое решение по работе принимает научный руководитель. Сервис даёт рекомендации, но не выполняет работу за студента.';

const EXPECTED_SECTIONS: Record<CourseType, string[]> = {
  research: [
    'Титульный лист',
    'Содержание',
    'Введение',
    'Концептуальная глава',
    'Дизайн эмпирического исследования',
    'Заключение',
    'Список использованных источников и литературы',
  ],
  project: [
    'Титульный лист',
    'Содержание',
    'Введение',
    'Концептуальная глава',
    'Анализ рынка',
    'Дизайн эмпирического исследования',
    'Заключение',
    'Список использованных источников и литературы',
    'Приложение: Техническое задание от заказчика',
  ],
};

// ---------- Prompts ----------

function buildSystemPrompt(type: CourseType): string {
  const methodology = getMethodologyForCourse(type);
  return `Ты — методический ассистент для студентов магистратуры ОП «Интегрированные коммуникации» НИУ ВШЭ.
Твоя задача — помочь студенту улучшить курсовую работу, опираясь на методические рекомендации.

ВАЖНЫЕ ПРИНЦИПЫ:
1. Ты НЕ переписываешь и НЕ выполняешь работу за студента. Ты даёшь советы и рекомендации.
2. Ты опираешься на методические рекомендации (приведены ниже). Не выдумывай требования.
3. Ты строгий, но конструктивный: указываешь, что слабо/отсутствует, и сразу — что с этим делать.
4. Ты пишешь по-русски, академическим, но дружелюбным языком.
5. Итоговое решение по работе всегда принимает научный руководитель — упомяни это в дисклеймере.

МЕТОДИЧЕСКИЕ РЕКОМЕНДАЦИИ (опирайся на них):
---
${methodology}
---

ФОРМАТ ВЫВОДА — строго JSON-объект (никакого текста вне JSON):
{
  "overallSummary": "2-3 предложения общей оценки работы (что в целом сделано, чего критически не хватает).",
  "structuralAnalysis": {
    "expectedSections": [список ожидаемых разделов по методичке для этого типа КР],
    "missingSections": [названия разделов, которых нет в работе],
    "extraSections": [подозрительные/несодержательные/лишние заголовки — например, "Глава 1. Теоретическая"],
    "sections": [
      {
        "section": "название раздела",
        "present": true|false,
        "wordCount": число | null,
        "verdict": "ok" | "too_short" | "too_long" | "missing",
        "comment": "конкретный разбор: что есть, чего не хватает, на что обратить внимание (2-4 предложения)"
      }
    ]
  },
  "logicAndCoherence": {
    "issues": ["конкретные проблемы логики/связности"],
    "strengths": ["что выстроено хорошо"]
  },
  "textQuality": {
    "issues": ["проблемы стиля: канцелярит, повторы, эссеистика, неакадемичность, и т.п."],
    "strengths": ["что в стиле хорошо"]
  },
  "recommendations": [
    {
      "category": "structure" | "content" | "logic" | "text_quality" | "formatting",
      "section": "название раздела или null",
      "issue": "что не так (одна фраза)",
      "suggestion": "что конкретно сделать (1-2 предложения, без переписывания за студента)"
    }
  ],
  "top5": [
    "Совет 1 — самый приоритетный (1-2 предложения, действенный)",
    "Совет 2",
    "Совет 3",
    "Совет 4",
    "Совет 5"
  ],
  "disclaimer": "${DISCLAIMER}"
}

Top5 ДОЛЖЕН содержать РОВНО 5 элементов — самые приоритетные действия, упорядоченные по важности (1 — самое важное). Без нумерации внутри строки.
В sections включай ВСЕ ожидаемые разделы (из expectedSections), плюс реально найденные дополнительные. Отсутствующий раздел получает present: false, wordCount: null, verdict: "missing".
Шаблонные/несодержательные названия глав (например: «Глава 1. Теоретическая», «Литературный обзор», «Глава 2. Эмпирическая») — отмечай в extraSections и обязательно выноси в recommendations с category="structure".`;
}

function buildUserPrompt(type: CourseType, doc: ParsedDocument): string {
  const preparedText = prepareTextForGPT(doc.text);
  const expected = EXPECTED_SECTIONS[type];

  return `Тип курсовой: ${type === 'research' ? 'Исследовательская курсовая работа (перерастает в магистерскую диссертацию)' : 'Курсовой проект (перерастает в магистерский проект)'}.

Ожидаемые разделы по методичке (используй ровно эти названия в expectedSections):
${expected.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Целевые пропорции объёма (для оценки verdict у sections):
${type === 'research'
      ? '- Введение ~7–12%\n- Концептуальная глава ~50–60% (ядро КР)\n- Дизайн эмпирического исследования ~20–30%\n- Заключение ~5–10%'
      : '- Введение ~7–12%\n- Концептуальная глава ~35–40%\n- Анализ рынка ~20–25%\n- Дизайн эмпирического исследования ~20–25%\n- Заключение ~5–10%'}

Сигналы «too_short»: раздел < ~500 слов; концептуальная глава < ~1500 слов — критически мало.
Сигналы «too_long»: один раздел > 70% работы; введение/заключение > 20% общего объёма.

Метаданные документа:
- Общее количество слов: ${doc.wordCount}
- Оценка количества страниц: ~${doc.pageEstimate}
- Найдено заголовков: ${doc.headings.length}
- Список найденных заголовков (до 50): ${doc.headings.slice(0, 50).join(' | ') || '— не найдены —'}

ТЕКСТ КУРСОВОЙ:
---
${preparedText}
---

Сделай полный анализ и верни строго JSON по описанной схеме. В top5 ровно 5 пунктов. Не переписывай работу — только советы.`;
}

// ---------- Model params (унифицировано с analyzer.ts) ----------

function getModelParams(model: string): {
  useMaxCompletionTokens: boolean;
  supportsJsonFormat: boolean;
  supportsTemperature: boolean;
} {
  const legacyModels = /^(gpt-4-|gpt-3)/i;
  const noTemperatureModels = /^(o[1-9]|gpt-5-nano)/i;
  if (legacyModels.test(model)) {
    return { useMaxCompletionTokens: false, supportsJsonFormat: true, supportsTemperature: true };
  }
  return {
    useMaxCompletionTokens: true,
    supportsJsonFormat: true,
    supportsTemperature: !noTemperatureModels.test(model),
  };
}

// ---------- Main entry ----------

export async function analyzeCourseWork(
  type: CourseType,
  doc: ParsedDocument,
  apiKey?: string,
): Promise<CourseAnalysisResult> {
  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OpenAI API Key не указан');

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const { useMaxCompletionTokens, supportsJsonFormat, supportsTemperature } = getModelParams(model);

  const openai = new OpenAI({ apiKey: key });

  const systemPrompt = buildSystemPrompt(type);
  const userPrompt = buildUserPrompt(type, doc);

  const requestParams: any = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    ...(supportsTemperature ? { temperature: 0.2 } : {}),
  };

  if (useMaxCompletionTokens) {
    requestParams.max_completion_tokens = 6000;
  } else {
    requestParams.max_tokens = 6000;
  }

  if (supportsJsonFormat) {
    requestParams.response_format = { type: 'json_object' };
  }

  // o-серия: нет system role, нет temperature, есть reasoning
  if (/^o[1-9]/i.test(model)) {
    requestParams.reasoning = { effort: 'high' };
    delete requestParams.temperature;
    requestParams.messages = [
      { role: 'user', content: `${systemPrompt}\n\n${userPrompt}` },
    ];
  }

  const completion = await openai.chat.completions.create(requestParams);
  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error('GPT вернул пустой ответ');

  let jsonStr = content;
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1].trim();

  let parsed: CourseAnalysisResult;
  try {
    parsed = JSON.parse(jsonStr) as CourseAnalysisResult;
  } catch (e) {
    throw new Error('GPT вернул невалидный JSON: ' + (e as Error).message);
  }

  return normaliseResult(parsed, type);
}

// ---------- Post-processing / safety ----------

function normaliseResult(
  raw: Partial<CourseAnalysisResult>,
  type: CourseType,
): CourseAnalysisResult {
  const expected = EXPECTED_SECTIONS[type];

  // Гарантируем, что disclaimer стоит
  const disclaimer = (raw.disclaimer && raw.disclaimer.trim()) || DISCLAIMER;

  // Top5: всегда ровно 5 элементов
  const top5Raw = Array.isArray(raw.top5) ? raw.top5.filter(s => typeof s === 'string' && s.trim()) : [];
  const top5 = top5Raw.slice(0, 5);
  while (top5.length < 5) {
    top5.push('Уточните этот совет с научным руководителем — модель не смогла сформулировать дополнительную рекомендацию.');
  }

  const structuralAnalysis = raw.structuralAnalysis || {
    expectedSections: expected,
    missingSections: [],
    extraSections: [],
    sections: [],
  };

  if (!Array.isArray(structuralAnalysis.expectedSections) || structuralAnalysis.expectedSections.length === 0) {
    structuralAnalysis.expectedSections = expected;
  }

  if (!Array.isArray(structuralAnalysis.sections)) structuralAnalysis.sections = [];
  if (!Array.isArray(structuralAnalysis.missingSections)) structuralAnalysis.missingSections = [];
  if (!Array.isArray(structuralAnalysis.extraSections)) structuralAnalysis.extraSections = [];

  return {
    overallSummary: raw.overallSummary || 'Общая оценка не сформирована.',
    structuralAnalysis,
    logicAndCoherence: {
      issues: raw.logicAndCoherence?.issues || [],
      strengths: raw.logicAndCoherence?.strengths || [],
    },
    textQuality: {
      issues: raw.textQuality?.issues || [],
      strengths: raw.textQuality?.strengths || [],
    },
    recommendations: Array.isArray(raw.recommendations) ? raw.recommendations : [],
    top5,
    disclaimer,
  };
}
