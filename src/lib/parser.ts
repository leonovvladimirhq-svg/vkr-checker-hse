// ============================================================
// Парсинг документов: mammoth.js для .docx, pdf-parse для .pdf
// ============================================================

import mammoth from 'mammoth';
import JSZip from 'jszip';
import { extractPdfWithTables } from './pdf-tables';

export interface VolumeBreakdown {
  titlePageDetected: boolean;
  introFound: boolean;
  biblioFound: boolean;
  appendixFound: boolean;
  footnotesFound: boolean;
  /** Удалось ли вычленить таблицы из текста работы. */
  tablesExcluded: boolean;
  /**
   * Как именно. false — по разметке документа (.docx, тег <w:tbl>): точно.
   * true — по расположению на странице (.pdf, см. pdf-tables.ts): разметки
   * там нет, таблица узнаётся по нарисованным ячейкам и колонкам текста.
   */
  tablesFromLayout: boolean;
}

export interface ParsedDocument {
  text: string;         // Полный текст
  html: string;         // HTML-версия (для .docx)
  headings: string[];   // Найденные заголовки
  wordCount: number;
  pageEstimate: number; // Оценка количества страниц (~250 слов = 1 страница)
  // Объём «тела работы» — без титульника, оглавления, списка литературы и приложений,
  // НО СО СНОСКАМИ (по Программе практики сноски входят в тело).
  // Используется для проверки порога ≥90 000 знаков с пробелами.
  bodyWordCount: number;
  bodyCharCountWithSpaces: number;
  bodyCharCountNoSpaces: number;
  appendixWordCount: number;
  footnoteCharCount: number; // знаки сносок (с пробелами), уже включены в bodyCharCountWithSpaces
  // Сколько знаков тела работы отброшено как таблицы и иллюстрации (п. 1.21).
  excludedTableChars: number;   // содержимое таблиц
  excludedCaptionChars: number; // подписи «Таблица N …», «Рисунок N …»
  excludedTableCount: number;   // число таблиц во всём документе (.docx)
  volumeBreakdown: VolumeBreakdown;
}

export interface ParseOptions {
  /**
   * Исключать из объёма таблицы и подписи к иллюстрациям (п. 1.21 Программы
   * практики ОП РиСО: «все таблицы, диаграммы и прочие иллюстративные
   * материалы из текста работы выносятся в приложение и не входят в объем
   * работы»).
   *
   * По умолчанию выключено: тот же пункт есть и в правилах для курсовых
   * (пп. 2.1.25 и 2.2.33), но включать его там на середине учебного года —
   * менять цифры уже проверенным работам, это отдельное решение заказчика.
   */
  excludeTablesFromVolume?: boolean;
}

/**
 * Извлекает текст сносок и концевых сносок из .docx.
 * mammoth.extractRawText НЕ включает текст сносок (он хранится в word/footnotes.xml
 * отдельно от тела документа), поэтому объём «тела со сносками» считался заниженным.
 * Возвращает склеенный текст всех сносок (или '' при ошибке/отсутствии).
 */
async function extractDocxNotesText(buffer: Buffer): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const parts: string[] = [];
    for (const name of ['word/footnotes.xml', 'word/endnotes.xml']) {
      const file = zip.file(name);
      if (!file) continue;
      const xml = await file.async('string');
      // Берём текст из всех <w:t>…</w:t> (сепараторные сноски тегов <w:t> не содержат).
      const matches = xml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
      for (const m of matches) {
        const inner = m.replace(/<w:t[^>]*>/, '').replace(/<\/w:t>/, '');
        parts.push(decodeXmlEntities(inner));
      }
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  } catch (e) {
    console.error('extractDocxNotesText failed (non-critical):', e);
    return '';
  }
}

// ============================================================
// Исключение таблиц и иллюстраций из объёма работы
//
// Программа практики ОП РиСО, п. 1.21: «все таблицы, диаграммы и прочие
// иллюстративные материалы из текста работы выносятся в приложение и не
// входят в объем работы». До 23.09.2026 чекер считал их наравне с текстом,
// из-за чего объём работ с таблицами внутри глав был завышен.
//
// У иллюстраций в объём попадает только подпись (сама картинка знаков не
// даёт), у таблиц — всё содержимое ячеек.
// ============================================================

