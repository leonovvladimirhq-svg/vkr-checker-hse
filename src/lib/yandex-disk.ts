// ============================================================
// Работа с Яндекс.Диск API (публичные ссылки)
// Не требует OAuth — работает только с публичными ссылками
// ============================================================

export interface YaDiskFileInfo {
  name: string;
  size: number;          // байт
  type: 'file' | 'dir';
  mime_type?: string;
  path?: string;
}

export interface YaDiskFolderResult {
  name: string;
  files: YaDiskFileInfo[];
  totalFiles: number;
  accessible: boolean;
  error?: string;
}

const API_BASE = 'https://cloud-api.yandex.net/v1/disk/public/resources';
const TIMEOUT_MS = 15000;

// Хосты, которые Яндекс.Диск API принимает как public_key напрямую.
const DISK_HOST_RE = /^https?:\/\/(?:disk\.360\.yandex\.[a-z]+|disk\.yandex\.[a-z]+|yadi\.sk)\//i;

/**
 * Разворачивает сокращённую/непрямую ссылку в прямую ссылку Яндекс.Диска.
 * - Если ссылка уже «дисковая» — возвращает как есть.
 * - Иначе best-effort пытается пройти по редиректу (clck.ru, sba.yandex.ru/redirect).
 *   ВАЖНО: на серверных IP clck.ru может отдавать капчу вместо редиректа — тогда
 *   развернуть не удаётся и возвращается null (вызывающий покажет понятное сообщение).
 */
export async function resolveDiskUrl(rawUrl: string): Promise<string | null> {
  if (!rawUrl) return null;
  if (DISK_HOST_RE.test(rawUrl)) return rawUrl;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(rawUrl, { redirect: 'follow', signal: controller.signal });
    clearTimeout(timeout);
    try { await res.body?.cancel(); } catch { /* ignore */ }
    let landing = res.url || '';
    // sba.yandex.ru/redirect?url=<целевой адрес> — достаём диск-ссылку из параметра url
    try {
      const u = new URL(landing);
      if (/(^|\.)sba\.yandex\./i.test(u.hostname) && u.searchParams.get('url')) {
        landing = decodeURIComponent(u.searchParams.get('url') as string);
      }
    } catch { /* ignore */ }
    return DISK_HOST_RE.test(landing) ? landing : null;
  } catch {
    return null;
  }
}

/**
 * Извлекает первую публичную ссылку Яндекс.Диска из текста работы (обычно — с титульного листа).
 * Используется как фолбэк, когда ссылка из формы пустая или недоступна.
 * Поддерживает disk.yandex.ru/.com, yadi.sk и disk.360.yandex.ru.
 */
export function extractYandexDiskUrl(text: string): string | null {
  if (!text) return null;
  const re = /https?:\/\/(?:disk\.360\.yandex\.[a-z]+|disk\.yandex\.[a-z]+|yadi\.sk)\/[^\s)<>"'«»]+/i;
  const m = text.match(re);
  if (!m) return null;
  // Обрезаем хвостовую пунктуацию, прилипшую к ссылке в тексте.
  return m[0].replace(/[.,;]+$/, '');
}

const MAX_DEPTH = 5;
const MAX_FILES = 300;          // Лимит файлов — останавливаем обход
const GLOBAL_TIMEOUT_MS = 60000; // 60 сек на весь рекурсивный обход

/**
 * Рекурсивный обход папки на Яндекс.Диске с пагинацией
 */
