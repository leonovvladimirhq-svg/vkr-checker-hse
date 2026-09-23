// ============================================================
// GET /api/download?id=... — Скачивание файла работы студента
//
// Только для преподавателя, в чью область видимости входит работа. До
// 23.09.2026 эндпоинт был открыт: номера попыток идут подряд, и любую
// работу можно было скачать, перебирая id в адресной строке.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAttemptById, attemptInScope } from '@/lib/db';
import { requireTeacher, scopeOf, notFound } from '@/lib/teacher-auth';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { teacher, denied } = requireTeacher(req);
  if (denied) return denied;

  const id = req.nextUrl.searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Укажите id' }, { status: 400 });
  }

  const attempt = getAttemptById(Number(id));
  if (!attempt || !attemptInScope(attempt, scopeOf(teacher))) return notFound();

  if (!attempt.file_path || !fs.existsSync(attempt.file_path)) {
    return NextResponse.json({ error: 'Файл не найден на сервере' }, { status: 404 });
  }

  const fileBuffer = fs.readFileSync(attempt.file_path);
  const ext = path.extname(attempt.file_path).toLowerCase();
  const mimeType = ext === '.pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const downloadName = attempt.file_name || `work${ext}`;

  return new NextResponse(fileBuffer, {
    headers: {
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
      'Content-Length': String(fileBuffer.length),
    },
  });
}