/**
 * Вырезает из XML документа сбалансированные блоки <w:tbl>…</w:tbl>.
 *
 * Таблицы бывают вложенными, поэтому нужен счётчик глубины, а не ленивый
 * regex: `<w:tbl>[\s\S]*?</w:tbl>` на вложенной таблице закрылся бы на
 * внутреннем теге и оставил хвост внешней в тексте.
 *
 * Открывающий тег ищем как `<w:tbl` + пробел или `>`: иначе под шаблон
 * попадут <w:tblPr>, <w:tblGrid>, <w:tblW> — свойства, а не сама таблица.
 */
function stripDocxTables(xml: string): { xml: string; tableCount: number } {
  const re = /<w:tbl(?=[\s>])|<\/w:tbl>/g;
  let depth = 0;
  let start = -1;
  let last = 0;
  let out = '';
  let tableCount = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(xml)) !== null) {
    if (m[0] !== '</w:tbl>') {
      if (depth === 0) start = m.index;
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0) {
        out += xml.slice(last, start);
        last = m.index + m[0].length;
        tableCount++;
      }
    }
  }
  out += xml.slice(last);
  return { xml: out, tableCount };
}

/**
 * Текст из XML документа Word.
 *
 * Абзац завершается ДВУМЯ переводами строки — ровно так же, как это делает
 * mammoth.extractRawText. Совпадение важно: объём работы раньше считался по
 * тексту mammoth, и расхождение в разделителе абзацев сдвинуло бы цифру у
 * всех работ на 1–2 % без всякой связи с таблицами.
 */
function docxXmlToText(xml: string): string {
  const tokenRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<\/w:p>|<w:tab\/>|<w:br\/>/g;
  let out = '';
  let m: RegExpExecArray | null;

  while ((m = tokenRe.exec(xml)) !== null) {
    if (m[0] === '</w:p>') out += '\n\n';
    else if (m[0] === '<w:tab/>') out += '\t';
    else if (m[0] === '<w:br/>') out += '\n';
    else out += decodeXmlEntities(m[1]);
  }
  return out;
}

/**
 * Подпись к таблице или иллюстрации: «Таблица 1 — Название», «Рисунок 2.
 * Динамика», «Продолжение таблицы 3», «Figure 4. Sample».
 *
 * После номера обязателен разделитель или конец строки. Без этого условия
 * под шаблон попала бы обычная фраза «Таблица 1 показывает, что…» — ссылка
 * на таблицу в тексте, которая из объёма вычитаться не должна.
 */
const CAPTION_RE =
  /^[ \t]*(?:продолжение\s+|окончание\s+)?(?:таблиц[аы]|табл\.|рисун(?:ок|ка)|рис\.|диаграмма|график|схема|table|figure|fig\.|chart|diagram)\s*№?\s*\d{1,3}(?:\.\d{1,2})?[ \t]*(?:[—–\-.:)][^\n]*)?$/i;

/** Убирает строки-подписи; возвращает текст и сколько знаков отброшено. */
function stripCaptionLines(text: string): { text: string; chars: number; count: number } {
  const lines = text.split('\n');
  const kept: string[] = [];
  let chars = 0;
  let count = 0;

  for (const line of lines) {
    if (CAPTION_RE.test(line)) {
      chars += line.length;
      count++;
      continue;
    }
    kept.push(line);
  }
  return { text: kept.join('\n'), chars, count };
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}

/**
 * Извлечение текста из .docx через mammoth.js
 * mammoth корректно обрабатывает кириллицу, форматирование, таблицы
 */
