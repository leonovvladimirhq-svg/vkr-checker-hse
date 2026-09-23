// GET /api/teacher/me — кто вошёл (или 401). Панель преподавателя
// спрашивает это при открытии, вместо прежнего флага в localStorage.

import { NextRequest, NextResponse } from 'next/server';
import { requireTeacher } from '@/lib/teacher-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { teacher, denied } = requireTeacher(req);
  if (denied) return denied;
  return NextResponse.json(teacher);
}
