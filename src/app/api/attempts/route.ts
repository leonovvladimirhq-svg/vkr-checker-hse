// ============================================================
// GET/DELETE /api/attempts — Просмотр и удаление проверок
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAttemptById, getAttemptsByStudent, deleteAttempt, getAttemptCount, insertAttempt, updateAttemptStatus } from '@/lib/db';
import path from 'path';
import fs from 'fs';

const UPLOADS_DIR = path.join(process.cwd(), 'data', 'uploads');

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
    const formData = await req.formData();
    const studentName = formData.get('studentName') as string;
    const workType = formData.get('workType') as string;
    const status = formData.get('status') as string;
    const resultsJson = formData.get('resultsJson') as string;
    const extractedTextPreview = formData.get('extractedTextPreview') as string || '';
    const fileName = formData.get('fileName') as string || '';
    const dbLink = formData.get('dbLink') as string || '';
    const presLink = formData.get('presLink') as string || '';
    const methodsJson = formData.get('methodsJson') as string || '{}';
    const usesAI = formData.get('usesAI') === 'true';
    const feedback = formData.get('feedback') as string || '';
    const file = formData.get('file') as File | null;

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

    // Сохранение файла на диск
    let filePath: string | undefined;
    if (file && file.size > 0) {
      if (!fs.existsSync(UPLOADS_DIR)) {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      }
      const ext = path.extname(file.name) || '.docx';
      const safeName = `${Date.now()}_${attemptNumber}${ext}`;
      filePath = path.join(UPLOADS_DIR, safeName);
      const buffer = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(filePath, buffer);
    }

    const attemptId = insertAttempt({
      student_name: studentName,
      work_type: workType,
      attempt_number: attemptNumber,
      status,
      results_json: resultsJson,
      extracted_text_preview: extractedTextPreview,
      file_name: fileName,
      db_link: dbLink,
      pres_link: presLink,
      methods_json: methodsJson,
      uses_ai: usesAI,
      feedback: feedback,
      file_path: filePath,
    });

    return NextResponse.json({ id: attemptId, attemptNumber, maxAttempts: 3 });
  } catch (error: any) {
    console.error('Save attempt error:', error);
    return NextResponse.json({ error: error.message || 'Ошибка сохранения' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    const body = await req.json();
    const { status } = body;

    if (!id || !status) {
      return NextResponse.json({ error: 'Укажите id и status' }, { status: 400 });
    }

    if (!['pass', 'fail', 'pending'].includes(status)) {
      return NextResponse.json({ error: 'Недопустимый статус' }, { status: 400 });
    }

    const updated = updateAttemptStatus(Number(id), status);
    if (!updated) {
      return NextResponse.json({ error: 'Попытка не найдена' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Ошибка обновления' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Укажите id' }, { status: 400 });
  }

  // Удалить файл с диска перед удалением записи
  const attempt = getAttemptById(Number(id));
  if (attempt?.file_path && fs.existsSync(attempt.file_path)) {
    try { fs.unlinkSync(attempt.file_path); } catch {}
  }

  const deleted = deleteAttempt(Number(id));
  if (!deleted) {
    return NextResponse.json({ error: 'Попытка не найдена' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
