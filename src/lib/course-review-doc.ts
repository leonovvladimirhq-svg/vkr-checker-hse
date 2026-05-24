// ============================================================
// Генератор Word-отзыва на курсовую работу (ИКР / КП)
// Структура соответствует Приложениям 20.1 / 20.2 Программы практики ОП ИК 2025
// и шаблонам «Шаблон отзыва - Исследовательская курсовая работа 2026.docx»
// «Шаблон отзыва - Курсовой проект 2026.docx».
// ============================================================

import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  HeadingLevel,
  AlignmentType,
  WidthType,
  BorderStyle,
  ShadingType,
} from 'docx';
import type { CourseType } from './methodology';

// ---------- Public input types ----------

/** Один формальный критерий «ДА/НЕТ/Комментарий» (таблицы БД и ИИ). */
export interface YesNoCriterion {
  criterion: string;
  yesNo: 'ДА' | 'НЕТ' | '—';
  comment: string;
}

/** Один взвешенный критерий характеристики работы (с оценкой). */
export interface WeightedCriterion {
  number: number;
  title: string;
  weight: string;          // "0,05" / "0,25" и т.п. (как в шаблоне — с запятой)
  comment: string;
  score: string;           // балл из 10 (например "8") или "—" если не оценено
}

/** Структурированные данные для заполнения отзыва. Заполняет GPT (см. course-review-prompt.ts). */
export interface ReviewTemplateData {
  studentFullName: string;
  workTitle: string;
  courseType: CourseType;

  // База данных
  bdAudioCount: number | null;
  bdTablesCount: number | null;
  bdOtherCount: number | null;
  bdCriteria: YesNoCriterion[];   // 4 строки по шаблону

  // Характеристика объёма
  charCountWithSpaces: number | null;
  volumeRequirementMet: string;      // "ДА" / "НЕТ" / комментарий
  structureRequirementMet: string;
  citationRequirementMet: string;
  aiRequirementOverall: string;

  // ИИ — 5 строк
  aiCriteria: YesNoCriterion[];

  // Характеристика работы — 5 (ИКР) или 6 (КП) строк
  workCriteria: WeightedCriterion[];

  // Рекомендуемая оценка
  recommendedGrade: string;        // например "7 из 10"
}

// ---------- Стили / утилиты ----------

const FONT = 'Times New Roman';

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: '808080' };
const borders = {
  top: cellBorder,
  bottom: cellBorder,
  left: cellBorder,
  right: cellBorder,
};

function p(text: string, opts: { bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; size?: number } = {}): Paragraph {
  return new Paragraph({
    alignment: opts.align,
    children: [
      new TextRun({
        text,
        bold: opts.bold,
        size: opts.size ?? 24, // 24 half-points = 12pt
        font: FONT,
      }),
    ],
  });
}

function cellP(text: string, opts: { bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; size?: number } = {}): Paragraph {
  return p(text || '', opts);
}

function headerCell(text: string, widthPct?: number): TableCell {
  return new TableCell({
    width: widthPct ? { size: widthPct, type: WidthType.PERCENTAGE } : undefined,
    borders,
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F2F2F2' },
    children: [cellP(text, { bold: true })],
  });
}

function dataCell(text: string, widthPct?: number): TableCell {
  return new TableCell({
    width: widthPct ? { size: widthPct, type: WidthType.PERCENTAGE } : undefined,
    borders,
    children: [cellP(text)],
  });
}

// ---------- Сборка документа ----------

