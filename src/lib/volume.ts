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
//    менее 100 000; на английском — не менее 90 000… в объем работы не
//    входят: титульный лист, содержание, библиографический список и
//    приложения.»
// Приложение 39, критерий 2: концептуальная часть — не менее 15 тыс. знаков.
// ============================================================

import { ParsedDocument } from './parser';
import { WorkLang, RISO_VOLUME_THRESHOLDS, RISO_CONCEPT_MIN_CHARS } from './checklist';

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
  /** Объём концептуальной главы, знаков с пробелами. null — границы не распознаны. */
  conceptChars: number | null;
  conceptThreshold: number;
  /** null — требуется ручная проверка (границы главы не найдены). */
  conceptPassed: boolean | null;
  /** Что удалось распознать в структуре документа — для прозрачности в отчёте. */
  breakdown: {
    titlePageDetected: boolean;
    introFound: boolean;
    biblioFound: boolean;
    appendixFound: boolean;
    footnotesFound: boolean;
    conceptFound: boolean;
  };
}

export function assessVolume(doc: ParsedDocument, lang: WorkLang): VolumeAssessment {
  const threshold = RISO_VOLUME_THRESHOLDS[lang];
  const body = doc.bodyCharCountWithSpaces;
  const concept = doc.conceptCharCount;

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
    conceptChars: concept,
    conceptThreshold: RISO_CONCEPT_MIN_CHARS,
    conceptPassed: concept === null ? null : concept >= RISO_CONCEPT_MIN_CHARS,
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

/** Пояснение к пункту volume_concept чек-листа. */
export function conceptVolumeNote(v: VolumeAssessment): string {
  if (v.conceptChars === null) {
    return `Не удалось определить границы концептуальной главы (заголовки «Глава 1» / «Глава 2» не найдены) — требуется ручная проверка объёма (требование: не менее ${nf(v.conceptThreshold)} знаков).`;
  }
  return v.conceptPassed
    ? `${nf(v.conceptChars)} знаков при требовании не менее ${nf(v.conceptThreshold)}.`
    : `${nf(v.conceptChars)} знаков при требовании не менее ${nf(v.conceptThreshold)} — не хватает ${nf(v.conceptThreshold - v.conceptChars)}.`;
}
