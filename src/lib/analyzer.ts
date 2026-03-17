// ============================================================
// Анализатор структуры ВКР через OpenAI GPT API
// Поддержка gpt-5.2, o3-mini, gpt-4o-mini и др.
// ============================================================

import OpenAI from 'openai';
import { WorkType, CheckItem, CheckResult } from './checklist';
import { ParsedDocument, prepareTextForGPT } from './parser';

interface GPTCheckResult {
  [checkId: string]: {
    passed: boolean;
    note: string;
  };
}

/**
 * Построение системного промпта для GPT
 */
function buildSystemPrompt(): string {
  return `Ты — система автоматической проверки структуры магистерских работ (ВКР) по чек-листу.

ПРАВИЛА:
1. Ты проверяешь ТОЛЬКО наличие и объём структурных элементов — НЕ оцениваешь качество содержания.
2. Для оценки объёма: >5 содержательных страниц ≈ >2000 слов текста в разделе (с учётом того, что страницы содержат таблицы, рисунки и т.д.).
3. Титульный лист — текст в самом начале документа с названием работы, ФИО студента, университетом.
4. Содержание — список разделов с номерами страниц.
5. Ссылка на базу данных — URL (Google Drive, Yandex Disk и т.д.) на титульном листе.
6. Список литературы — раздел с перечнем источников в конце документа.
7. Если заголовок раздела найден, но текст под ним слишком короткий (<2000 слов для >5 страниц), отметь passed: false и поясни.

ФОРМАТ ОТВЕТА — строго JSON-объект:
{
  "check_id": {
    "passed": true,
    "note": "Краткое пояснение на русском (1-2 предложения)"
  },
  ...
}

Не добавляй никакого текста вне JSON.`;
}

/**
 * Построение промпта с пунктами проверки для конкретного типа работы
 */
function buildCheckPrompt(type: WorkType, usesAI: boolean, doc: ParsedDocument): string {
  let checks = '';

  if (type === 'project') {
    checks = `
Проверяемые пункты МАГИСТЕРСКОГО ПРОЕКТА:
- title_page: Титульный лист
- db_link_title: Ссылка на базу данных на титульном листе (URL)
- pres_link: Ссылка на презентацию на титульном листе (URL)
- toc: Содержание (оглавление)
- concept_lit: Концептуальная глава — анализ литературы (>5 содержательных страниц, >2000 слов)
- concept_market: Концептуальная глава — анализ рынка (>5 содержательных страниц, >2000 слов)
- empirical: Эмпирическая глава (>5 содержательных страниц, >2000 слов)
- competitors: Анализ конкурентов (>5 содержательных страниц, >2000 слов)
- conclusion: Заключение
- bibliography: Список литературы
- appendix_tz: Приложение — ТЗ заказчика работы`;
  } else {
    checks = `
Проверяемые пункты МАГИСТЕРСКОЙ ДИССЕРТАЦИИ:
- title_page: Титульный лист
- db_link_title: Ссылка на базу данных на титульном листе (URL)
- toc: Содержание (оглавление)
- concept: Концептуальная глава (>5 содержательных страниц, >2000 слов)
- empirical: Эмпирическая глава (>5 содержательных страниц, >2000 слов)
- discussion: Обсуждение результатов (>5 содержательных страниц, >2000 слов)
- conclusion: Заключение
- bibliography: Список литературы
- mixed_method: Исследование использует смешанный/мультимодальный подход (>=2 разных метода исследования)`;
  }

  if (usesAI) {
    checks += `

Проверяемые пункты ИСПОЛЬЗОВАНИЯ ИИ:
- ai_intro: Во введении указаны используемые ИИ-сервисы, причины использования и разделы применения
- ai_section: Присутствует раздел «Описание применения генеративной модели»
- ai_citation: Корректное цитирование ИИ (указана модель, версия, запрос, скриншот ответов)
- ai_compliance: Использование ИИ не нарушает академическую честность`;
  }

  const preparedText = prepareTextForGPT(doc.text);

  // Дополнительная информация для GPT
  const meta = `
Метаданные документа:
- Количество слов: ${doc.wordCount}
- Оценка страниц: ~${doc.pageEstimate}
- Найденные заголовки: ${doc.headings.slice(0, 30).join(' | ') || 'не найдены'}`;

  return `${checks}
${meta}

ТЕКСТ ДОКУМЕНТА:
---
${preparedText}
---

Проверь каждый пункт и верни JSON.`;
}

