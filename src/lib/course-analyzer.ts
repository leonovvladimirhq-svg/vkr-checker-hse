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

export type ReadinessStatus =
  | 'ready_for_credit'        // «Вы близки к зачёту»
  | 'almost_there'            // «До успешной сдачи осталось совсем немного»
  | 'right_direction'         // «Работа требует доработки, но направление выбрано верно»
  | 'fix_then_defend'         // «После исправления замечаний работа может быть допущена к защите»
  | 'critical_issues';        // «Рекомендуется устранить критические замечания перед отправкой преподавателю»

export const READINESS_TEXTS: Record<ReadinessStatus, string> = {
  ready_for_credit:  'Вы близки к зачёту',
  almost_there:      'До успешной сдачи осталось совсем немного',
  right_direction:   'Работа требует доработки, но направление выбрано верно',
  fix_then_defend:   'После исправления замечаний работа может быть допущена к защите',
  critical_issues:   'Рекомендуется устранить критические замечания перед отправкой преподавателю',
};

export interface ErrorClassification {
  structural: number;
  content: number;
  formatting: number;
  ai_usage: number;
  other: number;
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
  /** Общая оценка готовности к зачёту: один из 5 заданных статусов. */
  readinessStatus: ReadinessStatus;
  /** Готовая фраза для UI (одна из 5 предзаданных). */
  readinessStatusText: string;
  /** Классификация ошибок по 5 категориям (для статистики и сводки преподавателю). */
  errorClassification: ErrorClassification;
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
  (1) Эксперт по методическим документам программы — сверяешь работу с действующими материалами (методичка 2024–2025 + Программа практики 2025).
  (2) Опытный научный руководитель — преподаватель Школы коммуникаций НИУ ВШЭ с многолетним опытом руководства курсовыми и магистерскими работами в области интегрированных коммуникаций, бренд-стратегий, медиа-исследований.

ВАЖНЫЕ ПРИНЦИПЫ:
1. Ты НЕ переписываешь и НЕ выполняешь работу за студента. Ты даёшь советы и рекомендации.
2. Ты опираешься на приведённые ниже методические материалы как на основу, **НО** также добавляешь собственные педагогические наблюдения как опытный научный руководитель. Не выдумывай формальные требования сверх документов — но **рассуждай критически** и сам проверяй работу: оценивай глубину раскрытия темы, академическую зрелость аргументации, корректность научного аппарата, реалистичность исследовательского дизайна, осмысленность концептуальной рамки, связность глав, качество формулировок и постановки исследовательского вопроса.
3. В рекомендациях должны присутствовать **обе модальности**:
   - **методические**: со ссылками на конкретные положения (например: «согласно §4.3 Программы практики 2025…», «по Приложению 19 для опроса требуется…», «методичка 2024-2025 п. 4.2.2.1 требует…»);
   - **экспертные** (твои собственные): «как научный руководитель замечу, что…», «обратите внимание на…», «проверьте, действительно ли…».

ТОН И ФОРМУЛИРОВКИ — критически важно:
4. Тон — **конструктивный и поддерживающий**. Цель — помочь студенту улучшить работу, а не демотивировать. Избегай категоричных, обесценивающих и пугающих формулировок.
   - НЕ используй: «недопустимо», «плохо», «совершенно не годится», «провал», «работа не будет принята», «критически плохо», «вы делаете ошибку», эмоционально окрашенные оценки.
   - Используй вместо этого: «стоит усилить», «имеет смысл доработать», «обратите внимание», «можно улучшить, если…», «было бы полезно добавить», «рекомендуем дополнить», «работа выиграет, если…».
   - Слово «критично/критический» допустимо только когда речь о реальном формальном недопуске (объём, отсутствие обязательного раздела) — и даже там лучше формулировать как «требует внимания в первую очередь».
   - Начинай с того, что уже сделано хорошо, и только потом — что можно улучшить.
5. Ты пишешь по-русски, академическим, но дружелюбным языком — как преподаватель, который хочет, чтобы студент вырос.
6. **Никогда** не используй термины «виртуальный помощник», «бот», «ассистент» в текстах ответа — обращайся от первого лица как научный руководитель.
7. Итоговое решение по работе всегда принимает научный руководитель студента — упомяни это в дисклеймере (мягко, без давления).

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
  "overallSummary": "2-3 предложения общей оценки работы — что уже сделано хорошо и над чем стоит поработать.",
  "readinessStatus": "одно из значений: ready_for_credit | almost_there | right_direction | fix_then_defend | critical_issues",
  "readinessStatusText": "точная фраза, соответствующая статусу (см. список ниже).",
  "errorClassification": {
    "structural": 0,
    "content": 0,
    "formatting": 0,
    "ai_usage": 0,
    "other": 0
  },
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

priorityAdvice — массив **БЕЗ верхней границы**, но не менее 3 элементов. Включай **столько советов, сколько объективно важно** для улучшения этой конкретной работы (ориентир 5–15). Не дополняй массив искусственно и не урезай — пиши столько, сколько действительно есть приоритетных моментов. Упорядочивай по убыванию важности. Каждый совет — конкретный, действенный, без воды; смешивай методические замечания (со ссылкой на документы) и экспертно-педагогические суждения научного руководителя. Формулировки — поддерживающие и конструктивные (см. правила тона выше).
В sections включай ВСЕ ожидаемые разделы (из expectedSections), плюс реально найденные дополнительные. Отсутствующий раздел получает present: false, wordCount: null, verdict: "missing".
Шаблонные/несодержательные названия глав (например: «Глава 1. Теоретическая», «Литературный обзор», «Глава 2. Эмпирическая») — отмечай в extraSections и обязательно выноси в recommendations с category="structure".

ПРАВИЛА ВЫБОРА readinessStatus (выбирай ОДНО значение):
- "critical_issues" → "Рекомендуется устранить критические замечания перед отправкой преподавателю": объём < 50 % порога (≈< 45 000 знаков) ИЛИ ≥ 3 отсутствующих обязательных раздела ИЛИ грубые нарушения правил ИИ при подтверждённом использовании.
- "fix_then_defend" → "После исправления замечаний работа может быть допущена к защите": объём 50–80 % порога ИЛИ 1–2 отсутствующих обязательных раздела ИЛИ существенные содержательные проблемы (нет эмпирики/нет рынка/нет концептуальной рамки).
- "right_direction" → "Работа требует доработки, но направление выбрано верно": объём 80–100 % порога; все обязательные разделы присутствуют, но один-два из них too_short или содержательно слабы; направление и подход выбраны корректно.
- "almost_there" → "До успешной сдачи осталось совсем немного": объём ≥ 100 % порога; все разделы есть и содержательны; есть только точечные замечания по содержанию/стилю/логике.
- "ready_for_credit" → "Вы близки к зачёту": все формальные требования выполнены, есть только мелкие пожелания/полировка.

readinessStatusText ДОЛЖЕН быть строго одной из 5 фраз выше — не сочиняй собственный текст.

errorClassification — посчитай и верни количество замечаний по 5 категориям (соответствуют category в recommendations): structural, content, logic→content, text_quality→content, formatting, ai_usage (если задеваешь правила использования ИИ), other (если есть прочее). Это для статистики преподавателю — будь честен в подсчёте.`;
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

  // 16 000 токенов: при priorityAdvice без лимита + детальном разборе разделов
  // ответ может занимать ~30–40 тыс. символов. С 6 000 токенов модель обрезалась
  // посередине строки и ломала JSON ("Unterminated string at position ~20k").
  if (useMaxCompletionTokens) {
    requestParams.max_completion_tokens = 16000;
  } else {
    requestParams.max_tokens = 16000;
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
  const finishReason = completion.choices[0]?.finish_reason;
  if (!content) throw new Error('GPT вернул пустой ответ');

  let jsonStr = content;
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1].trim();

  let parsed: Partial<CourseAnalysisResult> | null = null;
  try {
    parsed = JSON.parse(jsonStr) as Partial<CourseAnalysisResult>;
  } catch (e) {
    // JSON, скорее всего, обрезан по лимиту токенов или сломан.
    // Пробуем починить (закрыть незакрытые строки/массивы/объекты).
    console.warn(
      `[course-analyzer] JSON parse failed (finish=${finishReason}, len=${jsonStr.length}). Attempting repair. Error: ${(e as Error).message}`
    );
    const repaired = tryRepairTruncatedJson(jsonStr);
    if (repaired) {
      try {
        parsed = JSON.parse(repaired) as Partial<CourseAnalysisResult>;
        console.warn('[course-analyzer] JSON repair successful — partial result will be returned.');
      } catch (e2) {
        throw new Error(
          `GPT вернул невалидный JSON (finish=${finishReason}, len=${jsonStr.length}): ${(e as Error).message}. Repair тоже не сработал: ${(e2 as Error).message}`
        );
      }
    } else {
      throw new Error(
        `GPT вернул невалидный JSON (finish=${finishReason}, len=${jsonStr.length}): ${(e as Error).message}`
      );
    }
  }

  return normaliseResult(parsed, type);
}

/**
 * Чинит обрезанный JSON, который не закрылся из-за лимита токенов.
 * Алгоритм:
 *  1. Идёт по строке, ведёт стек скобок (`{ [`).
 *  2. Если оказались внутри строки (`"`) — обрезаем до последней `"` ИЛИ закрываем строку.
 *  3. Закрываем все открытые массивы и объекты в правильном порядке.
 * Это даёт частичный, но валидный JSON — клиенту покажется усечённый, но рабочий ответ.
 */
function tryRepairTruncatedJson(s: string): string | null {
  const stack: Array<'{' | '['> = [];
  let inString = false;
  let escape = false;
  let lastSafeEnd = -1; // позиция после последнего полностью закрытого значения вне строки

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') {
      inString = !inString;
      if (!inString) lastSafeEnd = i + 1;
      continue;
    }
    if (inString) continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' && stack[stack.length - 1] === '{') { stack.pop(); lastSafeEnd = i + 1; }
    else if (ch === ']' && stack[stack.length - 1] === '[') { stack.pop(); lastSafeEnd = i + 1; }
    else if (ch === ',' && stack.length > 0) lastSafeEnd = i; // вне строки — безопасная точка между элементами
  }

  if (stack.length === 0 && !inString) return null; // считаем, что починка не нужна — пусть кидает исходную ошибку

  // Стратегия: обрезаем до last safe end, потом закрываем всё, что в стеке.
  let truncated = lastSafeEnd > 0 ? s.slice(0, lastSafeEnd) : s;
  // Снова считаем состояние стека для truncated.
  const reStack: Array<'{' | '['> = [];
  let reIn = false;
  let reEsc = false;
  for (let i = 0; i < truncated.length; i++) {
    const ch = truncated[i];
    if (reEsc) { reEsc = false; continue; }
    if (ch === '\\') { reEsc = true; continue; }
    if (ch === '"') { reIn = !reIn; continue; }
    if (reIn) continue;
    if (ch === '{' || ch === '[') reStack.push(ch);
    else if (ch === '}' && reStack[reStack.length - 1] === '{') reStack.pop();
    else if (ch === ']' && reStack[reStack.length - 1] === '[') reStack.pop();
  }
  if (reIn) return null; // строка не закрыта даже после обрезки — починить надёжно нельзя
  // Убираем trailing запятую если есть
  truncated = truncated.replace(/,\s*$/, '');
  // Закрываем стек
  const closers = reStack.reverse().map(c => (c === '{' ? '}' : ']')).join('');
  return truncated + closers;
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

  // readinessStatus + текст: если GPT не вернул валидное значение — фолбэк-эвристика.
  const validStatuses: ReadinessStatus[] = ['ready_for_credit', 'almost_there', 'right_direction', 'fix_then_defend', 'critical_issues'];
  let readinessStatus: ReadinessStatus = (raw.readinessStatus && validStatuses.includes(raw.readinessStatus as ReadinessStatus))
    ? (raw.readinessStatus as ReadinessStatus)
    : computeFallbackReadiness(raw);
  const readinessStatusText = READINESS_TEXTS[readinessStatus];

  // errorClassification: безопасные значения (заполняем нулями, если не пришло).
  const ec = (raw as any).errorClassification || {};
  const errorClassification: ErrorClassification = {
    structural: Number(ec.structural) || 0,
    content: Number(ec.content) || 0,
    formatting: Number(ec.formatting) || 0,
    ai_usage: Number(ec.ai_usage) || 0,
    other: Number(ec.other) || 0,
  };

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
    readinessStatus,
    readinessStatusText,
    errorClassification,
    disclaimer,
  };
}

/**
 * Эвристика статуса готовности, если GPT не вернул валидное значение.
 * Логика: по количеству missingSections + наличию проблемных вердиктов.
 */
function computeFallbackReadiness(raw: Partial<CourseAnalysisResult>): ReadinessStatus {
  const missing = raw.structuralAnalysis?.missingSections?.length ?? 0;
  const sections = raw.structuralAnalysis?.sections ?? [];
  const tooShortCount = sections.filter(s => s.verdict === 'too_short').length;
  const issuesCount = (raw.logicAndCoherence?.issues?.length ?? 0) + (raw.textQuality?.issues?.length ?? 0);

  if (missing >= 3) return 'critical_issues';
  if (missing >= 1 || tooShortCount >= 3) return 'fix_then_defend';
  if (tooShortCount >= 1 || issuesCount >= 5) return 'right_direction';
  if (issuesCount >= 1) return 'almost_there';
  return 'ready_for_credit';
}
