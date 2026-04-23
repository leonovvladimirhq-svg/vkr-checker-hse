// ============================================================
// SQLite база данных — хранение попыток и результатов
// ============================================================

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'vkr.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_name TEXT NOT NULL,
      work_type TEXT NOT NULL CHECK(work_type IN ('project', 'dissertation')),
      attempt_number INTEGER NOT NULL CHECK(attempt_number BETWEEN 1 AND 3),
      status TEXT NOT NULL CHECK(status IN ('pass', 'fail', 'pending')),
      results_json TEXT NOT NULL,
      extracted_text_preview TEXT,
      file_name TEXT,
      db_link TEXT,
      pres_link TEXT,
      methods_json TEXT,
      uses_ai INTEGER DEFAULT 0,
      wave INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_attempts_student ON attempts(student_name);
    CREATE INDEX IF NOT EXISTS idx_attempts_date ON attempts(created_at);
  `);

  // Миграция: расширить CHECK constraint для поддержки статуса 'pending'
  // SQLite не позволяет ALTER TABLE для CHECK — пересоздаём таблицу
  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='attempts'").get() as { sql: string } | undefined;
    if (tableInfo && tableInfo.sql && !tableInfo.sql.includes("'pending'")) {
      db.exec(`
        ALTER TABLE attempts RENAME TO attempts_old;
        CREATE TABLE attempts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          student_name TEXT NOT NULL,
          work_type TEXT NOT NULL CHECK(work_type IN ('project', 'dissertation')),
          attempt_number INTEGER NOT NULL CHECK(attempt_number BETWEEN 1 AND 3),
          status TEXT NOT NULL CHECK(status IN ('pass', 'fail', 'pending')),
          results_json TEXT NOT NULL,
          extracted_text_preview TEXT,
          file_name TEXT,
          db_link TEXT,
          pres_link TEXT,
          methods_json TEXT,
          uses_ai INTEGER DEFAULT 0,
          wave INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO attempts SELECT * FROM attempts_old;
        DROP TABLE attempts_old;
        CREATE INDEX IF NOT EXISTS idx_attempts_student ON attempts(student_name);
        CREATE INDEX IF NOT EXISTS idx_attempts_date ON attempts(created_at);
      `);
    }
  } catch (e) {
    console.error('Migration error (non-critical):', e);
  }

  // Миграция: добавить поле feedback
  try {
    const colCheck = db.prepare("PRAGMA table_info(attempts)").all() as Array<{name: string}>;
    const hasFeedback = colCheck.some((c: any) => c.name === 'feedback');
    if (!hasFeedback) {
      db.exec("ALTER TABLE attempts ADD COLUMN feedback TEXT");
    }
  } catch (e) {
    console.error('Migration feedback error (non-critical):', e);
  }

  // Миграция: добавить поле file_path для хранения загруженных файлов
  try {
    const colCheck2 = db.prepare("PRAGMA table_info(attempts)").all() as Array<{name: string}>;
    const hasFilePath = colCheck2.some((c: any) => c.name === 'file_path');
    if (!hasFilePath) {
      db.exec("ALTER TABLE attempts ADD COLUMN file_path TEXT");
    }
  } catch (e) {
    console.error('Migration file_path error (non-critical):', e);
  }

  // Миграция: добавить поле teacher_review для отзыва преподавателя
  try {
    const colCheck3 = db.prepare("PRAGMA table_info(attempts)").all() as Array<{name: string}>;
    const hasTeacherReview = colCheck3.some((c: any) => c.name === 'teacher_review');
    if (!hasTeacherReview) {
      db.exec("ALTER TABLE attempts ADD COLUMN teacher_review TEXT");
    }
  } catch (e) {
    console.error('Migration teacher_review error (non-critical):', e);
  }

  // Миграция: добавить поле tech_comment для технического комментария преподавателя
  try {
    const colCheck4 = db.prepare("PRAGMA table_info(attempts)").all() as Array<{name: string}>;
    const hasTechComment = colCheck4.some((c: any) => c.name === 'tech_comment');
    if (!hasTechComment) {
      db.exec("ALTER TABLE attempts ADD COLUMN tech_comment TEXT");
    }
  } catch (e) {
    console.error('Migration tech_comment error (non-critical):', e);
  }

  // Default settings
  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );
  insertSetting.run('digest_email', '');
  insertSetting.run('current_wave', '1');
}

// --- Attempts ---

export interface AttemptRow {
  id: number;
  student_name: string;
  work_type: string;
  attempt_number: number;
  status: string;
  results_json: string;
  extracted_text_preview: string | null;
  file_name: string | null;
  db_link: string | null;
  pres_link: string | null;
  methods_json: string | null;
  uses_ai: number;
  wave: number;
  file_path: string | null;
  feedback: string | null;
  teacher_review: string | null;
  tech_comment: string | null;
  created_at: string;
}

export function getAttemptCount(studentName: string): number {
  const db = getDb();
  const row = db.prepare(
    'SELECT COUNT(*) as cnt FROM attempts WHERE TRIM(student_name) = TRIM(?)'
  ).get(studentName) as { cnt: number };
  return row.cnt;
}

export function getLastAttempt(studentName: string): AttemptRow | undefined {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM attempts WHERE TRIM(student_name) = TRIM(?) ORDER BY created_at DESC LIMIT 1'
  ).get(studentName) as AttemptRow | undefined;
}

export function insertAttempt(data: {
  student_name: string;
  work_type: string;
  attempt_number: number;
  status: string;
  results_json: string;
  extracted_text_preview?: string;
  file_name?: string;
  db_link?: string;
  pres_link?: string;
  methods_json?: string;
  uses_ai?: boolean;
  wave?: number;
  feedback?: string;
  file_path?: string;
}): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO attempts (student_name, work_type, attempt_number, status, results_json,
      extracted_text_preview, file_name, db_link, pres_link, methods_json, uses_ai, wave, feedback, file_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    data.student_name,
    data.work_type,
    data.attempt_number,
    data.status,
    data.results_json,
    data.extracted_text_preview || null,
    data.file_name || null,
    data.db_link || null,
    data.pres_link || null,
    data.methods_json || null,
    data.uses_ai ? 1 : 0,
    data.wave || 1,
    data.feedback || null,
    data.file_path || null
  );
  return result.lastInsertRowid as number;
}

export function getAllStudentsSummary(): Array<{
  id: number;
  student_name: string;
  work_type: string;
  status: string;
  attempt_number: number;
  last_date: string;
  wave: number;
}> {
  const db = getDb();
  return db.prepare(`
    SELECT id, student_name, work_type, status, attempt_number, created_at as last_date, wave
    FROM attempts
    WHERE id IN (
      SELECT MAX(id) FROM attempts GROUP BY TRIM(student_name)
    )
    ORDER BY created_at DESC
  `).all() as any[];
}

export function getTodayAttempts(): AttemptRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM attempts
    WHERE DATE(created_at) = DATE('now')
    ORDER BY created_at DESC
  `).all() as AttemptRow[];
}

