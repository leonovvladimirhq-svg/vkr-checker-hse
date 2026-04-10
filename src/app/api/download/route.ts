// ============================================================
// GET /api/download?id=... — Скачивание файла работы студента
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAttemptById } from '@/lib/db';
import fs from 'fs';
import path from 'path';

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Укажите id' }, { status: 400 });
  }

  const attempt = getAttemptById(Number(id));
  if (!attempt) {
    return NextResponse.json({ error: 'Попытка не найдена' }, { status: 404 });
  }

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
