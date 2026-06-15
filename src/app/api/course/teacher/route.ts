// ============================================================
// GET /api/course/teacher        — список отправленных курсовых
// GET /api/course/teacher?id=N   — детали одной попытки
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { getSubmittedCourseAttempts, getCourseAttemptById, deleteCourseAttempt } from '@/lib/db-course';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const idRaw = searchParams.get('id');

    if (idRaw) {
      const id = Number(idRaw);
      if (!id || isNaN(id)) {
        return NextResponse.json({ error: 'Неверный id' }, { status: 400 });
      }
      const a = getCourseAttemptById(id);
      if (!a) return NextResponse.json({ error: 'Не найдено' }, { status: 404 });
      return NextResponse.json({
        id: a.id,
        studentName: a.student_name,
        workTitle: a.work_title,
        courseType: a.course_type,
        fileName: a.file_name,
        wordCount: a.word_count,
        pageEstimate: a.page_estimate,
        submittedAt: a.submitted_at,
        createdAt: a.created_at,
        readinessStatus: a.readiness_status,
        readinessText: a.readiness_text,
        analysis: a.analysis_json ? JSON.parse(a.analysis_json) : null,
        hasFile: !!a.file_path,
        feedbackRating: a.feedback_rating || null,
        feedbackText: a.feedback_text || null,
        hasFeedback: !!(a.feedback_rating || a.feedback_text),
      });
    }

    const list = getSubmittedCourseAttempts();
    return NextResponse.json({
      items: list.map(a => ({
        id: a.id,
        studentName: a.student_name,
        workTitle: a.work_title,
        courseType: a.course_type,
        fileName: a.file_name,
        wordCount: a.word_count,
        pageEstimate: a.page_estimate,
        submittedAt: a.submitted_at,
        createdAt: a.created_at,
        readinessStatus: a.readiness_status,
        readinessText: a.readiness_text,
        attemptNumber: a.attempt_number,
        hasFile: !!a.file_path,
        source: a.source || 'student',
        hasTeacherReview: !!a.teacher_review_path,
        checkerGrade: a.checker_grade || null,
        feedbackRating: a.feedback_rating || null,
        feedbackText: a.feedback_text || null,
        hasFeedback: !!(a.feedback_rating || a.feedback_text),
      })),
      total: list.length,
    });
  } catch (error: any) {
    console.error('Course teacher API error:', error);
    return NextResponse.json(
      { error: error?.message || 'Внутренняя ошибка' },
      { status: 500 }
    );
  }
}

// DELETE /api/course/teacher?id=N — удалить попытку курсовой (строку БД + файлы с диска)
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get('id'));
    if (!id || isNaN(id)) {
      return NextResponse.json({ error: 'Не указан id' }, { status: 400 });
    }

    const attempt = getCourseAttemptById(id);
    if (!attempt) {
      return NextResponse.json({ error: 'Попытка не найдена' }, { status: 404 });
    }

    // Удаляем файлы с диска (работа + загруженный итоговый отзыв), если есть.
    for (const p of [attempt.file_path, attempt.teacher_review_path]) {
      if (p && fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch (e) { console.error('Не удалось удалить файл:', p, e); }
      }
    }

    deleteCourseAttempt(id);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('Course delete API error:', error);
    return NextResponse.json(
      { error: error?.message || 'Ошибка удаления работы' },
      { status: 500 }
    );
  }
}
