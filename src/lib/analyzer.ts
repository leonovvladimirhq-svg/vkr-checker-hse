// ============================================================
// Анализатор структуры ВКР через OpenAI GPT API
// Поддержка gpt-5.2, o3-mini, gpt-4o-mini и др.
//
// Промпты разведены по образовательным программам:
//   'ik'   — ОП «Интегрированные коммуникации» (магистратура), этот файл;
//   'riso' — ОП «Реклама и связи с общественностью» (бакалавриат),
//            см. ./riso-prompt.ts.
// ============================================================

import OpenAI from 'openai';
import { ProgrammeId, WorkType, WorkLang, CheckItem, CheckResult } from './checklist';
import { ParsedDocument, prepareTextForGPT } from './parser';
import { DbAnalysisResult } from './db-analyzer';
import { buildRisoSystemPrompt, buildRisoTextChecks } from './riso-prompt';
import { VolumeAssessment, volumeNote, conceptVolumeNote } from './volume';

interface GPTCheckResult {
  [checkId: string]: {
    passed: boolean;
    note: string;
  };
}

/**
 * Построение системного промпта для GPT
 */
function buildSystemPrompt(programme: ProgrammeId): string {
  if (programme === 'riso') return buildRisoSystemPrompt();

  return `Ты — система автоматической проверки структуры магистерских работ (ВКР) по чек-листу.
Проверка основана на Методических рекомендациях ОП «Интегрированные коммуникации» НИУ ВШЭ (для набора 2024–2025 гг.).

СПРАВОЧНЫЙ КОНТЕКСТ ИЗ МЕТОДИЧЕСКИХ РЕКОМЕНДАЦИЙ (используй для более точной проверки пунктов):

ВКР бывает двух видов — магистерская диссертация (МД) и магистерский проект (МП).

МАГИСТЕРСКАЯ ДИССЕРТАЦИЯ (МД):
- Структура: Титульный лист, Содержание, Введение, минимум 3 главы (концептуальная, эмпирическая, обсуждение результатов), Заключение, Список литературы.
- Введение: обоснование выбора темы, исследовательская ценность, цель, структура. Автор отвечает: что изучаю? почему тема заслуживает изучения? какова цель?
- Концептуальная глава: литературный обзор с содержательными названиями, систематизация научной дискуссии (не пересказ), концептуальная рамка исследования, терминологический аппарат.
- Эмпирическая глава: мультимодальный/смешанный дизайн (минимум 2 метода). Обоснование дизайна, методов, операционализация, описание процедуры сбора данных, анализ и интерпретация результатов (интерпретативный, а не описательный характер).
- Обсуждение результатов: интерпретация (не повторение), связь с проблемой исследования, сопоставление с предыдущими исследованиями, ограничения, направления дальнейших исследований.
- Заключение: выводы, практические рекомендации, ограничения, перспективы.
- Базы данных: ссылка на титульном листе обязательна.

МАГИСТЕРСКИЙ ПРОЕКТ (МП):
- Состоит из текстового документа и презентации.
- Текстовый документ: Титульный лист (со ссылкой на БД и на презентацию), Содержание, Введение, минимум 3 главы (концептуальная с разделами «Анализ литературы» и «Анализ рынка», эмпирическая, анализ конкурентов), Заключение, Список литературы, Приложение с ТЗ заказчика.
- Введение: проблематика кейса заказчика, контекст бренда, целевая аудитория, цели и задачи, структура работы.
- Концептуальная глава — раздел «Анализ литературы»: обзор академических источников, систематизация научной дискуссии по теме проекта, концептуальная рамка.
- Концептуальная глава — раздел «Анализ рынка»: характеристика рынка и потребителей на основе индустриальных источников (исследования агентств, фондов и т.д.), выводы о состоянии рынка, выделение пробелов в знаниях.
- Эмпирическая глава: исследование аудитории заказчика, методы соответствуют цели проекта, интерпретативные результаты.
- Анализ конкурентов: исследование деятельности конкурентов и бенчмарков в разрезе тематики ТЗ, бренд заказчика проанализирован тем же методом, выводы о конкурентном поле.
- Заключение: результаты + план рекомендаций для презентации.
- Презентация: результаты исследования, стратегия, рекомендации для заказчика с разработанными материалами.

ОБЩИЕ ТРЕБОВАНИЯ:
- Главы и параграфы должны иметь содержательные названия (не «Глава 1. Теоретическая», не «Глава 2. Эмпирическая»).
- Каждая глава разделена на 2 и более параграфов.

ПРАВИЛА ПРОВЕРКИ:
1. Ты проверяешь НАЛИЧИЕ и ОБЪЁМ структурных элементов, используя контекст методички для понимания что ожидается в каждом элементе.
2. Для оценки объёма: >5 содержательных страниц ≈ >1500 слов текста в разделе (мягкий порог — учитывай что страницы могут содержать таблицы, рисунки, схемы).
3. Будь УМЕРЕННО строгим: если элемент присутствует но с небольшими отклонениями — ставь passed: true с пояснением. Отклоняй только при явном ОТСУТСТВИИ элемента или критически малом объёме (<500 слов для разделов, где нужно >5 страниц).
4. ВЕРИФИКАЦИЯ МЕТОДОВ ИССЛЕДОВАНИЯ: Проверь, действительно ли в тексте работы описывается использование каждого заявленного метода. Если метод заявлен студентом, но в тексте нет описания его применения (нет описания процедуры сбора данных, нет упоминания результатов этого метода) — ставь passed: false с пояснением «Метод заявлен, но в тексте не найдено описание его применения». Если студент заявил 2 метода, но текст описывает только 1 — пункт mixed_method должен быть passed: false. Студент мог выбрать «Экспертное интервью» или «Другое» (с указанием своего метода) — при верификации также проверяй наличие описания этих методов в тексте.
5. Титульный лист — текст в самом начале документа с названием работы, ФИО студента, университетом.
6. Содержание — список разделов с нумерацией.
7. Ссылка на базу данных — URL (Google Drive, Yandex Disk и т.д.) на титульном листе.
8. Список литературы — раздел с перечнем источников в конце документа.

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
function buildCheckPrompt(
  programme: ProgrammeId,
  type: WorkType,
  usesAI: boolean,
  doc: ParsedDocument,
  dbAnalysis?: DbAnalysisResult | null,
  checklist?: CheckItem[],
  lang: WorkLang = 'ru',
): string {
  let checks = '';

  if (programme === 'riso') {
    checks = buildRisoTextChecks(lang);
  } else if (type === 'project') {
    checks = `
Проверяемые пункты МАГИСТЕРСКОГО ПРОЕКТА:
- title_page: Титульный лист (название работы, ФИО студента, НИУ ВШЭ)
- db_link_title: Ссылка на базу данных на титульном листе (URL — Google Drive, Yandex Disk и т.д.). По методичке: ссылка обязательна на титульном листе.
- pres_link: Ссылка на папку с презентацией на титульном листе (URL). По методичке: МП состоит из текстового документа и презентации, ссылка на презентацию должна быть на титульном листе.
- toc: Содержание (оглавление с перечнем разделов)
- concept_lit: Концептуальная глава — раздел «Анализ литературы» (>5 содержательных страниц, >1500 слов). По методичке: обзор академических источников, систематизация научной дискуссии по теме проекта, концептуальная рамка. Автор не должен лишь пересказывать — должна быть систематизация.
- concept_market: Концептуальная глава — раздел «Анализ рынка» (>5 содержательных страниц, >1500 слов). По методичке: характеристика рынка и потребителей на основе индустриальных источников, выводы о состоянии рынка, выделение пробелов в знаниях.
- empirical: Эмпирическая глава (>5 содержательных страниц, >1500 слов). По методичке: исследование аудитории заказчика, обоснование методов, интерпретативные (не описательные) результаты.
- competitors: Анализ конкурентов (>5 содержательных страниц, >1500 слов). По методичке: исследование деятельности конкурентов и бенчмарков, бренд заказчика проанализирован тем же методом, выводы о конкурентном поле.
- conclusion: Заключение. По методичке: результаты работы и план рекомендаций для презентации.
- bibliography: Список использованных источников и литературы
- appendix_tz: Приложение с ТЗ (техническим заданием) заказчика проекта. По методичке: заполненное и утверждённое ТЗ должно быть в приложениях.`;
  } else {
    checks = `
Проверяемые пункты МАГИСТЕРСКОЙ ДИССЕРТАЦИИ:
- title_page: Титульный лист (название работы, ФИО студента, НИУ ВШЭ)
- db_link_title: Ссылка на базу данных на титульном листе (URL — Google Drive, Yandex Disk и т.д.). По методичке: ссылка обязательна на титульном листе.
- toc: Содержание (оглавление с перечнем разделов)
- concept: Концептуальная глава (>5 содержательных страниц, >1500 слов). По методичке: литературный обзор с содержательными названиями, систематизация научной дискуссии (не пересказ), выработка концептуальной рамки исследования.
- empirical: Эмпирическая глава (>5 содержательных страниц, >1500 слов). По методичке: мультимодальный/смешанный дизайн, обоснование методов, описание процедуры сбора данных, интерпретативный анализ результатов.
- discussion: Обсуждение результатов (>5 содержательных страниц, >1500 слов). По методичке: интерпретация результатов (не повторение), сопоставление с предыдущими исследованиями и теоретическими моделями, ограничения, направления дальнейших исследований.
- conclusion: Заключение. По методичке: выводы в контексте академической дискуссии, практические рекомендации, ограничения, перспективы будущих исследований.
- bibliography: Список использованных источников и литературы
- mixed_method: Исследование использует смешанный/мультимодальный подход (>=2 разных метода исследования). По методичке: эмпирическая глава МД должна быть выполнена в мультимодальном или смешанном дизайне.`;
  }

  // Пункты приложения к тексту работы (только ОП РиСО, приложение 35 пп. 2 и 6)
  if (checklist) {
    const appendixItems = checklist.filter(i => i.section === 'Приложения к тексту работы');
    if (appendixItems.length > 0) {
      checks += `

Проверяемые пункты ПРИЛОЖЕНИЙ К ТЕКСТУ РАБОТЫ (ищи их в разделе «Приложение» самой ВКР, а не в папке базы данных):`;
      for (const item of appendixItems) {
        checks += `
- ${item.id}: ${item.text}`;
      }
    }
  }

  if (usesAI) {
    checks += `

Проверяемые пункты ИСПОЛЬЗОВАНИЯ ИИ:
- ai_intro: Во введении указаны используемые ИИ-сервисы, причины использования и разделы применения
- ai_section: Присутствует раздел «Описание применения генеративной модели»
- ai_citation: Корректное цитирование ИИ (указана модель, версия, запрос, скриншот ответов)
- ai_compliance: Использование ИИ не нарушает академическую честность`;
  }

  // Пункты проверки БД (если данные получены с Яндекс.Диска)
  if (dbAnalysis?.accessible && dbAnalysis.description) {
    let dbChecks = `

Проверяемые пункты БАЗЫ ДАННЫХ (проверяй по содержимому папки Яндекс.Диска, описанному ниже):
- db_files_present: Файлы в папке БД соответствуют заявленным методам исследования. Оцени: есть ли аудиофайлы для интервью, таблицы для опросов, кодировочные таблицы и т.д. Оцени соответствие файлов заявленным методам. Если файлы частично соответствуют — ставь passed: true, но укажи что именно отсутствует. Если файлы не найдены — ставь passed: false.`;

    // Динамически добавляем все auto:true пункты из секции «База данных»
    if (checklist) {
      const dbItems = checklist.filter(item => item.auto && item.section.startsWith('База данных') && item.id !== 'db_opens' && item.id !== 'db_files_present');
      for (const item of dbItems) {
        let extra = '';
        // Пояснения для GPT о синонимах и правилах подсчёта
        if (item.id.endsWith('_qc_sheet')) {
          extra = ' ВАЖНО: «Кодировочный лист» и «Кодировочная таблица» — это синонимы. Любой xlsx/csv файл с кодировками/категориями подходит.';
        }
        if (item.id.endsWith('_int_count')) {
          extra = ' ВАЖНО: Считай аудиофайлы (.mp3, .wav и т.д.) ВО ВСЕХ подпапках, включая вложенные. Имена файлов содержат путь подпапки (напр. «Записи/interview1.mp3»). Файлы транскриптов (.docx) — это расшифровки интервью, НЕ считай их как отдельные интервью. Считай ТОЛЬКО аудиофайлы.';
        }
        if (item.id.endsWith('_fg_count')) {
          extra = ' ВАЖНО: Считай аудиофайлы (.mp3, .wav и т.д.) во всех подпапках. Файлы транскриптов (.docx) не считаются как отдельные фокус-группы.';
        }
        dbChecks += `\n- ${item.id}: ${item.text}. Проверь по списку файлов в папке БД. Если есть файлы, подходящие по названию или содержимому — ставь passed: true. Если файлы не найдены — ставь passed: false.${extra}`;
      }
    }

    checks += dbChecks;
  }

  const preparedText = prepareTextForGPT(doc.text);

  // Дополнительная информация для GPT
  let meta = `
Метаданные документа:
- Количество слов: ${doc.wordCount}
- Оценка страниц: ~${doc.pageEstimate}
- Найденные заголовки: ${doc.headings.slice(0, 30).join(' | ') || 'не найдены'}`;

  // Добавляем информацию о БД если доступна
  if (dbAnalysis?.accessible && dbAnalysis.description) {
    meta += `

СОДЕРЖИМОЕ БАЗЫ ДАННЫХ (Яндекс.Диск):
${dbAnalysis.description}`;
  }

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
  supportsTemperature: boolean;
} {
  // Модели серии o* и gpt-5+ используют max_completion_tokens вместо max_tokens
  // и могут не поддерживать response_format
  const legacyModels = /^(gpt-4-|gpt-3)/i;
  // Модели, которые не поддерживают кастомный temperature (только default=1)
  const noTemperatureModels = /^(o[1-9]|gpt-5-nano)/i;

  if (legacyModels.test(model)) {
    return { useMaxCompletionTokens: false, supportsJsonFormat: true, supportsTemperature: true };
  }

  // gpt-4o-mini, gpt-5, gpt-5.2, gpt-5-nano, o3-mini и т.д. — новый стиль
  return {
    useMaxCompletionTokens: true,
    supportsJsonFormat: true,
    supportsTemperature: !noTemperatureModels.test(model),
  };
}

/**
 * Вызов OpenAI API для анализа документа
 */
export interface AnalyzeOptions {
  programme: ProgrammeId;
  type: WorkType;
  usesAI: boolean;
  doc: ParsedDocument;
  lang?: WorkLang;
  apiKey?: string;
  dbAnalysis?: DbAnalysisResult | null;
  checklist?: CheckItem[];
}

export async function analyzeDocument(opts: AnalyzeOptions): Promise<GPTCheckResult> {
  const { programme, type, usesAI, doc, apiKey, dbAnalysis, checklist } = opts;
  const lang: WorkLang = opts.lang || 'ru';
  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OpenAI API Key не указан');

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const { useMaxCompletionTokens, supportsJsonFormat, supportsTemperature } = getModelParams(model);

  const openai = new OpenAI({ apiKey: key });

  // Формируем параметры запроса в зависимости от модели
  const requestParams: any = {
    model,
    messages: [
      { role: 'system', content: buildSystemPrompt(programme) },
      { role: 'user', content: buildCheckPrompt(programme, type, usesAI, doc, dbAnalysis, checklist, lang) },
    ],
    ...(supportsTemperature ? { temperature: 0.1 } : {}),
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
      buildSystemPrompt(programme) + '\n\n' + requestParams.messages[0].content;
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
export interface MergeOptions {
  checklist: CheckItem[];
  gptResults: GPTCheckResult;
  dbLink: string;
  dbAnalysis?: DbAnalysisResult | null;
  presLink?: string;
  /** Детерминированный подсчёт объёма (ОП РиСО). GPT к нему не допускается. */
  volume?: VolumeAssessment | null;
  /** Минимальная длительность аудио/видеозаписей по регламенту программы. */
  mediaMinMinutes?: number;
}

export function mergeResults(opts: MergeOptions): CheckResult[] {
  const { checklist, gptResults, dbLink, dbAnalysis, presLink, volume } = opts;

  return checklist.map(item => {
    // Фиксированные пункты (отмечено студентом)
    if (item.fixed) {
      return { ...item, passed: true, note: 'Отмечено студентом' };
    }

    // Объём работы — считается программно, ответ GPT игнорируется полностью.
    if (item.id === 'volume_total') {
      if (!volume) return { ...item, passed: null, note: 'Объём не рассчитан' };
      return { ...item, passed: volume.passed, note: volumeNote(volume) };
    }
    if (item.id === 'volume_concept') {
      if (!volume) return { ...item, passed: null, note: 'Объём не рассчитан' };
      return { ...item, passed: volume.conceptPassed, note: conceptVolumeNote(volume) };
    }

    // Продолжительность записей: точную длительность публичный API Яндекс.Диска
    // не отдаёт, поэтому пункт остаётся ручным — но преподавателю показываем
    // ориентировочную оценку по размеру файлов, чтобы не слушать каждую запись.
    if (item.id.endsWith('_duration')) {
      return { ...item, passed: null, note: mediaDurationNote(dbAnalysis, opts.mediaMinMinutes) };
    }

    // Ссылка на презентацию: содержание невозможно проверить автоматически
    if (item.id === 'pres_link') {
      const gptResult = gptResults[item.id];
      const hasLinkInDoc = gptResult?.passed;
      const hasLinkInForm = presLink && presLink.trim();

      if (hasLinkInDoc || hasLinkInForm) {
        // Ссылка есть, но содержание требует ручной проверки
        const source = hasLinkInDoc ? 'найдена в документе' : 'указана студентом в форме';
        return { ...item, passed: null, note: `Ссылка ${source}. Содержание требует проверки преподавателем` };
      }
      return { ...item, passed: false, note: 'Ссылка на презентацию не найдена ни в документе, ни в форме' };
    }

    // Проверка доступности БД по ссылке
    if (item.id === 'db_opens') {
      if (!dbLink) {
        return { ...item, passed: false, note: 'Ссылка на базу данных не предоставлена' };
      }
      if (dbAnalysis) {
        if (dbAnalysis.accessible) {
          return { ...item, passed: true, note: `Ссылка доступна. Найдено файлов: ${dbAnalysis.fileCount}` };
        } else {
          return { ...item, passed: false, note: dbAnalysis.error || 'Ссылка недоступна' };
        }
      }
      return { ...item, passed: null, note: 'Ссылка предоставлена — не удалось проверить автоматически' };
    }

    // Проверка файлов БД через GPT
    if (item.id === 'db_files_present') {
      // Если GPT проверил этот пункт
      const gptResult = gptResults[item.id];
      if (gptResult) {
        return { ...item, passed: gptResult.passed, note: gptResult.note || '' };
      }
      // Если БД недоступна или не анализировалась
      if (!dbAnalysis?.accessible) {
        return { ...item, passed: null, note: 'Требуется ручная проверка — не удалось получить данные с Яндекс.Диска' };
      }
      return { ...item, passed: null, note: 'Не удалось проверить автоматически' };
    }

    // GPT-проверяемые пункты
    const gptResult = gptResults[item.id];
    if (gptResult) {
      // Необязательные пункты («не обязательно» в регламенте) не могут дать «незачёт»:
      // невыполнение отражаем как замечание для преподавателя, а не как провал.
      if (item.optional && gptResult.passed === false) {
        return { ...item, passed: null, note: `Не обнаружено (по регламенту не обязательно). ${gptResult.note || ''}`.trim() };
      }
      return { ...item, passed: gptResult.passed, note: gptResult.note || '' };
    }

    // Пункты базы данных — ручная проверка
    if (!item.auto) {
      return { ...item, passed: null, note: 'Требуется ручная проверка' };
    }

    // auto:true пункты БД, но GPT не ответил
    if (item.section.startsWith('База данных')) {
      if (!dbAnalysis?.accessible) {
        return { ...item, passed: null, note: 'Требуется ручная проверка — не удалось получить данные с Яндекс.Диска' };
      }
      return { ...item, passed: null, note: 'Не удалось проверить автоматически' };
    }

    return { ...item, passed: false, note: 'Не удалось проверить автоматически' };
  });
}

/**
 * Пояснение к пунктам продолжительности аудио/видеозаписей.
 *
 * Публичный API Яндекс.Диска не возвращает длительность медиафайлов, а сами
 * файлы (сотни мегабайт) сервис принципиально не скачивает. Поэтому пункт
 * остаётся ручным, но преподаватель получает ориентировочную оценку по размеру
 * файла — этого достаточно, чтобы увидеть заведомо короткие записи и не
 * прослушивать все подряд. Оценка явно помечена как оценка.
 */
function mediaDurationNote(
  dbAnalysis: DbAnalysisResult | null | undefined,
  minMinutes?: number,
): string {
  const stats = dbAnalysis?.stats;
  if (!stats || stats.mediaFiles.length === 0) {
    return 'Требуется ручная проверка — аудио/видеофайлы в базе данных не обнаружены или БД недоступна';
  }

  const estimated = stats.mediaFiles.filter(m => m.estMinutes !== null);
  if (estimated.length === 0) {
    return `Требуется ручная проверка: ${stats.mediaFiles.length} медиафайл(ов), длительность по размеру не оценивается (видеоформаты)`;
  }

  const threshold = minMinutes ?? 0;
  const short = estimated.filter(m => (m.estMinutes as number) < threshold);
  const durations = estimated.map(m => `${m.name} ≈ ${m.estMinutes} мин`).join('; ');

  const head = short.length > 0
    ? `Требуется ручная проверка. Ориентировочно короче ${threshold} мин: ${short.length} из ${estimated.length} файл(ов).`
    : `Требуется ручная проверка. Все ${estimated.length} файл(ов) ориентировочно дольше ${threshold} мин.`;

  return `${head} Оценка по размеру файла (не измерение): ${durations}`;
}