export async function parseDocx(buffer: Buffer, opts: ParseOptions = {}): Promise<ParsedDocument> {
  // Извлечение текста. Для GPT и проверки структуры нужен ПОЛНЫЙ текст,
  // включая таблицы: их содержание проверяется по существу (кодировочные
  // таблицы, выгрузки). Из объёма таблицы вычитаются отдельно, ниже.
  const textResult = await mammoth.extractRawText({ buffer });
  const text = textResult.value;

  // Извлечение HTML (для анализа структуры — заголовки, ссылки)
  const htmlResult = await mammoth.convertToHtml({ buffer });
  const html = htmlResult.value;

  // Извлечение заголовков из HTML
  const headingRegex = /<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi;
  const headings: string[] = [];
  let match;
  while ((match = headingRegex.exec(html)) !== null) {
    headings.push(match[1].replace(/<[^>]+>/g, '').trim());
  }

  // Подсчёт слов
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  const pageEstimate = Math.ceil(wordCount / 250);

  // Текст сносок храним отдельно (mammoth его не извлекает) и добавляем к объёму тела.
  const footnotesText = await extractDocxNotesText(buffer);

  // Объём считаем по тексту БЕЗ таблиц и подписей к иллюстрациям (п. 1.21).
  // Опорный текст берём из XML, а не из mammoth: только так видно, какие
  // абзацы лежат внутри <w:tbl>. Разделитель абзацев совпадает с mammoth,
  // поэтому цифра «с таблицами» остаётся прежней.
  const { docXml, tableCount } = opts.excludeTablesFromVolume
    ? await extractDocxBodyXml(buffer)
    : { docXml: null, tableCount: 0 };
  let volume: BodyVolumeResult;
  let excludedTableChars = 0;
  let excludedCaptionChars = 0;

  if (docXml) {
    const noTablesText = docxXmlToText(stripDocxTables(docXml).xml);
    const withTables = computeBodyVolume(docxXmlToText(docXml), footnotesText);
    const noTables = computeBodyVolume(noTablesText, footnotesText);
    volume = computeBodyVolume(stripCaptionLines(noTablesText).text, footnotesText);

    excludedTableChars = Math.max(0, withTables.bodyCharCountWithSpaces - noTables.bodyCharCountWithSpaces);
    excludedCaptionChars = Math.max(0, noTables.bodyCharCountWithSpaces - volume.bodyCharCountWithSpaces);
    volume.breakdown.tablesExcluded = true;
  } else {
    // Таблицы не исключаем: либо так попросил вызывающий код, либо .docx
    // нестандартный и word/document.xml в нём нет. Считаем как раньше,
    // по тексту mammoth, и не утверждаем, что таблицы вычтены.
    volume = computeBodyVolume(text, footnotesText);
  }

  return {
    text,
    html,
    headings,
    wordCount,
    pageEstimate,
    bodyWordCount: volume.bodyWordCount,
    bodyCharCountWithSpaces: volume.bodyCharCountWithSpaces,
    bodyCharCountNoSpaces: volume.bodyCharCountNoSpaces,
    appendixWordCount: volume.appendixWordCount,
    footnoteCharCount: volume.footnoteCharCount,
    excludedTableChars,
    excludedCaptionChars,
    excludedTableCount: tableCount,
    volumeBreakdown: volume.breakdown,
  };
}

/** Достаёт word/document.xml и число таблиц в нём (или null, если файл нестандартный). */
async function extractDocxBodyXml(buffer: Buffer): Promise<{ docXml: string | null; tableCount: number }> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const file = zip.file('word/document.xml');
    if (!file) return { docXml: null, tableCount: 0 };
    const docXml = await file.async('string');
    return { docXml, tableCount: stripDocxTables(docXml).tableCount };
  } catch (e) {
    console.error('extractDocxBodyXml failed (объём будет посчитан с таблицами):', e);
    return { docXml: null, tableCount: 0 };
  }
}

/**
 * Извлечение текста из .pdf через pdf-parse
 */
