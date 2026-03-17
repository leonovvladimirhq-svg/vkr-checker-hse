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
      status TEXT NOT NULL CHECK(status IN ('pass', 'fail')),
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
  created_at: string;
}

export function getAttemptCount(studentName: string): number {
  const db = getDb();
  const row = db.prepare(
    'SELECT COUNT(*) as cnt FROM attempts WHERE student_name = ?'
  ).get(studentName) as { cnt: number };
  return row.cnt;
}

export function getLastAttempt(studentName: string): AttemptRow | undefined {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM attempts WHERE student_name = ? ORDER BY created_at DESC LIMIT 1'
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
}): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO attempts (student_name, work_type, attempt_number, status, results_json,
      extracted_text_preview, file_name, db_link, pres_link, methods_json, uses_ai, wave)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    data.wave || 1
  );
  return result.lastInsertRowid as number;
}

export function getAllStudentsSummary(): Array<{
  student_name: string;
  work_type: string;
  status: string;
  attempt_number: number;
  last_date: string;
  wave: number;
}> {
  const db = getDb();
  return db.prepare(`
    SELECT student_name, work_type, status, attempt_number, created_at as last_date, wave
    FROM attempts
    WHERE id IN (
      SELECT MAX(id) FROM attempts GROUP BY student_name
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
