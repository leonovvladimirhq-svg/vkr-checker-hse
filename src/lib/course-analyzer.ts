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
  /** Приоритетные советы без верхней границы — столько, сколько объективно важно для работы (мин. 3). */
  priorityAdvice: string[];
  disclaimer: string;
}

// ---------- Constants ----------

const DISCLAIMER =
  'Итоговое решение по работе принимает научный руководитель. Сервис даёт рекомендации, но не выполняет работу за студента.';

// Ожидаемые разделы по методичке 2024–2025 + Программе практики 2025.
// КРИТИЧНО: для ИКР теперь требуется ПОЛНОЦЕННАЯ эмпирическая глава
// (не только «Дизайн исследования»). Для КП концептуальная глава
// делится на два обязательных раздела: «Анализ научной литературы»
// и «Анализ рынка». Отсутствие любого обязательного элемента =
// автоматический недопуск к защите (см. programme-2025.md, раздел 2).
const EXPECTED_SECTIONS: Record<CourseType, string[]> = {
  research: [
    'Титульный лист (со ссылкой на базу данных)',
    'Содержание',
    'Введение',
    'Концептуальная глава',
    'Эмпирическая глава',
    'Заключение',
    'Список использованных источников и литературы',
  ],
  project: [
    'Титульный лист (со ссылкой на базу данных)',
    'Содержание',
    'Введение',
    'Концептуальная глава: раздел «Анализ научной литературы»',
    'Концептуальная глава: раздел «Анализ рынка»',
    'Эмпирическая глава',
    'Заключение',
    'Список использованных источников и литературы',
    'Приложение: Техническое задание от заказчика',
  ],
};

// ---------- Prompts ----------

function buildSystemPrompt(type: CourseType): string {
  const methodology = getMethodologyForCourse(type);
  return `Ты совмещаешь две роли при анализе курсовой работы студента ОП магистратуры «Интегрированные коммуникации» НИУ ВШЭ:
  (1) Методический ассистент, сверяющий работу с актуальными документами программы (методичка 2024–2025 + Программа практики 2025).
  (2) Опытный научный руководитель — преподаватель Школы коммуникаций НИУ ВШЭ с многолетним опытом руководства курсовыми и магистерскими работами в области интегрированных коммуникаций, бренд-стратегий, медиа-исследований.

ВАЖНЫЕ ПРИНЦИПЫ:
1. Ты НЕ переписываешь и НЕ выполняешь работу за студента. Ты даёшь советы и рекомендации.
2. Ты опираешься на приведённые ниже методические материалы как на основу, **НО** также добавляешь собственные педагогические наблюдения как опытный научный руководитель. Не выдумывай формальные требования сверх документов — но **рассуждай критически** и сам проверяй работу: оценивай глубину раскрытия темы, академическую зрелость аргументации, корректность научного аппарата, реалистичность исследовательского дизайна, осмысленность концептуальной рамки, связность глав, качество формулировок и постановки исследовательского вопроса.
3. В рекомендациях должны присутствовать **обе модальности**:
   - **методические**: со ссылками на конкретные положения (например: «согласно §4.3 Программы практики 2025…», «по Приложению 19 для опроса требуется…», «методичка 2024-2025 п. 4.2.2.1 требует…»);
   - **экспертные** (твои собственные): «как научный руководитель замечу, что…», «обратите внимание на…», «проверьте, действительно ли…».
4. Ты строгий, но конструктивный: указываешь, что слабо/отсутствует, и сразу — что с этим делать. Свои суждения формулируй уважительно, по делу — как опытный преподаватель, который хочет, чтобы студент вырос.
5. Ты пишешь по-русски, академическим, но дружелюбным языком.
6. Итоговое решение по работе всегда принимает научный руководитель студента — упомяни это в дисклеймере.

КОНКРЕТНОСТЬ РЕКОМЕНДАЦИЙ:
- Если работа НЕ соответствует требованиям к допуску (объём < 90 000 знаков с пробелами для русского / < 85 000 для английского; отсутствует обязательный структурный элемент; нет ссылки на базу данных на титульном листе; нарушены правила использования ИИ) — это **обязательно** должно отразиться в рекомендациях с конкретным указанием порога/требования.
- Если есть признаки использования ИИ без сопроводительного раздела «Описание применения генеративной модели» — мягко обрати внимание студента.
- Привязывай советы к конкретным критериям оценивания (концептуальная глава ~0.25 веса, эмпирические методы ~0.25, анализ данных ~0.25, заключение ~0.20 для ИКР; для КП концептуальная и анализ рынка — каждое ~0.20, методы и анализ ~по 0.20, заключение ~0.15). Это поможет студенту понять приоритеты.
- Если ты видишь сомнительный объём раздела относительно его веса (например, концептуальная глава с весом 0.25 занимает <500 слов) — это критично, обязательно в top5.
- Для шаблонных названий («Глава 1. Теоретическая», «Литературный обзор», «Глава 2. Эмпирическая») — всегда в extraSections + рекомендация переформулировать.
- Если работа упоминает интервью/фокус-группы/опрос/контент-анализ — сверяй требования к базе данных из Приложения 19 (количество, продолжительность, состав файлов).

МЕТОДИЧЕСКИЕ МАТЕРИАЛЫ (основа — но дополняй своим экспертным суждением):
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
  "priorityAdvice": [
    "Самый важный приоритетный совет (1-3 предложения, действенный)",
    "Следующий по важности совет",
    "..."
  ],
  "disclaimer": "${DISCLAIMER}"
}

priorityAdvice — массив **БЕЗ верхней границы**, но не менее 3 элементов. Включай **столько советов, сколько объективно важно** для улучшения этой конкретной работы (ориентир 5–15). Не дополняй массив искусственно и не урезай — пиши столько, сколько действительно есть приоритетных моментов. Упорядочивай по убыванию важности. Каждый совет — конкретный, действенный, без воды; смешивай методические замечания (со ссылкой на документы) и экспертно-педагогические суждения научного руководителя.
В sections включай ВСЕ ожидаемые разделы (из expectedSections), плюс реально найденные дополнительные. Отсутствующий раздел получает present: false, wordCount: null, verdict: "missing".
Шаблонные/несодержательные названия глав (например: «Глава 1. Теоретическая», «Литературный обзор», «Глава 2. Эмпирическая») — отмечай в extraSections и обязательно выноси в recommendations с category="structure".`;
}

