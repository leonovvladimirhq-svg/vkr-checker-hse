// ============================================================
// GET /api/teachers — список учётных записей преподавателей
//
// Открыт без входа: он нужен форме студента («Выберите своего научного
// руководителя») и экрану входа преподавателя. Отдаёт только ФИО, логин,
// программу и роль — ни хешей паролей, ни чего-либо о работах.
// ============================================================

import { NextResponse } from 'next/server';
import { listTeacherAccounts } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const accounts = listTeacherAccounts().map(a => ({
    id: a.id,
    login: a.login,
    fullName: a.full_name,
    programme: a.programme,
    role: a.role,
    // Учётная запись без пароля в списке входа не показывается: войти в неё
    // всё равно нельзя, а студенту руководителя выбрать можно.
    canLogin: a.has_password === 1,
  }));
  return NextResponse.json({ accounts });
}
