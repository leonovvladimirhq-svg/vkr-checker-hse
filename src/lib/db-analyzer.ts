// ============================================================
// Анализатор базы данных из Яндекс.Диска
// Скачивает файлы, парсит xlsx/csv/docx/pdf, формирует описание для GPT
// ============================================================

import { YaDiskFileInfo, YaDiskFolderResult, downloadPublicFile, getPublicResourceInfo, extractYandexDiskUrl } from './yandex-disk';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';

/** Технические параметры одного медиафайла базы данных. */
export interface DbMediaFile {
  name: string;
  size: number;
  ext: string;
  /** Ориентировочная длительность в минутах, посчитанная по размеру файла
   *  и типичному битрейту формата. null — оценить невозможно (видео,
   *  неизвестный контейнер). Это ОЦЕНКА, а не измерение: Яндекс.Диск API
   *  длительность в метаданных публичной ссылки не отдаёт. */
  estMinutes: number | null;
  /** Формат допускается приложением 35 (аудио MP3/WAV, видео AVI/MOV/MPEG). */
  formatAllowed: boolean;
}

/** Сводка по составу базы данных — для технической части отзыва
 *  (приложение 36: «Содержит ___ аудио/видеофайл(ов), ___ таблиц, ___ других файлов»). */
export interface DbStats {
  total: number;
  media: number;       // аудио + видео
  tables: number;      // xlsx/xls/csv/tsv
  documents: number;   // docx/pdf
  other: number;
  mediaFiles: DbMediaFile[];
  /** Медиафайлы в форматах, не предусмотренных приложением 35. */
  disallowedFormats: string[];
}

export interface DbAnalysisResult {
  accessible: boolean;
  description: string;       // Текстовое описание для GPT
  fileCount: number;
  stats?: DbStats;
  error?: string;
}

/**
 * Анализирует БД по ссылке с фолбэком на ссылку из текста работы.
 *
 * Сначала пробует ссылку из формы. Если она недоступна (приватная/404/файл вместо папки),
 * ищет публичную ссылку Яндекс.Диска в тексте работы (обычно на титульном листе) и пробует её.
 * Возвращает первый доступный результат, иначе — недоступный результат по форменной ссылке.
 *
 * @param formLink ссылка из формы / сохранённая в попытке (может быть пустой)
 * @param docText  полный текст работы для поиска ссылки на титульном листе
 */
export async function analyzeDbWithFallback(
  formLink: string | null | undefined,
  docText: string,
): Promise<DbAnalysisResult> {
  const tryLink = async (link: string): Promise<DbAnalysisResult> => {
    const folderInfo = await getPublicResourceInfo(link);
    return analyzeDatabase(link, folderInfo);
  };

  let result: DbAnalysisResult = {
    accessible: false,
    description: '',
    fileCount: 0,
    error: 'Ссылка на базу данных не указана',
  };

  if (formLink) {
    try {
      result = await tryLink(formLink);
    } catch (err) {
      result = {
        accessible: false,
        description: '',
        fileCount: 0,
        error: (err as Error)?.message || 'Не удалось получить информацию по ссылке',
      };
    }
    if (result.accessible) return result;
  }

  // Фолбэк: ссылка из текста работы (титульный лист).
  const docLink = extractYandexDiskUrl(docText);
  if (docLink && docLink !== formLink) {
    try {
      const alt = await tryLink(docLink);
      if (alt.accessible) {
        alt.description = `(Ссылка из формы недоступна — использована ссылка на базу данных из текста работы.)\n${alt.description}`;
        return alt;
      }
    } catch {
      // оставляем исходный недоступный результат
    }
  }

  return result;
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
      stats: emptyStats(),
    };
  }

  const lines: string[] = [];
  lines.push(`Папка «${folderInfo.name}» содержит ${folderInfo.totalFiles} файлов:`);
  lines.push('');

  // Группируем файлы по типу
  const mediaFiles = folderInfo.files.filter(f => isAudio(f) || isVideo(f));
  const spreadsheetFiles = folderInfo.files.filter(f => isSpreadsheet(f));
  const documentFiles = folderInfo.files.filter(f => isDocument(f));
  const otherFiles = folderInfo.files.filter(
    f => !isAudio(f) && !isVideo(f) && !isSpreadsheet(f) && !isDocument(f),
  );

  // Аудио/видео — только метаданные (содержимое не скачиваем).
  // Длительность даём ОЦЕНКОЙ по размеру: публичный API Яндекс.Диска её не отдаёт.
  const mediaStats = mediaFiles.map(toMediaFile);
  if (mediaFiles.length > 0) {
    lines.push(`Аудио/видеофайлы (${mediaFiles.length}):`);
    for (const m of mediaStats) {
      const dur = m.estMinutes === null
        ? 'длительность автоматически не определяется'
        : `ориентировочно ~${m.estMinutes} мин (оценка по размеру файла, не измерение)`;
      lines.push(`  - ${m.name} (${formatSize(m.size)}, ${dur})`);
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
    stats: {
      total: folderInfo.totalFiles,
      media: mediaFiles.length,
      tables: spreadsheetFiles.length,
      documents: documentFiles.length,
      other: otherFiles.length,
      mediaFiles: mediaStats,
      disallowedFormats: Array.from(
        new Set(mediaStats.filter(m => !m.formatAllowed).map(m => m.ext)),
      ),
    },
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

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.wma'];
const VIDEO_EXTENSIONS = ['.avi', '.mov', '.mpeg', '.mpg', '.mp4', '.mkv', '.wmv', '.webm'];

/** Форматы, прямо разрешённые приложением 35 Программы практики ОП РиСО. */
const ALLOWED_MEDIA_EXTENSIONS = ['.mp3', '.wav', '.avi', '.mov', '.mpeg', '.mpg'];

/**
 * Типичный размер минуты записи, байт. Используется только для ОРИЕНТИРОВОЧНОЙ
 * оценки длительности: точную длительность даёт лишь чтение заголовков файла,
 * а медиафайлы мы принципиально не скачиваем.
 */
const BYTES_PER_MINUTE: Record<string, number> = {
  '.mp3': 960000,      // 128 кбит/с
  '.m4a': 960000,
  '.aac': 960000,
  '.ogg': 960000,
  '.wma': 960000,
  '.flac': 5250000,    // ~700 кбит/с
  '.wav': 10584000,    // 44,1 кГц / 16 бит / стерео
};

function isAudio(f: YaDiskFileInfo): boolean {
  return AUDIO_EXTENSIONS.includes(getExtension(f.name));
}

function isVideo(f: YaDiskFileInfo): boolean {
  return VIDEO_EXTENSIONS.includes(getExtension(f.name));
}

function toMediaFile(f: YaDiskFileInfo): DbMediaFile {
  const ext = getExtension(f.name);
  const perMinute = BYTES_PER_MINUTE[ext];
  return {
    name: f.name,
    size: f.size,
    ext,
    // Для видео битрейт варьируется на два порядка — оценку не даём.
    estMinutes: perMinute ? Math.round(f.size / perMinute) : null,
    formatAllowed: ALLOWED_MEDIA_EXTENSIONS.includes(ext),
  };
}

function emptyStats(): DbStats {
  return {
    total: 0, media: 0, tables: 0, documents: 0, other: 0,
    mediaFiles: [], disallowedFormats: [],
  };
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
