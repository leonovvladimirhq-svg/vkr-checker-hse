// ============================================================
// Чек-лист ВКР — полное определение всех пунктов проверки
//
// Поддерживаются две образовательные программы:
//   'ik'   — «Интегрированные коммуникации» (магистратура, ОП ИК)
//            Источник: чек-лист ВКР ОП ИК + методические рекомендации 2024–2025.
//   'riso' — «Реклама и связи с общественностью» (бакалавриат, ОП РиСО)
//            Источники: Программа практики ОП РиСО 2025/2026 (ред. 24.03.2026),
//            приложения 31–36, 39; чек-лист С. В. Катковой (колонка «РИСО»);
//            протокол встречи 10.07.2026.
// ============================================================

export type ProgrammeId = 'ik' | 'riso';

export type WorkType =
  | 'project'       // ИК: магистерский проект
  | 'dissertation'  // ИК: магистерская диссертация
  | 'riso_thesis';  // РиСО: бакалаврская ВКР (академический формат)

export type WorkLang = 'ru' | 'en';

export type ResearchMethod =
  | 'interviews'
  | 'focus_groups'
  | 'text_analysis'
  | 'survey'
  | 'quant_content'
  | 'monitoring'
  | 'expert_interview'
  | 'experiment'      // только РиСО (Программа практики, приложение 35)
  | 'ethnography'     // только РиСО (наблюдение, кейс-стади, нетнография)
  | 'other';

export interface CheckItem {
  id: string;
  section: string;
  text: string;
  auto: boolean;        // true = проверяется через GPT / программно, false = ручная проверка
  fixed?: boolean;      // true = всегда passed (отмечено студентом)
  optional?: boolean;   // true = «не обязательно»: невыполнение не даёт «незачёт»
}

export interface CheckResult extends CheckItem {
  passed: boolean | null; // null = требуется ручная проверка
  note: string;
}

// ============================================================
// Регламентные константы ОП РиСО
// (Программа практики ОП РиСО 2025/2026)
// ============================================================

/** п. 1.21: объём ВКР — знаки С ПРОБЕЛАМИ, с учётом сносок, без титульника,
 *  содержания, списка литературы и приложений. */
export const RISO_VOLUME_THRESHOLDS: Record<WorkLang, number> = {
  ru: 100000,
  en: 90000,
};

/** Приложение 39, критерий 2: концептуальная часть — не менее 15 тыс. знаков. */
export const RISO_CONCEPT_MIN_CHARS = 15000;

/** Приложение 35, п. 5: продолжительность аудио/видеозаписи — не менее 30 минут. */
export const RISO_MEDIA_MIN_MINUTES = 30;

/** ОП ИК: пороги продолжительности записей (для сравнения — 45 мин). */
export const IK_MEDIA_MIN_MINUTES = 45;

// ============================================================
// Генерация чек-листа
// ============================================================

export interface ChecklistOptions {
  programme: ProgrammeId;
  type: WorkType;
  empMethods: ResearchMethod[];
  compMethods: ResearchMethod[];
  usesAI: boolean;
  otherMethodName?: string;
  lang?: WorkLang;
}

export function getChecklist(opts: ChecklistOptions): CheckItem[] {
  return opts.programme === 'riso' ? getRisoChecklist(opts) : getIkChecklist(opts);
}

// ------------------------------------------------------------
// ОП «Интегрированные коммуникации» (магистратура) — без изменений
// ------------------------------------------------------------

