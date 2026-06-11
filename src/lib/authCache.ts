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

// ============================================================
// Кэш пароля упрощённого преподавательского флоу в модуле курсовых
// («Я преподаватель / Проанализировать»). TTL 25 минут, привязка к ПК
// (localStorage браузера). Ключ отдельный от основной авторизации.
// ============================================================

const COURSE_TEACHER_TTL_MS = 25 * 60 * 1000; // 25 минут
const COURSE_TEACHER_KEY = 'vkr-course-teacher';

interface CourseTeacherRecord {
  expiresAt: number;
  pwd: string; // введённый пароль — нужен, чтобы слать на сервер после перезагрузки (не хранится в бандле)
}

/** Запомнить успешный ввод пароля преподавателя на 25 минут (с самим паролем для повторных запросов). */
export function saveCourseTeacher(password: string): void {
  if (typeof window === 'undefined') return;
  try {
    const rec: CourseTeacherRecord = { expiresAt: Date.now() + COURSE_TEACHER_TTL_MS, pwd: password };
    window.localStorage.setItem(COURSE_TEACHER_KEY, JSON.stringify(rec));
  } catch {}
}

/** Действующий пароль преподавателя из кэша (или null, если кэш истёк/пуст). */
export function getCourseTeacherPassword(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(COURSE_TEACHER_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw) as CourseTeacherRecord;
    if (!rec || typeof rec.expiresAt !== 'number' || Date.now() > rec.expiresAt || !rec.pwd) {
      window.localStorage.removeItem(COURSE_TEACHER_KEY);
      return null;
    }
    return rec.pwd;
  } catch {
    return null;
  }
}

/** Действует ли кэш пароля преподавателя (в пределах 25 минут). */
export function readCourseTeacher(): boolean {
  return getCourseTeacherPassword() !== null;
}

/** Сбросить режим преподавателя (вернуться в студенческий режим). */
export function clearCourseTeacher(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(COURSE_TEACHER_KEY);
  } catch {}
}