export function getAttemptById(id: number): AttemptRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM attempts WHERE id = ?').get(id) as AttemptRow | undefined;
}

// Статус загрузки работы (для страницы отчёта, работает до публикации отчёта)
export function getStudentSubmissionStatus(studentName: string): {
  found: boolean;
  created_at?: string;
  attempt_number?: number;
  attempt_id?: number;
} {
  const db = getDb();
  const row = db.prepare(
    'SELECT id, created_at, attempt_number FROM attempts WHERE TRIM(student_name) = TRIM(?) ORDER BY created_at DESC LIMIT 1'
  ).get(studentName) as { id: number; created_at: string; attempt_number: number } | undefined;

  if (!row) return { found: false };
  return {
    found: true,
    created_at: row.created_at,
    attempt_number: row.attempt_number,
    attempt_id: row.id,
  };
}

// Получить последнюю попытку студента, чей id входит в снапшот
export function getAttemptByIdIfInSnapshot(studentName: string, snapshotIds: number[]): AttemptRow | undefined {
  if (snapshotIds.length === 0) return undefined;
  const db = getDb();
  const placeholders = snapshotIds.map(() => '?').join(',');
  return db.prepare(
    `SELECT * FROM attempts WHERE TRIM(student_name) = TRIM(?) AND id IN (${placeholders}) ORDER BY created_at DESC LIMIT 1`
  ).get(studentName, ...snapshotIds) as AttemptRow | undefined;
}

export function getAttemptsByStudent(studentName: string): AttemptRow[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM attempts WHERE TRIM(student_name) = TRIM(?) ORDER BY created_at DESC'
  ).all(studentName) as AttemptRow[];
}

export function updateAttemptStatus(id: number, newStatus: string): boolean {
  const db = getDb();
  const result = db.prepare('UPDATE attempts SET status = ? WHERE id = ?').run(newStatus, id);
  return result.changes > 0;
}

export function updateAttemptFields(id: number, fields: {
  status?: string;
  teacher_review?: string;
  tech_comment?: string;
}): boolean {
  const db = getDb();
  const sets: string[] = [];
  const values: any[] = [];

  if (fields.status !== undefined) {
    if (!['pass', 'fail', 'pending'].includes(fields.status)) {
      throw new Error('Invalid status');
    }
    sets.push('status = ?');
    values.push(fields.status);
  }
  if (fields.teacher_review !== undefined) {
    sets.push('teacher_review = ?');
    values.push(fields.teacher_review);
  }
  if (fields.tech_comment !== undefined) {
    sets.push('tech_comment = ?');
    values.push(fields.tech_comment);
  }

  if (sets.length === 0) return false;

  values.push(id);
  const result = db.prepare(`UPDATE attempts SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

export function deleteAttempt(id: number): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM attempts WHERE id = ?').run(id);
  return result.changes > 0;
}

// --- Settings ---

export function getSetting(key: string): string {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value || '';
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}
