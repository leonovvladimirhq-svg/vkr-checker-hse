// ============================================================
// GET/POST/DELETE /api/report — Итоговый отчёт для студентов
// GET ?student=ФИО — проверить статус загрузки + получить результат
// POST — опубликовать отчёт (снапшот IDs + timestamp)
// DELETE — закрыть отчёт
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  getSetting,
  setSetting,
  getAllStudentsSummary,
  getStudentSubmissionStatus,
  getAttemptByIdIfInSnapshot,
} from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const studentName = req.nextUrl.searchParams.get('student')?.trim();

    if (!studentName) {
      return NextResponse.json({ error: 'Укажите ФИО студента' }, { status: 400 });
    }

    const reportGeneratedAt = getSetting('report_generated_at');
    const reportReady = !!reportGeneratedAt;

    // Всегда возвращаем статус загрузки (есть ли работа в БД вообще)
    const submissionStatus = getStudentSubmissionStatus(studentName);

    if (!reportReady) {
      return NextResponse.json({ reportReady: false, submissionStatus });
    }

    // Отчёт опубликован — ищем студента только в снапшоте
    let snapshotIds: number[] = [];
    try {
      snapshotIds = JSON.parse(getSetting('report_snapshot_ids') || '[]');
    } catch {
      snapshotIds = [];
    }

    const attempt = getAttemptByIdIfInSnapshot(studentName, snapshotIds);

    if (!attempt) {
      return NextResponse.json({
        reportReady: true,
        studentFound: false,
        submissionStatus,
        reportGeneratedAt,
      });
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
      submissionStatus,
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

const REPORT_PASSWORD = '1234';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    if (body.password !== REPORT_PASSWORD) {
      return NextResponse.json({ error: 'Неверный пароль' }, { status: 401 });
    }

    const generatedAt = new Date().toISOString();
    setSetting('report_generated_at', generatedAt);

    // Снапшот: сохранить IDs последних попыток всех студентов на момент публикации
    const summary = getAllStudentsSummary();
    const snapshotIds = summary.map((s) => s.id);
    setSetting('report_snapshot_ids', JSON.stringify(snapshotIds));

    return NextResponse.json({ ok: true, generatedAt, snapshotCount: snapshotIds.length });
  } catch (error: any) {
    console.error('Report POST error:', error);
    return NextResponse.json({ error: error.message || 'Ошибка создания отчёта' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    if (body.password !== REPORT_PASSWORD) {
      return NextResponse.json({ error: 'Неверный пароль' }, { status: 401 });
    }
    setSetting('report_generated_at', '');
    setSetting('report_snapshot_ids', '[]');
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('Report DELETE error:', error);
    return NextResponse.json({ error: error.message || 'Ошибка закрытия отчёта' }, { status: 500 });
  }
}
