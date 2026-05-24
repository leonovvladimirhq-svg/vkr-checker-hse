'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { saveAuth, readAuth, clearAuth } from '@/lib/authCache';

// ---------- Типы (зеркалят CourseAnalysisResult из server) ----------

type SectionVerdict = 'ok' | 'too_short' | 'too_long' | 'missing';

interface SectionAnalysis {
  section: string;
  present: boolean;
  wordCount: number | null;
  verdict: SectionVerdict;
  comment: string;
}

type RecommendationCategory =
  | 'structure'
  | 'content'
  | 'logic'
  | 'text_quality'
  | 'formatting';

interface Recommendation {
  category: RecommendationCategory;
  section: string | null;
  issue: string;
  suggestion: string;
}

interface CourseAnalysisResult {
  overallSummary: string;
  structuralAnalysis: {
    expectedSections: string[];
    missingSections: string[];
    extraSections: string[];
    sections: SectionAnalysis[];
  };
  logicAndCoherence: { issues: string[]; strengths: string[] };
  textQuality: { issues: string[]; strengths: string[] };
  recommendations: Recommendation[];
  priorityAdvice: string[];
  readinessStatus: 'ready_for_credit' | 'almost_there' | 'right_direction' | 'fix_then_defend' | 'critical_issues';
  readinessStatusText: string;
  errorClassification: { structural: number; content: number; formatting: number; ai_usage: number; other: number };
  disclaimer: string;
}

interface CourseCheckResponse {
  attemptId: number;
  attemptNumber: number;
  studentName: string;
  courseType: 'research' | 'project';
  workTitle: string;
  documentInfo: {
    fileName: string;
    wordCount: number;
    pageEstimate: number;
    headingsFound: number;
  };
  analysis: CourseAnalysisResult;
  error?: string;
}

const READINESS_STYLES: Record<CourseAnalysisResult['readinessStatus'], { bg: string; border: string; text: string; emoji: string }> = {
  ready_for_credit: { bg: 'bg-emerald-50', border: 'border-emerald-500', text: 'text-emerald-800', emoji: '✓' },
  almost_there:     { bg: 'bg-lime-50',    border: 'border-lime-500',    text: 'text-lime-800',    emoji: '🌱' },
  right_direction:  { bg: 'bg-yellow-50',  border: 'border-yellow-500',  text: 'text-yellow-800',  emoji: '🧭' },
  fix_then_defend:  { bg: 'bg-amber-50',   border: 'border-amber-500',   text: 'text-amber-800',   emoji: '⚒️' },
  critical_issues:  { bg: 'bg-red-50',     border: 'border-red-500',     text: 'text-red-800',     emoji: '⚠️' },
};

const CATEGORY_LABELS: Record<RecommendationCategory, string> = {
  structure: 'Структура',
  content: 'Содержание',
  logic: 'Логика',
  text_quality: 'Качество текста',
  formatting: 'Оформление',
};