export async function parsePdf(buffer: Buffer, opts: ParseOptions = {}): Promise<ParsedDocument> {
  // Динамический импорт pdf-parse (CommonJS модуль)
  const pdfParse = (await import('pdf-parse')).default;

  // Когда объём нужно считать без таблиц, берём разбор с распознаванием
  // таблиц (src/lib/pdf-tables.ts). Полный текст он даёт побайтово такой
  // же, как pdf-parse, — проверено на 29 работах восьми генераторов PDF.
  // Любая осечка разбора не должна ронять проверку работы: откатываемся
  // на pdf-parse и честно помечаем, что таблицы не вычтены.
  let text: string;
  let numPages: number;
  let textWithoutTables: string | null = null;

  if (opts.excludeTablesFromVolume) {
    try {
      const extracted = await extractPdfWithTables(buffer);
      text = extracted.text;
      numPages = extracted.numPages;
      textWithoutTables = extracted.textWithoutTables;
    } catch (e) {
      console.error('parsePdf: разбор таблиц не удался, считаем объём с таблицами:', e);
      const data = await pdfParse(buffer);
      text = data.text;
      numPages = data.numpages;
    }
  } else {
    const data = await pdfParse(buffer);
    text = data.text;
    numPages = data.numpages;
  }
  const words = text.split(/\s+/).filter((w: string) => w.length > 0);
  const wordCount = words.length;

  // Простая эвристика для заголовков в PDF — строки заглавными или короткие строки перед длинными
  const lines = text.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
  const headings = lines.filter((line: string) => {
    // Строка до 100 символов, не заканчивается точкой, и содержит заглавную первую букву
    return line.length > 3 && line.length < 100 && !line.endsWith('.') && /^[A-ZА-ЯЁ]/.test(line);
  }).slice(0, 50); // Ограничиваем 50 заголовками

  // В PDF сноски идут инлайн внизу страницы и уже попадают в text → отдельно не добавляем.
  const withTables = computeBodyVolume(text);
  let volume = withTables;
  let excludedTableChars = 0;
  let excludedCaptionChars = 0;

  if (opts.excludeTablesFromVolume) {
    const base = textWithoutTables ?? text;
    const noTables = computeBodyVolume(base);
    volume = computeBodyVolume(stripCaptionLines(base).text);
    excludedTableChars = Math.max(0, withTables.bodyCharCountWithSpaces - noTables.bodyCharCountWithSpaces);
    excludedCaptionChars = Math.max(0, noTables.bodyCharCountWithSpaces - volume.bodyCharCountWithSpaces);
    volume.breakdown.tablesExcluded = textWithoutTables !== null;
    volume.breakdown.tablesFromLayout = textWithoutTables !== null;
  }

  return {
    text,
    html: '', // PDF не даёт HTML
    headings,
    wordCount,
    pageEstimate: numPages || Math.ceil(wordCount / 250),
    bodyWordCount: volume.bodyWordCount,
    bodyCharCountWithSpaces: volume.bodyCharCountWithSpaces,
    bodyCharCountNoSpaces: volume.bodyCharCountNoSpaces,
    appendixWordCount: volume.appendixWordCount,
    footnoteCharCount: volume.footnoteCharCount,
    excludedTableChars,
    excludedCaptionChars,
    excludedTableCount: 0,
    volumeBreakdown: volume.breakdown,
  };
}

/**
 * Автоопределение формата и парсинг
 */
export async function parseDocument(
  buffer: Buffer,
  filename: string,
  opts: ParseOptions = {},
): Promise<ParsedDocument> {
  const ext = filename.toLowerCase().split('.').pop();

  if (ext === 'docx') {
    return parseDocx(buffer, opts);
  } else if (ext === 'pdf') {
    return parsePdf(buffer, opts);
  } else {
    throw new Error(`Неподдерживаемый формат файла: .${ext}. Используйте .docx или .pdf`);
  }
}

/**
 * Подготовка текста для отправки в GPT (ограничение размера).
 *
 * Лимит по умолчанию — 180 000 символов: типовая курсовая (≥90 000 знаков тела +
 * титульник, оглавление, список литературы, приложения) укладывается целиком.
 * Для gpt-4o-mini / gpt-5.x это ~45–65 тыс. токенов входа — приемлемо.
 *
 * Если текст всё же длиннее лимита — семплируем ТРИ части (начало + середина + конец),
 * а не выбрасываем середину целиком. Это критично: исследовательский вопрос, шкалы,
 * статистические тесты и прочее «мясо» эмпирической главы лежат в середине работы и
 * раньше не доходили до модели (отсюда галлюцинации «раздел отсутствует»).
 */
export function prepareTextForGPT(text: string, maxChars: number = 180000): string {
  if (text.length <= maxChars) return text;

  const GAP = '\n\n[... часть текста пропущена для экономии объёма ...]\n\n';
  const third = Math.floor(maxChars / 3);

  const head = text.substring(0, third);
  const midStart = Math.max(third, Math.floor(text.length / 2 - third / 2));
  const middle = text.substring(midStart, midStart + third);
  const tail = text.substring(text.length - third);

  return head + GAP + middle + GAP + tail;
}

// ============================================================
// Вычисление объёма «тела работы»
// ============================================================

interface BodyVolumeResult {
  bodyWordCount: number;
  bodyCharCountWithSpaces: number;
  bodyCharCountNoSpaces: number;
  appendixWordCount: number;
  footnoteCharCount: number;
  breakdown: VolumeBreakdown;
}

/**
 * Находит границы «тела работы»: от «Введение» до «Список литературы».
 * Всё после «Приложение» считается приложениями и из тела вычитается.
 *
 * Если границы не найдены — возвращает весь текст как тело (fallback).
 * Возвращает body-объёмы в трёх метриках (слова / знаки с пробелами / знаки без пробелов),
 * объём приложений отдельно и флаги «что удалось распознать».
 */
