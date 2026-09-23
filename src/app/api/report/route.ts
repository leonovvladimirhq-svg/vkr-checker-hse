// ============================================================
// GET/POST/DELETE /api/report — Итоговый отчёт для студентов
// GET ?student=ФИО — проверить статус загрузки + получить результат
// POST — опубликовать отчёт (снапшот IDs + timestamp)
// DELETE — закрыть отчёт
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireIkShared } from '@/lib/teacher-auth';
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

// Публикация и закрытие отчёта — только общий доступ ОП ИК. Раньше здесь
// сверялся пароль «1234», который лежал в JS-коде панели преподавателя и
// в публичном репозитории, то есть не защищал ничего.
export async function POST(req: NextRequest) {
  const { denied } = requireIkShared(req);
  if (denied) return denied;

  try {

    const generatedAt = new Date().toISOString();
    setSetting('report_generated_at', generatedAt);

    // Снапшот: сохранить IDs последних попыток всех студентов на момент публикации
    // Снапшот охватывает все работы, как и прежде: отчёт публикуется для
    // всех студентов сразу, а видит каждый только свою запись по ФИО.
    const summary = getAllStudentsSummary(null);
    const snapshotIds = summary.map((s) => s.id);
    setSetting('report_snapshot_ids', JSON.stringify(snapshotIds));

    return NextResponse.json({ ok: true, generatedAt, snapshotCount: snapshotIds.length });
  } catch (error: any) {
    console.error('Report POST error:', error);
    return NextResponse.json({ error: error.message || 'Ошибка создания отчёта' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { denied } = requireIkShared(req);
  if (denied) return denied;

  try {
    setSetting('report_generated_at', '');
    setSetting('report_snapshot_ids', '[]');
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('Report DELETE error:', error);
    return NextResponse.json({ error: error.message || 'Ошибка закрытия отчёта' }, { status: 500 });
  }
}
