// ============================================================
// GPT-промпт для повторного анализа: заполнить ВСЕ поля шаблона отзыва
// (Приложение 20.1 / 20.2 Программы практики ОП ИК 2025).
// Возвращает JSON, который потом передаётся в generateReviewDocx().
// ============================================================

import OpenAI from 'openai';
import type { CourseType } from './methodology';
import { getMethodologyForCourse } from './methodology';
import type { ParsedDocument } from './parser';
import { prepareTextForGPT } from './parser';
import type { DbAnalysisResult } from './db-analyzer';
import {
  ReviewTemplateData,
  DEFAULT_BD_CRITERIA,
  DEFAULT_AI_CRITERIA,
  RESEARCH_WORK_CRITERIA,
  PROJECT_WORK_CRITERIA,
} from './course-review-doc';

function buildPrompt(
  type: CourseType,
  doc: ParsedDocument,
  studentName: string,
  workTitle: string,
  dbAnalysis?: DbAnalysisResult | null,
): { system: string; user: string } {
  const methodology = getMethodologyForCourse(type);
  const workCriteria = type === 'research' ? RESEARCH_WORK_CRITERIA : PROJECT_WORK_CRITERIA;

  // ----- Блок с фактическим содержимым БД (если есть) -----
  const dbBlock = dbAnalysis?.accessible && dbAnalysis.description
    ? `\n\nСОДЕРЖИМОЕ БАЗЫ ДАННЫХ (Яндекс.Диск):\n${dbAnalysis.description}\n\nИспользуй эти данные для заполнения bdAudioCount / bdTablesCount / bdOtherCount (конкретные числа, а не null) и для содержательных комментариев в bdCriteria.`
    : dbAnalysis && !dbAnalysis.accessible
      ? `\n\nБАЗА ДАННЫХ: ссылка передана, но недоступна (${dbAnalysis.error || 'неизвестная причина'}). Поставь счётчики в null, в bdCriteria комментарии — «Не удалось проверить автоматически; рекомендуется ручная проверка научным руководителем».`
      : `\n\nБАЗА ДАННЫХ: ссылка не была передана. Поставь bdAudioCount / bdTablesCount / bdOtherCount = null. В bdCriteria комментарии — «Не проверялось автоматически; рекомендуется ручная проверка научным руководителем».`;

  const system = `Ты помогаешь научному руководителю заполнить шаблон отзыва на ${type === 'research' ? 'исследовательскую курсовую работу' : 'курсовой проект'} студента ОП «Интегрированные коммуникации» НИУ ВШЭ. Финальный документ подписывает реальный научный руководитель, поэтому твоя задача — корректно подготовить факты и черновики комментариев по шаблону Приложения 20.${type === 'research' ? '1' : '2'} Программы практики 2025.

ВАЖНЫЕ ПРИНЦИПЫ:
- Уважительный, конструктивный тон. Никаких категоричных и демотивирующих формулировок.
- Не выдумывай факты о работе — опирайся только на присланный текст и фактическое содержимое БД (если предоставлено).
- В каждом «Содержательный комментарий по критерию» дай ОБОСНОВАННУЮ оценку (1–3 предложения): что есть в работе, что выполнено хорошо, что стоит усилить. Формулировки нейтральные — без позиционирования «как руководитель».
- Оценка по критерию — целое число от 0 до 10 (или «—», если критерий категорически не применим).
- Если что-то невозможно проверить автоматически (например, корректность цитирования / Антиплагиат, фактический хронометраж аудиозаписей) — так и пиши: «Не удалось проверить автоматически; рекомендуется ручная проверка научным руководителем». Не ставь «ДА/НЕТ», ставь «—».
- АКАДЕМИЧЕСКИЙ СТИЛЬ: комментарии пиши академическим, нейтральным языком без жаргона и публицистики (не «сшить», «прокачать», «докрутить»). Раз от студента требуется академический стиль, отзыв тоже должен ему соответствовать.
- НАЗВАНИЯ РАЗДЕЛОВ: методические рекомендации требуют от студента СОДЕРЖАТЕЛЬНЫХ названий глав и параграфов. НЕ занижай structureRequirementMet и НЕ пиши «раздел отсутствует» только потому, что глава названа содержательно, а не канцелярски («Анализ научной литературы», «Анализ рынка»). Если раздел присутствует по смыслу под содержательным названием — считай требование выполненным. НЕ рекомендуй переименовывать разделы в канонические названия.

ОБЪЁМ РАБОТЫ:
- Поля charCountWithSpaces и volumeRequirementMet сервер заполнит сам из точного значения bodyCharCountWithSpaces — можешь вернуть их как есть, они будут перезаписаны. НЕ пересчитывай объём и не сокращай разряды чисел.
- Порог допуска: 90000 знаков с пробелами для русского / 85000 для английского (целые числа).

МЕТОДИЧЕСКИЕ МАТЕРИАЛЫ (опирайся на них при заполнении):
---
${methodology}
---

ФОРМАТ ОТВЕТА — строго JSON:
{
  "bdAudioCount": число или null,
  "bdTablesCount": число или null,
  "bdOtherCount": число или null,
  "bdCriteria": [ {"criterion": "...", "yesNo": "ДА|НЕТ|—", "comment": "..."}, ...4 пункта в фиксированном порядке... ],
  "charCountWithSpaces": число (точный body-объём — bodyCharCountWithSpaces из метаданных),
  "volumeRequirementMet": "ДА / НЕТ (комментарий с конкретным числом и порогом)",
  "structureRequirementMet": "ДА / НЕТ (какие элементы отсутствуют)",
  "citationRequirementMet": "—",
  "aiRequirementOverall": "ДА / НЕТ / Не использовалось",
  "aiCriteria": [ {"criterion": "...", "yesNo": "ДА|НЕТ|—", "comment": "..."}, ...5 пунктов в фиксированном порядке... ],
  "workCriteria": [ {"number": 1, "title": "...", "weight": "0,05", "comment": "...", "score": "8"}, ...${workCriteria.length} пунктов... ],
  "recommendedGrade": "N из 10 (ТОЛЬКО число и краткая форма, например «7 из 10» — без развёрнутого текста; для ячейки таблицы)",
  "gradeRationale": "2-4 предложения обоснования рекомендуемой оценки — этот текст выводится отдельным абзацем под таблицей, поэтому пиши развёрнуто и связно"
}

ПРАВИЛО ПО citationRequirementMet: НЕ ставь «ДА» / «НЕТ» автоматически — поставь «—». В Word-отзыве рядом будет выделенная пометка «Рекомендуется ручная проверка через систему Антиплагиат».

ФИКСИРОВАННЫЙ ПОРЯДОК bdCriteria (повтори ровно эти формулировки):
${DEFAULT_BD_CRITERIA.map((c, i) => `${i + 1}. ${c}`).join('\n')}

ФИКСИРОВАННЫЙ ПОРЯДОК aiCriteria:
${DEFAULT_AI_CRITERIA.map((c, i) => `${i + 1}. ${c}`).join('\n')}

ФИКСИРОВАННЫЙ ПОРЯДОК workCriteria (повтори title и weight БУКВАЛЬНО, заполни только comment и score):
${workCriteria.map(c => `№${c.number} (вес ${c.weight}): ${c.title}`).join('\n')}

Рекомендуемая оценка (recommendedGrade) должна согласоваться с весами и оценками по критериям: примерно sum(score_i × weight_i). Не округляй строго — оставь натуральную целую оценку. Развёрнутое пояснение помещай в gradeRationale, а не в recommendedGrade.`;

  const user = `Студент: ${studentName}
Тема работы: ${workTitle}
Тип работы: ${type === 'research' ? 'Исследовательская курсовая работа (ИКР)' : 'Курсовой проект (КП)'}

ТОЧНЫЕ МЕТАДАННЫЕ ОБЪЁМА (числа даны сырыми целыми, без разделителей разрядов — не меняй их порядок):
- bodyCharCountWithSpaces (без титульника/оглавления/списка литературы/приложений, НО со сносками): ${doc.bodyCharCountWithSpaces} знаков с пробелами
- из них сноски: ${doc.footnoteCharCount} знаков (сноски входят в тело по Программе практики)
- bodyCharCountNoSpaces: ${doc.bodyCharCountNoSpaces} знаков без пробелов
- bodyWordCount: ${doc.bodyWordCount} слов
- Объём приложений: ${doc.appendixWordCount} слов
- Распознавание границ: введение = ${doc.volumeBreakdown.introFound ? 'найдено' : 'НЕ найдено'}, список литературы = ${doc.volumeBreakdown.biblioFound ? 'найден' : 'НЕ найден'}, приложения = ${doc.volumeBreakdown.appendixFound ? 'найдено' : 'не найдено'}
- Общий объём документа (справочно): ${doc.text.length} знаков / ${doc.wordCount} слов / ~${doc.pageEstimate} стр.

ВАЖНО: поля charCountWithSpaces и volumeRequirementMet в Word-отзыве будут заполнены сервером из точного значения bodyCharCountWithSpaces (${doc.bodyCharCountWithSpaces}). Не пересчитывай и не сокращай это число.
- Найдено заголовков: ${doc.headings.length} (${doc.headings.slice(0, 30).join(' | ') || '—'})
${dbBlock}

ТЕКСТ РАБОТЫ:
---
${prepareTextForGPT(doc.text)}
---

Заполни шаблон отзыва строго по схеме выше. Верни ТОЛЬКО JSON.`;

  return { system, user };
}

