// Общий разбор ответа fetch: вместо сырого "Unexpected token '<'" даём понятную ошибку.
// HTML-страница ошибки (502/504 от nginx или страница ошибки Next) определяется по
// content-type и/или ведущему '<' — тогда кидаем дружелюбное сообщение, а не падаем на JSON.parse.
export async function parseJsonResponse<T>(res: Response, ctx = 'Запрос'): Promise<T> {
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const text = await res.text().catch(() => '');
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      throw new Error('Сервер сейчас перегружен и не успел обработать запрос. Подождите минуту и попробуйте снова.');
    }
    if (text.trimStart().startsWith('<')) {
      throw new Error('Сервер вернул страницу ошибки вместо данных. Обновите страницу (Ctrl+F5) и попробуйте снова.');
    }
    throw new Error(`${ctx}: неожиданный ответ сервера (HTTP ${res.status}).`);
  }
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data && (data.error || data.message)) || `${ctx}: ошибка сервера (HTTP ${res.status}).`);
  }
  return data as T;
}
