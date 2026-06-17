// ============================================================
// Анализатор курсовых работ через OpenAI GPT API
// Принципиально иной формат вывода относительно ВКР-анализатора:
// не pass/fail чек-лист, а структурированные рекомендации по
// улучшению (структура, объёмы, логика, качество текста, top-5).
// ============================================================

import OpenAI from 'openai';
import { ParsedDocument, prepareTextForGPT } from './parser';
import { CourseType, getMethodologyForCourse } from './methodology';
import type { DbAnalysisResult } from './db-analyzer';

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

export interface DatabaseAnalysisSection {
  accessible: boolean;
  fileCount: number;
  fileCounts: {
    audio: number;
    tables: number;
    docs: number;
    other: number;
  };
  issues: string[];
  strengths: string[];
  note: string;
}

/** Один подблок разбора эмпирической главы. */
export interface EmpiricalSubAnalysis {
  comment: string;
  issues: string[];
  strengths: string[];
}

/**
 * Разбор эмпирической главы, разделённый на два блока (по просьбе преподавателей):
 *  - design   — дизайн исследования и инструменты сбора данных (анкета, гайд интервью и т.п.);
 *  - analysis — анализ и интерпретация полученных данных.
 * Может быть null, если эмпирической главы в работе нет.
 */
export interface EmpiricalChapterAnalysis {
  present: boolean;
  design: EmpiricalSubAnalysis;
  analysis: EmpiricalSubAnalysis;
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
  /** Анализ базы данных с Яндекс.Диска (если ссылка передана и доступна). */
  databaseAnalysis: DatabaseAnalysisSection;
  /** Разбор эмпирической главы двумя блоками (дизайн+инструменты / анализ+интерпретация). */
  empiricalChapter: EmpiricalChapterAnalysis | null;
  disclaimer: string;
}

// ---------- Constants ----------

const DISCLAIMER =
  'Итоговое решение по работе принимает научный руководитель. ИИ-консультант даёт рекомендации, но не выполняет работу за студента.';

// Ожидаемые разделы по методичке 2024–2025 + Программе практики 2025.
// Каждый раздел имеет:
//  - canonical: «официальное» название из методички (используется как expectedSection);
//  - synonyms:  альтернативные формулировки, которые тоже считаются совпадением;
//  - keywords:  ключевые слова, по которым раздел можно найти в тексте, даже если
//               отдельного заголовка нет (например, вставлен картинками).
interface ExpectedSection {
  canonical: string;
  synonyms: string[];
  keywords: string[];
}

