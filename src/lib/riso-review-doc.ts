// ============================================================
// Генератор шаблона «Отзыв руководителя на ВКР» — ОП «Реклама и связи
// с общественностью» (бакалавриат). Структура и формулировки — приложение 36
// Программы практики ОП РиСО 2025/2026.
//
// ПРИНЦИП ЗАПОЛНЕНИЯ (договорённость встречи 10.07.2026 и постановка задачи):
// сервис подставляет ТОЛЬКО то, что переносится дословно или считается
// арифметически — ФИО, тему, число файлов по типам, объём в знаках и вердикт
// по порогу объёма. Ни одного поля, где нужна оценка содержания, модель не
// заполняет: содержательные критерии с весами, рекомендуемая оценка и
// комментарии остаются пустыми для руководителя.
//
// Где значение получено не подсчётом, а требует человека, в графе «ДА/НЕТ»
// стоит «—», а в комментарии — какие именно факты собраны и что осталось
// проверить. Так документ не утверждает ничего от имени ИИ.
// ============================================================

import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  AlignmentType,
  WidthType,
  TableLayoutType,
  BorderStyle,
  ShadingType,
} from 'docx';
import { toGenitiveFullName } from './name-case';

const FONT = 'Times New Roman';
const RED_HEX = 'C00000';
const GREY_HEX = '595959';

// A4 с полями по приложению 31 (лево 3 см, право 1,5 см) → ширина набора 9355 DXA
const CONTENT_WIDTH = 9355;
const CRIT_COLS = [4200, 1100, 4055];
const WEIGHTED_COLS = [500, 4200, 700, 2755, 1200];

// ---------- Входные данные ----------

export interface RisoReviewMediaFile {
  name: string;
  size: number;
  ext: string;
  estMinutes: number | null;
  formatAllowed: boolean;
}

export interface RisoReviewData {
  studentName: string;
  workTitle: string;
  checkedAt: string;

  // База данных
  dbAccessible: boolean;
  dbError?: string | null;
  dbLink?: string | null;
  /** Студент вообще указывал ссылку на базу данных. */
  dbLinkProvided: boolean;
  mediaCount: number | null;
  tableCount: number | null;
  otherCount: number | null;
  mediaFiles: RisoReviewMediaFile[];
  disallowedFormats: string[];
  /** Пороги по количеству записей, выведенные из заявленных методов. */
  mediaThresholds: Array<{ method: string; min: number }>;
  minMinutes: number;

  // Объём
  charsWithSpaces: number | null;
  charsNoSpaces: number | null;
  footnoteChars: number | null;
  volumeThreshold: number | null;
  volumeMet: boolean | null;

  usesAI: boolean;
}

// ---------- Утилиты ----------

const nf = (n: number) => n.toLocaleString('ru-RU');

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: '808080' };
const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

interface RunOpts {
  bold?: boolean;
  italic?: boolean;
  size?: number;
  color?: string;
  align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  spaceAfter?: number;
}

function p(text: string, o: RunOpts = {}): Paragraph {
  return new Paragraph({
    alignment: o.align,
    spacing: { after: o.spaceAfter ?? 60, line: 260 },
    children: [
      new TextRun({
        text,
        bold: o.bold,
        italics: o.italic,
        color: o.color,
        size: o.size ?? 24,
        font: FONT,
      }),
    ],
  });
}

/** Пустая строка-заполнитель для полей, которые заполняет руководитель. */
function blankLine(label: string): Paragraph {
  return new Paragraph({
    spacing: { after: 60, line: 260 },
    children: [
      new TextRun({ text: label, size: 24, font: FONT }),
      new TextRun({ text: ' ' + '_'.repeat(Math.max(10, 78 - label.length)), size: 24, font: FONT }),
    ],
  });
}

function cell(text: string, width: number, o: RunOpts & { header?: boolean } = {}): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders,
    margins: { top: 50, bottom: 50, left: 80, right: 80 },
    shading: o.header ? { type: ShadingType.CLEAR, color: 'auto', fill: 'F2F2F2' } : undefined,
    children: [p(text, { ...o, size: o.size ?? 22, bold: o.header || o.bold, spaceAfter: 0 })],
  });
}

