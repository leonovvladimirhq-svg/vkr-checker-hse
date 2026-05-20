// ============================================================
// POST /api/course/check
// Анализ курсовой работы и автоматическая запись попытки в БД.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { parseDocument } from '@/lib/parser';
import { analyzeCourseWork, CourseAnalysisResult } from '@/lib/course-analyzer';
import type { CourseType } from '@/lib/methodology';
import {
  getCourseAttemptCount,
  insertCourseAttempt,
} from '@/lib/db-course';

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const studentNameRaw = formData.get('studentName') as string | null;
    const courseType = formData.get('courseType') as CourseType | null;
    const file = formData.get('file') as File | null;

    const studentName = studentNameRaw?.trim() || '';

    // --- Валидация ---
    if (!studentName || !courseType || !file) {
      return NextResponse.json(
        { error: 'Не указаны обязательные поля: ФИО, тип курсовой, файл' },
        { status: 400 }
      );
    }

    const nameWords = studentName.split(/\s+/).filter(Boolean).length;
    if (nameWords < 2) {
      return NextResponse.json(
        { error: 'Укажите полное ФИО (минимум 2 слова)' },
        { status: 400 }
      );
    }

    if (!['research', 'project'].includes(courseType)) {
      return NextResponse.json(
        { error: 'Неверный тип курсовой работы (research | project)' },
        { status: 400 }
      );
    }

    const ext = file.name.toLowerCase().split('.').pop();
    if (ext !== 'docx' && ext !== 'pdf') {
      return NextResponse.json(
        { error: 'Поддерживаются только файлы .docx и .pdf' },
        { status: 400 }
      );
    }

    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'Файл слишком большой (максимум 50 МБ)' },
        { status: 400 }
      );
    }

    // --- Парсинг документа ---
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const doc = await parseDocument(fileBuffer, file.name);

    // --- Анализ через GPT ---
    const analysis: CourseAnalysisResult = await analyzeCourseWork(courseType, doc);

    // --- Логирование попытки (счётчик загрузок per student, по согласованию — без лимита) ---
    const previousCount = getCourseAttemptCount(studentName);
    const attemptNumber = previousCount + 1;

    const attemptId = insertCourseAttempt({
      student_name: studentName,
      course_type: courseType,
      attempt_number: attemptNumber,
      file_name: file.name,
      word_count: doc.wordCount,
      page_estimate: doc.pageEstimate,
      headings_json: JSON.stringify(doc.headings.slice(0, 100)),
      extracted_text_preview: doc.text.substring(0, 2000),
      analysis_json: JSON.stringify(analysis),
      // Колонка БД называется top5_json исторически, но теперь хранит priorityAdvice (без лимита).
      top5_json: JSON.stringify(analysis.priorityAdvice),
    });

    return NextResponse.json({
      attemptId,
      attemptNumber,
      studentName,
      courseType,
      documentInfo: {
        fileName: file.name,
        wordCount: doc.wordCount,
        pageEstimate: doc.pageEstimate,
        headingsFound: doc.headings.length,
      },
      analysis,
    });
  } catch (error: any) {
    console.error('Course check API error:', error);
    return NextResponse.json(
      { error: error?.message || 'Внутренняя ошибка сервера при анализе курсовой' },
      { status: 500 }
    );
  }
}