const EXPECTED_SECTIONS: Record<CourseType, ExpectedSection[]> = {
  research: [
    { canonical: 'Титульный лист (со ссылкой на базу данных)',
      synonyms: ['Титул', 'Титульник', 'Title page'],
      keywords: ['Высшая школа экономики', 'магистратура', 'Москва'] },
    { canonical: 'Содержание',
      synonyms: ['Оглавление', 'Contents', 'Table of contents'],
      keywords: [] },
    { canonical: 'Введение',
      synonyms: ['Introduction', 'Вводная часть'],
      keywords: ['актуальность', 'исследовательский вопрос', 'цель работы'] },
    { canonical: 'Концептуальная глава',
      synonyms: ['Теоретическая глава', 'Глава 1', 'Литературный обзор', 'Теоретическая база', 'Концептуальная часть', 'Conceptual chapter'],
      keywords: ['теоретическая рамка', 'обзор литературы', 'концептуализация'] },
    { canonical: 'Эмпирическая глава',
      synonyms: ['Эмпирическая часть', 'Глава 2', 'Практическая часть', 'Исследование', 'Эмпирическое исследование', 'Empirical chapter'],
      keywords: ['методология', 'выборка', 'процедура исследования', 'результаты'] },
    { canonical: 'Заключение',
      synonyms: ['Выводы', 'Conclusion'],
      keywords: ['основные выводы', 'ограничения исследования'] },
    { canonical: 'Список использованных источников и литературы',
      synonyms: ['Список литературы', 'Библиография', 'References', 'Список источников'],
      keywords: [] },
  ],
  project: [
    { canonical: 'Титульный лист (со ссылкой на базу данных)',
      synonyms: ['Титул', 'Титульник', 'Title page'],
      keywords: ['Высшая школа экономики', 'магистратура'] },
    { canonical: 'Содержание',
      synonyms: ['Оглавление', 'Contents'],
      keywords: [] },
    { canonical: 'Введение',
      synonyms: ['Introduction'],
      keywords: ['бриф заказчика', 'цель проекта', 'задачи бренда'] },
    { canonical: 'Концептуальная глава: раздел «Анализ научной литературы»',
      synonyms: ['Анализ научной литературы', 'Литературный обзор', 'Теоретическая база', 'Обзор литературы', 'Literature review'],
      keywords: ['академическая дискуссия', 'обзор источников', 'концептуализация'] },
    { canonical: 'Концептуальная глава: раздел «Анализ рынка»',
      synonyms: ['Анализ рынка', 'Обзор рынка', 'Обзор и анализ рынка', 'Анализ отрасли', 'Market analysis', 'Market overview', 'Анализ конкурентов', 'Анализ потребителя', 'Анализ бренда и конкурентов'],
      keywords: ['доля рынка', 'конкуренты', 'целевая аудитория', 'тренды рынка', 'fashion-ритейл', 'индустриальные исследования'] },
    { canonical: 'Эмпирическая глава',
      synonyms: ['Эмпирическая часть', 'Глава 2', 'Практическая часть', 'Исследование', 'Эмпирическое исследование'],
      keywords: ['методология', 'выборка', 'процедура исследования', 'результаты'] },
    { canonical: 'Заключение',
      synonyms: ['Выводы', 'Conclusion'],
      keywords: ['результаты для заказчика', 'структура будущей практической части'] },
    { canonical: 'Список использованных источников и литературы',
      synonyms: ['Список литературы', 'Библиография', 'References'],
      keywords: [] },
    { canonical: 'Приложение: Техническое задание от заказчика',
      synonyms: ['Техническое задание', 'ТЗ', 'ТЗ от заказчика', 'Бриф заказчика', 'Бриф', 'Бриф клиента', 'Client brief'],
      keywords: ['описание задачи заказчика', 'ожидаемый результат', 'требования клиента'] },
  ],
};

// ---------- Prompts ----------