function getIkChecklist({ type, empMethods, compMethods, usesAI, otherMethodName }: ChecklistOptions): CheckItem[] {
  const items: CheckItem[] = [];

  // --- Основное содержание текстовой части ---
  if (type === 'project') {
    items.push(
      { id: 'title_page', section: 'Основное содержание текстовой части', text: 'Титульный лист', auto: true },
      { id: 'db_link_title', section: 'Основное содержание текстовой части', text: 'Ссылка на базу данных на титульном листе', auto: true },
      { id: 'pres_link', section: 'Основное содержание текстовой части', text: 'Ссылка на папку с презентацией (второй частью проекта)', auto: true },
      { id: 'toc', section: 'Основное содержание текстовой части', text: 'Содержание', auto: true },
      { id: 'concept_lit', section: 'Основное содержание текстовой части', text: 'Концептуальная глава: анализ литературы (>5 содержательных страниц)', auto: true },
      { id: 'concept_market', section: 'Основное содержание текстовой части', text: 'Концептуальная глава: анализ рынка (>5 содержательных страниц)', auto: true },
      { id: 'empirical', section: 'Основное содержание текстовой части', text: 'Эмпирическая глава (>5 содержательных страниц)', auto: true },
      { id: 'competitors', section: 'Основное содержание текстовой части', text: 'Анализ конкурентов (>5 содержательных страниц)', auto: true },
      { id: 'conclusion', section: 'Основное содержание текстовой части', text: 'Заключение', auto: true },
      { id: 'bibliography', section: 'Основное содержание текстовой части', text: 'Список литературы', auto: true },
      { id: 'appendix_tz', section: 'Основное содержание текстовой части', text: 'Приложение: ТЗ заказчика работы', auto: true },
      // Презентация
      { id: 'pres_content', section: 'Содержание презентации', text: 'Содержательная часть (>5 содержательных слайдов)', auto: false },
      { id: 'pres_links', section: 'Содержание презентации', text: 'Ссылки на целевые документы, разработанные студентом', auto: false },
    );
  } else {
    items.push(
      { id: 'title_page', section: 'Основное содержание текстовой части', text: 'Титульный лист', auto: true },
      { id: 'db_link_title', section: 'Основное содержание текстовой части', text: 'Ссылка на базу данных на титульном листе', auto: true },
      { id: 'toc', section: 'Основное содержание текстовой части', text: 'Содержание', auto: true },
      { id: 'concept', section: 'Основное содержание текстовой части', text: 'Концептуальная глава (>5 содержательных страниц)', auto: true },
      { id: 'empirical', section: 'Основное содержание текстовой части', text: 'Эмпирическая глава (>5 содержательных страниц)', auto: true },
      { id: 'discussion', section: 'Основное содержание текстовой части', text: 'Обсуждение результатов (>5 содержательных страниц)', auto: true },
      { id: 'conclusion', section: 'Основное содержание текстовой части', text: 'Заключение', auto: true },
      { id: 'bibliography', section: 'Основное содержание текстовой части', text: 'Список литературы', auto: true },
      { id: 'mixed_method', section: 'Проведенное исследование', text: 'Проведено в смешанном или мультимодальном подходе (>=2 метода)', auto: true },
    );
  }

  items.push(...getAiItems(usesAI));

  // --- База данных ---
  items.push({ id: 'db_opens', section: 'База данных', text: 'База данных открывается по ссылке', auto: true });
  items.push({ id: 'db_files_present', section: 'База данных', text: 'Файлы БД соответствуют заявленным методам исследования', auto: true });

  empMethods.forEach(m => {
    items.push(...getIkMethodItems(m, 'empirical', otherMethodName));
  });

  if (type === 'project' && compMethods.length > 0) {
    compMethods.forEach(m => {
      items.push(...getIkMethodItems(m, 'competitor', otherMethodName));
    });
  }

  return items;
}

// ------------------------------------------------------------
// ОП «Реклама и связи с общественностью» (бакалавриат)
// ------------------------------------------------------------