/** Ячейка комментария: текст + при необходимости красная пометка о ручной проверке. */
function commentCell(text: string, width: number, manual: boolean): TableCell {
  const children: Paragraph[] = [p(text || '', { size: 22, spaceAfter: 0 })];
  if (manual) {
    children.push(p('Требуется проверка руководителем', {
      size: 20, bold: true, color: RED_HEX, spaceAfter: 0,
    }));
  }
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders,
    margins: { top: 50, bottom: 50, left: 80, right: 80 },
    children,
  });
}

interface Criterion {
  criterion: string;
  yesNo: string;
  comment: string;
  manual: boolean;
}

function criteriaTable(rows: Criterion[]): Table {
  return new Table({
    columnWidths: CRIT_COLS,
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          cell('Критерий', CRIT_COLS[0], { header: true }),
          cell('ДА/НЕТ', CRIT_COLS[1], { header: true, align: AlignmentType.CENTER }),
          cell('Комментарий по критерию', CRIT_COLS[2], { header: true }),
        ],
      }),
      ...rows.map(r => new TableRow({
        children: [
          cell(r.criterion, CRIT_COLS[0]),
          cell(r.yesNo, CRIT_COLS[1], { align: AlignmentType.CENTER, bold: r.yesNo !== '—' }),
          commentCell(r.comment, CRIT_COLS[2], r.manual),
        ],
      })),
    ],
  });
}

// ---------- Содержательные критерии (всегда пустые) ----------

const WEIGHTED_CRITERIA: Array<{ n: string; title: string; weight: string }> = [
  {
    n: '1',
    title: 'Введение выполняет ознакомительную функцию и на основе релевантных тематике академических источников даёт читателю представление о причинах выбора темы, её исследовательской ценности, цели и структуре работы',
    weight: '0,1',
  },
  {
    n: '2',
    title: 'Релевантность использованных источников теме исследования. Анализ научной дискуссии о проблеме исследования, корректность авторских обобщений. Ясность изложения необходимой к изучению причинно-следственной связи. Обоснованность концептуализации основных понятий. Корректная демонстрация проблемы исследования, концептуализация и операционализация основных понятий (при необходимости), формулировка исследовательских вопросов',
    weight: '0,25',
  },
  {
    n: '3',
    title: 'Обоснование и корректность использования методов сбора данных и инструментария (анкеты социологического опроса, протокола наблюдения, гайда полуструктурированного интервью и т. д.). Использование результатов концептуальной части исследования при разработке инструментов для сбора данных',
    weight: '0,25',
  },
  {
    n: '4',
    title: 'Корректность использования метода анализа эмпирических данных, интерпретации полученных результатов',
    weight: '0,25',
  },
  {
    n: '5',
    title: 'Заключение выполняет функцию демонстрации полученного нового знания и его ограничений',
    weight: '0,15',
  },
];

function weightedTable(): Table {
  return new Table({
    columnWidths: WEIGHTED_COLS,
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          cell('', WEIGHTED_COLS[0], { header: true }),
          cell('Критерий', WEIGHTED_COLS[1], { header: true }),
          cell('Вес', WEIGHTED_COLS[2], { header: true, align: AlignmentType.CENTER }),
          cell('Содержательный комментарий по критерию', WEIGHTED_COLS[3], { header: true }),
          cell('Оценка по критерию', WEIGHTED_COLS[4], { header: true, align: AlignmentType.CENTER }),
        ],
      }),
      ...WEIGHTED_CRITERIA.map(c => new TableRow({
        children: [
          cell(c.n, WEIGHTED_COLS[0], { align: AlignmentType.CENTER }),
          cell(c.title, WEIGHTED_COLS[1]),
          cell(c.weight, WEIGHTED_COLS[2], { align: AlignmentType.CENTER }),
          cell('', WEIGHTED_COLS[3]),
          cell('', WEIGHTED_COLS[4]),
        ],
      })),
      new TableRow({
        children: [
          cell('', WEIGHTED_COLS[0]),
          cell('Комментарий руководителя по имеющимся нарушениям требований к структуре и оформлению', WEIGHTED_COLS[1]),
          cell('', WEIGHTED_COLS[2]),
          cell('', WEIGHTED_COLS[3]),
          cell('', WEIGHTED_COLS[4]),
        ],
      }),
      new TableRow({
        children: [
          cell('', WEIGHTED_COLS[0]),
          cell('Рекомендуемая оценка по ВКР с учётом соблюдения требований к структуре и оформлению, объему и БД', WEIGHTED_COLS[1], { bold: true }),
          cell('', WEIGHTED_COLS[2]),
          cell('', WEIGHTED_COLS[3]),
          cell('', WEIGHTED_COLS[4]),
        ],
      }),
    ],
  });
}