async function fetchFolderRecursive(
  publicUrl: string,
  folderPath: string,
  prefix: string,
  depth: number = 0,
  deadline: number = Date.now() + GLOBAL_TIMEOUT_MS,
  allFiles: YaDiskFileInfo[] = [],
): Promise<YaDiskFileInfo[]> {
  if (depth > MAX_DEPTH) return [];
  if (Date.now() >= deadline) return [];       // общий таймаут истёк
  if (allFiles.length >= MAX_FILES) return []; // достигнут лимит файлов

  const files: YaDiskFileInfo[] = [];
  let offset = 0;
  const limit = 100;

  // Пагинация — получаем ВСЕ элементы в папке
  while (true) {
    // Проверяем таймаут и лимит перед каждым запросом
    if (Date.now() >= deadline) break;
    if (allFiles.length >= MAX_FILES) break;

    try {
      let url = `${API_BASE}?public_key=${encodeURIComponent(publicUrl)}&limit=${limit}&offset=${offset}`;
      if (folderPath) {
        url += `&path=${encodeURIComponent(folderPath)}`;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) break;

      const data = await res.json();
      const items = data._embedded?.items || [];

      for (const item of items) {
        if (allFiles.length >= MAX_FILES) break; // лимит достигнут внутри страницы
        if (item.type === 'file') {
          const fileInfo: YaDiskFileInfo = {
            name: prefix ? `${prefix}/${item.name}` : item.name,
            size: item.size || 0,
            type: 'file',
            mime_type: item.mime_type,
            path: item.path,
          };
          files.push(fileInfo);
          allFiles.push(fileInfo);
        } else if (item.type === 'dir') {
          // Рекурсивно обходим подпапку
          const subPrefix = prefix ? `${prefix}/${item.name}` : item.name;
          const subPath = folderPath ? `${folderPath}/${item.name}` : `/${item.name}`;
          try {
            const subFiles = await fetchFolderRecursive(
              publicUrl, subPath, subPrefix, depth + 1, deadline, allFiles,
            );
            files.push(...subFiles);
          } catch {
            // Не удалось обойти подпапку — пропускаем
          }
        }
      }

      // Если получено меньше limit — значит все элементы получены
      if (items.length < limit) break;
      offset += limit;
    } catch {
      break;
    }
  }

  return files;
}

/**
 * Получить информацию о публичной папке/файле на Яндекс.Диске
 */
export async function getPublicResourceInfo(rawUrl: string): Promise<YaDiskFolderResult> {
  const publicUrl = await resolveDiskUrl(rawUrl);
  if (!publicUrl) {
    return {
      name: '', files: [], totalFiles: 0, accessible: false,
      error: 'Ссылка не распознана как прямая ссылка на Яндекс.Диск. Если вы использовали короткую ссылку (например, clck.ru) — вставьте, пожалуйста, прямую ссылку вида https://disk.yandex.ru/... или https://disk.360.yandex.ru/...',
    };
  }
  try {
    const url = `${API_BASE}?public_key=${encodeURIComponent(publicUrl)}&limit=100`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      if (res.status === 404) {
        return { name: '', files: [], totalFiles: 0, accessible: false, error: 'Ссылка не найдена (404)' };
      }
      if (res.status === 403) {
        return { name: '', files: [], totalFiles: 0, accessible: false, error: 'Ссылка приватная или недоступна' };
      }
      return { name: '', files: [], totalFiles: 0, accessible: false, error: `Ошибка API: ${res.status}` };
    }

    const data = await res.json();

    // Если это папка — рекурсивно обходим все подпапки
    if (data.type === 'dir') {
      const deadline = Date.now() + GLOBAL_TIMEOUT_MS;
      const files = await fetchFolderRecursive(publicUrl, '', '', 0, deadline, []);

      return {
        name: data.name,
        files,
        totalFiles: files.length,
        accessible: true,
      };
    }

    // Если это одиночный файл
    if (data.type === 'file') {
      return {
        name: data.name,
        files: [{
          name: data.name,
          size: data.size || 0,
          type: 'file',
          mime_type: data.mime_type,
        }],
        totalFiles: 1,
        accessible: true,
      };
    }

    return { name: data.name || '', files: [], totalFiles: 0, accessible: true };

  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { name: '', files: [], totalFiles: 0, accessible: false, error: 'Таймаут запроса к Яндекс.Диску' };
    }
    return { name: '', files: [], totalFiles: 0, accessible: false, error: err.message || 'Ошибка соединения' };
  }
}

/**
 * Скачать файл из публичной папки на Яндекс.Диске
 */
export async function downloadPublicFile(rawUrl: string, filePath?: string): Promise<Buffer | null> {
  const publicUrl = await resolveDiskUrl(rawUrl);
  if (!publicUrl) return null;
  try {
    let url = `${API_BASE}/download?public_key=${encodeURIComponent(publicUrl)}`;
    if (filePath) {
      url += `&path=${encodeURIComponent(filePath)}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = await res.json();
    if (!data.href) return null;

    // Скачиваем по полученной ссылке
    const downloadController = new AbortController();
    const downloadTimeout = setTimeout(() => downloadController.abort(), 30000);

    const downloadRes = await fetch(data.href, { signal: downloadController.signal });
    clearTimeout(downloadTimeout);

    if (!downloadRes.ok) return null;

    const arrayBuffer = await downloadRes.arrayBuffer();
    return Buffer.from(arrayBuffer);

  } catch {
    return null;
  }
}
