// ============================================================
// POST /api/check — Главный эндпоинт проверки ВКР
// Принимает multipart/form-data с файлом и метаданными
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { parseDocument } from '@/lib/parser';
import { analyzeDocument, mergeResults } from '@/lib/analyzer';
import { getChecklist, WorkType, ResearchMethod } from '@/lib/checklist';
import { getAttemptCount, insertAttempt } from '@/lib/db';

export const maxDuration = 120; // Увеличенный таймаут для GPT-анализа

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    // --- Извлечение полей ---
    const studentName = formData.get('studentName') as string;
    const workType = formData.get('workType') as WorkType;
    const usesAI = formData.get('usesAI') === 'true';
    const dbLink = formData.get('dbLink') as string || '';
    const presLink = formData.get('presLink') as string || '';
    const empMethodsRaw = formData.get('empMethods') as string || '[]';
    const compMethodsRaw = formData.get('compMethods') as string || '[]';
    const file = formData.get('file') as File | null;

    // --- Валидация ---
    if (!studentName || !workType || !file) {
      return NextResponse.json(
        { error: 'Не указаны обязательные поля: ФИО, тип работы, файл' },
        { status: 400 }
      );
    }

    if (!['project', 'dissertation'].includes(workType)) {
      return NextResponse.json(
        { error: 'Неверный тип работы' },
        { status: 400 }
      );
    }

    const empMethods: ResearchMethod[] = JSON.parse(empMethodsRaw);
    const compMethods: ResearchMethod[] = JSON.parse(compMethodsRaw);

    // --- Проверка лимита попыток ---
    const attemptCount = getAttemptCount(studentName);
    if (attemptCount >= 3) {
      return NextResponse.json(
        { error: 'Все 3 попытки использованы. Обратитесь к научному руководителю.' },
        { status: 403 }
      );
    }

    const attemptNumber = attemptCount + 1;

    // --- Парсинг документа через mammoth/pdf-parse ---
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const doc = await parseDocument(fileBuffer, file.name);

    // --- Анализ через GPT ---
    const gptResults = await analyzeDocument(workType, usesAI, doc);

    // --- Сборка чек-листа ---
    const checklist = getChecklist(workType, empMethods, compMethods, usesAI);
    const results = mergeResults(checklist, gptResults, dbLink);

    // --- Определение статуса ---
    const failedCount = results.filter(r => r.passed === false).length;
    const passedCount = results.filter(r => r.passed === true).length;
    const manualCount = results.filter(r => r.passed === null).length;
    const overallStatus = failedCount === 0 ? 'pass' : 'fail';

    // --- Сохранение в БД ---
    const attemptId = insertAttempt({
      student_name: studentName,
      work_type: workType,
      attempt_number: attemptNumber,
      status: overallStatus,
      results_json: JSON.stringify(results),
      extracted_text_preview: doc.text.substring(0, 2000),
      file_name: file.name,
      db_link: dbLink,
      pres_link: presLink,
      methods_json: JSON.stringify({ emp: empMethods, comp: compMethods }),
      uses_ai: usesAI,
    });

    // --- Ответ ---
    return NextResponse.json({
      id: attemptId,
      studentName,
      workType,
      attemptNumber,
      maxAttempts: 3,
      status: overallStatus,
      results,
      summary: {
        total: results.length,
        passed: passedCount,
        failed: failedCount,
        manual: manualCount,
      },
      documentInfo: {
        fileName: file.name,
        wordCount: doc.wordCount,
        pageEstimate: doc.pageEstimate,
        headingsFound: doc.headings.length,
        textPreview: doc.text.substring(0, 500) + '...',
      },
    });

  } catch (error: any) {
    console.error('Check API error:', error);
    return NextResponse.json(
      { error: error.message || 'Внутренняя ошибка сервера' },
      { status: 500 }
    );
  }
}