// ---------- Сборка блоков с данными ----------

function buildDbCriteria(d: RisoReviewData): Criterion[] {
  const media = d.mediaFiles || [];
  const estimated = media.filter(m => m.estMinutes !== null);

  // 1. Продолжительность — измерить нельзя (API Яндекс.Диска не отдаёт длительность)
  let durationComment: string;
  const noDataNote = d.dbLinkProvided
    ? 'База данных недоступна по ссылке — сведения не собраны.'
    : 'Ссылка на базу данных не указана — сведения не собраны.';

  if (!d.dbAccessible) {
    durationComment = noDataNote;
  } else if (media.length === 0) {
    durationComment = 'Аудио/видеофайлы в базе данных не обнаружены.';
  } else if (estimated.length === 0) {
    durationComment = `Файлов: ${media.length}. Длительность по размеру не оценивается (видеоформаты). Требование — не менее ${d.minMinutes} мин.`;
  } else {
    const short = estimated.filter(m => (m.estMinutes as number) < d.minMinutes);
    const list = estimated.slice(0, 12).map(m => `${m.name} ≈ ${m.estMinutes} мин`).join('; ');
    durationComment =
      `Требование — не менее ${d.minMinutes} мин. Оценка по размеру файла (не измерение): ${list}` +
      (estimated.length > 12 ? ` и ещё ${estimated.length - 12} файл(ов).` : '.') +
      (short.length > 0
        ? ` Ориентировочно короче ${d.minMinutes} мин: ${short.length} из ${estimated.length}.`
        : ' Все файлы ориентировочно длиннее порога.');
  }

  // 2. Формат — считается точно по расширениям; воспроизведение проверить нельзя
  let formatYesNo = '—';
  let formatComment: string;
  if (!d.dbAccessible) {
    formatComment = noDataNote;
  } else if (media.length === 0) {
    formatComment = 'Аудио/видеофайлы в базе данных не обнаружены.';
  } else {
    const byExt: Record<string, number> = {};
    for (const m of media) byExt[m.ext] = (byExt[m.ext] || 0) + 1;
    const extList = Object.keys(byExt).map(e => `${e} — ${byExt[e]}`).join(', ');
    formatComment =
      `Форматы файлов: ${extList}. ` +
      (d.disallowedFormats.length === 0
        ? 'Все форматы предусмотрены приложением 35 (MP3, WAV, AVI, MOV, MPEG). '
        : `Вне списка приложения 35: ${d.disallowedFormats.join(', ')}. `) +
      'Фактическое воспроизведение файлов автоматически не проверялось.';
  }

  // 3. Количество файлов — считается точно
  let countYesNo = '—';
  let countComment: string;
  let countManual = true;
  if (!d.dbAccessible) {
    countComment = noDataNote;
  } else if (d.mediaThresholds.length === 1) {
    const t = d.mediaThresholds[0];
    const ok = (d.mediaCount ?? 0) >= t.min;
    countYesNo = ok ? 'ДА' : 'НЕТ';
    countManual = false;
    countComment = `В базе данных ${nf(d.mediaCount ?? 0)} аудио/видеофайл(ов). Требование для метода «${t.method}» — не менее ${t.min}.`;
  } else if (d.mediaThresholds.length > 1) {
    const req = d.mediaThresholds.map(t => `«${t.method}» — не менее ${t.min}`).join('; ');
    countComment = `В базе данных ${nf(d.mediaCount ?? 0)} аудио/видеофайл(ов). Заявлено несколько методов (${req}), распределить файлы по методам автоматически невозможно.`;
  } else {
    countComment = `В базе данных ${nf(d.mediaCount ?? 0)} аудио/видеофайл(ов). Для заявленных методов порог по количеству записей не установлен.`;
  }

  // 4. Содержание файлов — только человек
  const contentComment = d.dbAccessible
    ? 'Соответствие содержания файлов заявленной теме автоматически не проверяется.'
    : noDataNote;

  return [
    {
      criterion: 'Соблюдение требований к продолжительности аудио\\видеофайла(ов)',
      yesNo: '—',
      comment: durationComment,
      manual: true,
    },
    {
      criterion: 'Соблюдение требований к воспроизведению и цифровому формату файла(ов)',
      yesNo: formatYesNo,
      comment: formatComment,
      manual: true,
    },
    {
      criterion: 'Соблюдение требований к количеству файлов',
      yesNo: countYesNo,
      comment: countComment,
      manual: countManual,
    },
    {
      criterion: 'Соблюдение требований к содержанию файла(ов) (несоответствие содержания файла заданной теме)',
      yesNo: '—',
      comment: contentComment,
      manual: true,
    },
  ];
}