function getRisoChecklist({ empMethods, usesAI, otherMethodName, lang }: ChecklistOptions): CheckItem[] {
  const items: CheckItem[] = [];
  const SECTION_TEXT = 'Основное содержание текстовой части';
  const volumeThreshold = RISO_VOLUME_THRESHOLDS[lang || 'ru'];

  // --- Обязательные структурные элементы (п. 1.14 Программы практики) ---
  items.push(
    { id: 'title_page', section: SECTION_TEXT, text: 'Титульный лист (приложение 32: тема, ФИО, руководитель, направление 42.03.01)', auto: true },
    { id: 'db_link_title', section: SECTION_TEXT, text: 'Ссылка на базу данных на титульном листе (публичная ссылка Яндекс 360)', auto: true },
    { id: 'toc', section: SECTION_TEXT, text: 'Содержание', auto: true },
    { id: 'intro', section: SECTION_TEXT, text: 'Введение (обоснование выбора темы, исследовательская ценность, цель и структура работы)', auto: true },
    { id: 'concept', section: SECTION_TEXT, text: 'Концептуальная глава: литературный обзор по теме, проблема исследования', auto: true },
    { id: 'empirical', section: SECTION_TEXT, text: 'Эмпирическая глава: дизайн исследования, метод(ы) сбора данных и их обоснование, анализ результатов', auto: true },
    { id: 'chapters_structure', section: SECTION_TEXT, text: 'Минимум две главы, каждая разделена на 2 и более параграфов с содержательными названиями', auto: true },
    { id: 'conclusion', section: SECTION_TEXT, text: 'Заключение (полученное знание, ограничения и перспективы исследования)', auto: true },
    { id: 'bibliography', section: SECTION_TEXT, text: 'Список использованных источников и литературы (ГОСТ Р 7.0.100–2018, подстрочные сноски)', auto: true },
  );

  // --- Объём работы (п. 1.21) — считается программно, не через GPT ---
  items.push(
    {
      id: 'volume_total',
      section: 'Объём работы',
      text: `Объём работы не менее ${volumeThreshold.toLocaleString('ru-RU')} знаков с пробелами (со сносками; без титульного листа, содержания, списка литературы и приложений)`,
      auto: true,
    },
    {
      id: 'volume_concept',
      section: 'Объём работы',
      text: `Концептуальная часть не менее ${RISO_CONCEPT_MIN_CHARS.toLocaleString('ru-RU')} знаков (приложение 39, критерий 2)`,
      auto: true,
    },
  );

  // --- Использование ИИ ---
  items.push(...getAiItems(usesAI));

  // --- База данных (приложение 35) ---
  items.push({ id: 'db_opens', section: 'База данных', text: 'База данных открывается по публичной ссылке Яндекс 360', auto: true });
  items.push({ id: 'db_files_present', section: 'База данных', text: 'Файлы БД соответствуют заявленным методам исследования', auto: true });

  empMethods.forEach(m => {
    items.push(...getRisoMethodItems(m, otherMethodName));
  });

  // --- Обязательные материалы в приложении к тексту работы (приложение 35, пп. 2 и 6) ---
  items.push(...getRisoAppendixItems(empMethods));

  return items;
}

// ------------------------------------------------------------
// Общий блок «Использование ИИ» (идентичен для обеих программ)
// ------------------------------------------------------------

function getAiItems(usesAI: boolean): CheckItem[] {
  if (!usesAI) return [];
  return [
    { id: 'ai_marked', section: 'Использование ИИ', text: 'Работа отмечена как содержащая сгенерированный контент', auto: false, fixed: true },
    { id: 'ai_intro', section: 'Использование ИИ', text: 'Во введении указаны используемые сервисы, причины использования и разделы', auto: true },
    { id: 'ai_section', section: 'Использование ИИ', text: 'Присутствует раздел «Описание применения генеративной модели»', auto: true },
    { id: 'ai_citation', section: 'Использование ИИ', text: 'Корректное цитирование: модель, версия, запрос, скриншот ответов ИИ', auto: true },
    { id: 'ai_compliance', section: 'Использование ИИ', text: 'Использование ИИ соответствует требованиям (нет подлога, нет плагиата)', auto: true },
  ];
}

// ------------------------------------------------------------
// Пункты по методам — ОП ИК
// ------------------------------------------------------------

