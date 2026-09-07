// ============================================================
// POST /api/check — Главный эндпоинт проверки ВКР
// Принимает multipart/form-data с файлом и метаданными
//
// Работает для двух образовательных программ (поле programme):
//   'ik'   — «Интегрированные коммуникации» (магистратура)
//   'riso' — «Реклама и связи с общественностью» (бакалавриат)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { parseDocument } from '@/lib/parser';
import { analyzeDocument, mergeResults } from '@/lib/analyzer';
import { getChecklist, WorkType, WorkLang, ResearchMethod } from '@/lib/checklist';
import { getProgramme, isProgrammeId, isValidWorkType, DEFAULT_PROGRAMME } from '@/lib/programmes';
import { getPublicResourceInfo } from '@/lib/yandex-disk';
import { analyzeDatabase, DbAnalysisResult } from '@/lib/db-analyzer';
import { assessVolume, VolumeAssessment } from '@/lib/volume';

export const maxDuration = 120; // Увеличенный таймаут для GPT-анализа

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    // --- Извлечение полей ---
    const studentName = (formData.get('studentName') as string)?.trim();
    const workTitle = ((formData.get('workTitle') as string) || '').trim();
    const programmeId = (formData.get('programme') as string) || DEFAULT_PROGRAMME;
    const workType = formData.get('workType') as WorkType;
    const workLang = ((formData.get('workLang') as string) || 'ru') as WorkLang;
    const usesAI = formData.get('usesAI') === 'true';
    const dbLink = formData.get('dbLink') as string || '';
    const presLink = formData.get('presLink') as string || '';
    const empMethodsRaw = formData.get('empMethods') as string || '[]';
    const compMethodsRaw = formData.get('compMethods') as string || '[]';
    const otherMethodName = formData.get('otherMethodName') as string || '';
    const file = formData.get('file') as File | null;

    // --- Валидация ---
    if (!studentName || !workType || !file) {
      return NextResponse.json(
        { error: 'Не указаны обязательные поля: ФИО, тип работы, файл' },
        { status: 400 }
      );
    }

    if (!isProgrammeId(programmeId)) {
      return NextResponse.json({ error: 'Неизвестная образовательная программа' }, { status: 400 });
    }
    const programme = getProgramme(programmeId);

    if (!isValidWorkType(programme.id, workType)) {
      return NextResponse.json(
        { error: `Тип работы «${workType}» не предусмотрен программой «${programme.label}»` },
        { status: 400 }
      );
    }

    if (workLang !== 'ru' && workLang !== 'en') {
      return NextResponse.json({ error: 'Неверный язык работы' }, { status: 400 });
    }

    // Тема нужна для шаблона отзыва руководителя (приложение 36) — без неё
    // в документе останется пустая строка, поэтому спрашиваем сразу.
    if (programme.requiresWorkTitle && workTitle.length < 5) {
      return NextResponse.json(
        { error: 'Укажите тему работы (не менее 5 символов)' },
        { status: 400 }
      );
    }

    const empMethods: ResearchMethod[] = JSON.parse(empMethodsRaw);
    const compMethods: ResearchMethod[] = JSON.parse(compMethodsRaw);

    if (empMethods.length < programme.minMethods(workType)) {
      return NextResponse.json(
        { error: `Для этой работы нужно выбрать минимум ${programme.minMethods(workType)} метод(а) исследования` },
        { status: 400 }
      );
    }

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

    // --- Объём работы: считается программно, без участия GPT ---
    const volume: VolumeAssessment | null = programme.volumeThresholds
      ? assessVolume(doc, workLang)
      : null;

    // --- Сборка чек-листа ---
    const checklist = getChecklist({
      programme: programme.id,
      type: workType,
      empMethods,
      compMethods,
      usesAI,
      otherMethodName: otherMethodName || undefined,
      lang: workLang,
    });

    // --- Анализ через GPT ---
    const gptResults = await analyzeDocument({
      programme: programme.id,
      type: workType,
      usesAI,
      doc,
      lang: workLang,
      dbAnalysis,
      checklist,
    });

    const results = mergeResults({
      checklist,
      gptResults,
      dbLink,
      dbAnalysis,
      presLink,
      volume,
      mediaMinMinutes: programme.mediaMinMinutes,
    });

    // --- Определение статуса ---
    const failedCount = results.filter(r => r.passed === false).length;
    const passedCount = results.filter(r => r.passed === true).length;
    const manualCount = results.filter(r => r.passed === null).length;
    const overallStatus = failedCount > 0 ? 'fail' : manualCount > 0 ? 'pending' : 'pass';

    // --- Ответ (без сохранения в БД — студент сохраняет явно) ---
    return NextResponse.json({
      studentName,
      workTitle,
      programme: programme.id,
      programmeLabel: programme.label,
      workType,
      workLang,
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
      // Технические параметры для отзыва руководителя (приложение 36 Программы
      // практики ОП РиСО): состав БД и объём работы. Договорённость встречи
      // 10.07.2026 — ИИ отвечает за технику, содержательная оценка за человеком.
      technical: buildTechnicalSummary(volume, dbAnalysis),
      // Метаданные для последующего сохранения
      saveData: {
        extractedTextPreview: doc.text.substring(0, 2000),
        dbLink,
        presLink,
        methodsJson: JSON.stringify({ emp: empMethods, comp: compMethods, otherMethodName: otherMethodName || undefined }),
        usesAI,
        fileName: file.name,
        resultsJson: JSON.stringify(results),
        programme: programme.id,
        workLang,
        volumeJson: volume ? JSON.stringify(volume) : '',
        workTitle,
        // Снимок состава БД на момент проверки — фолбэк для шаблона отзыва,
        // если к моменту его выгрузки ссылка на Яндекс.Диск перестанет открываться.
        dbStatsJson: dbAnalysis?.stats ? JSON.stringify(dbAnalysis.stats) : '',
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

/**
 * Техническая справка для отзыва руководителя.
 * Только измеримые факты: сколько файлов какого типа лежит в БД и каков объём
 * работы. Никаких содержательных суждений — их формулирует руководитель.
 */
function buildTechnicalSummary(
  volume: VolumeAssessment | null,
  dbAnalysis: DbAnalysisResult | null,
) {
  return {
    volume: volume && {
      charsWithSpaces: volume.bodyCharsWithSpaces,
      charsNoSpaces: volume.bodyCharsNoSpaces,
      footnoteChars: volume.footnoteChars,
      threshold: volume.threshold,
      requirementMet: volume.passed,
      conceptChars: volume.conceptChars,
      conceptThreshold: volume.conceptThreshold,
      conceptRequirementMet: volume.conceptPassed,
      breakdown: volume.breakdown,
    },
    database: {
      accessible: dbAnalysis?.accessible ?? false,
      error: dbAnalysis?.error || null,
      // Формулировки под приложение 36: «Содержит ___ аудио/видеофайл(ов),
      // ___ таблиц (выгрузка данных опроса и т.п.), ___ других файлов».
      mediaFiles: dbAnalysis?.stats?.media ?? null,
      tableFiles: dbAnalysis?.stats?.tables ?? null,
      otherFiles: dbAnalysis?.stats
        ? dbAnalysis.stats.documents + dbAnalysis.stats.other
        : null,
      totalFiles: dbAnalysis?.stats?.total ?? dbAnalysis?.fileCount ?? null,
      disallowedFormats: dbAnalysis?.stats?.disallowedFormats ?? [],
      media: dbAnalysis?.stats?.mediaFiles ?? [],
    },
  };
}
