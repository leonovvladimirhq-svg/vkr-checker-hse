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
): { system: string; user: string } {
  const methodology = getMethodologyForCourse(type);
  const workCriteria = type === 'research' ? RESEARCH_WORK_CRITERIA : PROJECT_WORK_CRITERIA;
  const charCount = doc.text.length;

  const system = `Ты — опытный научный руководитель ОП «Интегрированные коммуникации» НИУ ВШЭ. Тебе поручено заполнить официальный шаблон отзыва на ${type === 'research' ? 'исследовательскую курсовую работу' : 'курсовой проект'} студента.

Соблюдай:
- Строгое соответствие шаблону Приложения 20.${type === 'research' ? '1' : '2'} Программы практики 2025.
- Уважительный, конструктивный тон. Никаких категоричных и демотивирующих формулировок.
- Не выдумывай факты о работе — опирайся только на присланный текст.
- В каждом «Содержательный комментарий по критерию» дай ОБОСНОВАННУЮ оценку (1–3 предложения): что есть в работе по этому критерию, что выполнено хорошо, что стоит усилить.
- Оценка по критерию — целое число от 0 до 10 (или «—», если критерий категорически не применим).

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
  "charCountWithSpaces": число (можно взять из метаданных),
  "volumeRequirementMet": "ДА / НЕТ (комментарий)",
  "structureRequirementMet": "ДА / НЕТ (какие элементы отсутствуют)",
  "citationRequirementMet": "ДА / НЕТ / Не проверялось",
  "aiRequirementOverall": "ДА / НЕТ / Не использовалось",
  "aiCriteria": [ {"criterion": "...", "yesNo": "ДА|НЕТ|—", "comment": "..."}, ...5 пунктов в фиксированном порядке... ],
  "workCriteria": [ {"number": 1, "title": "...", "weight": "0,05", "comment": "...", "score": "8"}, ...${workCriteria.length} пунктов... ],
  "recommendedGrade": "N из 10 (краткое обоснование)"
}

ФИКСИРОВАННЫЙ ПОРЯДОК bdCriteria (повтори ровно эти формулировки):
${DEFAULT_BD_CRITERIA.map((c, i) => `${i + 1}. ${c}`).join('\n')}

ФИКСИРОВАННЫЙ ПОРЯДОК aiCriteria:
${DEFAULT_AI_CRITERIA.map((c, i) => `${i + 1}. ${c}`).join('\n')}

ФИКСИРОВАННЫЙ ПОРЯДОК workCriteria (повтори title и weight БУКВАЛЬНО, заполни только comment и score):
${workCriteria.map(c => `№${c.number} (вес ${c.weight}): ${c.title}`).join('\n')}

Рекомендуемая оценка должна согласоваться с весами и оценками по критериям: примерно sum(score_i × weight_i). Не округляй строго — оставь натуральную целую оценку с пояснением.`;

  const user = `Студент: ${studentName}
Тема работы: ${workTitle}
Тип работы: ${type === 'research' ? 'Исследовательская курсовая работа (ИКР)' : 'Курсовой проект (КП)'}

Метаданные документа:
- Общий объём (включая всё): ${charCount.toLocaleString('ru-RU')} знаков с пробелами
- Слов: ${doc.wordCount.toLocaleString('ru-RU')}
- Страниц (оценка): ~${doc.pageEstimate}
- Найдено заголовков: ${doc.headings.length} (${doc.headings.slice(0, 30).join(' | ') || '—'})

ТЕКСТ РАБОТЫ:
---
${prepareTextForGPT(doc.text, 60000)}
---

Заполни шаблон отзыва строго по схеме выше. Верни ТОЛЬКО JSON.`;

  return { system, user };
}

export async function generateReviewFields(
  type: CourseType,
  doc: ParsedDocument,
  studentName: string,
  workTitle: string,
  apiKey?: string,
): Promise<ReviewTemplateData> {
  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OpenAI API Key не указан');

  const model = process.env.OPENAI_MODEL || 'gpt-5.2';
  const openai = new OpenAI({ apiKey: key });
  const { system, user } = buildPrompt(type, doc, studentName, workTitle);

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

  return {
    studentFullName: studentName,
    workTitle,
    courseType: type,

    bdAudioCount: typeof raw.bdAudioCount === 'number' ? raw.bdAudioCount : null,
    bdTablesCount: typeof raw.bdTablesCount === 'number' ? raw.bdTablesCount : null,
    bdOtherCount: typeof raw.bdOtherCount === 'number' ? raw.bdOtherCount : null,
    bdCriteria: DEFAULT_BD_CRITERIA.map((criterion, i) => ({
      criterion,
      yesNo: (bd[i]?.yesNo as 'ДА' | 'НЕТ' | '—') || '—',
      comment: bd[i]?.comment || '',
    })),

    charCountWithSpaces: typeof raw.charCountWithSpaces === 'number'
      ? raw.charCountWithSpaces
      : doc.text.length,
    volumeRequirementMet: raw.volumeRequirementMet || '—',
    structureRequirementMet: raw.structureRequirementMet || '—',
    citationRequirementMet: raw.citationRequirementMet || 'Не проверялось',
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
  };
}