function getIkMethodItems(method: string, part: string, otherMethodName?: string): CheckItem[] {
  const partLabel = part === 'empirical' ? 'эмпирической части' : 'анализа конкурентов';
  const m = method.replace('_comp', '');
  const items: CheckItem[] = [];

  switch (m) {
    case 'interviews':
      items.push(
        { id: `${part}_int_count`, section: `База данных (${partLabel})`, text: 'Глубинные интервью: не менее 10 файлов (7 для смешанного метода)', auto: true },
        { id: `${part}_int_duration`, section: `База данных (${partLabel})`, text: 'Каждый файл не менее 45 минут (30 для экспертного интервью)', auto: false },
        { id: `${part}_int_quality`, section: `База данных (${partLabel})`, text: 'Аудио разборчивое, соответствует теме исследования', auto: false },
      );
      break;
    case 'focus_groups':
      items.push(
        { id: `${part}_fg_count`, section: `База данных (${partLabel})`, text: 'Фокус-группы: не менее 5 файлов (3 для смешанного метода)', auto: true },
        { id: `${part}_fg_duration`, section: `База данных (${partLabel})`, text: 'Каждый файл не менее 45 минут', auto: false },
        { id: `${part}_fg_quality`, section: `База данных (${partLabel})`, text: 'Аудио разборчивое, соответствует теме исследования', auto: false },
      );
      break;
    case 'text_analysis':
      items.push(
        { id: `${part}_ta_materials`, section: `База данных (${partLabel})`, text: 'Исходные материалы для кодирования', auto: true },
        { id: `${part}_ta_coding`, section: `База данных (${partLabel})`, text: 'Кодировочная таблица', auto: true },
      );
      break;
    case 'survey':
      items.push(
        { id: `${part}_srv_data`, section: `База данных (${partLabel})`, text: 'Таблица с выгрузкой данных', auto: true },
        { id: `${part}_srv_meta`, section: `База данных (${partLabel})`, text: 'Метаданные (время и дата заполнения)', auto: true },
        { id: `${part}_srv_stats`, section: `База данных (${partLabel})`, text: 'Выгрузка из программы для статистического анализа (SPSS, Jupyter, Excel)', auto: true },
      );
      break;
    case 'quant_content':
      items.push(
        { id: `${part}_qc_sheet`, section: `База данных (${partLabel})`, text: 'Кодировочный лист', auto: true },
      );
      break;
    case 'monitoring':
      items.push(
        { id: `${part}_mon_data`, section: `База данных (${partLabel})`, text: 'Первичные или вторичные данные', auto: true },
      );
      break;
    case 'expert_interview':
      items.push(
        { id: `${part}_ei_files`, section: `База данных (${partLabel})`, text: 'Экспертное интервью: файлы записей или транскриптов', auto: false },
        { id: `${part}_ei_quality`, section: `База данных (${partLabel})`, text: 'Экспертное интервью: качество и соответствие теме', auto: false },
      );
      break;
    case 'other': {
      const methodLabel = otherMethodName || 'Другой метод';
      items.push(
        { id: `${part}_other_data`, section: `База данных (${partLabel})`, text: `${methodLabel}: данные исследования`, auto: false },
        { id: `${part}_other_quality`, section: `База данных (${partLabel})`, text: `${methodLabel}: соответствие теме и методу`, auto: false },
      );
      break;
    }
  }

  return items;
}

// ------------------------------------------------------------
// Пункты по методам — ОП РиСО (приложение 35 Программы практики)
// ------------------------------------------------------------

