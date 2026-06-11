// ============================================================
// POST /api/course/upload-review
// Преподаватель/учебный офис загружает ПОДПИСАННЫЙ итоговый отзыв
// обратно в систему и привязывает его к попытке курсовой.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { getCourseAttemptById, setCourseTeacherReview } from '@/lib/db-course';

export const maxDuration = 60;

const REVIEW_DIR = path.join(process.cwd(), 'data', 'course-reviews');

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const attemptId = Number(formData.get('attemptId'));
    const file = formData.get('file') as File | null;

    if (!attemptId || isNaN(attemptId)) {
      return NextResponse.json({ error: 'Не указан id попытки' }, { status: 400 });
    }
    if (!file) {
      return NextResponse.json({ error: 'Файл отзыва не передан' }, { status: 400 });
    }

    const attempt = getCourseAttemptById(attemptId);
    if (!attempt) {
      return NextResponse.json({ error: 'Попытка не найдена' }, { status: 404 });
    }

    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext !== 'docx' && ext !== 'pdf') {
      return NextResponse.json({ error: 'Поддерживаются только .docx и .pdf' }, { status: 400 });
    }
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: 'Файл слишком большой (максимум 50 МБ)' }, { status: 400 });
    }

    await fs.mkdir(REVIEW_DIR, { recursive: true });
    const filePath = path.join(REVIEW_DIR, `${attemptId}.${ext}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(filePath, buffer);

    setCourseTeacherReview(attemptId, filePath);

    return NextResponse.json({ ok: true, attemptId });
  } catch (error: any) {
    console.error('Course upload-review API error:', error);
    return NextResponse.json(
      { error: error?.message || 'Ошибка загрузки итогового отзыва' },
      { status: 500 }
    );
  }
}
