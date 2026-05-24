// ============================================================
// GET /api/course/teacher        — список отправленных курсовых
// GET /api/course/teacher?id=N   — детали одной попытки
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSubmittedCourseAttempts, getCourseAttemptById } from '@/lib/db-course';

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
