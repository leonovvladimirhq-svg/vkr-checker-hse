// ============================================================
// GET /api/students — Сводная таблица для преподавателя
// GET /api/students?today=1 — Дневной дайджест
// POST /api/students — Настройки дайджеста и волны (только общий доступ ОП ИК)
//
// Отдаёт только работы из области видимости вошедшего преподавателя:
// научный руководитель ОП РиСО — своих студентов, общий доступ ОП ИК —
// работы ОП ИК.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAllStudentsSummary, getTodayAttempts, getSetting, setSetting, listTeacherAccounts } from '@/lib/db';
import { requireIkShared, requireTeacher, scopeOf } from '@/lib/teacher-auth';

export const dynamic = 'force-dynamic';

/** Численность потока ОП ИК — для карточки «Не загрузили». Для ОП РиСО состава потока у нас нет. */
const IK_COHORT_SIZE = 57;

export async function GET(req: NextRequest) {
  const { teacher, denied } = requireTeacher(req);
  if (denied) return denied;
  const scope = scopeOf(teacher);

  try {
    const today = req.nextUrl.searchParams.get('today');

    if (today === '1') {
      const attempts = getTodayAttempts(scope);
      return NextResponse.json({ attempts });
    }

    const students = getAllStudentsSummary(scope);

    // ФИО научного руководителя — для руководителя программы, который видит всех
    const supervisorNames = new Map(listTeacherAccounts().map(a => [a.id, a.full_name]));
    const withSupervisor = students.map(s => ({
      ...s,
      supervisor_name: s.supervisor_id ? supervisorNames.get(s.supervisor_id) || null : null,
    }));

    const passCount = students.filter(s => s.status === 'pass').length;
    const failCount = students.filter(s => s.status === 'fail').length;
    const pendingReviewCount = students.filter(s => s.status === 'pending').length;

    const isIk = teacher.role === 'shared';

    return NextResponse.json({
      students: withSupervisor,
      stats: {
        // Для ОП ИК — численность потока; для остальных — сколько студентов
        // прислали работы: списка группы в сервисе нет, «не загрузили» не посчитать.
        total: isIk ? IK_COHORT_SIZE : students.length,
        passed: passCount,
        failed: failCount,
        pendingReview: pendingReviewCount,
        notSubmitted: isIk ? Math.max(0, IK_COHORT_SIZE - passCount - failCount - pendingReviewCount) : null,
      },
      settings: isIk
        ? { digestEmail: getSetting('digest_email'), currentWave: getSetting('current_wave') }
        : null,
    });

  } catch (error: any) {
    console.error('Students API error:', error);
    return NextResponse.json(
      { error: error.message || 'Ошибка' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const { denied } = requireIkShared(req);
  if (denied) return denied;

  try {
    const body = await req.json();

    if (body.digestEmail !== undefined) {
      setSetting('digest_email', body.digestEmail);
    }
    if (body.currentWave !== undefined) {
      setSetting('current_wave', String(body.currentWave));
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