function getRisoMethodItems(method: ResearchMethod, otherMethodName?: string): CheckItem[] {
  const S = 'База данных (эмпирическая часть)';
  const items: CheckItem[] = [];
  const part = 'empirical';

  switch (method) {
    case 'interviews':
      items.push(
        { id: `${part}_int_count`, section: S, text: 'Глубинные интервью: не менее 10 файлов (7 для смешанного метода)', auto: true },
        { id: `${part}_int_duration`, section: S, text: `Каждая аудио/видеозапись не менее ${RISO_MEDIA_MIN_MINUTES} минут`, auto: false },
        { id: `${part}_int_quality`, section: S, text: 'Аудио разборчивое, содержит идентифицирующие интервьюера признаки, соответствует теме', auto: false },
        { id: `${part}_int_format`, section: S, text: 'Формат записей: MP3/WAV (аудио) или AVI/MOV/MPEG (видео), файлы воспроизводятся', auto: true },
      );
      break;
    case 'focus_groups':
      items.push(
        { id: `${part}_fg_count`, section: S, text: 'Фокус-группы: не менее 5 файлов (3 для смешанного метода)', auto: true },
        { id: `${part}_fg_duration`, section: S, text: `Каждая аудио/видеозапись не менее ${RISO_MEDIA_MIN_MINUTES} минут`, auto: false },
        { id: `${part}_fg_quality`, section: S, text: 'Аудио разборчивое, соответствует теме исследования', auto: false },
        { id: `${part}_fg_format`, section: S, text: 'Формат записей: MP3/WAV (аудио) или AVI/MOV/MPEG (видео), файлы воспроизводятся', auto: true },
      );
      break;
    case 'text_analysis':
      items.push(
        { id: `${part}_ta_materials`, section: S, text: 'Исходные материалы, которые подвергались анализу', auto: true },
        { id: `${part}_ta_coding`, section: S, text: 'Кодировочная таблица с переменными', auto: true },
      );
      break;
    case 'survey':
      items.push(
        { id: `${part}_srv_data`, section: S, text: 'Таблица с выгрузкой данных опроса', auto: true },
        { id: `${part}_srv_meta`, section: S, text: 'В таблице присутствуют метаданные (дата заполнения, время заполнения, id)', auto: true },
        { id: `${part}_srv_stats`, section: S, text: 'Выгрузка из программы для статистического анализа (SPSS, Jupyter Notebook, Excel) — не обязательно', auto: true, optional: true },
      );
      break;
    case 'quant_content':
      items.push(
        { id: `${part}_qc_sheet`, section: S, text: 'Кодировочный лист (кодировочная таблица) с переменными', auto: true },
      );
      break;
    case 'monitoring':
      items.push(
        { id: `${part}_mon_data`, section: S, text: 'Мониторинговый / информационно-аналитический анализ текста (в т.ч. Медиалогия, Brand Analytics): первичные или вторичные текстовые данные', auto: true },
      );
      break;
    case 'expert_interview':
      items.push(
        { id: `${part}_ei_files`, section: S, text: 'Экспертное интервью: аудиозаписи или транскрипты (количество согласуется с научным руководителем)', auto: false },
        { id: `${part}_ei_duration`, section: S, text: `Экспертное интервью: каждая запись не менее ${RISO_MEDIA_MIN_MINUTES} минут`, auto: false },
        { id: `${part}_ei_quality`, section: S, text: 'Экспертное интервью: качество записи и соответствие теме', auto: false },
      );
      break;
    case 'experiment':
      items.push(
        { id: `${part}_exp_data`, section: S, text: 'Эксперимент: таблица с выгрузкой данных (номера наблюдений и значения переменных)', auto: true },
        { id: `${part}_exp_meta`, section: S, text: 'Эксперимент: метаданные в выгрузке (дата, время заполнения, ip, устройство)', auto: true },
        { id: `${part}_exp_design`, section: S, text: 'Эксперимент: в тексте описаны отбор участников, рандомизация и рассчитанный размер эффекта со значимостью', auto: true },
      );
      break;
    case 'ethnography':
      items.push(
        { id: `${part}_eth_data`, section: S, text: 'Этнографическое исследование (наблюдение, кейс-стади, нетнография): аудиозаписи бесед с информантами, дневник наблюдения или протокол наблюдений', auto: true },
      );
      break;
    case 'other': {
      const methodLabel = otherMethodName || 'Другой метод';
      items.push(
        { id: `${part}_other_data`, section: S, text: `${methodLabel}: данные исследования (состав БД согласуется с научным руководителем)`, auto: false },
        { id: `${part}_other_quality`, section: S, text: `${methodLabel}: соответствие теме и методу`, auto: false },
      );
      break;
    }
  }

  return items;
}

/**
 * Приложение 35, пп. 2 и 6: часть базы данных обязательно выносится
 * в приложение к тексту ВКР. Состав зависит от методов исследования.
 */
function getRisoAppendixItems(empMethods: ResearchMethod[]): CheckItem[] {
  const S = 'Приложения к тексту работы';
  const items: CheckItem[] = [];

  const hasInterviews = empMethods.includes('interviews') || empMethods.includes('expert_interview');
  const hasFg = empMethods.includes('focus_groups');
  const hasSurveyLike = empMethods.includes('survey') || empMethods.includes('experiment');
  const hasEthno = empMethods.includes('ethnography');

  if (hasInterviews) {
    items.push({
      id: 'appendix_int',
      section: S,
      text: 'В приложении: гайд интервью, скринер и транскрипт одного наиболее показательного интервью',
      auto: true,
    });
  }
  if (hasFg) {
    items.push({
      id: 'appendix_fg',
      section: S,
      text: 'В приложении: гайд фокус-группы, скринер (при наличии) и транскрипт одной фокус-группы',
      auto: true,
    });
  }
  if (hasSurveyLike) {
    items.push({
      id: 'appendix_quant',
      section: S,
      text: 'В приложении: анкета опроса / материалы стимулов эксперимента в текстовом формате',
      auto: true,
    });
  }
  if (hasEthno) {
    items.push({
      id: 'appendix_eth',
      section: S,
      text: 'В приложении: транскрипт наиболее показательного интервью и дневник/протокол наблюдений за одну сессию',
      auto: true,
    });
  }

  return items;
}