const VERDICT_STYLES: Record<SectionVerdict, { label: string; cls: string }> = {
  ok: { label: 'OK', cls: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
  too_short: { label: 'Слишком коротко', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  too_long: { label: 'Слишком объёмно', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  missing: { label: 'Отсутствует', cls: 'bg-red-100 text-red-700 border-red-300' },
};

export default function CoursePage() {
  // --- Авторизация ---
  const [authenticated, setAuthenticated] = useState(false);
  const [loginInput, setLoginInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState('');

  // --- Форма ---
  const [studentName, setStudentName] = useState('');
  const [workTitle, setWorkTitle] = useState('');
  const [courseType, setCourseType] = useState<'research' | 'project' | ''>('');
  const [file, setFile] = useState<File | null>(null);

  // --- Отправка преподавателю ---
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // --- Состояние проверки ---
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [result, setResult] = useState<CourseCheckResponse | null>(null);
  const [error, setError] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<RecommendationCategory | 'all'>('all');

  useEffect(() => {
    if (readAuth('student')) setAuthenticated(true);
  }, []);

  const handleLogin = () => {
    if (loginInput === 'student' && passwordInput === 'hse2025') {
      setAuthenticated(true);
      setLoginError('');
      saveAuth('student');
    } else {
      setLoginError('Неверный логин или пароль');
    }
  };

  const handleLogout = () => {
    clearAuth('student');
    setAuthenticated(false);
    setLoginInput('');
    setPasswordInput('');
  };

  // --- Валидация ---
  const nameWords = studentName.trim().split(/\s+/).filter(Boolean).length;
  const isFormValid = nameWords >= 2 && !!courseType && !!file && workTitle.trim().length >= 5;

  // --- Файл ---
  const handleFile = useCallback((f: File) => {
    const ext = f.name.split('.').pop()?.toLowerCase();
    if (ext !== 'docx' && ext !== 'pdf') {
      setError('Поддерживаются только файлы .docx и .pdf');
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      setError('Файл слишком большой (максимум 50 МБ)');
      return;
    }
    setFile(f);
    setError('');
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  }, [handleFile]);

  // --- Submit ---
  const handleSubmit = async () => {
    if (!isFormValid || !file || !courseType) return;

    setLoading(true);
    setError('');
    setLoadingProgress(10);
    setLoadingStatus('Загрузка файла на сервер...');

    try {
      const formData = new FormData();
      formData.append('studentName', studentName.trim());
      formData.append('workTitle', workTitle.trim());
      formData.append('courseType', courseType);
      formData.append('file', file);

      setLoadingProgress(30);
      setLoadingStatus('Извлечение текста...');
      await new Promise(r => setTimeout(r, 100));

      setLoadingProgress(55);
      setLoadingStatus('Анализ работы научным руководителем...');

      const res = await fetch('/api/course/check', { method: 'POST', body: formData });

      setLoadingProgress(90);
      setLoadingStatus('Формирование рекомендаций...');

      const data: CourseCheckResponse = await res.json();
      if (!res.ok) throw new Error(data.error || `Ошибка сервера: ${res.status}`);

      setLoadingProgress(100);
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Произошла ошибка при анализе');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setResult(null);
    setFile(null);
    setError('');
    setCategoryFilter('all');
    setSubmitted(false);
    setSubmitError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const exportPDF = () => window.print();

  // --- Отправка работы преподавателю ---
  const handleSubmitToTeacher = async () => {
    if (!result || !file) {
      setSubmitError('Файл работы недоступен. Загрузите работу заново.');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      const fd = new FormData();
      fd.append('attemptId', String(result.attemptId));
      fd.append('workTitle', result.workTitle || workTitle.trim());
      fd.append('file', file);
      const res = await fetch('/api/course/submit', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка отправки');
      setSubmitted(true);
    } catch (err: any) {
      setSubmitError(err.message || 'Не удалось отправить работу преподавателю');
    } finally {
      setSubmitting(false);
    }
  };

  // ====================== RENDER ======================

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Header />
        <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 120px)' }}>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 w-full max-w-sm">
            <h2 className="text-lg font-bold text-blue-800 mb-1">Вход в систему</h2>
            <p className="text-xs text-slate-500 mb-5">Введите логин и пароль для доступа</p>
            {loginError && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
                {loginError}
              </div>
            )}
            <div className="mb-4">
              <label className="block text-sm font-semibold mb-1.5">Логин</label>
              <input type="text" value={loginInput} onChange={e => setLoginInput(e.target.value)}
                placeholder="Введите логин"
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
            </div>
            <div className="mb-5">
              <label className="block text-sm font-semibold mb-1.5">Пароль</label>
              <input type="password" value={passwordInput} onChange={e => setPasswordInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                placeholder="Введите пароль"
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
            </div>
            <button onClick={handleLogin}
              className="w-full px-5 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition">
              Войти
            </button>
          </div>
        </div>
        <footer className="max-w-3xl mx-auto px-6 py-4 text-center">
          <p className="text-xs text-slate-400">
            Продолжая работу с приложением, вы подтверждаете своё согласие на обработку персональных данных
          </p>
        </footer>
      </div>
    );
  }

  if (result) {
    const a = result.analysis;
    const filteredRecs =
      categoryFilter === 'all'
        ? a.recommendations
        : a.recommendations.filter(r => r.category === categoryFilter);

    return (
      <div className="min-h-screen bg-slate-50">
        <Header onLogout={handleLogout} />
        <main className="max-w-3xl mx-auto px-6 py-8">

          {/* Шапка результата */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 mb-6">
            <div className="flex justify-between items-start flex-wrap gap-4 mb-4">
              <div>
                <h2 className="text-lg font-bold text-blue-800">Разбор курсовой работы</h2>
                <p className="text-sm text-slate-500 mt-1">
                  {result.studentName} &middot;{' '}
                  {result.courseType === 'research'
                    ? 'Исследовательская курсовая'
                    : 'Курсовой проект'}{' '}
                  &middot; Попытка №{result.attemptNumber}
                </p>
                {result.workTitle && (
                  <p className="text-sm text-slate-700 mt-1.5"><span className="font-semibold">Тема:</span> {result.workTitle}</p>
                )}
              </div>
              <div className="px-5 py-2 rounded-lg text-sm font-semibold bg-blue-50 text-blue-700 border-2 border-blue-300">
                Разбор работы
              </div>
            </div>

            <div className="bg-amber-50 border-2 border-amber-400 rounded-xl px-5 py-3 mt-3 mb-1 flex items-start gap-3">
              <span className="text-amber-500 text-xl flex-shrink-0">⚠️</span>
              <p className="text-sm font-semibold text-amber-800">{a.disclaimer}</p>
            </div>

            <div className="bg-slate-50 rounded-lg p-3 mt-4 text-xs text-slate-600">
              <span className="font-semibold">Документ:</span> {result.documentInfo.fileName}
              {' '}&middot;{' '}{result.documentInfo.wordCount.toLocaleString()} слов
              {' '}&middot;{' '}~{result.documentInfo.pageEstimate} стр.
              {' '}&middot;{' '}{result.documentInfo.headingsFound} заголовков
            </div>
          </div>

          {/* Готовность к зачёту */}
          {a.readinessStatusText && (() => {
            const style = READINESS_STYLES[a.readinessStatus] || READINESS_STYLES.right_direction;
            return (
              <div className={`rounded-xl border-2 p-5 mb-6 ${style.bg} ${style.border}`}>
                <div className="flex items-start gap-4">
                  <div className="text-3xl flex-shrink-0">{style.emoji}</div>
                  <div className="flex-1">
                    <div className={`text-xs uppercase tracking-wide font-semibold ${style.text} opacity-80 mb-1`}>
                      Общая оценка готовности к зачёту
                    </div>
                    <div className={`text-xl font-bold ${style.text}`}>{a.readinessStatusText}</div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Приоритетные рекомендации (без лимита) */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 mb-6">
            <h3 className="text-lg font-bold text-blue-800 mb-4">
              🎯 Приоритетные рекомендации
            </h3>
            <ol className="space-y-3">
              {a.priorityAdvice.map((tip, i) => (
                <li key={i} className="flex gap-3 items-start bg-blue-50 rounded-lg px-4 py-3 border border-blue-100">
                  <span className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-sm">
                    {i + 1}
                  </span>
                  <span className="text-sm text-slate-800 leading-relaxed">{tip}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Общая оценка */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 mb-6">
            <h3 className="text-base font-bold text-blue-800 mb-3">Общая оценка</h3>
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
              {a.overallSummary}
            </p>
          </div>

          {/* Структура работы */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 mb-6">
            <h3 className="text-base font-bold text-blue-800 mb-3">Структура работы</h3>

            {a.structuralAnalysis.missingSections.length > 0 && (
              <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-700">
                <span className="font-semibold">Отсутствующие разделы:</span>{' '}
                {a.structuralAnalysis.missingSections.join(', ')}
              </div>
            )}

            {a.structuralAnalysis.extraSections.length > 0 && (
              <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-sm text-amber-800">
                <span className="font-semibold">Шаблонные/несодержательные названия:</span>{' '}
                {a.structuralAnalysis.extraSections.join(', ')}
              </div>
            )}

            <div className="space-y-2">
              {a.structuralAnalysis.sections.map((s, i) => {
                const v = VERDICT_STYLES[s.verdict] || VERDICT_STYLES.ok;
                return (
                  <div key={i} className="border border-slate-200 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
                      <div className="font-semibold text-sm text-slate-800">{s.section}</div>
                      <div className="flex gap-2 items-center text-xs">
                        {s.wordCount != null && (
                          <span className="text-slate-500">{s.wordCount.toLocaleString()} слов</span>
                        )}
                        <span className={`px-2 py-0.5 rounded-md border ${v.cls} font-semibold`}>
                          {v.label}
                        </span>
                      </div>
                    </div>
                    {s.comment && (
                      <p className="text-sm text-slate-600 mt-1 leading-relaxed">{s.comment}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Логика и связность */}
          <DualBlock
            title="Логика и связность"
            issues={a.logicAndCoherence.issues}
            strengths={a.logicAndCoherence.strengths}
          />

          {/* Качество текста */}
          <DualBlock
            title="Качество текста"
            issues={a.textQuality.issues}
            strengths={a.textQuality.strengths}
          />

          {/* Расширенные рекомендации */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 mb-6">
            <h3 className="text-base font-bold text-blue-800 mb-3">Все рекомендации</h3>

            <div className="flex flex-wrap gap-2 mb-4 print:hidden">
              <FilterPill active={categoryFilter === 'all'} onClick={() => setCategoryFilter('all')}>
                Все ({a.recommendations.length})
              </FilterPill>
              {(Object.keys(CATEGORY_LABELS) as RecommendationCategory[]).map(c => {
                const count = a.recommendations.filter(r => r.category === c).length;
                if (count === 0) return null;
                return (
                  <FilterPill key={c} active={categoryFilter === c} onClick={() => setCategoryFilter(c)}>
                    {CATEGORY_LABELS[c]} ({count})
                  </FilterPill>
                );
              })}
            </div>

            {filteredRecs.length === 0 ? (
              <p className="text-sm text-slate-500">Нет рекомендаций в этой категории.</p>
            ) : (
              <div className="space-y-3">
                {filteredRecs.map((r, i) => (
                  <div key={i} className="border border-slate-200 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-semibold">
                        {CATEGORY_LABELS[r.category] || r.category}
                      </span>
                      {r.section && (
                        <span className="text-xs text-slate-500">· {r.section}</span>
                      )}
                    </div>
                    <div className="text-sm font-medium text-slate-800 mb-1">{r.issue}</div>
                    <div className="text-sm text-slate-600 leading-relaxed">{r.suggestion}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Блок отправки преподавателю */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 mb-6 print:hidden">
            <h3 className="text-base font-bold text-blue-800 mb-2">Готовы отправить работу преподавателю?</h3>
            <p className="text-sm text-slate-600 mb-4">
              После отправки работа появится в панели преподавателя — вместе с файлом, результатами анализа,
              рекомендациями и итоговым статусом. Вы можете доработать работу и отправить её снова — каждая
              отправка сохраняется как отдельная версия.
            </p>
            {submitError && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2.5 mb-3 text-sm">
                {submitError}
              </div>
            )}
            {submitted ? (
              <div className="bg-emerald-50 border-2 border-emerald-400 text-emerald-800 rounded-lg px-4 py-3 text-sm font-semibold">
                ✓ Работа отправлена преподавателю
              </div>
            ) : (
              <button
                onClick={handleSubmitToTeacher}
                disabled={submitting}
                className="px-6 py-3 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-slate-300 transition"
              >
                {submitting ? 'Отправляем…' : '📤 Отправить работу преподавателю'}
              </button>
            )}
          </div>

          {/* Оверлей при отправке */}
          {submitting && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
              <div className="bg-white rounded-xl p-10 text-center max-w-sm shadow-xl">
                <div className="w-12 h-12 border-4 border-slate-200 border-t-emerald-600 rounded-full animate-spin mx-auto mb-4" />
                <div className="font-semibold text-slate-800 mb-1">Отправляем работу преподавателю…</div>
                <div className="text-xs text-red-600 font-medium">Не закрывайте страницу!</div>
              </div>
            </div>
          )}

          {/* Кнопки */}
          <div className="flex gap-3 justify-end mt-6 print:hidden">
            <button onClick={exportPDF}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-slate-100 hover:bg-slate-200 border border-slate-200">
              Скачать PDF
            </button>
            <button onClick={resetForm}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700">
              Загрузить ещё раз
            </button>
          </div>

        </main>
        <footer className="max-w-3xl mx-auto px-6 py-4 text-center">
          <p className="text-xs text-slate-400">
            Продолжая работу с приложением, вы подтверждаете своё согласие на обработку персональных данных
          </p>
        </footer>
      </div>
    );
  }

  // ============ ФОРМА ============
  return (
    <div className="min-h-screen bg-slate-50">
      <Header onLogout={handleLogout} />

      {loading && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl p-10 text-center max-w-md shadow-xl">
            <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4" />
            <div className="font-semibold mb-2">Анализ курсовой работы...</div>
            <div className="text-sm text-slate-500 mb-4">{loadingStatus}</div>
            <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div className="h-full bg-blue-600 rounded-full transition-all duration-500" style={{ width: `${loadingProgress}%` }} />
            </div>
          </div>
        </div>
      )}

      <main className="max-w-3xl mx-auto px-6 py-8">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-6 text-sm">
            {error}
          </div>
        )}

        {/* Информационный блок */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 mb-6 text-sm text-blue-900 leading-relaxed">
          <p className="font-semibold mb-1">Интеллектуальная самопроверка курсовой работы</p>
          <p>
            Загрузите черновик курсовой — сервис проанализирует структуру, объёмы разделов, логику изложения и
            качество текста относительно методических рекомендаций ОП «Интегрированные коммуникации» и предложит
            <strong> топ-5 приоритетных советов</strong> по улучшению.
          </p>
          <p className="mt-2 text-blue-800">
            ⚠ Сервис даёт рекомендации, но <strong>не выполняет работу за вас</strong>. Итоговое решение по работе
            принимает научный руководитель.
          </p>
        </div>

        {/* Шаг 1: Информация */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 mb-6">
          <h2 className="text-lg font-bold text-blue-800 mb-4">Шаг 1. Информация о работе</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-semibold mb-1.5">ФИО студента *</label>
              <input type="text" value={studentName} onChange={e => setStudentName(e.target.value)}
                placeholder="Фамилия Имя Отчество"
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
              <p className="text-xs text-slate-400 mt-1">Укажите полное ФИО (Фамилия Имя Отчество)</p>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5">Тип курсовой *</label>
              <select value={courseType} onChange={e => setCourseType(e.target.value as any)}
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 bg-white">
                <option value="">— Выберите —</option>
                <option value="research">Исследовательская курсовая (перерастает в МД)</option>
                <option value="project">Курсовой проект (перерастает в МП)</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1.5">Тема работы *</label>
            <input
              type="text"
              value={workTitle}
              onChange={e => setWorkTitle(e.target.value)}
              placeholder="Например: Коммуникационная стратегия бренда X на рынке Y"
              className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              maxLength={250}
            />
            <p className="text-xs text-slate-400 mt-1">
              Тема будет видна преподавателю в сводной таблице (минимум 5 символов).
            </p>
          </div>
        </div>

        {/* Шаг 2: Файл */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 mb-6">
          <h2 className="text-lg font-bold text-blue-800 mb-4">Шаг 2. Загрузка работы</h2>

          <div className="mb-4">
            <label className="block text-sm font-semibold mb-1.5">Файл работы (.docx или .pdf) *</label>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl px-5 py-10 text-center cursor-pointer transition
                ${dragOver ? 'border-blue-500 bg-blue-50/50' : 'border-slate-200 hover:border-blue-400'}`}
            >
              <div className="text-3xl mb-2">📄</div>
              <div className="text-sm text-slate-500">Перетащите файл сюда или нажмите для выбора</div>
              <div className="text-xs text-slate-400 mt-1">.docx, .pdf — до 50 МБ</div>
              <input ref={fileInputRef} type="file" accept=".docx,.pdf" className="hidden"
                onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
              {file && (
                <div className="mt-3 text-sm font-semibold text-emerald-600">
                  ✓ {file.name} ({(file.size / 1024 / 1024).toFixed(1)} МБ)
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={handleSubmit} disabled={!isFormValid || loading}
              className="px-7 py-3 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition">
              Проанализировать
            </button>
          </div>
        </div>
      </main>

      <footer className="max-w-3xl mx-auto px-6 py-4 text-center">
        <p className="text-xs text-slate-400">
          Продолжая работу с приложением, вы подтверждаете своё согласие на обработку персональных данных
        </p>
      </footer>
    </div>
  );
}

// ---------- Subcomponents ----------

function DualBlock({ title, issues, strengths }: { title: string; issues: string[]; strengths: string[] }) {
  if (issues.length === 0 && strengths.length === 0) return null;
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 mb-6">
      <h3 className="text-base font-bold text-blue-800 mb-3">{title}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="text-xs font-bold text-red-700 uppercase tracking-wide mb-2">Что улучшить</div>
          {issues.length === 0 ? (
            <p className="text-sm text-slate-400 italic">— нет замечаний —</p>
          ) : (
            <ul className="space-y-1.5">
              {issues.map((s, i) => (
                <li key={i} className="text-sm text-slate-700 flex gap-2">
                  <span className="text-red-500 flex-shrink-0">•</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="text-xs font-bold text-emerald-700 uppercase tracking-wide mb-2">Сильные стороны</div>
          {strengths.length === 0 ? (
            <p className="text-sm text-slate-400 italic">— не выделено —</p>
          ) : (
            <ul className="space-y-1.5">
              {strengths.map((s, i) => (
                <li key={i} className="text-sm text-slate-700 flex gap-2">
                  <span className="text-emerald-500 flex-shrink-0">•</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-md font-semibold border transition
        ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-400'}`}>
      {children}
    </button>
  );
}

// ============ HEADER ============
function Header({ onLogout }: { onLogout?: () => void }) {
  return (
    <header className="bg-gradient-to-r from-slate-800 to-blue-700 text-white shadow-lg print:shadow-none">
      <div className="max-w-3xl mx-auto px-6 py-5 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold">Курсовая работа</h1>
          <p className="text-xs opacity-75 mt-0.5">Интеллектуальный помощник по улучшению курсовой</p>
        </div>
        <nav className="flex gap-1 print:hidden">
          <Link href="/" className="bg-white/15 hover:bg-white/25 px-4 py-2 rounded-lg text-sm transition">
            Студент
          </Link>
          <Link href="/teacher" className="bg-white/15 hover:bg-white/25 px-4 py-2 rounded-lg text-sm transition">
            Преподаватель
          </Link>
          <Link href="/report" className="bg-white/15 hover:bg-white/25 px-4 py-2 rounded-lg text-sm transition">
            Итоговый отчет/Статус работы
          </Link>
          <span className="bg-white/30 px-4 py-2 rounded-lg text-sm font-medium">Курсовая работа</span>
          {onLogout && (
            <button onClick={onLogout}
              className="bg-white/15 hover:bg-white/25 px-4 py-2 rounded-lg text-sm transition"
              title="Выйти (удалить сохранённый вход)">
              Выйти
            </button>
          )}
        </nav>
      </div>
      <div className="border-t border-white/10 print:hidden">
        <div className="max-w-3xl mx-auto px-6 py-1.5 text-xs text-white/60">
          Нашли ошибку? Сообщите разработчику:{' '}
          <a href="mailto:vleonov@hse.ru" className="underline hover:text-white/80">vleonov@hse.ru</a>
        </div>
      </div>
    </header>
  );
}
