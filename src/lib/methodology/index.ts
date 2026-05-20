// ============================================================
// Knowledge base методических материалов
// Читает .md файлы из ./methodology/ один раз и кэширует в памяти.
// На будущее: сюда подкладываются доп. документы (программы практики,
// шкала оценок, примеры отличных работ и т.д.).
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
 * На текущем этапе курсовая research/project использует один общий файл `coursework.md`.
 * В будущих итерациях здесь будут конкатенироваться дополнительные документы:
 *  - программы практики,
 *  - шкала оценок ВШЭ,
 *  - примеры отличных работ и отзывов,
 *  - и т.п.
 */
export function getMethodologyForCourse(_type: CourseType): string {
  return readMd('coursework');
}

/**
 * Сбрасывает кэш (для разработки — изменили .md, хочется без рестарта).
 */
export function invalidateMethodologyCache(): void {
  for (const k of Object.keys(cache)) delete cache[k];
}
