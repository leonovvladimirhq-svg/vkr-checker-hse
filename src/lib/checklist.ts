// ============================================================
// Чек-лист ВКР — полное определение всех пунктов проверки
// Соответствует загруженному документу "Чек-лист ВКР.docx"
// ============================================================

export type WorkType = 'project' | 'dissertation';

export type ResearchMethod =
  | 'interviews'
  | 'focus_groups'
  | 'text_analysis'
  | 'survey'
  | 'quant_content'
  | 'monitoring';

export interface CheckItem {
  id: string;
  section: string;
  text: string;
  auto: boolean;        // true = проверяется через GPT, false = ручная проверка / ссылка
  fixed?: boolean;      // true = всегда passed (отмечено студентом)
}

export interface CheckResult extends CheckItem {
  passed: boolean | null; // null = требуется ручная проверка
  note: string;
}

// ============================================================
// Генерация чек-листа в зависимости от типа работы и методов
// ============================================================

export function getChecklist(
  type: WorkType,
  empMethods: ResearchMethod[],
  compMethods: ResearchMethod[],
  usesAI: boolean
): CheckItem[] {
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

  // --- Блок ИИ ---
  if (usesAI) {
    items.push(
      { id: 'ai_marked', section: 'Использование ИИ', text: 'Работа отмечена как содержащая сгенерированный контент', auto: false, fixed: true },
      { id: 'ai_intro', section: 'Использование ИИ', text: 'Во введении указаны используемые сервисы, причины использования и разделы', auto: true },
      { id: 'ai_section', section: 'Использование ИИ', text: 'Присутствует раздел «Описание применения генеративной модели»', auto: true },
      { id: 'ai_citation', section: 'Использование ИИ', text: 'Корректное цитирование: модель, версия, запрос, скриншот ответов ИИ', auto: true },
      { id: 'ai_compliance', section: 'Использование ИИ', text: 'Использование ИИ соответствует требованиям (нет подлога, нет плагиата)', auto: true },
    );
  }

  // --- База данных ---
  items.push({ id: 'db_opens', section: 'База данных', text: 'База данных открывается по ссылке', auto: false });

  // Методы эмпирической части
  empMethods.forEach(m => {
    items.push(...getMethodItems(m, 'empirical'));
  });

  // Методы анализа конкурентов (только для проекта)
  if (type === 'project' && compMethods.length > 0) {
    compMethods.forEach(m => {
      items.push(...getMethodItems(m, 'competitor'));
    });
  }

  return items;
}

function getMethodItems(method: string, part: string): CheckItem[] {
  const partLabel = part === 'empirical' ? 'эмпирической части' : 'анализа конкурентов';
  const m = method.replace('_comp', '');
  const items: CheckItem[] = [];

  switch (m) {
    case 'interviews':
      items.push(
        { id: `${part}_int_count`, section: `База данных (${partLabel})`, text: 'Глубинные интервью: не менее 10 файлов (7 для смешанного метода)', auto: false },
        { id: `${part}_int_duration`, section: `База данных (${partLabel})`, text: 'Каждый файл не менее 45 минут (30 для экспертного интервью)', auto: false },
        { id: `${part}_int_quality`, section: `База данных (${partLabel})`, text: 'Аудио разборчивое, соответствует теме исследования', auto: false },
      );
      break;
    case 'focus_groups':
      items.push(
        { id: `${part}_fg_count`, section: `База данных (${partLabel})`, text: 'Фокус-группы: не менее 5 файлов (3 для смешанного метода)', auto: false },
        { id: `${part}_fg_duration`, section: `База данных (${partLabel})`, text: 'Каждый файл не менее 45 минут', auto: false },
        { id: `${part}_fg_quality`, section: `База данных (${partLabel})`, text: 'Аудио разборчивое, соответствует теме исследования', auto: false },
      );
      break;
    case 'text_analysis':
      items.push(
        { id: `${part}_ta_materials`, section: `База данных (${partLabel})`, text: 'Исходные материалы для кодирования', auto: false },
        { id: `${part}_ta_coding`, section: `База данных (${partLabel})`, text: 'Кодировочная таблица', auto: false },
      );
      break;
    case 'survey':
      items.push(
        { id: `${part}_srv_data`, section: `База данных (${partLabel})`, text: 'Таблица с выгрузкой данных', auto: false },
        { id: `${part}_srv_meta`, section: `База данных (${partLabel})`, text: 'Метаданные (время и дата заполнения)', auto: false },
        { id: `${part}_srv_stats`, section: `База данных (${partLabel})`, text: 'Выгрузка из программы для статистического анализа (SPSS, Jupyter, Excel)', auto: false },
      );
      break;
    case 'quant_content':
      items.push(
        { id: `${part}_qc_sheet`, section: `База данных (${partLabel})`, text: 'Кодировочный лист', auto: false },
      );
      break;
    case 'monitoring':
      items.push(
        { id: `${part}_mon_data`, section: `База данных (${partLabel})`, text: 'Первичные или вторичные данные', auto: false },
      );
      break;
  }

  return items;
}
