// ============================================================
// GET /api/riso-review?id=N — шаблон «Отзыв руководителя на ВКР» (.docx)
// для ОП «Реклама и связи с общественностью» (приложение 36 Программы практики).
//
// Заполняются только переносимые и счётные поля: ФИО, тема работы, состав базы
// данных по типам файлов, объём работы в знаках и вердикт по порогу объёма.
// Содержательные критерии и рекомендуемая оценка остаются пустыми — их
// заполняет научный руководитель (договорённость встречи 10.07.2026).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAttemptById } from '@/lib/db';
import { buildRisoReviewDoc, RisoReviewData, RisoReviewMediaFile } from '@/lib/riso-review-doc';
import { analyzeDbWithFallback, DbStats } from '@/lib/db-analyzer';
import { PROGRAMMES } from '@/lib/programmes';
import { programmeForWorkType } from '@/lib/programmes';
import { RISO_MEDIA_MIN_MINUTES } from '@/lib/checklist';

export const maxDuration = 120;

/**
 * Пороги по количеству записей из приложения 35: минимум 10 интервью
 * или 5 фокус-групп на каждую эмпирическую группу. Для остальных методов
 * (в т.ч. экспертного интервью) регламент числа не фиксирует.
 */
const MEDIA_THRESHOLDS: Record<string, number> = {
  interviews: 10,
  focus_groups: 5,
};

export async function GET(req: NextRequest) {
  try {
    const idParam = req.nextUrl.searchParams.get('id');
    if (!idParam) {
      return NextResponse.json({ error: 'Укажите id попытки' }, { status: 400 });
    }

    const attempt = getAttemptById(Number(idParam));
    if (!attempt) {
      return NextResponse.json({ error: 'Попытка не найдена' }, { status: 404 });
    }

    const programmeId = attempt.programme || programmeForWorkType(attempt.work_type);
    if (programmeId !== 'riso') {
      return NextResponse.json(
        { error: 'Шаблон отзыва по приложению 36 предусмотрен только для ОП «Реклама и связи с общественностью»' },
        { status: 400 },
      );
    }

    // --- Объём: берём посчитанное на момент проверки, GPT здесь не участвует ---
    let volume: any = null;
    if (attempt.volume_json) {
      try { volume = JSON.parse(attempt.volume_json); } catch { volume = null; }
    }

    // --- Методы исследования → пороги по количеству записей ---
    let empMethods: string[] = [];
    if (attempt.methods_json) {
      try { empMethods = JSON.parse(attempt.methods_json).emp || []; } catch { empMethods = []; }
    }
    const methodLabels = new Map(PROGRAMMES.riso.methods.map(m => [m.value as string, m.label]));
    const mediaThresholds = empMethods
      .filter(m => MEDIA_THRESHOLDS[m] !== undefined)
      .map(m => ({ method: methodLabels.get(m) || m, min: MEDIA_THRESHOLDS[m] }));

    // --- Состав базы данных ---
    // Сначала пробуем актуальное состояние Яндекс.Диска: студент мог дозагрузить
    // файлы после проверки, а отзыв пишется по факту на момент отзыва.
    // Если ссылка не открывается — используем снимок, сохранённый при проверке.
    let stats: DbStats | null = null;
    let dbAccessible = false;
    let dbError: string | null = null;

    if (attempt.db_link) {
      try {
        const fresh = await analyzeDbWithFallback(attempt.db_link, attempt.extracted_text_preview || '');
        if (fresh.accessible && fresh.stats) {
          stats = fresh.stats;
          dbAccessible = true;
        } else {
          dbError = fresh.error || 'Ссылка недоступна';
        }
      } catch (e: any) {
        dbError = e?.message || 'Не удалось обратиться к Яндекс.Диску';
      }
    } else {
      dbError = 'Ссылка на базу данных не была указана';
    }

    if (!stats && attempt.db_stats_json) {
      try {
        stats = JSON.parse(attempt.db_stats_json);
        if (stats) {
          dbAccessible = true;
          dbError = dbError
            ? `${dbError}. Использован состав базы данных на момент проверки работы`
            : null;
        }
      } catch { /* снимок повреждён — останемся без данных */ }
    }

    const mediaFiles: RisoReviewMediaFile[] = stats?.mediaFiles ?? [];

    const data: RisoReviewData = {
      studentName: attempt.student_name,
      workTitle: attempt.work_title || '',
      checkedAt: new Date(attempt.created_at + 'Z').toLocaleDateString('ru-RU'),

      dbAccessible,
      dbError,
      dbLink: attempt.db_link,
      dbLinkProvided: !!attempt.db_link,
      mediaCount: stats ? stats.media : null,
      tableCount: stats ? stats.tables : null,
      otherCount: stats ? stats.documents + stats.other : null,
      mediaFiles,
      disallowedFormats: stats?.disallowedFormats ?? [],
      mediaThresholds,
      minMinutes: RISO_MEDIA_MIN_MINUTES,

      charsWithSpaces: volume?.bodyCharsWithSpaces ?? null,
      charsNoSpaces: volume?.bodyCharsNoSpaces ?? null,
      footnoteChars: volume?.footnoteChars ?? null,
      volumeThreshold: volume?.threshold ?? null,
      volumeMet: typeof volume?.passed === 'boolean' ? volume.passed : null,

      usesAI: attempt.uses_ai === 1,
    };

    const buffer = await buildRisoReviewDoc(data);
    const surname = (attempt.student_name || 'студент').trim().split(/\s+/)[0];
    const downloadName = `Отзыв_ВКР_${surname}.docx`;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="review.docx"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
      },
    });
  } catch (error: any) {
    console.error('RiSO review template error:', error);
    return NextResponse.json(
      { error: error.message || 'Не удалось сформировать шаблон отзыва' },
      { status: 500 },
    );
  }
}
