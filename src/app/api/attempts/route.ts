// ============================================================
// GET/DELETE /api/attempts — Просмотр и удаление проверок
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAttemptById, getAttemptsByStudent, deleteAttempt } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const id = searchParams.get('id');
  const student = searchParams.get('student');

  if (id) {
    const attempt = getAttemptById(Number(id));
    if (!attempt) {
      return NextResponse.json({ error: 'Попытка не найдена' }, { status: 404 });
    }
    return NextResponse.json({
      ...attempt,
      results: JSON.parse(attempt.results_json),
      methods: attempt.methods_json ? JSON.parse(attempt.methods_json) : null,
    });
  }

  if (student) {
    const attempts = getAttemptsByStudent(student);
    return NextResponse.json({ attempts });
  }

  return NextResponse.json({ error: 'Укажите параметр id или student' }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Укажите id' }, { status: 400 });
  }

  const deleted = deleteAttempt(Number(id));
  if (!deleted) {
    return NextResponse.json({ error: 'Попытка не найдена' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
