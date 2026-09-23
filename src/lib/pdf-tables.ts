// ============================================================
// Разбор PDF с распознаванием таблиц
//
// Зачем: по п. 1.21 Программы практики ОП РиСО таблицы и иллюстрации из
// текста работы в объём не входят. В .docx таблица размечена тегом <w:tbl>
// и вычитается точно. В PDF разметки нет — есть только текст с координатами
// и нарисованные фигуры. Таблицу приходится узнавать по геометрии.
//
// Как узнаём (три условия подряд, каждое отсекает свой класс ошибок):
//  1. На странице есть прямоугольники или горизонтальные линейки.
//  2. Они образуют РЯДЫ, где рядом друг с другом стоят минимум две ячейки.
//     Без этого условия под таблицу попадала подложка строки текста —
//     Google Docs рисует такой прямоугольник под каждой строкой, и первая
//     версия детектора срезала 37 % текста реальной работы.
//  3. Текст внутри области разложен на колонки: есть строки, где между
//     соседними фрагментами зазор шире межсловного. Без этого условия
//     сплошная проза внутри текстовой рамки (так рисует macOS/Quartz)
//     принималась за таблицу.
//
// pdf.js берём тот же, что лежит внутри pdf-parse, — новой зависимости нет.
// Версия v2.0.550: она, в отличие от v1.10.100 (по умолчанию в pdf-parse),
// переживает getOperatorList() в Node — у v1.10.100 загрузчик шрифтов лезет
// в document и роняет процесс асинхронным исключением. Текст обе версии дают
// ПОБАЙТОВО одинаковый: проверено на 29 работах восьми разных генераторов
// PDF (Google Docs, Word 2016/2019/2024, macOS, ilovepdf, smallpdf, pypdf).
// ============================================================

/* eslint-disable @typescript-eslint/no-var-requires */

interface Rect { x0: number; y0: number; x1: number; y1: number }
interface HLine { x0: number; x1: number; y: number }
interface Region extends Rect { rows: number }

export interface PdfExtractResult {
  /** Текст в точности как его отдаёт pdf-parse — для GPT и проверки структуры. */
  text: string;
  /** Тот же текст без содержимого таблиц — для подсчёта объёма. */
  textWithoutTables: string;
  numPages: number;
  /** Сколько областей-таблиц найдено во всём документе. */
  tableRegions: number;
}

// --- аффинные преобразования ---------------------------------

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

// --- фигуры на странице --------------------------------------

/**
 * Прямоугольники и горизонтальные линейки страницы в координатах листа.
 *
 * Матрицу преобразования ведём сами (save/restore/transform): координаты в
 * операторах пути заданы в текущей системе координат, и без пересчёта
 * области уезжают у любого документа, где выставлен масштаб.
 */
function collectShapes(opList: any, OPS: any, pageW: number, pageH: number): { cells: Rect[]; hlines: HLine[] } {
  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  const rects: Rect[] = [];
  const hlines: HLine[] = [];

  for (let k = 0; k < opList.fnArray.length; k++) {
    const fn = opList.fnArray[k];
    const args = opList.argsArray[k];

    if (fn === OPS.save) {
      stack.push(ctm);
    } else if (fn === OPS.restore) {
      ctm = stack.pop() || IDENTITY;
    } else if (fn === OPS.transform) {
      ctm = multiply(args as Matrix, ctm);
    } else if (fn === OPS.constructPath) {
      const [pathOps, coords] = args;
      let i = 0;
      let cur: [number, number] | null = null;

      for (const op of pathOps) {
        if (op === OPS.rectangle) {
          const x = coords[i], y = coords[i + 1], w = coords[i + 2], h = coords[i + 3];
          i += 4;
          const [ax, ay] = applyMatrix(ctm, x, y);
          const [bx, by] = applyMatrix(ctm, x + w, y + h);
          rects.push({
            x0: Math.min(ax, bx), y0: Math.min(ay, by),
            x1: Math.max(ax, bx), y1: Math.max(ay, by),
          });
        } else if (op === OPS.moveTo) {
          cur = applyMatrix(ctm, coords[i], coords[i + 1]);
          i += 2;
        } else if (op === OPS.lineTo) {
          const p = applyMatrix(ctm, coords[i], coords[i + 1]);
          i += 2;
          if (cur && Math.abs(p[1] - cur[1]) < 1.5 && Math.abs(p[0] - cur[0]) > 40) {
            hlines.push({ x0: Math.min(cur[0], p[0]), x1: Math.max(cur[0], p[0]), y: (p[1] + cur[1]) / 2 });
          }
          cur = p;
        } else if (op === OPS.curveTo) {
          i += 6; cur = null;
        } else if (op === OPS.curveTo2 || op === OPS.curveTo3) {
          i += 4; cur = null;
        }
      }
    }
  }

  // Прямоугольник во весь лист — подложка или область обрезки, не ячейка.
  const cells = rects.filter(r => {
    const w = r.x1 - r.x0;
    const h = r.y1 - r.y0;
    if (w > pageW * 0.92 && h > pageH * 0.92) return false;
    return w > 12 && h > 4 && w <= pageW && h <= pageH;
  });

  return { cells, hlines };
}