/**
 * Определяет, какие параметры поддерживает модель
 */
function getModelParams(model: string): {
  useMaxCompletionTokens: boolean;
  supportsJsonFormat: boolean;
} {
  // Модели серии o* и gpt-5+ используют max_completion_tokens вместо max_tokens
  // и могут не поддерживать response_format
  const newStyleModels = /^(o[1-9]|gpt-5|gpt-4o)/i;
  const legacyModels = /^(gpt-4-|gpt-3)/i;

  if (legacyModels.test(model)) {
    return { useMaxCompletionTokens: false, supportsJsonFormat: true };
  }

  // gpt-4o-mini, gpt-5, gpt-5.2, o3-mini и т.д. — новый стиль
  return { useMaxCompletionTokens: true, supportsJsonFormat: true };
}

/**
 * Вызов OpenAI API для анализа документа
 */
export async function analyzeDocument(
  type: WorkType,
  usesAI: boolean,
  doc: ParsedDocument,
  apiKey?: string
): Promise<GPTCheckResult> {
  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OpenAI API Key не указан');

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const { useMaxCompletionTokens, supportsJsonFormat } = getModelParams(model);

  const openai = new OpenAI({ apiKey: key });

  // Формируем параметры запроса в зависимости от модели
  const requestParams: any = {
    model,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildCheckPrompt(type, usesAI, doc) },
    ],
    temperature: 0.1,
  };

  // max_tokens vs max_completion_tokens
  if (useMaxCompletionTokens) {
    requestParams.max_completion_tokens = 4000;
  } else {
    requestParams.max_tokens = 4000;
  }

  // JSON format
  if (supportsJsonFormat) {
    requestParams.response_format = { type: 'json_object' };
  }

  // Reasoning (для o3-mini, o1 и подобных)
  if (/^o[1-9]/i.test(model)) {
    requestParams.reasoning = { effort: 'high' };
    // o-серия не поддерживает temperature и system role
    delete requestParams.temperature;
    requestParams.messages = requestParams.messages.filter(
      (m: any) => m.role !== 'system'
    );
    // Переносим system prompt в user message
    requestParams.messages[0].content =
      buildSystemPrompt() + '\n\n' + requestParams.messages[0].content;
  }

  const completion = await openai.chat.completions.create(requestParams);

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error('GPT вернул пустой ответ');

  // Извлечение JSON (модель может обернуть в markdown блок)
  let jsonStr = content;
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  return JSON.parse(jsonStr) as GPTCheckResult;
}

/**
 * Объединение результатов GPT с чек-листом
 */
export function mergeResults(
  checklist: CheckItem[],
  gptResults: GPTCheckResult,
  dbLink: string,
): CheckResult[] {
  return checklist.map(item => {
    // Фиксированные пункты (отмечено студентом)
    if (item.fixed) {
      return { ...item, passed: true, note: 'Отмечено студентом' };
    }

    // GPT-проверяемые пункты
    const gptResult = gptResults[item.id];
    if (gptResult) {
      return { ...item, passed: gptResult.passed, note: gptResult.note || '' };
    }

    // Проверка наличия ссылки на БД
    if (item.id === 'db_opens') {
      return {
        ...item,
        passed: !!dbLink,
        note: dbLink ? 'Ссылка предоставлена — требуется ручная проверка доступности' : 'Ссылка не предоставлена',
      };
    }

    // Пункты базы данных — ручная проверка
    if (!item.auto) {
      return { ...item, passed: null, note: 'Требуется ручная проверка базы данных. Загрузите данные в формате Excel (.xlsx) для автоматической проверки.' };
    }

    return { ...item, passed: false, note: 'Не удалось проверить автоматически' };
  });
}
