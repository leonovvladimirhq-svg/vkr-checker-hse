// ============================================================
// GET /api/course/download?id=N
// Преподаватель скачивает оригинальный файл курсовой работы.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { getCourseAttemptById } from '@/lib/db-course';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get('id'));
    if (!id || isNaN(id)) {
      return NextResponse.json({ error: 'Неверный id' }, { status: 400 });
    }

    const a = getCourseAttemptById(id);
    if (!a) return NextResponse.json({ error: 'Не найдено' }, { status: 404 });
    if (!a.file_path) {
      return NextResponse.json(
        { error: 'Файл не сохранён (работа не была отправлена преподавателю)' },
        { status: 404 }
      );
    }

    let buffer: Buffer;
    try {
      buffer = await fs.readFile(a.file_path);
    } catch {
      return NextResponse.json(
        { error: '⚠️ Файл утерян на сервере. Попросите студента загрузить работу заново.' },
        { status: 410 }
      );
    }

    const ext = (path.extname(a.file_path) || '.docx').toLowerCase();
    const mime = ext === '.pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    const downloadName = a.file_name || `course_${id}${ext}`;
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch (error: any) {
    console.error('Course download API error:', error);
    return NextResponse.json(
      { error: error?.message || 'Ошибка скачивания файла' },
      { status: 500 }
    );
  }
}