function buildSystemPrompt(type: CourseType): string {
  const methodology = getMethodologyForCourse(type);
  const expected = EXPECTED_SECTIONS[type];

  // Сопоставление синонимов — встроено в промпт, чтобы GPT мог матчить
  // студенческие формулировки («бриф заказчика», «обзор рынка fashion-ритейла»)
  // с каноническими названиями из методички.
  const synonymsBlock = expected
    .filter(s => s.synonyms.length > 0 || s.keywords.length > 0)
    .map(s => {
      const lines = [`«${s.canonical}»`];
      if (s.synonyms.length > 0) lines.push(`   синонимы: ${s.synonyms.map(x => `«${x}»`).join(', ')}`);
      if (s.keywords.length > 0) lines.push(`   ключевые слова: ${s.keywords.map(x => `«${x}»`).join(', ')}`);
      return lines.join('\n');
    }).join('\n');

  return `Ты — ИИ-консультант по курсовым работам ОП магистратуры «Интегрированные коммуникации» НИУ ВШЭ. Ты обучен на методических документах программы (методичка 2024–2025 + Программа практики 2025) и помогаешь студентам улучшать черновики курсовых работ перед отправкой научному руководителю.

ТВОЯ РОЛЬ И ГРАНИЦЫ:
1. Ты ИИ-консультант, а НЕ научный руководитель. Итоговое решение по работе всегда принимает реальный научный руководитель — упомяни это в дисклеймере, но не давай громких оценок «зачёт/незачёт».
2. Ты НЕ переписываешь и НЕ выполняешь работу за студента. Ты даёшь рекомендации.
3. Ты опираешься на методические материалы и одновременно даёшь свои аналитические наблюдения по содержанию работы: глубина раскрытия темы, корректность научного аппарата, реалистичность исследовательского дизайна, осмысленность концептуальной рамки, связность глав, качество формулировок.
4. В рекомендациях используй обе модальности:
   - методические — со ссылками на конкретные положения («согласно §4.3 Программы практики 2025…», «по Приложению 19 для опроса требуется…», «методичка 2024-2025 п. 4.2.2.1 требует…»);
   - аналитические — твои собственные наблюдения по тексту работы. Формулируй их без претензии на роль руководителя: «обратите внимание на…», «стоит проверить…», «как ИИ-консультант рекомендую усилить…».

ЧЕГО НЕЛЬЗЯ ПИСАТЬ (важно):
- «Как научный руководитель…», «рекомендую вам как руководитель…» — ты не научный руководитель.
- «Я считаю работу неудовлетворительной» — не выноси приговор, давай рекомендации.
- Категоричные слова: «недопустимо», «провал», «работа не будет принята», «критически плохо», «вы делаете ошибку».
- Замени на: «стоит усилить», «имеет смысл доработать», «обратите внимание», «было бы полезно добавить», «работа выиграет, если…».
- Слово «критический» допустимо только в формулировке «требует внимания в первую очередь» — для случаев формального недопуска (объём, отсутствие обязательного раздела).
- Не используй слова «бот» / «виртуальный помощник» в адрес себя — представляйся как «ИИ-консультант».

СОПОСТАВЛЕНИЕ РАЗДЕЛОВ ПО СМЫСЛУ (критично):
Студент часто называет разделы по-своему. Сопоставляй заголовки документа с ожидаемыми разделами **по смыслу, а не по точному совпадению строк**. Используй таблицу синонимов и ключевых слов:
${synonymsBlock}

Правила сопоставления:
- Если заголовок студента семантически соответствует ожидаемому разделу — считай раздел присутствующим (present: true), а в comment упоминай ОБА имени: ожидаемое и фактическое (например: «Присутствует в виде раздела “Обзор и анализ отечественного fashion-рынка” — соответствует ожидаемому “Анализ рынка”»).
- Если соответствующего заголовка нет, но содержательно раздел присутствует (есть ключевые слова в тексте) — считай его present: true и отметь это в comment.
- Если раздел вставлен изображениями (нет распознаваемого текста, но в файле много непарсимых элементов рядом с темой раздела) — поставь present: false, а в comment явно укажи: «Возможно, раздел вставлен в виде изображений — автоматическая проверка недоступна. Убедитесь, что текст раздела присутствует машиночитаемом виде».
- ТЗ / бриф заказчика — особый случай: даже если файл назван «бриф заказчика» и состоит из картинок, считай требование выполненным, если в тексте работы есть ссылка на это приложение. В comment отметь: «ТЗ присутствует в виде брифа заказчика в приложении».

НАЗВАНИЯ РАЗДЕЛОВ — КРИТИЧЕСКИ ВАЖНОЕ ПРАВИЛО (частая ошибка прошлых версий):
- Канонические названия из таблицы выше («Анализ научной литературы», «Анализ рынка», «Концептуальная глава» и т.п.) — это ТОЛЬКО ВНУТРЕННИЙ МАППИНГ для тебя. НЕ показывай их студенту как «обязательные» названия и НЕ предлагай переименовать раздел в каноническое название.
- Методические рекомендации ОП ИК, наоборот, ТРЕБУЮТ от студента СОДЕРЖАТЕЛЬНЫХ названий глав и параграфов (например «Обзор международного опыта в…», «Анализ потребителя и лучших практик»). Шаблонные канцелярские названия вроде «Анализ научной литературы», «Анализ рынка», «Глава 1. Теоретическая» — нежелательны.
- Поэтому: если раздел присутствует по смыслу под содержательным названием — present: true, НЕ заноси его в missingSections и НЕ пиши «раздел отсутствует / нужно оформить отдельно / обозначить канонически». Это прямо противоречит методичке и было ошибкой.
- В missingSections заноси раздел ТОЛЬКО если его нет ни по заголовку, ни по синонимам, ни по ключевым словам, ни по смыслу содержания.
- Если сомневаешься, есть ли раздел/элемент в работе (например, материал может быть в приложении или в середине текста) — НЕ утверждай его отсутствие. Сформулируй мягко: «убедитесь, что… присутствует» или отметь как требующее уточнения, но не констатируй отсутствие как факт.

ТОН:
- Конструктивный и поддерживающий. Цель — помочь студенту улучшить работу, не демотивировать.
- Начинай разбор с того, что уже сделано хорошо, и только потом — что можно улучшить.
- Пиши по-русски, академическим, но дружелюбным языком.

ОБЪЁМ РАБОТЫ:
- Сервер уже посчитал точный объём «тела работы» (без титульника, оглавления, списка литературы и приложений) в трёх метриках: знаки с пробелами, знаки без пробелов, слова. Это в user-промпте под заголовком «ТОЧНЫЙ ОБЪЁМ ТЕЛА РАБОТЫ».
- При оценке объёма опирайся ТОЛЬКО на эти числа. НЕ пиши абстрактные оценки типа «примерно столько-то страниц» и НЕ предлагай студенту «проверить объём вручную» — называй конкретные числа.
- Порог допуска по Программе практики 2025: ≥ 90 000 знаков с пробелами для русского / ≥ 85 000 для английского.
- Если объём ниже порога — обязательно в priorityAdvice с конкретным числом («сейчас X знаков с пробелами, требуется не менее 90 000»).
- Если поле «volumeBreakdown.introFound: false» — значит «Введение» не найдено, и body-объём может быть завышен (включает титульник). Упомяни это.

БАЗА ДАННЫХ (если в user-промпте есть блок «СОДЕРЖИМОЕ БАЗЫ ДАННЫХ»):
- Анализируй содержимое БД и заполни databaseAnalysis в JSON-ответе.
- Считай файлы по типам (аудио/видео, таблицы, документы, другое).
- Если в работе упоминаются интервью/фокус-группы/опрос/контент-анализ — сверяй с Приложением 19 (требования к количеству, продолжительности, формату).
- Если в БД явные проблемы (нет нужных файлов, файл назван невнятно, пустые таблицы) — в issues. Если БД хорошо организована — в strengths.

КОНКРЕТНОСТЬ:
- Если работа НЕ соответствует требованиям к допуску (объём, отсутствие обязательного раздела, нет ссылки на базу данных на титульном листе, нарушены правила использования ИИ) — обязательно в рекомендациях с конкретным указанием порога/требования.
- Если есть признаки использования ИИ без раздела «Описание применения генеративной модели» — мягко обрати внимание.
- Привязывай советы к весам критериев оценивания (концептуальная глава ~0.25 веса, эмпирические методы ~0.25, анализ данных ~0.25, заключение ~0.20 для ИКР; для КП концептуальная и анализ рынка — каждое ~0.20, методы и анализ ~по 0.20, заключение ~0.15).
- В extraSections заноси ТОЛЬКО реально бессодержательные/пустые заголовки («Глава 1», «Глава 2», «Часть 1» без какого-либо содержательного названия). Для них совет — сделать название СОДЕРЖАТЕЛЬНЫМ (отражающим суть главы), а НЕ переименовать в каноническое название из таблицы. Содержательные авторские названия в extraSections не заноси.

АКАДЕМИЧЕСКИЙ СТИЛЬ САМИХ РЕКОМЕНДАЦИЙ (важно):
- Твои формулировки в comment / issue / suggestion / priorityAdvice должны быть в академическом, нейтральном стиле — без жаргона, публицистики и разговорных метафор. Раз мы требуем академического стиля от студента, отзыв тоже должен ему соответствовать.
- НЕ используй слова вроде «сшить» (элементы работы), «прокачать», «докрутить», «по-хорошему», «по факту», «и т.д.» вместо конкретики. Заменяй на «логически связать», «доработать», «усилить аргументацию».

СОДЕРЖАТЕЛЬНЫЕ ПРОВЕРКИ (не только структура — преподаватели ждут анализа сути):
- Соответствие дизайна исследования: если в работе заявлен качественный дизайн, но присутствуют количественные гипотезы (формулировки вида «X будет выше, если Y»), или наоборот — обрати на это внимание: гипотезы в количественном формате не нужны для качественного исследования. Проверь, что заявленный в дизайне метод соответствует тому, что реально делается в эмпирической главе.
- Источники в концептуальной главе: если опора идёт на неакадемические источники (блоги, новостные заметки, рекламные материалы) там, где нужна научная литература, — порекомендуй заменить на рецензируемые научные работы.
- Выводы по параграфам: если выводы отрывочны, не обобщают содержание параграфа — отметь, что их стоит раскрыть полнее.
- Чрезмерная буллитность: если значимое содержание подано списками-буллитами там, где нужен связный академический текст, — обрати внимание.
- Статистика (для эмпирических работ с количественными данными): проверь корректность выбора критериев. Например, коэффициент корреляции Пирсона неуместен для порядковых данных — для них подходят Спирмен/Кендалл; одновременное применение Пирсона и Спирмена для одной задачи требует обоснования. Сверяй выводы с реально описанными результатами анализа.

МЕТОДИЧЕСКИЕ МАТЕРИАЛЫ (опирайся на них):
---
${methodology}
---

ФОРМАТ ВЫВОДА — строго JSON-объект (никакого текста вне JSON):
{
  "overallSummary": "2-3 предложения общей оценки работы — что уже сделано хорошо и над чем стоит поработать.",
  "readinessStatus": "одно из значений: ready_for_credit | almost_there | right_direction | fix_then_defend | critical_issues",
  "readinessStatusText": "точная фраза, соответствующая статусу (см. список ниже).",
  "errorClassification": {
    "structural": 0, "content": 0, "formatting": 0, "ai_usage": 0, "other": 0
  },
  "structuralAnalysis": {
    "expectedSections": [список канонических названий ожидаемых разделов для этого типа КР],
    "missingSections": [названия разделов, которых нет даже по синонимам/ключевым словам],
    "extraSections": [подозрительные/несодержательные/лишние заголовки — например, «Глава 1. Теоретическая»],
    "sections": [
      {
        "section": "каноническое название раздела",
        "present": true|false,
        "wordCount": число | null,
        "verdict": "ok" | "too_short" | "too_long" | "missing",
        "comment": "конкретный разбор: что есть, чего не хватает; если найдено по синониму — упомяни оба имени (2-4 предложения)"
      }
    ]
  },
  "logicAndCoherence": { "issues": [...], "strengths": [...] },
  "textQuality":       { "issues": [...], "strengths": [...] },
  "recommendations": [
    {
      "category": "structure" | "content" | "logic" | "text_quality" | "formatting",
      "section": "название раздела или null",
      "issue": "что не так (одна фраза)",
      "suggestion": "что конкретно сделать (1-2 предложения, без переписывания за студента)"
    }
  ],
  "databaseAnalysis": {
    "accessible": true|false,
    "fileCount": число,
    "fileCounts": { "audio": число, "tables": число, "docs": число, "other": число },
    "issues":    ["...что не так с БД..."],
    "strengths": ["...что в БД сделано хорошо..."],
    "note": "1-2 предложения общей оценки БД; если ссылка не указана — «База данных не была передана для анализа»"
  },
  "empiricalChapter": {
    "present": true|false,
    "design":   { "comment": "разбор дизайна исследования и инструментов сбора данных (анкета, гайд интервью, протокол наблюдения): обоснован ли выбор метода, корректны ли инструменты, связаны ли они с концептуальной частью", "issues": ["..."], "strengths": ["..."] },
    "analysis": { "comment": "разбор анализа и интерпретации данных: корректность метода анализа, статистических критериев, обоснованность выводов, связь выводов с результатами", "issues": ["..."], "strengths": ["..."] }
  },
  "priorityAdvice": [
    "Самый важный приоритетный совет (1-3 предложения, действенный)",
    "..."
  ],
  "disclaimer": "${DISCLAIMER}"
}

priorityAdvice — массив **БЕЗ верхней границы**, минимум 3 элемента, типично 5–15. Включай столько советов, сколько объективно важно. Не дополняй искусственно. Упорядочивай по убыванию важности. Каждый совет — конкретный, действенный. Формулировки — поддерживающие, без претензии на роль руководителя.

В structuralAnalysis.sections включай ВСЕ ожидаемые разделы. Отсутствующий → present: false, wordCount: null, verdict: «missing». Раздел, найденный по синониму, → present: true и в comment упомяни обе формулировки.

empiricalChapter — заполняй ОБЯЗАТЕЛЬНО двумя блоками. Первый блок (design) — про дизайн исследования и инструменты сбора данных (обоснование выбора метода, качество анкеты/гайда/протокола, связь с концептуальной частью). Второй блок (analysis) — про анализ и интерпретацию полученных данных (корректность метода анализа и статистических критериев, обоснованность и подтверждённость выводов). Если эмпирической главы в работе нет — present: false и пустые подблоки.

ПРАВИЛА ВЫБОРА readinessStatus:
- "critical_issues" → объём < 50 % порога (≈< 45 000 знаков с пробелами) ИЛИ ≥ 3 отсутствующих обязательных раздела ИЛИ грубые нарушения правил ИИ при подтверждённом использовании.
- "fix_then_defend" → объём 50–80 % порога ИЛИ 1–2 отсутствующих обязательных раздела ИЛИ существенные содержательные проблемы.
- "right_direction" → объём 80–100 % порога; разделы есть, но один-два too_short или содержательно слабы.
- "almost_there" → объём ≥ 100 % порога; все разделы есть и содержательны; только точечные замечания.
- "ready_for_credit" → все формальные требования выполнены, только мелкие пожелания.

readinessStatusText — строго одна из 5 фраз: "${Object.values(READINESS_TEXTS).join('", "')}".

errorClassification — посчитай количество замечаний по 5 категориям (соответствуют category в recommendations + ai_usage и other для остального).`;
}