export async function generateReviewFields(
  type: CourseType,
  doc: ParsedDocument,
  studentName: string,
  workTitle: string,
  dbAnalysis?: DbAnalysisResult | null,
  apiKey?: string,
): Promise<ReviewTemplateData> {
  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OpenAI API Key не указан');

  const model = process.env.OPENAI_MODEL || 'gpt-5.2';
  const openai = new OpenAI({ apiKey: key });
  const { system, user } = buildPrompt(type, doc, studentName, workTitle, dbAnalysis);

  const params: any = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_completion_tokens: 12000,
    response_format: { type: 'json_object' },
  };
  // gpt-5-nano и o-серия — без temperature
  if (!/^(o[1-9]|gpt-5-nano)/i.test(model)) {
    params.temperature = 0.2;
  }

  const completion = await openai.chat.completions.create(params);
  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error('GPT вернул пустой ответ при генерации отзыва');

  const raw = JSON.parse(content) as Partial<ReviewTemplateData>;

  // Гарантируем заполнение через фолбэки
  const workCriteriaDefault = type === 'research' ? RESEARCH_WORK_CRITERIA : PROJECT_WORK_CRITERIA;
  const bd = Array.isArray(raw.bdCriteria) ? raw.bdCriteria : [];
  const ai = Array.isArray(raw.aiCriteria) ? raw.aiCriteria : [];
  const work = Array.isArray(raw.workCriteria) ? raw.workCriteria : [];

  // Если GPT не вернул счётчики БД, но у нас есть фактические данные с Яндекс.Диска — берём из dbAnalysis
  const dbDescription = dbAnalysis?.description || '';
  const audioFromDb = (dbDescription.match(/Аудиофайлы\s*\((\d+)\)/) || [])[1];
  const tablesFromDb = (dbDescription.match(/Табличные файлы\s*\((\d+)\)/) || [])[1];
  const docsFromDb = (dbDescription.match(/Документы\s*\((\d+)\)/) || [])[1];
  const otherFromDb = (dbDescription.match(/Другие файлы\s*\((\d+)\)/) || [])[1];

  const bdAudioCount = typeof raw.bdAudioCount === 'number'
    ? raw.bdAudioCount
    : (audioFromDb ? parseInt(audioFromDb, 10) : null);
  const bdTablesCount = typeof raw.bdTablesCount === 'number'
    ? raw.bdTablesCount
    : (tablesFromDb ? parseInt(tablesFromDb, 10) : null);
  const bdOtherCount = typeof raw.bdOtherCount === 'number'
    ? raw.bdOtherCount
    : ((docsFromDb || otherFromDb)
        ? (parseInt(docsFromDb || '0', 10) + parseInt(otherFromDb || '0', 10))
        : null);

  // --- Объём и вердикт по порогу считаем ДЕТЕРМИНИРОВАННО на сервере ---
  // (баг ×10: GPT, получив локализованное «93 000» с неразрывным пробелом, ронял порядок.
  //  Поэтому charCountWithSpaces и volumeRequirementMet берём из точного серверного значения,
  //  а не из ответа модели.)
  const bodyChars = doc.bodyCharCountWithSpaces;
  const cyr = (doc.text.match(/[а-яё]/gi) || []).length;
  const lat = (doc.text.match(/[a-z]/gi) || []).length;
  const volumeThreshold = lat > cyr * 1.2 ? 85000 : 90000; // англ. порог 85 000, иначе рус. 90 000
  const fmtNum = (n: number) => n.toLocaleString('ru-RU');
  const volumeRequirementMet = bodyChars >= volumeThreshold
    ? `ДА (${fmtNum(bodyChars)} знаков с пробелами с учётом сносок, порог ${fmtNum(volumeThreshold)})`
    : `НЕТ (${fmtNum(bodyChars)} знаков с пробелами с учётом сносок, требуется не менее ${fmtNum(volumeThreshold)})`;

  return {
    studentFullName: studentName,
    workTitle,
    courseType: type,

    bdAudioCount,
    bdTablesCount,
    bdOtherCount,
    bdCriteria: DEFAULT_BD_CRITERIA.map((criterion, i) => ({
      criterion,
      yesNo: (bd[i]?.yesNo as 'ДА' | 'НЕТ' | '—') || '—',
      comment: bd[i]?.comment || '',
    })),

    charCountWithSpaces: bodyChars,
    volumeRequirementMet,
    structureRequirementMet: raw.structureRequirementMet || '—',
    citationRequirementMet: raw.citationRequirementMet || '—',
    aiRequirementOverall: raw.aiRequirementOverall || 'Не использовалось',

    aiCriteria: DEFAULT_AI_CRITERIA.map((criterion, i) => ({
      criterion,
      yesNo: (ai[i]?.yesNo as 'ДА' | 'НЕТ' | '—') || '—',
      comment: ai[i]?.comment || '',
    })),

    workCriteria: workCriteriaDefault.map((wc, i) => ({
      number: wc.number,
      title: wc.title,
      weight: wc.weight,
      comment: work[i]?.comment || '',
      score: work[i]?.score || '—',
    })),

    recommendedGrade: raw.recommendedGrade || '—',
    gradeRationale: raw.gradeRationale || '',
  };
}
