// ============================================================
// Телеметрия в общий дашборд мониторинга проектов Школы коммуникаций
// (http://89.169.146.175:8080). У каждого проекта свой ингест-токен.
//
// Принципы:
//  - «выстрелил и забыл»: ответ студенту не ждёт дашборда, таймаут 5 с,
//    любая ошибка — только в console.warn;
//  - без DASHBOARD_URL / DASHBOARD_TOKEN — тихий no-op;
//  - ПДн не передаём: ФИО студента уходит только как короткий хеш (чтобы
//    считать уникальных студентов), имя файла — нет (в нём часто фамилия),
//    тема работы — нет. В дашборд идут программа, тип работы, методы, итог.
// ============================================================

import crypto from 'crypto';

const TIMEOUT_MS = 5000;

export interface TelemetryEvent {
  /** Стабильный идентификатор пользователя без ПДн (см. userRef). */
  user_ref?: string | null;
  request_text: string;
  response_text?: string | null;
  status?: 'ok' | 'error';
  latency_ms?: number | null;
  model?: string | null;
  dedup_key?: string | null;
}

/** Короткий хеш ФИО: один студент → один user_ref, само ФИО не передаётся. */
export function userRef(studentName: string): string {
  return 'student:' + crypto.createHash('sha256').update(studentName.trim().toLowerCase(), 'utf8').digest('hex').slice(0, 12);
}

function nowStamp(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

export function track(event: TelemetryEvent): void {
  const url = (process.env.DASHBOARD_URL || '').replace(/\/+$/, '');
  const token = process.env.DASHBOARD_TOKEN || '';
  if (!url || !token) return;

  const ts = nowStamp();
  const payload = {
    occurred_at: ts,
    user_ref: event.user_ref ?? null,
    request_text: event.request_text,
    response_text: event.response_text ?? null,
    status: event.status === 'error' ? 'error' : 'ok',
    latency_ms: event.latency_ms ?? null,
    model: event.model ?? process.env.OPENAI_MODEL ?? null,
    dedup_key: event.dedup_key ?? `${event.user_ref ?? 'anon'}:${ts}`,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  fetch(`${url}/api/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
    signal: controller.signal,
  })
    .catch(err => console.warn('Дашборд недоступен:', err?.message || err))
    .finally(() => clearTimeout(timer));
}
