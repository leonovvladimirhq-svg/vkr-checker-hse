// ============================================================
// Конфигурация образовательных программ
//
// Единая точка правды о том, чем отличаются программы друг от друга:
// какие типы работ, какие методы исследования, нужна ли презентация,
// какие пороги объёма. Используется и фронтендом (форма студента),
// и бэкендом (валидация в /api/check).
//
// Добавление новой программы = добавление ещё одной записи в PROGRAMMES
// + ветка в getChecklist() и buildSystemPrompt().
// ============================================================

import {
  ProgrammeId,
  WorkType,
  WorkLang,
  ResearchMethod,
  RISO_VOLUME_THRESHOLDS,
  RISO_CONCEPT_MIN_CHARS,
  RISO_MEDIA_MIN_MINUTES,
  IK_MEDIA_MIN_MINUTES,
} from './checklist';

export interface Option<T extends string> {
  value: T;
  label: string;
}

export interface ProgrammeConfig {
  id: ProgrammeId;
  /** Полное название программы — для селектора и шапки отчёта. */
  label: string;
  /** Короткая метка для таблиц преподавателя. */
  shortLabel: string;
  /** Уровень образования — для текстов интерфейса. */
  level: string;
  /** Пояснение под селектором программы. */
  hint: string;
  /** Типы работ, доступные студенту этой программы. */
  workTypes: Option<WorkType>[];
  /** Методы эмпирической части. */
  methods: Option<ResearchMethod>[];
  /** Методы блока «Анализ конкурентов» (пусто = блока нет). */
  competitorMethods: Option<string>[];
  /** Нужна ли ссылка на презентацию (вторая часть проекта). */
  requiresPresentation: (type: WorkType) => boolean;
  /** Минимальное число методов эмпирической части. */
  minMethods: (type: WorkType) => number;
  /** Выбор языка работы (влияет на порог объёма). */
  hasLangChoice: boolean;
  /** Пороги объёма тела работы в знаках. null = объём не проверяется. */
  volumeThresholds: Record<WorkLang, number> | null;
  /** Требование к объёму концептуальной части, знаков. null = не проверяется. */
  conceptMinChars: number | null;
  /** Минимальная продолжительность аудио/видеозаписей, минут. */
  mediaMinMinutes: number;
}

const IK_METHODS: Option<ResearchMethod>[] = [
  { value: 'interviews', label: 'Глубинные интервью' },
  { value: 'focus_groups', label: 'Фокус-группы' },
  { value: 'text_analysis', label: 'Методы анализа текстов (контент-анализ, дискурс-анализ и др.)' },
  { value: 'survey', label: 'Опрос' },
  { value: 'quant_content', label: 'Количественный контент-анализ' },
  { value: 'monitoring', label: 'Мониторинговый анализ' },
  { value: 'expert_interview', label: 'Экспертное интервью' },
  { value: 'other', label: 'Другое' },
];

const RISO_METHODS: Option<ResearchMethod>[] = [
  { value: 'interviews', label: 'Глубинные интервью' },
  { value: 'focus_groups', label: 'Фокус-группы' },
  { value: 'survey', label: 'Опрос' },
  { value: 'text_analysis', label: 'Методы анализа текстов (контент-анализ, дискурс-анализ, фрейм-анализ и др.)' },
  { value: 'quant_content', label: 'Количественный контент-анализ' },
  { value: 'monitoring', label: 'Мониторинговый / информационно-аналитический анализ (Медиалогия, Brand Analytics и т.п.)' },
  { value: 'experiment', label: 'Эксперимент' },
  { value: 'ethnography', label: 'Этнографическое исследование (наблюдение, кейс-стади, нетнография)' },
  { value: 'expert_interview', label: 'Экспертное интервью' },
  { value: 'other', label: 'Другое' },
];

export const PROGRAMMES: Record<ProgrammeId, ProgrammeConfig> = {
  ik: {
    id: 'ik',
    label: 'Интегрированные коммуникации',
    shortLabel: 'ИК',
    level: 'магистратура',
    hint: 'Магистерская программа Школы коммуникаций. ВКР — магистерский проект или магистерская диссертация.',
    workTypes: [
      { value: 'project', label: 'Магистерский проект' },
      { value: 'dissertation', label: 'Магистерская диссертация' },
    ],
    methods: IK_METHODS,
    competitorMethods: [
      { value: 'text_analysis_comp', label: 'Другие методы анализа текста' },
      { value: 'quant_content_comp', label: 'Количественный контент-анализ' },
      { value: 'expert_interview_comp', label: 'Экспертное интервью' },
      { value: 'other_comp', label: 'Другое' },
    ],
    requiresPresentation: (type) => type === 'project',
    minMethods: (type) => (type === 'dissertation' ? 2 : 1),
    hasLangChoice: false,
    volumeThresholds: null,
    conceptMinChars: null,
    mediaMinMinutes: IK_MEDIA_MIN_MINUTES,
  },

  riso: {
    id: 'riso',
    label: 'Реклама и связи с общественностью',
    shortLabel: 'РиСО',
    level: 'бакалавриат',
    hint: 'Программа бакалавриата Школы коммуникаций. ВКР выполняется в академическом формате — исследование. Презентация и анализ конкурентов не требуются.',
    workTypes: [
      { value: 'riso_thesis', label: 'Выпускная квалификационная работа (бакалаврская, академический формат)' },
    ],
    methods: RISO_METHODS,
    competitorMethods: [],
    requiresPresentation: () => false,
    minMethods: () => 1,
    hasLangChoice: true,
    volumeThresholds: RISO_VOLUME_THRESHOLDS,
    conceptMinChars: RISO_CONCEPT_MIN_CHARS,
    mediaMinMinutes: RISO_MEDIA_MIN_MINUTES,
  },
};

export const DEFAULT_PROGRAMME: ProgrammeId = 'ik';

export function isProgrammeId(v: unknown): v is ProgrammeId {
  return v === 'ik' || v === 'riso';
}

export function getProgramme(id: string | null | undefined): ProgrammeConfig {
  return isProgrammeId(id) ? PROGRAMMES[id] : PROGRAMMES[DEFAULT_PROGRAMME];
}

/**
 * Программа, к которой относится тип работы.
 * Нужна для старых записей в БД, где колонки `programme` ещё не было.
 */
export function programmeForWorkType(workType: string): ProgrammeId {
  return workType === 'riso_thesis' ? 'riso' : 'ik';
}

/** Человекочитаемое название типа работы (используется на всех страницах). */
export function workTypeLabel(workType: string): string {
  switch (workType) {
    case 'project': return 'Магистерский проект';
    case 'dissertation': return 'Магистерская диссертация';
    case 'riso_thesis': return 'Бакалаврская ВКР (РиСО)';
    default: return workType;
  }
}

/** Короткая метка типа работы для сводной таблицы преподавателя. */
export function workTypeShortLabel(workType: string): string {
  switch (workType) {
    case 'project': return 'Проект';
    case 'dissertation': return 'Диссертация';
    case 'riso_thesis': return 'ВКР (бакалавриат)';
    default: return workType;
  }
}

export function isValidWorkType(programme: ProgrammeId, workType: string): boolean {
  return PROGRAMMES[programme].workTypes.some(w => w.value === workType);
}
