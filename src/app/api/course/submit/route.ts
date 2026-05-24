// ============================================================
// POST /api/course/submit
// Студент отправляет курсовую работу преподавателю.
// Сохраняет файл на диск, помечает запись как отправленную.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { getCourseAttemptById, markCourseAttemptSubmitted } from '@/lib/db-course';

export const maxDuration = 60;

const UPLOAD_DIR = path.join(process.cwd(), 'data', 'course-uploads');

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const attemptIdRaw = formData.get('attemptId') as string | null;
    const workTitle = (formData.get('workTitle') as string | null)?.trim() || '';
    const file = formData.get('file') as File | null;

    const attemptId = Number(attemptIdRaw);
    if (!attemptId || isNaN(attemptId)) {
      return NextResponse.json({ error: 'Не указан attemptId' }, { status: 400 });
    }
    if (!file) {
      return NextResponse.json({ error: 'Файл работы не приложен' }, { status: 400 });
    }
    if (!workTitle || workTitle.length < 5) {
      return NextResponse.json({ error: 'Тема работы обязательна (минимум 5 символов)' }, { status: 400 });
    }

    const attempt = getCourseAttemptById(attemptId);
    if (!attempt) {
      return NextResponse.json({ error: 'Попытка не найдена' }, { status: 404 });
    }

    // Сохраняем файл
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const ext = (file.name.split('.').pop() || 'docx').toLowerCase();
    const safeExt = ext === 'pdf' ? 'pdf' : 'docx';
    const filePath = path.join(UPLOAD_DIR, `${attemptId}.${safeExt}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(filePath, buffer);

    // Обновляем запись
    markCourseAttemptSubmitted(attemptId, {
      file_path: filePath,
      work_title: workTitle,
    });

    return NextResponse.json({
      ok: true,
      attemptId,
      submittedAt: new Date().toISOString(),
      filePath: `course-uploads/${attemptId}.${safeExt}`,
    });
  } catch (error: any) {
    console.error('Course submit API error:', error);
    return NextResponse.json(
      { error: error?.message || 'Ошибка отправки работы преподавателю' },
      { status: 500 }
    );
  }
}
