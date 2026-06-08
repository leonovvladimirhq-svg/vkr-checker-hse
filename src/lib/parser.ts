// ============================================================
// Парсинг документов: mammoth.js для .docx, pdf-parse для .pdf
// ============================================================

import mammoth from 'mammoth';

export interface VolumeBreakdown {
  titlePageDetected: boolean;
  introFound: boolean;
  biblioFound: boolean;
  appendixFound: boolean;
}

export interface ParsedDocument {
  text: string;         // Полный текст
  html: string;         // HTML-версия (для .docx)
  headings: string[];   // Найденные заголовки
  wordCount: number;
  pageEstimate: number; // Оценка количества страниц (~250 слов = 1 страница)
  // Объём «тела работы» — без титульника, оглавления, списка литературы и приложений.
  // Используется для проверки порога ≥90 000 знаков с пробелами по Программе практики 2025.
  bodyWordCount: number;
  bodyCharCountWithSpaces: number;
  bodyCharCountNoSpaces: number;
  appendixWordCount: number;
  volumeBreakdown: VolumeBreakdown;
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

  const volume = computeBodyVolume(text);

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
export function computeBodyVolume(text: string): BodyVolumeResult {
  const breakdown: VolumeBreakdown = {
    titlePageDetected: false,
    introFound: false,
    biblioFound: false,
    appendixFound: false,
  };

  // Эвристика титульного листа: упоминание «Высшая школа экономики» / «Магистерская» в первых ~2000 символов
  const head = text.substring(0, 2000);
  if (/высшая школа экономики|национальный исследовательский университет|магистерская/i.test(head)) {
    breakdown.titlePageDetected = true;
  }

  // Регексы маркеров разделов — гибкие (учитываем кавычки, переносы, регистр)
  const introRe = /(^|\n)\s*(введение)\s*\n/i;
  const biblioRe = /(^|\n)\s*(список\s+(использованных\s+)?(литературы|источников(\s+и\s+литературы)?)|библиограф\w+|список\s+литературы)\s*\n/i;
  const appendixRe = /(^|\n)\s*(приложения?|приложение\s+[№a-zа-я0-9])\s*(\n|$)/i;

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
  const bodyWordCount = bodyWords.length;
  const bodyCharCountWithSpaces = bodyText.length;
  const bodyCharCountNoSpaces = bodyText.replace(/\s+/g, '').length;

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
    breakdown,
  };
}
