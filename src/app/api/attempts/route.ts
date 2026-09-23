// ============================================================
// /api/attempts — попытки проверки
//   POST   — студент сохраняет результат (без входа: у студентов нет учётных записей)
//   GET    — преподаватель: попытка по id или все попытки студента
//   PATCH  — преподаватель: статус, отзыв, технический комментарий
//   DELETE — преподаватель: удаление попытки
//
// GET/PATCH/DELETE требуют входа и работают только с попытками из области
// видимости преподавателя (см. teacher-auth.ts). Чужая попытка неотличима
// от несуществующей — 404.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAttemptById, getAttemptsByStudent, deleteAttempt, getAttemptCount, insertAttempt, updateAttemptFields, attemptInScope, getTeacherAccountById } from '@/lib/db';
import { requireTeacher, scopeOf, notFound } from '@/lib/teacher-auth';
import path from 'path';
import fs from 'fs';

const UPLOADS_DIR = path.join(process.cwd(), 'data', 'uploads');

export async function GET(req: NextRequest) {
  const { teacher, denied } = requireTeacher(req);
  if (denied) return denied;
  const scope = scopeOf(teacher);

  const { searchParams } = req.nextUrl;
  const id = searchParams.get('id');
  const student = searchParams.get('student');

  if (id) {
    const attempt = getAttemptById(Number(id));
    if (!attempt || !attemptInScope(attempt, scope)) return notFound();
    const supervisor = attempt.supervisor_id ? getTeacherAccountById(attempt.supervisor_id) : undefined;
    // Путь к файлу на сервере наружу не отдаём: он нужен только /api/download.
    const { file_path, ...safe } = attempt;
    return NextResponse.json({
      ...safe,
      has_file: !!file_path,
      supervisor_name: supervisor?.full_name || null,
      results: JSON.parse(attempt.results_json),
      methods: attempt.methods_json ? JSON.parse(attempt.methods_json) : null,
    });
  }

  if (student) {
    const attempts = getAttemptsByStudent(student, scope).map(({ file_path, ...a }) => ({ ...a, has_file: !!file_path }));
    return NextResponse.json({ attempts });
  }

  return NextResponse.json({ error: 'Укажите параметр id или student' }, { status: 400 });
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const studentName = (formData.get('studentName') as string)?.trim();
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
    const programme = (formData.get('programme') as string) || 'ik';
    const workLang = (formData.get('workLang') as string) || 'ru';
    const volumeJson = (formData.get('volumeJson') as string) || '';
    const workTitle = ((formData.get('workTitle') as string) || '').trim();
    const dbStatsJson = (formData.get('dbStatsJson') as string) || '';
    const supervisorId = ((formData.get('supervisorId') as string) || '').trim();
    const file = formData.get('file') as File | null;

    if (!studentName || !workType || !status || !resultsJson) {
      return NextResponse.json({ error: 'Не указаны обязательные поля' }, { status: 400 });
    }

    // ОП РиСО: работа уходит конкретному научному руководителю и видна только
    // ему. Без руководителя её не увидит никто, поэтому сохранять такую нельзя.
    const programmeId = programme === 'riso' ? 'riso' : 'ik';
    let supervisor: string | undefined;
    if (programmeId === 'riso') {
      const account = supervisorId ? getTeacherAccountById(supervisorId) : undefined;
      if (!account || !account.active || account.programme !== 'riso' || account.role === 'shared') {
        return NextResponse.json({ error: 'Выберите своего научного руководителя' }, { status: 400 });
      }
      supervisor = account.id;
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
      programme: programmeId,
      supervisor_id: supervisor,
      work_lang: workLang === 'en' ? 'en' : 'ru',
      volume_json: volumeJson || undefined,
      work_title: workTitle || undefined,
      db_stats_json: dbStatsJson || undefined,
    });

    return NextResponse.json({ id: attemptId, attemptNumber, maxAttempts: 3 });
  } catch (error: any) {
    console.error('Save attempt error:', error);
    return NextResponse.json({ error: error.message || 'Ошибка сохранения' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const { teacher, denied } = requireTeacher(req);
  if (denied) return denied;

  try {
    const id = req.nextUrl.searchParams.get('id');
    const body = await req.json();
    const { status, teacher_review, tech_comment } = body;

    if (!id) {
      return NextResponse.json({ error: 'Укажите id' }, { status: 400 });
    }

    // Хотя бы одно поле должно быть передано
    if (status === undefined && teacher_review === undefined && tech_comment === undefined) {
      return NextResponse.json({ error: 'Укажите хотя бы одно поле для обновления' }, { status: 400 });
    }

    if (status !== undefined && !['pass', 'fail', 'pending'].includes(status)) {
      return NextResponse.json({ error: 'Недопустимый статус' }, { status: 400 });
    }

    const existing = getAttemptById(Number(id));
    if (!existing || !attemptInScope(existing, scopeOf(teacher))) return notFound();

    const fields: { status?: string; teacher_review?: string; tech_comment?: string } = {};
    if (status !== undefined) fields.status = status;
    if (teacher_review !== undefined) fields.teacher_review = teacher_review;
    if (tech_comment !== undefined) fields.tech_comment = tech_comment;

    const updated = updateAttemptFields(Number(id), fields);
    if (!updated) {
      return NextResponse.json({ error: 'Попытка не найдена' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Ошибка обновления' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { teacher, denied } = requireTeacher(req);
  if (denied) return denied;

  const { searchParams } = req.nextUrl;
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Укажите id' }, { status: 400 });
  }

  // Удалить файл с диска перед удалением записи
  const attempt = getAttemptById(Number(id));
  if (!attempt || !attemptInScope(attempt, scopeOf(teacher))) return notFound();
  if (attempt.file_path && fs.existsSync(attempt.file_path)) {
    try { fs.unlinkSync(attempt.file_path); } catch {}
  }

  const deleted = deleteAttempt(Number(id));
  if (!deleted) {
    return NextResponse.json({ error: 'Попытка не найдена' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