function buildAiCriteria(usesAI: boolean): Criterion[] {
  const titles = [
    'Во введении указаны используемые сервисы и причины их использования, разделы, в которых используются ИИ',
    'Присутствует раздел «Описание применения генеративной модели»',
    'В разделе «Описание применения генеративной модели» используется корректное цитирование: указана модель, ее версия, изначальный запрос',
    'Использование ИИ в работе соответствует требованиям и не используется для: подлога (приведения несуществующих источников), плагиата (переписывания чужого текста)',
  ];
  const comment = usesAI
    ? 'Студент отметил работу как содержащую сгенерированный контент. Проверка этих пунктов требует чтения текста и не выполняется автоматически.'
    : 'Студент не отмечал работу как содержащую сгенерированный алгоритмами контент.';
  return titles.map(t => ({ criterion: t, yesNo: '—', comment, manual: usesAI }));
}

// ---------- Основная сборка документа ----------

export async function buildRisoReviewDoc(d: RisoReviewData): Promise<Buffer> {
  const name = toGenitiveFullName(d.studentName);

  const children: (Paragraph | Table)[] = [];

  // Шапка
  children.push(
    p('Федеральное государственное автономное образовательное учреждение высшего образования «Национальный исследовательский университет «Высшая школа экономики»»',
      { align: AlignmentType.CENTER, size: 22 }),
    p('Факультет креативных индустрий', { align: AlignmentType.CENTER, size: 22 }),
    p('Школа коммуникаций', { align: AlignmentType.CENTER, size: 22, spaceAfter: 220 }),
    p('Отзыв руководителя на ВКР', { align: AlignmentType.CENTER, bold: true, size: 26, spaceAfter: 220 }),
  );

  // ФИО и тема
  children.push(
    p(`${name.studentWord} ${name.genitive}`, { size: 24, spaceAfter: 0 }),
    p('(фамилия, имя, отчество)', { size: 18, color: GREY_HEX, spaceAfter: 140 }),
    p('4 курса бакалавриата образовательной программы «Реклама и связи с общественностью» на тему:', { size: 24, spaceAfter: 60 }),
  );
  if (d.workTitle && d.workTitle.trim()) {
    children.push(p(`«${d.workTitle.trim()}»`, { size: 24, bold: true, spaceAfter: 220 }));
  } else {
    children.push(
      blankLine(''),
      p('Тема работы не была указана студентом при проверке — заполните вручную.',
        { size: 20, italic: true, color: RED_HEX, spaceAfter: 220 }),
    );
  }

  // ---- База данных ----
  children.push(p('Соответствие требованиям к базам данных:', { bold: true, size: 24, spaceAfter: 60 }));

  if (d.dbAccessible) {
    children.push(p(
      `Содержит ${nf(d.mediaCount ?? 0)} аудио/видеофайл(ов), ${nf(d.tableCount ?? 0)} таблиц (выгрузка данных опроса т.п.), ${nf(d.otherCount ?? 0)} других файлов.`,
      { size: 24, spaceAfter: 120 },
    ));
  } else {
    children.push(
      p('Содержит _______ аудио/видеофайл(ов), _________таблиц (выгрузка данных опроса т.п.), _________других файлов.',
        { size: 24, spaceAfter: 40 }),
      p(d.dbLinkProvided
        ? `База данных по указанной ссылке недоступна${d.dbError ? `: ${d.dbError}` : ''} — состав файлов заполните вручную.`
        : 'Студент не указал ссылку на базу данных при проверке — состав файлов заполните вручную.',
        { size: 20, italic: true, color: RED_HEX, spaceAfter: 120 }),
    );
  }

  children.push(criteriaTable(buildDbCriteria(d)), p('', { spaceAfter: 180 }));

  // ---- ИИ ----
  children.push(
    p('Соответствие требованиям к корректному использованию ИИ:', { bold: true, size: 24, spaceAfter: 60 }),
    criteriaTable(buildAiCriteria(d.usesAI)),
    p('', { spaceAfter: 180 }),
  );

  // ---- Объём ----
  children.push(p('Характеристика объема работы', { bold: true, size: 24, spaceAfter: 60 }));

  if (d.charsWithSpaces !== null) {
    const footnotes = d.footnoteChars && d.footnoteChars > 0
      ? ` (в объём включены сноски: ${nf(d.footnoteChars)} знаков)`
      : '';
    children.push(p(
      `Объем работы без учета списка литературы и приложений ${nf(d.charsWithSpaces)} знаков с пробелами${footnotes}.`,
      { size: 24 },
    ));
  } else {
    children.push(blankLine('Объем работы без учета списка литературы и приложений ______(число) знаков с пробелами.'));
  }

  if (d.volumeMet !== null && d.volumeThreshold !== null && d.charsWithSpaces !== null) {
    const verdict = d.volumeMet
      ? `Соблюдены: ${nf(d.charsWithSpaces)} знаков при требовании не менее ${nf(d.volumeThreshold)}.`
      : `Не соблюдены: ${nf(d.charsWithSpaces)} знаков при требовании не менее ${nf(d.volumeThreshold)} — не хватает ${nf(d.volumeThreshold - d.charsWithSpaces)}.`;
    children.push(p(`Соблюдение требований к объему работы: ${verdict}`, { size: 24 }));
  } else {
    children.push(blankLine('Соблюдение требований к объему работы:'));
  }

  children.push(
    blankLine('Соблюдение требований к обязательным структурным элементам ВКР'),
    blankLine('Соблюдение требований к объему корректного заимствования:'),
    p('', { spaceAfter: 180 }),
  );

  // ---- Содержательные критерии (пустые) ----
  children.push(weightedTable(), p('', { spaceAfter: 220 }));

  // ---- Подпись ----
  children.push(
    p('Руководитель', { size: 24, spaceAfter: 0 }),
    p('ученая степень, звание, кафедра/департамент, (место работы)', { size: 18, color: GREY_HEX, spaceAfter: 200 }),
    p('_________________________                                        __________________', { size: 24, spaceAfter: 0 }),
    p('              (подпись)                                                                      (И.О. Фамилия)', { size: 18, color: GREY_HEX, spaceAfter: 140 }),
    p('Дата_______________', { size: 24, spaceAfter: 260 }),
  );

  // ---- Служебная плашка ----
  const filled: string[] = ['ФИО студента и тема работы'];
  if (d.dbAccessible) filled.push('число файлов базы данных по типам');
  if (d.charsWithSpaces !== null) filled.push('объём работы в знаках с пробелами и вердикт по порогу');

  children.push(
    p('— — — служебная информация, удалите перед подписанием — — —',
      { size: 18, color: GREY_HEX, align: AlignmentType.CENTER, spaceAfter: 80 }),
    p(`Заполнено автоматически сервисом «ВКР-чекер» ${d.checkedAt}: ${filled.join(', ')}. ` +
      'Эти поля перенесены дословно или посчитаны арифметически — оценки содержания сервис не даёт.',
      { size: 18, italic: true, color: GREY_HEX }),
    p('Заполняет руководитель: все содержательные критерии с весами, рекомендуемая оценка, ' +
      'соблюдение требований к обязательным структурным элементам, объём корректного заимствования ' +
      '(переносится из официального отчёта «Антиплагиат»), а также отмеченные красным пункты таблиц.',
      { size: 18, italic: true, color: GREY_HEX }),
    p(`ФИО в родительном падеже сформировано автоматически по правилам склонения; исходное написание: ${name.nominative}. Проверьте форму.`,
      { size: 18, italic: true, color: GREY_HEX }),
  );

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 24 } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1134, bottom: 1417, left: 1701, right: 850 },
        },
      },
      children,
    }],
  });

  return Packer.toBuffer(doc);
}
