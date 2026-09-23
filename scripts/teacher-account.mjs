#!/usr/bin/env node
// ============================================================
// Управление учётными записями преподавателей — запускается НА СЕРВЕРЕ,
// внутри контейнера:
//
//   docker exec -w /app vkr-checker node scripts/teacher-account.mjs list
//   docker exec -w /app vkr-checker node scripts/teacher-account.mjs password zverev
//   docker exec -w /app vkr-checker node scripts/teacher-account.mjs password "admin 1029" <пароль>
//   docker exec -w /app vkr-checker node scripts/teacher-account.mjs role katkova programme_lead
//   docker exec -w /app vkr-checker node scripts/teacher-account.mjs active zverev 0
//
// password без второго аргумента генерирует случайный пароль и печатает его
// ОДИН раз — в базе остаётся только хеш, восстановить пароль нельзя, только
// задать новый.
//
// Формат хеша совпадает с src/lib/teacher-auth.ts: scrypt$<соль>$<хеш>.
// Сами учётные записи (ФИО, логины) создаёт сервис при старте из
// src/lib/teachers.ts — скрипт их не добавляет, только настраивает.
// ============================================================

import crypto from 'node:crypto';
import path from 'node:path';
import Database from 'better-sqlite3';

const DB_PATH = path.join(process.cwd(), 'data', 'vkr.db');
const ROLES = ['supervisor', 'programme_lead', 'shared'];
// Без похожих символов (0/O, 1/l/I): пароль будут переписывать с листа.
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generatePassword() {
  const chars = Array.from(crypto.randomBytes(12), b => ALPHABET[b % ALPHABET.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8).join('')}`;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const db = new Database(DB_PATH);
const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='teacher_accounts'").get();
if (!hasTable) fail('Таблицы teacher_accounts нет: откройте сайт хотя бы раз после обновления — сервис создаст её сам.');

const [cmd, login, value] = process.argv.slice(2);
const find = l => db.prepare('SELECT * FROM teacher_accounts WHERE login = ?').get(l);

switch (cmd) {
  case 'list': {
    const rows = db.prepare(`SELECT login, full_name, programme, role, active,
      CASE WHEN password_hash IS NULL OR password_hash = '' THEN 'нет' ELSE 'задан' END AS pwd
      FROM teacher_accounts ORDER BY programme, full_name`).all();
    for (const r of rows) {
      console.log(`${r.login.padEnd(12)} ${r.programme.padEnd(5)} ${r.role.padEnd(15)} пароль: ${r.pwd.padEnd(6)} ${r.active ? '' : '[отключена] '}${r.full_name}`);
    }
    break;
  }
  case 'password': {
    const acc = find(login || '');
    if (!acc) fail(`Нет учётной записи с логином «${login}». Список: list`);
    const password = value || generatePassword();
    db.prepare('UPDATE teacher_accounts SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(hashPassword(password), acc.id);
    console.log(`${acc.full_name} | логин: ${acc.login} | пароль: ${password}`);
    break;
  }
  case 'role': {
    const acc = find(login || '');
    if (!acc) fail(`Нет учётной записи с логином «${login}».`);
    if (!ROLES.includes(value)) fail(`Роль — одна из: ${ROLES.join(', ')}`);
    db.prepare('UPDATE teacher_accounts SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(value, acc.id);
    console.log(`${acc.full_name}: роль ${acc.role} → ${value}`);
    break;
  }
  case 'active': {
    const acc = find(login || '');
    if (!acc) fail(`Нет учётной записи с логином «${login}».`);
    const on = value === '1' ? 1 : 0;
    db.prepare('UPDATE teacher_accounts SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(on, acc.id);
    console.log(`${acc.full_name}: ${on ? 'включена' : 'отключена (все её сессии перестают работать сразу)'}`);
    break;
  }
  default:
    fail('Команды: list | password <логин> [пароль] | role <логин> <роль> | active <логин> <0|1>');
}