export async function generateReviewDocx(data: ReviewTemplateData): Promise<Buffer> {
  const isResearch = data.courseType === 'research';
  const titleText = isResearch
    ? 'Отзыв на Исследовательскую курсовую работу'
    : 'Отзыв на Курсовой проект';

  const sections: Paragraph[] = [];

  // ===== ШАПКА =====
  sections.push(p('Федеральное государственное автономное образовательное учреждение', { align: AlignmentType.CENTER }));
  sections.push(p('высшего образования «Национальный исследовательский университет «Высшая школа экономики»»', { align: AlignmentType.CENTER }));
  sections.push(p('Факультет креативных индустрий', { align: AlignmentType.CENTER }));
  sections.push(p('Школа коммуникаций', { align: AlignmentType.CENTER }));
  sections.push(p(''));
  sections.push(p(titleText, { bold: true, align: AlignmentType.CENTER, size: 28 }));
  sections.push(p(''));
  sections.push(p(`Студента(ки) ${data.studentFullName}`));
  sections.push(p('(фамилия, имя, отчество)', { size: 20 }));
  sections.push(p(''));
  sections.push(p('1 курса магистратуры образовательной программы «Интегрированные коммуникации» на тему:'));
  sections.push(p(`«${data.workTitle}»`, { bold: true }));
  sections.push(p(''));

  // ===== Соответствие требованиям к базам данных =====
  sections.push(p('Соответствие требованиям к базам данных:', { bold: true }));
  sections.push(p(`Содержит ${data.bdAudioCount ?? '___'} аудио/видеофайл(ов), ${data.bdTablesCount ?? '___'} таблиц (выгрузка данных опроса), ${data.bdOtherCount ?? '___'} других файлов.`));

  const bdTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          headerCell('Критерий', 50),
          headerCell('ДА/НЕТ', 15),
          headerCell('Комментарий по критерию', 35),
        ],
      }),
      ...data.bdCriteria.map(c => new TableRow({
        children: [
          dataCell(c.criterion, 50),
          dataCell(c.yesNo, 15),
          dataCell(c.comment, 35),
        ],
      })),
    ],
  });

  // ===== Характеристика объёма работы =====
  const volumeIntro: Paragraph[] = [
    p(''),
    p('Характеристика объёма работы', { bold: true }),
    p(`Объём работы без учёта списка литературы и приложений: ${data.charCountWithSpaces?.toLocaleString('ru-RU') ?? '______'} знаков с пробелами.`),
    p(`Соблюдение требований к объёму работы: ${data.volumeRequirementMet}`),
    p(`Соблюдение требований к обязательным структурным элементам КР: ${data.structureRequirementMet}`),
    p(`Соблюдение требований к объёму корректного цитирования: ${data.citationRequirementMet}`),
    p(`Соответствие требованиям к корректному использованию ИИ: ${data.aiRequirementOverall}`),
    p(''),
  ];

  // ===== ИИ-таблица =====
  const aiTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          headerCell('Критерий', 60),
          headerCell('ДА/НЕТ', 10),
          headerCell('Комментарий по критерию', 30),
        ],
      }),
      ...data.aiCriteria.map(c => new TableRow({
        children: [
          dataCell(c.criterion, 60),
          dataCell(c.yesNo, 10),
          dataCell(c.comment, 30),
        ],
      })),
    ],
  });

  // ===== Характеристика работы студента =====
  const workTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          headerCell('№', 5),
          headerCell('Критерий', 55),
          headerCell('Вес', 8),
          headerCell('Содержательный комментарий по критерию', 22),
          headerCell('Оценка', 10),
        ],
      }),
      ...data.workCriteria.map(c => new TableRow({
        children: [
          dataCell(String(c.number), 5),
          dataCell(c.title, 55),
          dataCell(c.weight, 8),
          dataCell(c.comment, 22),
          dataCell(c.score, 10),
        ],
      })),
      new TableRow({
        children: [
          new TableCell({
            borders,
            columnSpan: 4,
            children: [cellP('Рекомендуемая оценка по КР с учётом соблюдения требований к объёму, структуре и оформлению', { bold: true })],
          }),
          dataCell(data.recommendedGrade, 10),
        ],
      }),
    ],
  });

  // ===== Подпись =====
  const signatureBlock: Paragraph[] = [
    p(''),
    p('Руководитель'),
    p('учёная степень, звание, кафедра/департамент, (место работы)'),
    p(''),
    p('_________________________  __________________'),
    p('(подпись)                                        (И.О. Фамилия)'),
    p(''),
    p('Дата ____________________'),
  ];

  // ===== Сборка документа =====
  const doc = new Document({
    creator: 'ВКР-Чекер',
    title: titleText,
    description: `Отзыв на курсовую работу студента ${data.studentFullName}`,
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 24 },
        },
      },
    },
    sections: [
      {
        properties: {},
        children: [
          ...sections,
          bdTable,
          ...volumeIntro,
          p('Соответствие требованиям к корректному использованию ИИ:', { bold: true }),
          aiTable,
          p(''),
          p('Характеристика работы студента', { bold: true }),
          workTable,
          ...signatureBlock,
        ],
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

// ---------- Дефолтные шаблоны критериев (для GPT-промпта и фолбэка) ----------

export const DEFAULT_BD_CRITERIA: string[] = [
  'Соблюдение требований к продолжительности аудио/видеофайла(ов)',
  'Соблюдение требований к воспроизведению и цифровому формату файла(ов)',
  'Соблюдение требований к количеству файлов',
  'Соблюдение требований к содержанию файла(ов) (соответствие содержания файла заданной теме)',
];

export const DEFAULT_AI_CRITERIA: string[] = [
  'Работа отмечена как содержащая сгенерированный алгоритмами автоматической генерации контент',
  'Во введении указаны используемые сервисы и причины их использования, разделы, в которых используются ИИ',
  'Присутствует раздел «Описание применения генеративной модели»',
  'В разделе «Описание применения генеративной модели» используется корректное цитирование: указана модель, её версия, изначальный запрос, приведён скриншот ответов ИИ',
  'Использование ИИ в работе соответствует требованиям и не используется для подлога (приведения несуществующих источников), плагиата (переписывания чужого текста)',
];

export const RESEARCH_WORK_CRITERIA: Array<{ number: number; title: string; weight: string }> = [
  { number: 1, weight: '0,05', title: 'Введение выполняет ознакомительную функцию и на основе релевантных тематике академических источников даёт читателю представление о причинах выбора темы, её исследовательской ценности, цели и структуре работы' },
  { number: 2, weight: '0,25', title: 'Релевантность использованных источников теме исследования. Анализ научной дискуссии о проблеме исследования, корректность авторских обобщений. Ясность изложения причинно-следственной связи. Обоснованность концептуализации основных понятий' },
  { number: 3, weight: '0,25', title: 'Обоснование и корректность использования методов сбора данных и инструментария (анкеты социологического опроса, протокола наблюдения, гайда полу-структурированного интервью и т. д.). Использование результатов концептуальной части исследования при разработке инструментов для сбора данных' },
  { number: 4, weight: '0,25', title: 'Корректность использования метода анализа эмпирических данных, интерпретации полученных результатов' },
  { number: 5, weight: '0,20', title: 'Заключение выполняет функцию демонстрации полученного нового знания и его ограничений. Результаты соотнесены с академической дискуссией. Описаны потенциальные направления дальнейшего исследования' },
];

export const PROJECT_WORK_CRITERIA: Array<{ number: number; title: string; weight: string }> = [
  { number: 1, weight: '0,05', title: 'Введение выполняет ознакомительную функцию и даёт читателю представление о состоянии рассматриваемого в работе рынка, целях и задачах бренда, его ситуации на рынке и целевой аудитории — в соответствии с брифом заказчика. Присутствует краткое объяснение основных концепций, используемых в работе. Заявлена структура работы.' },
  { number: 2, weight: '0,20', title: 'Релевантность использованных источников теме исследования. Анализ научной дискуссии по теме исследования. Корректность авторских обобщений. Ясность изложения причинно-следственной связи. Обоснованность концептуализации основных понятий' },
  { number: 3, weight: '0,20', title: 'Информированность о состоянии релевантного рынка и поведении потребителя на основе индустриальных исследований. Анализ рынка и анализ бренда/продукта заказчика и конкурентов (прямых и косвенных) и бенчмарков. Релевантность выбранных для анализа брендов. Выводы о состоянии рынка и месте бренда на нем, выделение угроз/возможностей на рынке и потребностей потребителя.' },
  { number: 4, weight: '0,20', title: 'Обоснование и корректность использования методов сбора данных и инструментария (анкеты социологического опроса, протокола наблюдения, гайда полу-структурированного интервью и т. д.). Использование результатов концептуальной части исследования при разработке инструментов для сбора данных' },
  { number: 5, weight: '0,20', title: 'Корректность использования метода анализа эмпирических данных, интерпретации полученных результатов' },
  { number: 6, weight: '0,15', title: 'Заключение выполняет функцию демонстрации полученного знания, необходимого для решения задачи заказчика. Результаты соотнесены с аналитикой научной дискуссии и анализом рынка в рамках концептуальной главы. Предложена структура будущей практической части работы' },
];
