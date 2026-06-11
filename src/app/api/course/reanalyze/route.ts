// ============================================================
// POST /api/course/reanalyze
// Преподаватель запускает повторный анализ работы и получает
// заполненный Word-отзыв (.docx) — автоматическое скачивание.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import { getCourseAttemptById, setCourseCheckerGrade } from '@/lib/db-course';
import { parseDocument } from '@/lib/parser';
import { generateReviewFields } from '@/lib/course-review-prompt';
import { generateReviewDocx } from '@/lib/course-review-doc';
import { analyzeDbWithFallback, DbAnalysisResult } from '@/lib/db-analyzer';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const id = Number(body.id);
    if (!id || isNaN(id)) {
      return NextResponse.json({ error: 'Не указан id попытки' }, { status: 400 });
    }

    const attempt = getCourseAttemptById(id);
    if (!attempt) {
      return NextResponse.json({ error: 'Попытка не найдена' }, { status: 404 });
    }
    if (!attempt.file_path) {
      return NextResponse.json({ error: 'Файл работы не сохранён (работа не была отправлена преподавателю)' }, { status: 400 });
    }

    // Прочитать сохранённый файл
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(attempt.file_path);
    } catch {
      return NextResponse.json(
        { error: `Файл работы утерян на сервере (${attempt.file_path}). Попросите студента загрузить работу заново.` },
        { status: 410 }
      );
    }

    const fileName = attempt.file_name || `work.${attempt.file_path.endsWith('.pdf') ? 'pdf' : 'docx'}`;
    const doc = await parseDocument(buffer, fileName);

    // Анализ БД (ссылка из попытки, с фолбэком на ссылку из текста работы).
    // Делаем заново на момент reanalyze — содержимое папки могло поменяться с момента check.
    const dbAnalysis: DbAnalysisResult = await analyzeDbWithFallback(attempt.db_link, doc.text);

    // GPT: заполняем поля шаблона
    const fields = await generateReviewFields(
      attempt.course_type,
      doc,
      attempt.student_name,
      attempt.work_title || '— тема не указана —',
      dbAnalysis,
    );

    // Сохраняем рекомендованную чекером оценку — чтобы позже сравнить с финальной оценкой преподавателя.
    setCourseCheckerGrade(id, fields.recommendedGrade || '—', fields.gradeRationale || '');

    // Рендерим Word
    const docBuffer = await generateReviewDocx(fields);

    // Имя файла отзыва
    const safeName = attempt.student_name
      .replace(/[^a-zA-Zа-яА-ЯёЁ0-9 ]/g, '')
      .trim()
      .replace(/\s+/g, '_');
    const typeShort = attempt.course_type === 'research' ? 'ИКР' : 'КП';
    const downloadName = `Отзыв_${typeShort}_${safeName || 'Студент'}.docx`;

    return new NextResponse(new Uint8Array(docBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(downloadName)}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
        'Content-Length': String(docBuffer.length),
      },
    });
  } catch (error: any) {
    console.error('Course reanalyze API error:', error);
    return NextResponse.json(
      { error: error?.message || 'Ошибка повторного исследования' },
      { status: 500 }
    );
  }
}