function buildUserPrompt(
  type: CourseType,
  doc: ParsedDocument,
  dbAnalysis?: DbAnalysisResult | null,
): string {
  const preparedText = prepareTextForGPT(doc.text);
  const expected = EXPECTED_SECTIONS[type].map(s => s.canonical);

  const charThreshold = 90000; // для русского; для английского — 85000

  // Блок с точным объёмом тела работы
  const breakdown = doc.volumeBreakdown;
  const volumeBlock = `ТОЧНЫЙ ОБЪЁМ ТЕЛА РАБОТЫ (без титульника, оглавления, списка литературы и приложений; числа — сырые целые, не меняй их разрядность):
- Знаков с пробелами: ${doc.bodyCharCountWithSpaces} (порог допуска ${charThreshold}; объём УЖЕ включает сноски)
- Из них сноски: ${doc.footnoteCharCount} знаков (сноски входят в тело работы по Программе практики)
- Знаков без пробелов: ${doc.bodyCharCountNoSpaces}
- Слов: ${doc.bodyWordCount}
- Объём приложений (для информации): ${doc.appendixWordCount} слов
- Распознанные границы: титульник = ${breakdown.titlePageDetected ? 'да' : 'нет'}, «Введение» = ${breakdown.introFound ? 'найдено' : 'НЕ найдено'}, «Список литературы» = ${breakdown.biblioFound ? 'найден' : 'НЕ найден'}, «Приложение» = ${breakdown.appendixFound ? 'найдено' : 'не найдено'}
- Общий объём документа (для справки): ${doc.text.length} знаков с пробелами / ${doc.wordCount} слов

ВАЖНО: При оценке объёма используй ТОЛЬКО bodyCharCountWithSpaces (${doc.bodyCharCountWithSpaces} знаков с пробелами). Не делай абстрактных оценок «примерно столько-то страниц» — приводи точное число и сравнивай с порогом ${charThreshold}. Пиши число объёма ровно как дано, не сокращай разряды.`;

  // Блок с содержимым БД (если есть)
  const dbBlock = dbAnalysis?.accessible && dbAnalysis.description
    ? `\n\nСОДЕРЖИМОЕ БАЗЫ ДАННЫХ (Яндекс.Диск):\n${dbAnalysis.description}\n\nИспользуй эти данные, чтобы заполнить databaseAnalysis в JSON-ответе. Сверь содержимое БД с заявленными в работе методами исследования (Приложение 19 Программы практики 2025).`
    : dbAnalysis && !dbAnalysis.accessible
      ? `\n\nБАЗА ДАННЫХ: ссылка передана, но недоступна (${dbAnalysis.error || 'неизвестная причина'}). Отметь это в databaseAnalysis.note и в issues.`
      : `\n\nБАЗА ДАННЫХ: ссылка не передана. Заполни databaseAnalysis с accessible=false, fileCount=0, note="База данных не была передана для анализа".`;

  return `Тип курсовой: ${type === 'research' ? 'Исследовательская курсовая работа (ИКР, перерастает в магистерскую диссертацию)' : 'Курсовой проект (КП, перерастает в магистерский проект)'}.

Ожидаемые разделы (используй ровно эти канонические названия в expectedSections и в section полях):
${expected.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Целевые пропорции объёма (для оценки verdict у sections):
${type === 'research'
      ? '- Введение ~7–12%\n- Концептуальная глава ~35–45% (ядро КР, вес 0.25 при оценивании)\n- Эмпирическая глава ~35–45% (методы + анализ, суммарный вес 0.50)\n- Заключение ~5–10% (вес 0.20)'
      : '- Введение ~5–10% (вес 0.05)\n- Концептуальная глава: раздел «Анализ научной литературы» ~15–20% (вес 0.20)\n- Концептуальная глава: раздел «Анализ рынка» ~15–20% (вес 0.20)\n- Эмпирическая глава ~30–40% (методы + анализ, суммарный вес 0.40)\n- Заключение ~5–10% (вес 0.15)'}

Сигналы «too_short»: раздел < ~500 слов; концептуальная или эмпирическая глава < ~1500 слов — критически мало.
Сигналы «too_long»: один раздел > 60% работы; введение/заключение > 20% общего объёма.

${volumeBlock}

Метаданные документа:
- Найдено заголовков: ${doc.headings.length}
- Список найденных заголовков (до 50): ${doc.headings.slice(0, 50).join(' | ') || '— не найдены —'}
${dbBlock}

ТЕКСТ КУРСОВОЙ:
---
${preparedText}
---

Сделай полный анализ и верни строго JSON по описанной схеме. В priorityAdvice — без верхнего предела, минимум 3 совета. Совмещай ссылки на методичку с собственными аналитическими наблюдениями. Не переписывай работу — только рекомендации.`;
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
  dbAnalysis?: DbAnalysisResult | null,
  apiKey?: string,
): Promise<CourseAnalysisResult> {
  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OpenAI API Key не указан');

  // Дефолт gpt-5.2 (последняя доступная стабильная gpt-5.x на момент 05.2026; gpt-5.3 пока недоступна на ключе).
  const model = process.env.OPENAI_MODEL || 'gpt-5.2';
  const { useMaxCompletionTokens, supportsJsonFormat, supportsTemperature } = getModelParams(model);

  const openai = new OpenAI({ apiKey: key });

  const systemPrompt = buildSystemPrompt(type);
  const userPrompt = buildUserPrompt(type, doc, dbAnalysis);

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

  return normaliseResult(parsed, type, dbAnalysis);
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
  dbAnalysis?: DbAnalysisResult | null,
): CourseAnalysisResult {
  const expected = EXPECTED_SECTIONS[type].map(s => s.canonical);

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
  const readinessStatus: ReadinessStatus = (raw.readinessStatus && validStatuses.includes(raw.readinessStatus as ReadinessStatus))
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

  // databaseAnalysis: если GPT ничего не вернул — собираем фолбэк из dbAnalysis.
  const rawDb = (raw as any).databaseAnalysis || {};
  const databaseAnalysis: DatabaseAnalysisSection = {
    accessible: typeof rawDb.accessible === 'boolean'
      ? rawDb.accessible
      : !!(dbAnalysis && dbAnalysis.accessible),
    fileCount: Number(rawDb.fileCount) || (dbAnalysis?.fileCount ?? 0),
    fileCounts: {
      audio: Number(rawDb.fileCounts?.audio) || 0,
      tables: Number(rawDb.fileCounts?.tables) || 0,
      docs: Number(rawDb.fileCounts?.docs) || 0,
      other: Number(rawDb.fileCounts?.other) || 0,
    },
    issues: Array.isArray(rawDb.issues) ? rawDb.issues.filter((s: unknown): s is string => typeof s === 'string') : [],
    strengths: Array.isArray(rawDb.strengths) ? rawDb.strengths.filter((s: unknown): s is string => typeof s === 'string') : [],
    note: typeof rawDb.note === 'string' && rawDb.note.trim()
      ? rawDb.note
      : (dbAnalysis
          ? (dbAnalysis.accessible
              ? `Папка содержит ${dbAnalysis.fileCount} файлов.`
              : `База данных недоступна: ${dbAnalysis.error || 'причина неизвестна'}.`)
          : 'База данных не была передана для анализа.'),
  };

  // empiricalChapter: безопасно нормализуем два подблока; null, если глава не разобрана.
  const empiricalChapter = normaliseEmpiricalChapter((raw as any).empiricalChapter);

  const result: CourseAnalysisResult = {
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
    databaseAnalysis,
    empiricalChapter,
    disclaimer,
  };

  // Страховка поверх промпта: вычищаем протёкшие формулировки «как научный руководитель» и т.п.
  return scrubResult(result);
}

