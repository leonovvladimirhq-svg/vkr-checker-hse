// ============================================================
// Knowledge base методических материалов
// Читает .md файлы из ./methodology/ один раз и кэширует в памяти.
//
// Источники (в порядке приоритета):
//  1. coursework-2024.md   — методичка для 2024–2025 г. набора (актуальная)
//  2. programme-2025.md    — Программа практики 2025 г. набора (объём, ИИ-правила, БД, ГОСТ, шкала оценивания)
//  3. coursework.md        — методичка 22/23 г. набора (LEGACY, по умолчанию не используется)
//
// При появлении дополнительных документов (Гайдбук, программы практики бакалавриата
// и др.) — просто кладите новый .md в этот каталог и подключайте здесь.
// ============================================================

import fs from 'fs';
import path from 'path';

const METHODOLOGY_DIR = path.join(process.cwd(), 'src', 'lib', 'methodology');

const cache: Record<string, string> = {};

function readMd(name: string): string {
  if (cache[name] !== undefined) return cache[name];
  const file = path.join(METHODOLOGY_DIR, `${name}.md`);
  try {
    const text = fs.readFileSync(file, 'utf-8');
    cache[name] = text;
    return text;
  } catch (e) {
    console.error(`[methodology] failed to read ${file}:`, e);
    cache[name] = '';
    return '';
  }
}

export type CourseType = 'research' | 'project';

/**
 * Возвращает текст методички для GPT-промпта.
 *
 * Текущая конкатенация (по умолчанию — для всех типов КР):
 *   - Методические рекомендации 2024–2025 (основа)
 *   - Программа практики 2025 (регламент: объём, ИИ, БД, ГОСТ, критерии оценивания)
 *
 * Старая методичка 22/23 (`coursework.md`) НЕ используется по умолчанию,
 * но остаётся в каталоге как историческая справка / fallback.
 */
export function getMethodologyForCourse(_type: CourseType): string {
  const sections: string[] = [];

  const methodology2024 = readMd('coursework-2024');
  if (methodology2024) {
    sections.push(
      '=== ИСТОЧНИК 1: МЕТОДИЧЕСКИЕ РЕКОМЕНДАЦИИ ДЛЯ 2024–2025 ГОДА НАБОРА (АКТУАЛЬНЫЕ) ===\n\n' +
        methodology2024
    );
  }

  const programme2025 = readMd('programme-2025');
  if (programme2025) {
    sections.push(
      '=== ИСТОЧНИК 2: ПРОГРАММА ПРАКТИКИ 2025 ГОДА НАБОРА (РЕГЛАМЕНТ: ОБЪЁМ, ИИ, БД, ГОСТ, КРИТЕРИИ) ===\n\n' +
        programme2025
    );
  }

  // Fallback на старую методичку 22/23, если основные не загружены
  if (sections.length === 0) {
    const legacy = readMd('coursework');
    if (legacy) {
      sections.push(
        '=== FALLBACK: МЕТОДИЧЕСКИЕ РЕКОМЕНДАЦИИ 22/23 (УСТАРЕВШИЕ, НО ДЛЯ КОНТЕКСТА) ===\n\n' +
          legacy
      );
    }
  }

  return sections.join('\n\n---\n\n');
}

/**
 * Сбрасывает кэш (для разработки — изменили .md, хочется без рестарта).
 */
export function invalidateMethodologyCache(): void {
  for (const k of Object.keys(cache)) delete cache[k];
}
