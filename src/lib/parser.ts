// ============================================================
// Парсинг документов: mammoth.js для .docx, pdf-parse для .pdf
// ============================================================

import mammoth from 'mammoth';
import JSZip from 'jszip';

export interface VolumeBreakdown {
  titlePageDetected: boolean;
  introFound: boolean;
  biblioFound: boolean;
  appendixFound: boolean;
  footnotesFound: boolean;
  conceptFound: boolean;
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
  // Объём концептуальной (первой) главы, знаков с пробелами.
  // null — границы главы не распознаны (проверка уходит в ручную).
  conceptCharCount: number | null;
  volumeBreakdown: VolumeBreakdown;
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
export async function parseDocx(buffer: Buffer): Promise<ParsedDocument> {
  // Извлечение текста
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
  const volume = computeBodyVolume(text, footnotesText);

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
    conceptCharCount: volume.conceptCharCount,
    volumeBreakdown: volume.breakdown,
  };
}

/**
 * Извлечение текста из .pdf через pdf-parse
 */
export async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  // Динамический импорт pdf-parse (CommonJS модуль)
  const pdfParse = (await import('pdf-parse')).default;
  const data = await pdfParse(buffer);

  const text = data.text;
  const words = text.split(/\s+/).filter((w: string) => w.length > 0);
  const wordCount = words.length;

  // Простая эвристика для заголовков в PDF — строки заглавными или короткие строки перед длинными
  const lines = text.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
  const headings = lines.filter((line: string) => {
    // Строка до 100 символов, не заканчивается точкой, и содержит заглавную первую букву
    return line.length > 3 && line.length < 100 && !line.endsWith('.') && /^[A-ZА-ЯЁ]/.test(line);
  }).slice(0, 50); // Ограничиваем 50 заголовками

  // В PDF сноски идут инлайн внизу страницы и уже попадают в text → отдельно не добавляем.
  const volume = computeBodyVolume(text);

  return {
    text,
    html: '', // PDF не даёт HTML
    headings,
    wordCount,
    pageEstimate: data.numpages || Math.ceil(wordCount / 250),
    bodyWordCount: volume.bodyWordCount,
    bodyCharCountWithSpaces: volume.bodyCharCountWithSpaces,
    bodyCharCountNoSpaces: volume.bodyCharCountNoSpaces,
    appendixWordCount: volume.appendixWordCount,
    footnoteCharCount: volume.footnoteCharCount,
    conceptCharCount: volume.conceptCharCount,
    volumeBreakdown: volume.breakdown,
  };
}

/**
 * Автоопределение формата и парсинг
 */
export async function parseDocument(buffer: Buffer, filename: string): Promise<ParsedDocument> {
  const ext = filename.toLowerCase().split('.').pop();

  if (ext === 'docx') {
    return parseDocx(buffer);
  } else if (ext === 'pdf') {
    return parsePdf(buffer);
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
  conceptCharCount: number | null;
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
    conceptFound: false,
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
  const biblioRe = /(^|\n)\s*(список\s+(использованных\s+)?(литературы|источников(\s+и\s+литературы)?)|библиограф\w+|список\s+литературы|references|bibliography|list\s+of\s+references)\s*\n/i;
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

  // Объём концептуальной (первой) главы — от «Глава 1» до «Глава 2» внутри тела работы.
  // Нужен для критерия 2 приложения 39 Программы практики ОП РиСО (>= 15 000 знаков).
  const conceptCharCount = computeConceptCharCount(text, bodyStart, bodyEnd);
  breakdown.conceptFound = conceptCharCount !== null;

  return {
    bodyWordCount,
    bodyCharCountWithSpaces,
    bodyCharCountNoSpaces,
    appendixWordCount,
    footnoteCharCount,
    conceptCharCount,
    breakdown,
  };
}

/**
 * Объём первой (концептуальной) главы в знаках с пробелами.
 *
 * Границы ищутся по заголовкам «Глава 1…» / «Глава 2…» (римские цифры тоже
 * поддерживаются) ВНУТРИ тела работы — так оглавление, где те же строки идут
 * с номерами страниц, не мешает: тело начинается с «Введение», а оглавление
 * расположено выше.
 *
 * Если заголовки не распознаны (нестандартная нумерация — «1. Название»,
 * «Раздел 1» и т.п.) — возвращает null, и пункт уходит на ручную проверку.
 * Лучше честный «требуется проверка», чем неверная цифра в отзыве.
 */
export function computeConceptCharCount(
  text: string,
  bodyStart: number,
  bodyEnd: number,
): number | null {
  const body = text.substring(bodyStart, bodyEnd);

  const ch1 = body.match(/(^|\n)[ \t]*(?:глава|chapter)[ \t]*(?:1|i)(?![0-9ivx])/i);
  if (!ch1 || ch1.index === undefined) return null;

  const afterCh1 = ch1.index + ch1[0].length;
  const rest = body.substring(afterCh1);
  const ch2 = rest.match(/(^|\n)[ \t]*(?:глава|chapter)[ \t]*(?:2|ii)(?![0-9ivx])/i);
  if (!ch2 || ch2.index === undefined) return null;

  const conceptText = body.substring(ch1.index, afterCh1 + ch2.index);
  // Слишком короткий фрагмент — почти наверняка попадание в оглавление,
  // а не в реальную главу. Не выдаём заведомо ложную цифру.
  if (conceptText.replace(/\s+/g, '').length < 500) return null;

  return conceptText.length;
}
