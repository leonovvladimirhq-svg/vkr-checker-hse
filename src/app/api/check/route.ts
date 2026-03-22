// ============================================================
// POST /api/check — Главный эндпоинт проверки ВКР
// Принимает multipart/form-data с файлом и метаданными
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { parseDocument } from '@/lib/parser';
import { analyzeDocument, mergeResults } from '@/lib/analyzer';
import { getChecklist, WorkType, ResearchMethod } from '@/lib/checklist';
import { getPublicResourceInfo } from '@/lib/yandex-disk';
import { analyzeDatabase, DbAnalysisResult } from '@/lib/db-analyzer';

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

    // --- Парсинг документа через mammoth/pdf-parse ---
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const doc = await parseDocument(fileBuffer, file.name);

    // --- Анализ базы данных через Яндекс.Диск API ---
    let dbAnalysis: DbAnalysisResult | null = null;
    if (dbLink) {
      try {
        const folderInfo = await getPublicResourceInfo(dbLink);
        dbAnalysis = await analyzeDatabase(dbLink, folderInfo);
      } catch (err) {
        console.error('DB analysis error (non-critical):', err);
        // Не блокируем проверку — БД уйдёт в ручную проверку
      }
    }

    // --- Анализ через GPT ---
    const gptResults = await analyzeDocument(workType, usesAI, doc, undefined, dbAnalysis);

    // --- Сборка чек-листа ---
    const checklist = getChecklist(workType, empMethods, compMethods, usesAI);
    const results = mergeResults(checklist, gptResults, dbLink, dbAnalysis);

    // --- Определение статуса ---
    const failedCount = results.filter(r => r.passed === false).length;
    const passedCount = results.filter(r => r.passed === true).length;
    const manualCount = results.filter(r => r.passed === null).length;
    const overallStatus = failedCount === 0 ? 'pass' : 'fail';

    // --- Ответ (без сохранения в БД — студент сохраняет явно) ---
    return NextResponse.json({
      studentName,
      workType,
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
      // Метаданные для последующего сохранения
      saveData: {
        extractedTextPreview: doc.text.substring(0, 2000),
        dbLink,
        presLink,
        methodsJson: JSON.stringify({ emp: empMethods, comp: compMethods }),
        usesAI,
        fileName: file.name,
        resultsJson: JSON.stringify(results),
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
