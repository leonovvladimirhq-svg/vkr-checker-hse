// ============================================================
// Вход преподавателей и проверка доступа — НА СЕРВЕРЕ
//
// До 23.09.2026 вход в панель преподавателя проверялся только в браузере:
// пароль лежал в JS-коде страницы (и в публичном репозитории), а API
// отдавали список студентов, файлы работ и курсовые любому, кто знал адрес.
// Экран входа защищал экран, а не данные.
//
// Теперь:
//  - пароль сверяется на сервере со scrypt-хешем из teacher_accounts;
//  - браузер получает подписанную HMAC-куку vkr_teacher (HttpOnly — её не
//    прочитать скриптом страницы; подделать без секрета нельзя);
//  - каждый API преподавателя вызывает requireTeacher() и отдаёт только
//    работы из области видимости учётной записи.
//
// Middleware Next.js не используется намеренно: он работает в Edge Runtime
// без node:crypto, а проверка должна сходить в базу (учётную запись могли
// отключить — тогда сессия должна умереть сразу, а не через 12 часов).
// ============================================================

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  AttemptScope,
  TeacherAccountRow,
  getTeacherAccountById,
  getTeacherAccountByLogin,
  getSetting,
  setSetting,
} from './db';
import { TeacherRole } from './teachers';

export const TEACHER_COOKIE = 'vkr_teacher';
const SESSION_TTL_SEC = 12 * 60 * 60;

export interface TeacherSession {
  id: string;
  login: string;
  fullName: string;
  programme: string;
  role: TeacherRole;
}

// --- пароли ---------------------------------------------------

const SCRYPT_KEYLEN = 32;

/** Формат хеша: scrypt$<соль hex>$<хеш hex>. Тот же — в scripts/teacher-account.mjs. */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [kind, saltHex, hashHex] = stored.split('$');
  if (kind !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// --- подпись сессии -------------------------------------------

/**
 * Секрет подписи. Если в .env нет SESSION_SECRET — генерируется один раз и
 * хранится в таблице settings: сервис работает без ручной настройки, а
 * перезапуск контейнера не выкидывает преподавателей из системы.
 */
function sessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  let secret = getSetting('session_secret');
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    setSetting('session_secret', secret);
  }
  return secret;
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

export function issueSessionCookie(res: NextResponse, req: NextRequest, account: TeacherAccountRow): void {
  const payload = Buffer.from(JSON.stringify({
    id: account.id,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
  })).toString('base64url');

  res.cookies.set(TEACHER_COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: 'lax',
    // Сайт работает за nginx по HTTPS; локально (http://localhost) флаг
    // secure не ставим, иначе браузер куку просто не сохранит.
    secure: req.headers.get('x-forwarded-proto') === 'https',
    path: '/',
    maxAge: SESSION_TTL_SEC,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(TEACHER_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
}

// --- проверка -------------------------------------------------

export function authenticate(login: string, password: string): TeacherAccountRow | null {
  const account = getTeacherAccountByLogin(login);
  if (!account || !account.active) return null;
  return verifyPassword(password, account.password_hash) ? account : null;
}

/** Сессия из куки или null. Учётная запись перечитывается из базы на каждый запрос. */
export function getTeacher(req: NextRequest): TeacherSession | null {
  const raw = req.cookies.get(TEACHER_COOKIE)?.value;
  if (!raw) return null;

  const [payload, signature] = raw.split('.');
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let data: { id?: string; exp?: number };
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data.id || !data.exp || data.exp < Date.now() / 1000) return null;

  const account = getTeacherAccountById(data.id);
  if (!account || !account.active) return null;

  return {
    id: account.id,
    login: account.login,
    fullName: account.full_name,
    programme: account.programme,
    role: account.role,
  };
}

type Guard =
  | { teacher: TeacherSession; denied?: undefined }
  | { teacher?: undefined; denied: NextResponse };

/** Любой вошедший преподаватель. */
export function requireTeacher(req: NextRequest): Guard {
  const teacher = getTeacher(req);
  if (!teacher) {
    return { denied: NextResponse.json({ error: 'Требуется вход преподавателя', code: 'auth_required' }, { status: 401 }) };
  }
  return { teacher };
}

/**
 * Только общий доступ ОП ИК: курсовые, дайджест, настройки волны,
 * публикация итогового отчёта — это процессы ОП ИК, и преподаватель
 * ОП РиСО в них не участвует.
 */
export function requireIkShared(req: NextRequest): Guard {
  const guard = requireTeacher(req);
  if (guard.denied) return guard;
  if (guard.teacher.role !== 'shared') {
    return { denied: NextResponse.json({ error: 'Раздел доступен только для общего доступа ОП ИК', code: 'forbidden' }, { status: 403 }) };
  }
  return guard;
}

/** Какие работы видит учётная запись. */
export function scopeOf(t: TeacherSession): AttemptScope {
  return {
    programme: t.programme,
    supervisorId: t.role === 'supervisor' ? t.id : null,
  };
}

/**
 * Ответ «не найдено» для чужой работы — тот же, что для несуществующей.
 * Отвечать «403 доступ запрещён» значило бы подтверждать, что работа с таким
 * номером есть, и номера можно было бы перебирать.
 */
export function notFound(): NextResponse {
  return NextResponse.json({ error: 'Попытка не найдена' }, { status: 404 });
}