/** Кандидаты в таблицы: ряды, где рядом стоят минимум две ячейки. */
function candidateRegions(cells: Rect[], hlines: HLine[]): Region[] {
  // Раскладываем прямоугольники по рядам — по пересечению вертикальных границ
  const rows: Array<{ y0: number; y1: number; items: Rect[] }> = [];
  for (const c of [...cells].sort((a, b) => b.y1 - a.y1)) {
    const row = rows.find(r =>
      Math.min(r.y1, c.y1) - Math.max(r.y0, c.y0) > Math.min(r.y1 - r.y0, c.y1 - c.y0) * 0.5);
    if (row) {
      row.items.push(c);
      row.y0 = Math.min(row.y0, c.y0);
      row.y1 = Math.max(row.y1, c.y1);
    } else {
      rows.push({ y0: c.y0, y1: c.y1, items: [c] });
    }
  }

  const tableRows = rows.filter(r => {
    const xs = [...r.items].sort((a, b) => a.x0 - b.x0);
    for (let i = 1; i < xs.length; i++) if (xs[i].x0 >= xs[i - 1].x1 - 2) return true;
    return false;
  });

  const regions: Region[] = [];
  for (const r of tableRows.sort((a, b) => b.y1 - a.y1)) {
    const box: Region = {
      x0: Math.min(...r.items.map(i => i.x0)),
      x1: Math.max(...r.items.map(i => i.x1)),
      y0: r.y0, y1: r.y1, rows: 1,
    };
    const prev = regions[regions.length - 1];
    if (prev && prev.y0 - box.y1 < 12 && box.x0 < prev.x1 && box.x1 > prev.x0) {
      prev.x0 = Math.min(prev.x0, box.x0);
      prev.x1 = Math.max(prev.x1, box.x1);
      prev.y0 = Math.min(prev.y0, box.y0);
      prev.rows++;
    } else {
      regions.push(box);
    }
  }
  const out = regions.filter(r => r.rows >= 2);

  // Таблицы без заливки ячеек, набранные линейками (booktabs и подобное):
  // три и более горизонтальных линии одной ширины друг под другом.
  const sorted = [...hlines].sort((a, b) => b.y - a.y);
  let group: HLine[] = [];
  const flush = () => {
    if (group.length >= 3) {
      const widths = group.map(l => l.x1 - l.x0);
      if (Math.max(...widths) - Math.min(...widths) < 40) {
        out.push({
          x0: Math.min(...group.map(l => l.x0)), x1: Math.max(...group.map(l => l.x1)),
          y0: Math.min(...group.map(l => l.y)), y1: Math.max(...group.map(l => l.y)),
          rows: group.length,
        });
      }
    }
    group = [];
  };
  for (const l of sorted) {
    if (!group.length || group[group.length - 1].y - l.y < 140) group.push(l);
    else { flush(); group = [l]; }
  }
  flush();

  return out;
}

const COLUMN_GAP = 18; // пунктов: межсловный зазор столько не занимает даже в растянутой строке

/**
 * Проверка области по тексту: в таблице строки разложены на колонки.
 *
 * Смотрим не на позиции начала фрагментов, а на ЗАЗОРЫ между ними: конец
 * одного фрагмента до начала следующего. В выключенной по ширине прозе
 * межсловные пробелы растягиваются, но до ширины межколоночного отступа
 * не дотягивают.
 */
