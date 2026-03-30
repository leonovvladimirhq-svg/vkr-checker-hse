// ============================================================
// GET /api/students — Сводная таблица для преподавателя
// GET /api/students?today=1 — Дневной дайджест
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAllStudentsSummary, getTodayAttempts, getSetting, setSetting } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const today = req.nextUrl.searchParams.get('today');

    if (today === '1') {
      const attempts = getTodayAttempts();
      return NextResponse.json({ attempts });
    }

    const students = getAllStudentsSummary();
    const digestEmail = getSetting('digest_email');
    const currentWave = getSetting('current_wave');

    // Статистика
    const passCount = students.filter(s => s.status === 'pass').length;
    const failCount = students.filter(s => s.status === 'fail').length;
    const pendingReviewCount = students.filter(s => s.status === 'pending').length;

    return NextResponse.json({
      students,
      stats: {
        total: 57, // Количество студентов в программе
        passed: passCount,
        failed: failCount,
        pendingReview: pendingReviewCount,
        notSubmitted: 57 - passCount - failCount - pendingReviewCount,
      },
      settings: {
        digestEmail,
        currentWave,
      },
    });

  } catch (error: any) {
    console.error('Students API error:', error);
    return NextResponse.json(
      { error: error.message || 'Ошибка' },
      { status: 500 }
    );
  }
}

// POST /api/students — Обновление настроек
export async function POST(req: NextRequest) {
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