export function computeBodyVolume(text: string, footnotesText: string = ''): BodyVolumeResult {
  const breakdown: VolumeBreakdown = {
    titlePageDetected: false,
    introFound: false,
    biblioFound: false,
    appendixFound: false,
    footnotesFound: false,
    tablesExcluded: false,
    tablesFromLayout: false,
  };

  // Эвристика титульного листа: упоминание «Высшая школа экономики» / «Магистерская»
  // в первых ~2000 символов. Английские маркеры нужны для работ на английском языке
  // (ОП РиСО, п. 1.26: ВКР может быть выполнена и защищена на английском, порог 90 000).
  const head = text.substring(0, 2000);
  if (/высшая школа экономики|национальный исследовательский университет|магистерская|higher school of economics|national research university/i.test(head)) {
    breakdown.titlePageDetected = true;
  }

  // Регексы маркеров разделов — гибкие (учитываем кавычки, переносы, регистр).
  // Английские варианты обязательны: без них у англоязычной работы границы тела
  // не находятся вовсе и в объём попадают титульник, оглавление, список
  // источников и приложения — то есть цифра завышается на десятки тысяч знаков.
  const introRe = /(^|\n)\s*(введение|introduction)\s*\n/i;
  // «использованных / использованной / используемых» — все три формы встречаются
  // в реальных работах (Баннова, 09.2026: «Список используемых источников»).
  const biblioRe = /(^|\n)\s*(список\s+(использ[а-яё]+\s+)?(литературы|источников)(\s+и\s+(литературы|источников))?|библиограф[а-яё]+|references|bibliography|list\s+of\s+references)\s*\n/i;
  // Было `приложения?` — это не покрывало самую частую форму «Приложение»
  // (regex останавливался на «приложени»), из-за чего приложения не отсекались
  // от тела работы. Правильный класс — [еяй].
  const appendixRe = /(^|\n)\s*(приложени[еяй]|приложение\s+[№a-zа-я0-9]|appendix(\s+[a-z0-9])?|appendices)\s*(\n|$)/i;

  const introMatch = text.match(introRe);
  const biblioMatch = text.match(biblioRe);
  const appendixMatch = text.match(appendixRe);

  breakdown.introFound = !!introMatch;
  breakdown.biblioFound = !!biblioMatch;
  breakdown.appendixFound = !!appendixMatch;

  // Начало тела = позиция «Введение» (если есть), иначе — после титульника (~2000 символов), иначе — 0
  let bodyStart = 0;
  if (introMatch && introMatch.index !== undefined) {
    bodyStart = introMatch.index;
  } else if (breakdown.titlePageDetected) {
    bodyStart = 2000;
  }

  // Конец тела = позиция «Список литературы» (если есть), иначе — позиция «Приложение» (если есть), иначе — конец текста
  let bodyEnd = text.length;
  if (biblioMatch && biblioMatch.index !== undefined && biblioMatch.index > bodyStart) {
    bodyEnd = biblioMatch.index;
  } else if (appendixMatch && appendixMatch.index !== undefined && appendixMatch.index > bodyStart) {
    bodyEnd = appendixMatch.index;
  }

  const bodyText = text.substring(bodyStart, bodyEnd);
  const bodyWords = bodyText.split(/\s+/).filter(w => w.length > 0);

  // Сноски — часть тела работы по Программе практики, но mammoth их не извлекает в text,
  // поэтому добавляем их объём отдельно (передаётся из parseDocx; для PDF — пусто).
  const footnoteCharCount = footnotesText.length;
  const footnoteWordCount = footnotesText.split(/\s+/).filter(w => w.length > 0).length;
  const footnoteCharNoSpaces = footnotesText.replace(/\s+/g, '').length;
  breakdown.footnotesFound = footnoteCharCount > 0;

  const bodyWordCount = bodyWords.length + footnoteWordCount;
  const bodyCharCountWithSpaces = bodyText.length + footnoteCharCount;
  const bodyCharCountNoSpaces = bodyText.replace(/\s+/g, '').length + footnoteCharNoSpaces;

  // Приложения — всё, что после «Приложение»
  let appendixWordCount = 0;
  if (appendixMatch && appendixMatch.index !== undefined) {
    const appendixText = text.substring(appendixMatch.index);
    appendixWordCount = appendixText.split(/\s+/).filter(w => w.length > 0).length;
  }

  return {
    bodyWordCount,
    bodyCharCountWithSpaces,
    bodyCharCountNoSpaces,
    appendixWordCount,
    footnoteCharCount,
    breakdown,
  };
}