function looksTabular(region: Region, items: any[]): boolean {
  const rowsByY = new Map<number, Array<{ x0: number; x1: number }>>();

  for (const it of items) {
    const width = it.width || 0;
    const x = it.transform[4] + width / 2;
    const y = it.transform[5] + (it.height || 0) / 3;
    if (x < region.x0 || x > region.x1 || y < region.y0 || y > region.y1) continue;
    if (!it.str || !it.str.trim()) continue;

    const key = Math.round(it.transform[5] / 3);
    if (!rowsByY.has(key)) rowsByY.set(key, []);
    rowsByY.get(key)!.push({ x0: it.transform[4], x1: it.transform[4] + width });
  }
  if (rowsByY.size < 2) return false;

  let multiColumnRows = 0;
  for (const row of Array.from(rowsByY.values())) {
    const sorted = row.sort((a: { x0: number }, b: { x0: number }) => a.x0 - b.x0);
    let widest = 0;
    for (let i = 1; i < sorted.length; i++) {
      widest = Math.max(widest, sorted[i].x0 - sorted[i - 1].x1);
    }
    if (widest >= COLUMN_GAP) multiColumnRows++;
  }
  return multiColumnRows >= 2;
}

// --- разбор документа ----------------------------------------

/**
 * Достаёт из PDF два текста: полный (как pdf-parse) и без содержимого таблиц.
 *
 * Строки собираются тем же правилом, что в pdf-parse: новый перевод строки,
 * когда меняется координата Y. Иначе объём сдвинулся бы у всех работ по
 * причине, не имеющей отношения к таблицам.
 */
export async function extractPdfWithTables(buffer: Buffer): Promise<PdfExtractResult> {
  // Путь записан строкой целиком, а не через переменную: сборщик Next.js
  // должен разрешить его статически, иначе модуль не попадёт в бандл.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfjsLib = require('pdf-parse/lib/pdf.js/v2.0.550/build/pdf.js');
  const OPS = pdfjsLib.OPS;

  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    disableFontFace: true,
    nativeImageDecoderSupport: 'none',
  }).promise;

  let text = '';
  let textWithoutTables = '';
  let tableRegions = 0;

  try {
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      const page = await doc.getPage(pageNo);
      const view = page.view;
      const pageW = view[2] - view[0];
      const pageH = view[3] - view[1];

      const content = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });

      let regions: Region[] = [];
      try {
        const { cells, hlines } = collectShapes(await page.getOperatorList(), OPS, pageW, pageH);
        regions = candidateRegions(cells, hlines).filter(r => looksTabular(r, content.items));
      } catch (e) {
        // Страница с повреждённой графикой не должна ломать подсчёт: просто
        // считаем, что таблиц на ней нет.
        console.warn(`pdf-tables: не удалось разобрать графику страницы ${pageNo}:`, e);
      }
      tableRegions += regions.length;

      // Сборка текста страницы повторяет pdf-parse дословно: перевод строки,
      // когда меняется координата Y, счётчик сбрасывается на каждой странице,
      // страницы склеиваются через два перевода строки. Любое отступление
      // сдвигает границы «Введение …  Список литературы» — при первой попытке
      // страницы склеились без разделителя, и тело работы Носовой выросло со
      // 116 885 до 181 747 знаков: заголовки прилипли к концу прошлой страницы.
      let pageText = '';
      let pageTextClean = '';
      let lastY: number | undefined;
      let lastYClean: number | undefined;

      for (const item of content.items) {
        const x = item.transform[4] + (item.width || 0) / 2;
        const y = item.transform[5] + (item.height || 0) / 3;
        const inTable = regions.some(r => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);

        pageText += (lastY === item.transform[5] || !lastY) ? item.str : '\n' + item.str;
        lastY = item.transform[5];

        if (!inTable) {
          pageTextClean += (lastYClean === item.transform[5] || !lastYClean) ? item.str : '\n' + item.str;
          lastYClean = item.transform[5];
        }
      }

      text += '\n\n' + pageText;
      textWithoutTables += '\n\n' + pageTextClean;
    }
  } finally {
    try { await doc.destroy(); } catch { /* не критично */ }
  }

  return { text, textWithoutTables, numPages: doc.numPages, tableRegions };
}
