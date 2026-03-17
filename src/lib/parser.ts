// ============================================================
// Парсинг документов: mammoth.js для .docx, pdf-parse для .pdf
// ============================================================

import mammoth from 'mammoth';

export interface ParsedDocument {
  text: string;         // Полный текст
  html: string;         // HTML-версия (для .docx)
  headings: string[];   // Найденные заголовки
  wordCount: number;
  pageEstimate: number; // Оценка количества страниц (~250 слов = 1 страница)
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

  return { text, html, headings, wordCount, pageEstimate };
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

  return {
    text,
    html: '', // PDF не даёт HTML
    headings,
    wordCount,
    pageEstimate: data.numpages || Math.ceil(wordCount / 250),
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
 * Подготовка текста для отправки в GPT (ограничение размера)
 */
export function prepareTextForGPT(text: string, maxChars: number = 60000): string {
  if (text.length <= maxChars) return text;

  // Берём начало и конец документа (важно для титульного листа и заключения)
  const halfMax = Math.floor(maxChars / 2);
  return text.substring(0, halfMax) +
    '\n\n[... ПРОПУЩЕНА СРЕДНЯЯ ЧАСТЬ ДОКУМЕНТА ...]\n\n' +
    text.substring(text.length - halfMax);
}
