// ============================================================
// GET /api/course/export-reviews
// Архив (ZIP) со всеми ЗАГРУЖЕННЫМИ итоговыми отзывами преподавателей.
// Имя каждого файла — ФИО студента (чтобы учебному офису не путаться).
// ============================================================

import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
import { getCourseAttemptsWithTeacherReview } from '@/lib/db-course';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

function sanitizeName(name: string): string {
  return (name || 'Студент')
    .replace(/[^a-zA-Zа-яА-ЯёЁ0-9 ._-]/g, '')
    .trim()
    .replace(/\s+/g, ' ') || 'Студент';
}

export async function GET() {
  try {
    const rows = getCourseAttemptsWithTeacherReview();
    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'Нет загруженных итоговых отзывов для выгрузки' },
        { status: 404 }
      );
    }

    const zip = new JSZip();
    const usedNames = new Set<string>();
    let added = 0;

    for (const row of rows) {
      if (!row.teacher_review_path) continue;
      let buffer: Buffer;
      try {
        buffer = await fs.readFile(row.teacher_review_path);
      } catch {
        // файл на диске утерян — пропускаем
        continue;
      }
      const ext = (path.extname(row.teacher_review_path) || '.docx').toLowerCase();
      const typeShort = row.course_type === 'research' ? 'ИКР' : 'КП';
      let base = `${sanitizeName(row.student_name)} — ${typeShort}`;
      // защита от коллизий по ФИО
      if (usedNames.has(base + ext)) base = `${base} (#${row.id})`;
      const fileName = base + ext;
      usedNames.add(fileName);
      zip.file(fileName, buffer);
      added++;
    }

    if (added === 0) {
      return NextResponse.json(
        { error: 'Файлы итоговых отзывов не найдены на сервере' },
        { status: 404 }
      );
    }

    const content = await zip.generateAsync({ type: 'nodebuffer' });
    const downloadName = `Итоговые_отзывы_${new Date().toISOString().slice(0, 10)}.zip`;

    return new NextResponse(new Uint8Array(content), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="reviews.zip"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
        'Content-Length': String(content.length),
      },
    });
  } catch (error: any) {
    console.error('Course export-reviews API error:', error);
    return NextResponse.json(
      { error: error?.message || 'Ошибка выгрузки архива отзывов' },
      { status: 500 }
    );
  }
}
