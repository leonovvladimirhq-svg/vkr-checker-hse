// ============================================================
// POST /api/course/feedback
// Обратная связь о качестве работы сервиса (текст + лайк/дизлайк),
// которую оставляет студент или преподаватель после анализа.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCourseAttemptById, setCourseFeedback } from '@/lib/db-course';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const id = Number(body.attemptId);
    const ratingRaw = body.rating;
    const text = typeof body.text === 'string' ? body.text.trim() : '';

    if (!id || isNaN(id)) {
      return NextResponse.json({ error: 'Не указан id попытки' }, { status: 400 });
    }

    const rating = ratingRaw === 'like' || ratingRaw === 'dislike' ? ratingRaw : null;
    if (!rating && !text) {
      return NextResponse.json({ error: 'Оставьте оценку или текст отзыва' }, { status: 400 });
    }

    const attempt = getCourseAttemptById(id);
    if (!attempt) {
      return NextResponse.json({ error: 'Попытка не найдена' }, { status: 404 });
    }

    setCourseFeedback(id, rating, text || null);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('Course feedback API error:', error);
    return NextResponse.json(
      { error: error?.message || 'Ошибка сохранения отзыва' },
      { status: 500 }
    );
  }
}
