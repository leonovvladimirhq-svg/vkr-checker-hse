// ============================================================
// GET/DELETE /api/attempts — Просмотр и удаление проверок
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAttemptById, getAttemptsByStudent, deleteAttempt, getAttemptCount, insertAttempt } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const id = searchParams.get('id');
  const student = searchParams.get('student');

  if (id) {
    const attempt = getAttemptById(Number(id));
    if (!attempt) {
      return NextResponse.json({ error: 'Попытка не найдена' }, { status: 404 });
    }
    return NextResponse.json({
      ...attempt,
      results: JSON.parse(attempt.results_json),
      methods: attempt.methods_json ? JSON.parse(attempt.methods_json) : null,
    });
  }

  if (student) {
    const attempts = getAttemptsByStudent(student);
    return NextResponse.json({ attempts });
  }

  return NextResponse.json({ error: 'Укажите параметр id или student' }, { status: 400 });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { studentName, workType, status, resultsJson, extractedTextPreview, fileName, dbLink, presLink, methodsJson, usesAI } = body;

    if (!studentName || !workType || !status || !resultsJson) {
      return NextResponse.json({ error: 'Не указаны обязательные поля' }, { status: 400 });
    }

    // Проверка лимита попыток
    const attemptCount = getAttemptCount(studentName);
    if (attemptCount >= 3) {
      return NextResponse.json(
        { error: 'Все 3 попытки использованы. Обратитесь к научному руководителю.' },
        { status: 403 }
      );
    }

    const attemptNumber = attemptCount + 1;

    const attemptId = insertAttempt({
      student_name: studentName,
      work_type: workType,
      attempt_number: attemptNumber,
      status,
      results_json: resultsJson,
      extracted_text_preview: extractedTextPreview || '',
      file_name: fileName || '',
      db_link: dbLink || '',
      pres_link: presLink || '',
      methods_json: methodsJson || '{}',
      uses_ai: usesAI || false,
    });

    return NextResponse.json({ id: attemptId, attemptNumber, maxAttempts: 3 });
  } catch (error: any) {
    console.error('Save attempt error:', error);
    return NextResponse.json({ error: error.message || 'Ошибка сохранения' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Укажите id' }, { status: 400 });
  }

  const deleted = deleteAttempt(Number(id));
  if (!deleted) {
    return NextResponse.json({ error: 'Попытка не найдена' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
