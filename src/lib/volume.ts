// ============================================================
// Детерминированная проверка объёма работы (ОП РиСО)
//
// Объём НЕ доверяется GPT: языковые модели не умеют считать знаки и
// систематически ошибаются на порядок (см. историю фикса ×10 в модуле
// курсовых, 11.06.2026). Здесь всё считается арифметикой на сервере,
// а в промпт числа не уходят вовсе.
//
// Регламент — Программа практики ОП РиСО 2025/2026, п. 1.21:
//   «Под объемом ВКР понимается количество знаков С ПРОБЕЛАМИ, с учетом
//    сносок на источники и литературу… для работ на русском языке — не
//    менее 100 000; на английском — не менее 90 000… все таблицы, диаграммы
//    и прочие иллюстративные материалы из текста работы выносятся в
//    приложение и не входят в объем работы… в объем работы не входят:
//    титульный лист, содержание, библиографический список и приложения.»
// ============================================================

import { ParsedDocument } from './parser';
import { WorkLang, RISO_VOLUME_THRESHOLDS } from './checklist';

export interface VolumeAssessment {
  lang: WorkLang;
  /** Порог объёма тела работы, знаков с пробелами. */
  threshold: number;
  /** Тело работы (Введение → Список литературы) + сноски, знаков с пробелами. */
  bodyCharsWithSpaces: number;
  /** То же без пробелов — справочно (в чек-листе ОП ИК используется эта метрика). */
  bodyCharsNoSpaces: number;
  /** Знаки сносок — уже включены в bodyCharsWithSpaces. */
  footnoteChars: number;
  bodyWordCount: number;
  appendixWordCount: number;
  passed: boolean;
  /** Сколько знаков не хватает до порога (0, если порог взят). */
  shortfall: number;
  /** Знаки таблиц из текста работы, исключённые из объёма (п. 1.21). */
  excludedTableChars: number;
  /** Знаки подписей «Таблица N …» / «Рисунок N …», исключённые из объёма. */
  excludedCaptionChars: number;
  /** Число таблиц во ВСЁМ документе, включая приложения (.docx; для .pdf всегда 0). */
  excludedTableCount: number;
  /** Что удалось распознать в структуре документа — для прозрачности в отчёте. */
  breakdown: {
    titlePageDetected: boolean;
    introFound: boolean;
    biblioFound: boolean;
    appendixFound: boolean;
    footnotesFound: boolean;
    tablesExcluded: boolean;
  };
}

export function assessVolume(doc: ParsedDocument, lang: WorkLang): VolumeAssessment {
  const threshold = RISO_VOLUME_THRESHOLDS[lang];
  const body = doc.bodyCharCountWithSpaces;

  return {
    lang,
    threshold,
    bodyCharsWithSpaces: body,
    bodyCharsNoSpaces: doc.bodyCharCountNoSpaces,
    footnoteChars: doc.footnoteCharCount,
    bodyWordCount: doc.bodyWordCount,
    appendixWordCount: doc.appendixWordCount,
    passed: body >= threshold,
    shortfall: Math.max(0, threshold - body),
    excludedTableChars: doc.excludedTableChars,
    excludedCaptionChars: doc.excludedCaptionChars,
    excludedTableCount: doc.excludedTableCount,
    breakdown: doc.volumeBreakdown,
  };
}

const nf = (n: number) => n.toLocaleString('ru-RU');

/** Пояснение к пункту volume_total чек-листа. */
export function volumeNote(v: VolumeAssessment): string {
  const parts: string[] = [];
  parts.push(
    v.passed
      ? `${nf(v.bodyCharsWithSpaces)} знаков с пробелами при требовании не менее ${nf(v.threshold)}.`
      : `${nf(v.bodyCharsWithSpaces)} знаков с пробелами при требовании не менее ${nf(v.threshold)} — не хватает ${nf(v.shortfall)}.`,
  );
  if (v.breakdown.footnotesFound) {
    parts.push(`В объём включены сноски (${nf(v.footnoteChars)} знаков).`);
  }
  parts.push(excludedNote(v));
  if (!v.breakdown.introFound || !v.breakdown.biblioFound) {
    const missing: string[] = [];
    if (!v.breakdown.introFound) missing.push('«Введение»');
    if (!v.breakdown.biblioFound) missing.push('«Список литературы»');
    parts.push(
      `Внимание: заголовки ${missing.join(' и ')} не распознаны, границы тела работы определены приблизительно — проверьте цифру вручную.`,
    );
  }
  return parts.join(' ');
}

/**
 * Что исключено из объёма по п. 1.21 («все таблицы, диаграммы и прочие
 * иллюстративные материалы из текста работы… не входят в объем работы»).
 *
 * Для .pdf оговариваем ограничение прямо: таблицы там не размечены, и
 * вычесть их из объёма нельзя, не срезав заодно обычный текст.
 */
export function excludedNote(v: VolumeAssessment): string {
  const excluded: string[] = [];
  if (v.excludedTableChars > 0) {
    // Число таблиц намеренно не приводим: excludedTableCount считает таблицы
    // во всём документе, а из объёма вычитаются только те, что попали в тело
    // работы — таблица в приложении в объём и так не входила.
    excluded.push(`таблицы из текста (${nf(v.excludedTableChars)} знаков)`);
  }
  if (v.excludedCaptionChars > 0) {
    excluded.push(`подписи к таблицам и иллюстрациям (${nf(v.excludedCaptionChars)} знаков)`);
  }

  if (!v.breakdown.tablesExcluded) {
    const head = excluded.length ? `Из объёма исключены ${excluded.join(' и ')}.` : '';
    return `${head} Работа загружена в PDF: таблицы внутри текста в этом формате не размечены и из объёма не вычитаются — для точного подсчёта загрузите .docx.`.trim();
  }
  return excluded.length
    ? `Из объёма исключены ${excluded.join(' и ')} — по п. 1.21 они выносятся в приложение.`
    : 'Таблиц и иллюстраций в тексте работы не найдено — вычитать из объёма нечего.';
}
