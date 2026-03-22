// ============================================================
// Анализатор базы данных из Яндекс.Диска
// Скачивает файлы, парсит xlsx/csv/docx/pdf, формирует описание для GPT
// ============================================================

import { YaDiskFileInfo, YaDiskFolderResult, downloadPublicFile } from './yandex-disk';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';

export interface DbAnalysisResult {
  accessible: boolean;
  description: string;       // Текстовое описание для GPT
  fileCount: number;
  error?: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 МБ
const PARSEABLE_EXTENSIONS = ['.xlsx', '.xls', '.csv', '.tsv', '.docx', '.pdf'];
const DOC_TEXT_PREVIEW_LENGTH = 1000;

/**
 * Проанализировать содержимое папки БД с Яндекс.Диска
 */
export async function analyzeDatabase(
  publicUrl: string,
  folderInfo: YaDiskFolderResult,
): Promise<DbAnalysisResult> {
  if (!folderInfo.accessible) {
    return {
      accessible: false,
      description: '',
      fileCount: 0,
      error: folderInfo.error || 'Ссылка недоступна',
    };
  }

  if (folderInfo.files.length === 0) {
    return {
      accessible: true,
      description: 'Папка пуста — файлы не найдены.',
      fileCount: 0,
    };
  }

  const lines: string[] = [];
  lines.push(`Папка «${folderInfo.name}» содержит ${folderInfo.totalFiles} файлов:`);
  lines.push('');

  // Группируем файлы по типу
  const audioFiles = folderInfo.files.filter(f => isAudio(f));
  const spreadsheetFiles = folderInfo.files.filter(f => isSpreadsheet(f));
  const documentFiles = folderInfo.files.filter(f => isDocument(f));
  const otherFiles = folderInfo.files.filter(f => !isAudio(f) && !isSpreadsheet(f) && !isDocument(f));

  // Аудиофайлы — только метаданные
  if (audioFiles.length > 0) {
    lines.push(`Аудиофайлы (${audioFiles.length}):`);
    for (const f of audioFiles) {
      lines.push(`  - ${f.name} (${formatSize(f.size)})`);
    }
    lines.push('');
  }

  // Таблицы — скачиваем и парсим структуру
  if (spreadsheetFiles.length > 0) {
    lines.push(`Табличные файлы (${spreadsheetFiles.length}):`);
    for (const f of spreadsheetFiles) {
      if (f.size > MAX_FILE_SIZE) {
        lines.push(`  - ${f.name} (${formatSize(f.size)}) — файл слишком большой для автоматического анализа`);
        continue;
      }

      // Пытаемся скачать и распарсить
      const parsed = await parseFileContent(publicUrl, f);
      if (parsed) {
        lines.push(`  - ${f.name} (${formatSize(f.size)}):`);
        lines.push(parsed);
      } else {
        lines.push(`  - ${f.name} (${formatSize(f.size)}) — не удалось распарсить`);
      }
    }
    lines.push('');
  }

  // Документы — скачиваем и извлекаем текст
  if (documentFiles.length > 0) {
    lines.push(`Документы (${documentFiles.length}):`);
    for (const f of documentFiles) {
      if (f.size > MAX_FILE_SIZE) {
        lines.push(`  - ${f.name} (${formatSize(f.size)}) — файл слишком большой для автоматического анализа`);
        continue;
      }

      const parsed = await parseFileContent(publicUrl, f);
      if (parsed) {
        lines.push(`  - ${f.name} (${formatSize(f.size)}):`);
        lines.push(parsed);
      } else {
        lines.push(`  - ${f.name} (${formatSize(f.size)}) — не удалось распарсить`);
      }
    }
    lines.push('');
  }

  // Остальные файлы
  if (otherFiles.length > 0) {
    lines.push(`Другие файлы (${otherFiles.length}):`);
    for (const f of otherFiles) {
      lines.push(`  - ${f.name} (${formatSize(f.size)}, ${f.mime_type || 'неизвестный тип'})`);
    }
  }

  return {
    accessible: true,
    description: lines.join('\n'),
    fileCount: folderInfo.totalFiles,
  };
}

/**
 * Скачать и распарсить файл (xlsx/csv/docx/pdf)
 */
async function parseFileContent(publicUrl: string, file: YaDiskFileInfo): Promise<string | null> {
  try {
    const buffer = await downloadPublicFile(publicUrl, file.path);
    if (!buffer) return null;

    const ext = getExtension(file.name);

    if (ext === '.csv' || ext === '.tsv') {
      return parseCsvBuffer(buffer, ext === '.tsv' ? '\t' : ',');
    }

    if (ext === '.xlsx' || ext === '.xls') {
      return parseXlsxBuffer(buffer);
    }

    if (ext === '.docx') {
      return parseDocxBuffer(buffer);
    }

    if (ext === '.pdf') {
      return parsePdfBuffer(buffer);
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Парсинг Excel файла
 */
function parseXlsxBuffer(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const lines: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
    const rowCount = data.length;
    const headers = data[0] as any[] | undefined;

    if (headers && headers.length > 0) {
      const colNames = headers.map((h: any) => String(h || '')).filter(Boolean);
      lines.push(`    Лист «${sheetName}»: ${rowCount} строк, колонки: ${colNames.slice(0, 10).join(', ')}${colNames.length > 10 ? ` и ещё ${colNames.length - 10}` : ''}`);
    } else {
      lines.push(`    Лист «${sheetName}»: ${rowCount} строк`);
    }
  }

  return lines.join('\n');
}

/**
 * Парсинг CSV файла
 */
function parseCsvBuffer(buffer: Buffer, separator: string): string {
  const text = buffer.toString('utf-8');
  const rows = text.split('\n').filter(r => r.trim());
  const headerRow = rows[0];
  const headers = headerRow ? headerRow.split(separator).map(h => h.trim().replace(/^"|"$/g, '')) : [];

  return `    ${rows.length} строк, колонки: ${headers.slice(0, 10).join(', ')}${headers.length > 10 ? ` и ещё ${headers.length - 10}` : ''}`;
}

/**
 * Парсинг Word документа
 */
async function parseDocxBuffer(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value;
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const preview = text.substring(0, DOC_TEXT_PREVIEW_LENGTH).trim();

  return `    ${words.length} слов\n    Начало: «${preview}${text.length > DOC_TEXT_PREVIEW_LENGTH ? '...' : ''}»`;
}

/**
 * Парсинг PDF документа
 */
async function parsePdfBuffer(buffer: Buffer): Promise<string> {
  const pdfParse = (await import('pdf-parse')).default;
  const data = await pdfParse(buffer);
  const text = data.text;
  const words = text.split(/\s+/).filter((w: string) => w.length > 0);
  const preview = text.substring(0, DOC_TEXT_PREVIEW_LENGTH).trim();
  const pages = data.numpages || 0;

  return `    ${pages} стр., ${words.length} слов\n    Начало: «${preview}${text.length > DOC_TEXT_PREVIEW_LENGTH ? '...' : ''}»`;
}

// --- Утилиты ---

function isAudio(f: YaDiskFileInfo): boolean {
  const ext = getExtension(f.name);
  return ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.wma'].includes(ext);
}

function isSpreadsheet(f: YaDiskFileInfo): boolean {
  const ext = getExtension(f.name);
  return ['.xlsx', '.xls', '.csv', '.tsv'].includes(ext);
}

function isDocument(f: YaDiskFileInfo): boolean {
  const ext = getExtension(f.name);
  return ['.docx', '.pdf'].includes(ext);
}

function getExtension(filename: string): string {
  return ('.' + (filename.split('.').pop() || '')).toLowerCase();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}