function buildUserPrompt(type: CourseType, doc: ParsedDocument): string {
  const preparedText = prepareTextForGPT(doc.text);
  const expected = EXPECTED_SECTIONS[type];

  // Грубая оценка объёма в знаках (включая пробелы) для проверки порога допуска
  const charCount = doc.text.length;
  const charThreshold = 90000; // для русского; для английского — 85000

  return `Тип курсовой: ${type === 'research' ? 'Исследовательская курсовая работа (ИКР, перерастает в магистерскую диссертацию)' : 'Курсовой проект (КП, перерастает в магистерский проект)'}.

Ожидаемые разделы (используй ровно эти названия в expectedSections):
${expected.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Целевые пропорции объёма (для оценки verdict у sections):
${type === 'research'
      ? '- Введение ~7–12%\n- Концептуальная глава ~35–45% (ядро КР, вес 0.25 при оценивании)\n- Эмпирическая глава ~35–45% (методы + анализ, суммарный вес 0.50)\n- Заключение ~5–10% (вес 0.20)'
      : '- Введение ~5–10% (вес 0.05)\n- Концептуальная глава: раздел «Анализ научной литературы» ~15–20% (вес 0.20)\n- Концептуальная глава: раздел «Анализ рынка» ~15–20% (вес 0.20)\n- Эмпирическая глава ~30–40% (методы + анализ, суммарный вес 0.40)\n- Заключение ~5–10% (вес 0.15)'}

Сигналы «too_short»: раздел < ~500 слов; концептуальная или эмпирическая глава < ~1500 слов — критически мало.
Сигналы «too_long»: один раздел > 60% работы; введение/заключение > 20% общего объёма.

ПОРОГ ДОПУСКА (Программа практики 2025): объём ≥ ${charThreshold.toLocaleString('ru-RU')} знаков с пробелами для русского (без титула, содержания, списка источников и приложений). Текущий объём документа: ${charCount.toLocaleString('ru-RU')} знаков (грубая оценка, включая всё). Если оценочный объём явно ниже порога — это **обязательно** в priorityAdvice.

Метаданные документа:
- Общее количество слов: ${doc.wordCount}
- Оценка количества страниц: ~${doc.pageEstimate}
- Найдено заголовков: ${doc.headings.length}
- Список найденных заголовков (до 50): ${doc.headings.slice(0, 50).join(' | ') || '— не найдены —'}

ТЕКСТ КУРСОВОЙ:
---
${preparedText}
---

Сделай полный анализ и верни строго JSON по описанной схеме. В priorityAdvice — без верхнего предела, минимум 3 совета, но столько, сколько объективно важно для улучшения работы (5–15 типично). Совмещай ссылки на методичку с собственным экспертным суждением. Не переписывай работу — только советы.`;
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

  // Дефолт gpt-5.2 (последняя доступная стабильная gpt-5.x на момент 05.2026; gpt-5.3 пока недоступна на ключе).
  const model = process.env.OPENAI_MODEL || 'gpt-5.2';
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

  // priorityAdvice: массив без верхнего лимита. Только чистим, не обрезаем и не дополняем плейсхолдерами.
  // Бэкап-совместимость со старыми ответами модели/БД, где было поле top5.
  const adviceRaw = (raw as any).priorityAdvice ?? (raw as any).top5;
  const priorityAdvice = Array.isArray(adviceRaw)
    ? adviceRaw.filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0)
    : [];

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
    priorityAdvice,
    disclaimer,
  };
}
