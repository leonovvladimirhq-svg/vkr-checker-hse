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

const MAX_DEPTH = 5;

/**
 * Рекурсивный обход папки на Яндекс.Диске с пагинацией
 */
async function fetchFolderRecursive(
  publicUrl: string,
  folderPath: string,
  prefix: string,
  depth: number = 0,
): Promise<YaDiskFileInfo[]> {
  if (depth > MAX_DEPTH) return [];

  const files: YaDiskFileInfo[] = [];
  let offset = 0;
  const limit = 100;

  // Пагинация — получаем ВСЕ элементы в папке
  while (true) {
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
        if (item.type === 'file') {
          files.push({
            name: prefix ? `${prefix}/${item.name}` : item.name,
            size: item.size || 0,
            type: 'file',
            mime_type: item.mime_type,
            path: item.path,
          });
        } else if (item.type === 'dir') {
          // Рекурсивно обходим подпапку
          const subPrefix = prefix ? `${prefix}/${item.name}` : item.name;
          const subPath = folderPath ? `${folderPath}/${item.name}` : `/${item.name}`;
          try {
            const subFiles = await fetchFolderRecursive(publicUrl, subPath, subPrefix, depth + 1);
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
export async function getPublicResourceInfo(publicUrl: string): Promise<YaDiskFolderResult> {
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
      const files = await fetchFolderRecursive(publicUrl, '', '', 0);

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
export async function downloadPublicFile(publicUrl: string, filePath?: string): Promise<Buffer | null> {
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
