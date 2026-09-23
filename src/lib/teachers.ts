// ============================================================
// Каталог учётных записей преподавателей
//
// Здесь — только НЕ секретные данные: ФИО, логин, программа, роль. Пароли в
// репозиторий не попадают никогда: в базе хранится лишь их scrypt-хеш, а
// задаются они скриптом scripts/teacher-account.mjs прямо на сервере.
//
// Список используется как начальное наполнение таблицы teacher_accounts:
// при старте сервиса недостающие записи добавляются, у существующих
// обновляются ФИО и программа. Роль, пароль и признак активности после
// первого добавления меняются только скриптом — чтобы выдать, скажем,
// руководителю программы доступ ко всем работам без передеплоя.
//
// Роли:
//  - supervisor      — научный руководитель: видит ТОЛЬКО работы студентов,
//                      выбравших его при отправке;
//  - programme_lead  — руководитель программы: видит все работы своей ОП;
//  - shared          — общий доступ ОП ИК (как было до 09.2026): видит все
//                      работы ОП ИК, курсовые, дайджест, публикацию отчёта.
// ============================================================

import { ProgrammeId } from './checklist';

export type TeacherRole = 'supervisor' | 'programme_lead' | 'shared';

export interface TeacherDirectoryEntry {
  /** Стабильный идентификатор; он же хранится в attempts.supervisor_id. */
  id: string;
  login: string;
  fullName: string;
  programme: ProgrammeId;
  /** Роль при ПЕРВОМ добавлении в базу; дальше меняется скриптом. */
  initialRole: TeacherRole;
}

/** Общий доступ ОП ИК — логин прежний, чтобы у А. Грязевой ничего не поменялось. */
export const IK_SHARED_ACCOUNT_ID = 'ik-shared';

export const TEACHER_DIRECTORY: TeacherDirectoryEntry[] = [
  { id: IK_SHARED_ACCOUNT_ID, login: 'admin 1029', fullName: 'Общий доступ ОП «Интегрированные коммуникации»', programme: 'ik', initialRole: 'shared' },

  // ОП «Реклама и связи с общественностью» — список от С. В. Катковой, 23.09.2026.
  // В присланном списке С. В. Каткова стояла дважды: запись одна.
  { id: 'zverev',    login: 'zverev',    fullName: 'Зверев Сергей Александрович', programme: 'riso', initialRole: 'supervisor' },
  { id: 'lyutikova', login: 'lyutikova', fullName: 'Лютикова Алина Павловна',     programme: 'riso', initialRole: 'supervisor' },
  { id: 'katkova',   login: 'katkova',   fullName: 'Каткова Светлана Викторовна', programme: 'riso', initialRole: 'supervisor' },
  { id: 'vlades',    login: 'vlades',    fullName: 'Владес Олег Александрович',   programme: 'riso', initialRole: 'supervisor' },
  { id: 'rodkin',    login: 'rodkin',    fullName: 'Родькин Павел Евгеньевич',    programme: 'riso', initialRole: 'supervisor' },
  { id: 'karasev',   login: 'karasev',   fullName: 'Карасев Олег Владимирович',   programme: 'riso', initialRole: 'supervisor' },
];

/** «Зверев Сергей Александрович» → «С. А. Зверев» — для подписи в отзыве. */
export function initialsSurname(fullName: string): string {
  const [surname, name, patronymic] = fullName.trim().split(/\s+/);
  if (!surname || !name) return fullName.trim();
  const init = (s?: string) => (s ? `${s[0].toUpperCase()}. ` : '');
  return `${init(name)}${init(patronymic)}${surname}`.trim();
}