/** Безопасно собирает EmpiricalChapterAnalysis из сырого ответа GPT. */
function normaliseEmpiricalChapter(raw: any): EmpiricalChapterAnalysis | null {
  if (!raw || typeof raw !== 'object') return null;
  const sub = (s: any): EmpiricalSubAnalysis => ({
    comment: typeof s?.comment === 'string' ? s.comment : '',
    issues: Array.isArray(s?.issues) ? s.issues.filter((x: unknown): x is string => typeof x === 'string') : [],
    strengths: Array.isArray(s?.strengths) ? s.strengths.filter((x: unknown): x is string => typeof x === 'string') : [],
  });
  const design = sub(raw.design);
  const analysis = sub(raw.analysis);
  // Если оба подблока пустые — считаем, что разбора нет.
  const empty = !design.comment && !analysis.comment &&
    design.issues.length === 0 && design.strengths.length === 0 &&
    analysis.issues.length === 0 && analysis.strengths.length === 0;
  if (empty && raw.present !== true) return null;
  return {
    present: raw.present !== false,
    design,
    analysis,
  };
}

// ---------- Санитайзер вординга (страховка поверх промпта) ----------

/**
 * Вычищает протёкшие в ответ нежелательные формулировки: позиционирование «как научный
 * руководитель» и категоричные приговоры. Заменяет на нейтральные эквиваленты ИИ-консультанта.
 */
