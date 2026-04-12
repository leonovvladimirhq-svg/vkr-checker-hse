// ============================================================
// Клиентский кэш авторизации через localStorage (TTL 24 часа)
// Используется на странице студента и преподавателя, чтобы
// не вводить логин/пароль при каждом открытии сервиса.
// ============================================================

const TTL_MS = 24 * 60 * 60 * 1000; // 24 часа

export type AuthRole = 'student' | 'teacher';

interface AuthRecord {
  expiresAt: number;
}

function storageKey(role: AuthRole): string {
  return `vkr-auth-${role}`;
}

/** Сохранить метку авторизации на 24 часа */
export function saveAuth(role: AuthRole): void {
  if (typeof window === 'undefined') return;
  try {
    const rec: AuthRecord = { expiresAt: Date.now() + TTL_MS };
    window.localStorage.setItem(storageKey(role), JSON.stringify(rec));
  } catch {
    // localStorage может быть недоступен (private mode, quota и т.п.)
  }
}

/** Проверить, есть ли действующий кэш авторизации для роли */
export function readAuth(role: AuthRole): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(storageKey(role));
    if (!raw) return false;
    const rec = JSON.parse(raw) as AuthRecord;
    if (!rec || typeof rec.expiresAt !== 'number' || Date.now() > rec.expiresAt) {
      window.localStorage.removeItem(storageKey(role));
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Удалить кэш авторизации (при выходе из сервиса) */
export function clearAuth(role: AuthRole): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey(role));
  } catch {}
}
