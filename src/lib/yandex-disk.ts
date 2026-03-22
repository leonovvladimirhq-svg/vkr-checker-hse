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

    // Если это папка — извлекаем список файлов + содержимое подпапок (1 уровень)
    if (data.type === 'dir' && data._embedded?.items) {
      const topItems: any[] = data._embedded.items;
      const files: YaDiskFileInfo[] = [];

      for (const item of topItems) {
        if (item.type === 'file') {
          files.push({
            name: item.name,
            size: item.size || 0,
            type: 'file',
            mime_type: item.mime_type,
            path: item.path,
          });
        } else if (item.type === 'dir') {
          // Обходим подпапку — один уровень вложенности
          try {
            const subUrl = `${API_BASE}?public_key=${encodeURIComponent(publicUrl)}&path=${encodeURIComponent('/' + item.name)}&limit=100`;
            const subController = new AbortController();
            const subTimeout = setTimeout(() => subController.abort(), TIMEOUT_MS);
            const subRes = await fetch(subUrl, { signal: subController.signal });
            clearTimeout(subTimeout);

            if (subRes.ok) {
              const subData = await subRes.json();
              if (subData._embedded?.items) {
                for (const subItem of subData._embedded.items) {
                  if (subItem.type === 'file') {
                    files.push({
                      name: `${item.name}/${subItem.name}`,
                      size: subItem.size || 0,
                      type: 'file',
                      mime_type: subItem.mime_type,
                      path: subItem.path,
                    });
                  }
                }
              }
            }
          } catch {
            // Не удалось получить содержимое подпапки — добавляем как папку
            files.push({
              name: item.name,
              size: 0,
              type: 'dir',
              mime_type: undefined,
              path: item.path,
            });
          }
        }
      }

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
