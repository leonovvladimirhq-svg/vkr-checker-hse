// ============================================================
// GET/POST /api/report — Итоговый отчёт для студентов
// GET ?student=ФИО — проверить статус и получить результат
// POST — создать/обновить отчёт (преподаватель)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSetting, setSetting, getLastAttempt } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const studentName = req.nextUrl.searchParams.get('student')?.trim();

    if (!studentName) {
      return NextResponse.json({ error: 'Укажите ФИО студента' }, { status: 400 });
    }

    const reportGeneratedAt = getSetting('report_generated_at');

    if (!reportGeneratedAt) {
      return NextResponse.json({ reportReady: false });
    }

    const attempt = getLastAttempt(studentName);

    if (!attempt) {
      return NextResponse.json({ reportReady: true, studentFound: false });
    }

    // Возвращаем данные БЕЗ tech_comment — он только для преподавателя
    let results = [];
    try {
      results = JSON.parse(attempt.results_json || '[]');
    } catch {
      results = [];
    }

    return NextResponse.json({
      reportReady: true,
      studentFound: true,
      reportGeneratedAt,
      attempt: {
        id: attempt.id,
        student_name: attempt.student_name,
        status: attempt.status,
        work_type: attempt.work_type,
        attempt_number: attempt.attempt_number,
        teacher_review: attempt.teacher_review || null,
        results,
        created_at: attempt.created_at,
      },
    });
  } catch (error: any) {
    console.error('Report GET error:', error);
    return NextResponse.json({ error: error.message || 'Ошибка получения отчёта' }, { status: 500 });
  }
}

export async function POST() {
  try {
    const generatedAt = new Date().toISOString();
    setSetting('report_generated_at', generatedAt);
    return NextResponse.json({ ok: true, generatedAt });
  } catch (error: any) {
    console.error('Report POST error:', error);
    return NextResponse.json({ error: error.message || 'Ошибка создания отчёта' }, { status: 500 });
  }
}