function scrubString(s: string): string {
  if (!s) return s;
  let out = s;
  const replacements: Array<[RegExp, string]> = [
    [/как\s+научный\s+руководитель[,]?\s*/gi, 'как ИИ-консультант '],
    [/рекомендую\s+вам\s+как\s+руководител[ья]/gi, 'как ИИ-консультант рекомендую'],
    [/как\s+(ваш\s+)?руководитель\s+рекомендую/gi, 'как ИИ-консультант рекомендую'],
    [/\bнедопустимо\b/gi, 'нежелательно'],
    [/\bпровал\b/gi, 'серьёзный недочёт'],
    [/работа\s+не\s+будет\s+принята/gi, 'работа требует доработки'],
    [/критически\s+плохо/gi, 'требует существенной доработки'],
  ];
  for (const [re, rep] of replacements) out = out.replace(re, rep);
  return out;
}

/** Рекурсивно применяет scrubString ко всем строковым значениям результата. */
function scrubResult(result: CourseAnalysisResult): CourseAnalysisResult {
  const walk = (val: any): any => {
    if (typeof val === 'string') return scrubString(val);
    if (Array.isArray(val)) return val.map(walk);
    if (val && typeof val === 'object') {
      const out: any = {};
      for (const k of Object.keys(val)) out[k] = walk(val[k]);
      return out;
    }
    return val;
  };
  return walk(result) as CourseAnalysisResult;
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
