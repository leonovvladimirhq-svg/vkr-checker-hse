// ============================================================
// SQLite слой для модуля курсовой работы
// Отдельная таблица course_attempts — формат вывода у курсовых
// принципиально иной, чем у ВКР (рекомендации, а не pass/fail).
// ============================================================

import { getDb } from './db';
import type { CourseType } from './methodology';

let initialised = false;

function ensureSchema() {
  if (initialised) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS course_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_name TEXT NOT NULL,
      course_type TEXT NOT NULL CHECK(course_type IN ('research', 'project')),
      attempt_number INTEGER NOT NULL,
      file_name TEXT,
      word_count INTEGER,
      page_estimate INTEGER,
      headings_json TEXT,
      extracted_text_preview TEXT,
      analysis_json TEXT NOT NULL,
      top5_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_course_attempts_student ON course_attempts(student_name);
    CREATE INDEX IF NOT EXISTS idx_course_attempts_date ON course_attempts(created_at);
  `);

  // --- Ленивые миграции: добавляем колонки, если их нет ---
  const cols = db.prepare("PRAGMA table_info(course_attempts)").all() as Array<{ name: string }>;
  const has = (name: string) => cols.some(c => c.name === name);
  const safeAlter = (sql: string, label: string) => {
    try { db.exec(sql); } catch (e) { console.error(`[db-course] migration ${label} failed (non-critical):`, e); }
  };
  if (!has('work_title'))        safeAlter('ALTER TABLE course_attempts ADD COLUMN work_title TEXT', 'work_title');
  if (!has('file_path'))         safeAlter('ALTER TABLE course_attempts ADD COLUMN file_path TEXT', 'file_path');
  if (!has('submitted_at'))      safeAlter('ALTER TABLE course_attempts ADD COLUMN submitted_at DATETIME', 'submitted_at');
  if (!has('readiness_status'))  safeAlter('ALTER TABLE course_attempts ADD COLUMN readiness_status TEXT', 'readiness_status');
  if (!has('readiness_text'))    safeAlter('ALTER TABLE course_attempts ADD COLUMN readiness_text TEXT', 'readiness_text');

  initialised = true;
}

export interface CourseAttemptRow {
  id: number;
  student_name: string;
  course_type: CourseType;
  attempt_number: number;
  file_name: string | null;
  word_count: number | null;
  page_estimate: number | null;
  headings_json: string | null;
  extracted_text_preview: string | null;
  analysis_json: string;
  top5_json: string;
  created_at: string;
  // Новые поля (NULL для старых записей):
  work_title: string | null;
  file_path: string | null;
  submitted_at: string | null;
  readiness_status: string | null;
  readiness_text: string | null;
}

export function getCourseAttemptCount(studentName: string): number {
  ensureSchema();
  const db = getDb();
  const row = db
    .prepare(
      'SELECT COUNT(*) as cnt FROM course_attempts WHERE TRIM(student_name) = TRIM(?)'
    )
    .get(studentName) as { cnt: number };
  return row.cnt;
}

export function insertCourseAttempt(data: {
  student_name: string;
  course_type: CourseType;
  attempt_number: number;
  file_name?: string;
  word_count?: number;
  page_estimate?: number;
  headings_json?: string;
  extracted_text_preview?: string;
  analysis_json: string;
  top5_json: string;
  work_title?: string;
  readiness_status?: string;
  readiness_text?: string;
}): number {
  ensureSchema();
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO course_attempts (
      student_name, course_type, attempt_number, file_name,
      word_count, page_estimate, headings_json, extracted_text_preview,
      analysis_json, top5_json, work_title, readiness_status, readiness_text
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    data.student_name,
    data.course_type,
    data.attempt_number,
    data.file_name ?? null,
    data.word_count ?? null,
    data.page_estimate ?? null,
    data.headings_json ?? null,
    data.extracted_text_preview ?? null,
    data.analysis_json,
    data.top5_json,
    data.work_title ?? null,
    data.readiness_status ?? null,
    data.readiness_text ?? null,
  );
  return result.lastInsertRowid as number;
}

export function getCourseAttemptsByStudent(studentName: string): CourseAttemptRow[] {
  ensureSchema();
  const db = getDb();
  return db
    .prepare(
      'SELECT * FROM course_attempts WHERE TRIM(student_name) = TRIM(?) ORDER BY created_at DESC'
    )
    .all(studentName) as CourseAttemptRow[];
}

export function getCourseAttemptById(id: number): CourseAttemptRow | undefined {
  ensureSchema();
  const db = getDb();
  return db
    .prepare('SELECT * FROM course_attempts WHERE id = ?')
    .get(id) as CourseAttemptRow | undefined;
}

/**
 * Помечает запись как «отправленную преподавателю». Прописывает путь к файлу,
 * время отправки и (если ещё не было) тему работы.
 */
export function markCourseAttemptSubmitted(
  id: number,
  data: { file_path: string; work_title?: string },
): boolean {
  ensureSchema();
  const db = getDb();
  const sets = ['file_path = ?', 'submitted_at = CURRENT_TIMESTAMP'];
  const vals: any[] = [data.file_path];
  if (data.work_title !== undefined) {
    sets.push('work_title = ?');
    vals.push(data.work_title);
  }
  vals.push(id);
  const r = db.prepare(`UPDATE course_attempts SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return r.changes > 0;
}

/**
 * Список работ, отправленных преподавателю. Для таблицы /teacher.
 */
export function getSubmittedCourseAttempts(): CourseAttemptRow[] {
  ensureSchema();
  const db = getDb();
  return db
    .prepare(
      'SELECT * FROM course_attempts WHERE submitted_at IS NOT NULL ORDER BY submitted_at DESC'
    )
    .all() as CourseAttemptRow[];
}
