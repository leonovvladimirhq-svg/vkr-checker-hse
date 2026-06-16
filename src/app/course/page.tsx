'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { saveAuth, readAuth, clearAuth, saveCourseTeacher, readCourseTeacher, getCourseTeacherPassword, clearCourseTeacher } from '@/lib/authCache';
import { parseJsonResponse } from '@/lib/http';

const TEACHER_PASSWORD = 'proverkahse';

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

interface DatabaseAnalysisSection {
  accessible: boolean;
  fileCount: number;
  fileCounts: { audio: number; tables: number; docs: number; other: number };
  issues: string[];
  strengths: string[];
  note: string;
}

interface EmpiricalSubAnalysis {
  comment: string;
  issues: string[];
  strengths: string[];
}

interface EmpiricalChapterAnalysis {
  present: boolean;
  design: EmpiricalSubAnalysis;
  analysis: EmpiricalSubAnalysis;
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
  databaseAnalysis: DatabaseAnalysisSection;
  empiricalChapter?: EmpiricalChapterAnalysis | null;
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
    bodyCharCountWithSpaces?: number;
    bodyWordCount?: number;
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
  const [dbLink, setDbLink] = useState('');
  const [file, setFile] = useState<File | null>(null);

  // --- Отправка преподавателю ---
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // --- Режим преподавателя «Я преподаватель / Проанализировать» ---
  const [teacherMode, setTeacherMode] = useState(false);
  const [teacherModalOpen, setTeacherModalOpen] = useState(false);
  const [teacherPwInput, setTeacherPwInput] = useState('');
  const [teacherPwError, setTeacherPwError] = useState('');
  const [downloadingReview, setDownloadingReview] = useState(false);
  const [reviewError, setReviewError] = useState('');

  // --- Обратная связь разработчику (оценка качества работы сервиса) ---
  const [feedbackRating, setFeedbackRating] = useState<'like' | 'dislike' | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [feedbackError, setFeedbackError] = useState('');

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
    if (readCourseTeacher()) setTeacherMode(true);
  }, []);

  // --- Режим преподавателя ---
  const confirmTeacherPassword = () => {
    if (teacherPwInput === TEACHER_PASSWORD) {
      saveCourseTeacher(teacherPwInput);
      setTeacherMode(true);
      setTeacherModalOpen(false);
      setTeacherPwInput('');
      setTeacherPwError('');
    } else {
      setTeacherPwError('Неверный пароль');
    }
  };

  const exitTeacherMode = () => {
    clearCourseTeacher();
    setTeacherMode(false);
  };

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
  const isFormValid =
    nameWords >= 2 &&
    !!courseType &&
    !!file &&
    workTitle.trim().length >= 5 &&
    dbLink.trim().length > 0;

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
      formData.append('dbLink', dbLink.trim());
      formData.append('file', file);
      if (teacherMode) {
        formData.append('mode', 'teacher');
        formData.append('teacherPassword', getCourseTeacherPassword() || '');
      }

      setLoadingProgress(30);
      setLoadingStatus('Извлечение текста...');
      await new Promise(r => setTimeout(r, 100));

      setLoadingProgress(50);
      setLoadingStatus('Проверка базы данных на Яндекс.Диске...');
      await new Promise(r => setTimeout(r, 100));

      setLoadingProgress(65);
      setLoadingStatus('Анализ работы ИИ-консультантом по курсовым работам...');

      const res = await fetch('/api/course/check', { method: 'POST', body: formData });

      setLoadingProgress(90);
      setLoadingStatus('Формирование рекомендаций...');

      const data = await parseJsonResponse<CourseCheckResponse>(res, 'Проверка работы');

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
    setFeedbackRating(null);
    setFeedbackText('');
    setFeedbackSent(false);
    setFeedbackError('');
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

  // --- Скачивание Word-отзыва (режим преподавателя) ---
  const downloadReview = async () => {
    if (!result) return;
    setDownloadingReview(true);
    setReviewError('');
    try {
      const res = await fetch('/api/course/reanalyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: result.attemptId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Ошибка сервера: ${res.status}`);
      }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      let filename = `Отзыв_${result.studentName}.docx`;
      const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
      const plain = cd.match(/filename="([^"]+)"/i);
      if (star) filename = decodeURIComponent(star[1]);
      else if (plain) filename = decodeURIComponent(plain[1]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setReviewError(err.message || 'Не удалось сгенерировать Word-отзыв');
    } finally {
      setDownloadingReview(false);
    }
  };

  // --- Отправка обратной связи разработчику ---
  const submitFeedback = async () => {
    if (!result) return;
    if (!feedbackRating && !feedbackText.trim()) {
      setFeedbackError('Поставьте оценку или напишите отзыв');
      return;
    }
    setFeedbackSending(true);
    setFeedbackError('');
    try {
      const res = await fetch('/api/course/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId: result.attemptId, rating: feedbackRating, text: feedbackText.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
      setFeedbackSent(true);
    } catch (err: any) {
      setFeedbackError(err.message || 'Не удалось отправить отзыв');
    } finally {
      setFeedbackSending(false);
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

    // ---- Принцип бургера: собираем сильные стороны и слабые в отдельные блоки ----
    const allStrengths: string[] = [
      ...(a.logicAndCoherence.strengths || []),
      ...(a.textQuality.strengths || []),
      ...(a.databaseAnalysis?.strengths || []),
    ];
    const okSections = a.structuralAnalysis.sections.filter(s => s.verdict === 'ok' && s.present);
    if (okSections.length > 0) {
      allStrengths.unshift(`Раздел${okSections.length > 1 ? 'ы' : ''} «${okSections.map(s => s.section).join('», «')}» соответствуют ожидаемой структуре.`);
    }

    const allIssues: string[] = [
      ...(a.logicAndCoherence.issues || []),
      ...(a.textQuality.issues || []),
      ...(a.databaseAnalysis?.issues || []),
    ];
    const missingSections = a.structuralAnalysis.missingSections;
    const tooShortSections = a.structuralAnalysis.sections.filter(s => s.verdict === 'too_short');
    if (missingSections.length > 0) {
      allIssues.unshift(`Отсутствующие разделы: ${missingSections.join(', ')}.`);
    }
    if (tooShortSections.length > 0) {
      allIssues.push(`Объём недостаточен в разделах: ${tooShortSections.map(s => s.section).join(', ')}.`);
    }

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
              <p className="text-sm font-semibold text-amber-800">
                {teacherMode
                  ? 'Итоговое решение по работе принимает научный руководитель. ИИ-консультант даёт рекомендации, на что обратить внимание согласно с документами программы, но не является экспертом и может ошибаться.'
                  : a.disclaimer}
              </p>
            </div>

            <div className="bg-slate-50 rounded-lg p-3 mt-4 text-xs text-slate-600">
              <span className="font-semibold">Документ:</span> {result.documentInfo.fileName}
              {' '}&middot;{' '}{result.documentInfo.wordCount.toLocaleString()} слов
              {' '}&middot;{' '}~{result.documentInfo.pageEstimate} стр.
              {' '}&middot;{' '}{result.documentInfo.headingsFound} заголовков
              {typeof result.documentInfo.bodyCharCountWithSpaces === 'number' && (
                <>
                  {' '}&middot;{' '}
                  <span className="font-semibold">Тело работы:</span>{' '}
                  {result.documentInfo.bodyCharCountWithSpaces.toLocaleString('ru-RU')} знаков с пробелами{' '}
                  {result.documentInfo.bodyCharCountWithSpaces >= 90000 ? (
                    <span className="font-semibold text-emerald-700">✅ порог 90 000 пройден</span>
                  ) : (
                    <span className="font-semibold text-red-700">
                      ❌ ниже порога 90 000 (не хватает {(90000 - result.documentInfo.bodyCharCountWithSpaces).toLocaleString('ru-RU')})
                    </span>
                  )}
                </>
              )}
            </div>
          </div>

          {/* 1. Готовность к зачёту (скрыта в режиме преподавателя — это студенческий показатель) */}
          {!teacherMode && a.readinessStatusText && (() => {
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

          {/* 2. Общая оценка */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 mb-6">
            <h3 className="text-base font-bold text-blue-800 mb-3">Общая оценка</h3>
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
              {a.overallSummary}
            </p>
          </div>

          {/* 3. Сильные стороны (принцип бургера: сначала хорошее) */}
          {allStrengths.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-emerald-200 p-7 mb-6">
              <h3 className="text-base font-bold text-emerald-800 mb-3">
                ✅ Что получилось хорошо
              </h3>
              <ul className="space-y-2">
                {allStrengths.map((s, i) => (
                  <li key={i} className="text-sm text-slate-700 flex gap-2 items-start">
                    <span className="text-emerald-500 flex-shrink-0">•</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 4. Что стоит доработать */}
          {allIssues.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-amber-200 p-7 mb-6">
              <h3 className="text-base font-bold text-amber-800 mb-3">
                🛠 Что стоит доработать
              </h3>
              <ul className="space-y-2">
                {allIssues.map((s, i) => (
                  <li key={i} className="text-sm text-slate-700 flex gap-2 items-start">
                    <span className="text-amber-500 flex-shrink-0">•</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 5. Разбор по разделам */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 mb-6">
            <h3 className="text-base font-bold text-blue-800 mb-3">Разбор по разделам</h3>

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

          {/* 5b. Эмпирическая глава: дизайн исследования / анализ данных (два блока) */}
          {a.empiricalChapter && a.empiricalChapter.present && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 mb-6">
              <h3 className="text-base font-bold text-blue-800 mb-4">Эмпирическая глава — детальный разбор</h3>
              <div className="grid grid-cols-1 gap-4">
                <EmpiricalBlock
                  title="1. Дизайн исследования и инструменты сбора данных"
                  hint="Обоснование выбора метода, качество анкеты / гайда интервью / протокола, связь с концептуальной частью"
                  sub={a.empiricalChapter.design}
                />
                <EmpiricalBlock
                  title="2. Анализ и интерпретация данных"
                  hint="Корректность метода анализа и статистических критериев, обоснованность и подтверждённость выводов"
                  sub={a.empiricalChapter.analysis}
                />
              </div>
            </div>
          )}

          {/* 5c. Корректность цитирования / Антиплагиат — критерий недопуска */}
          <div className="bg-white rounded-xl shadow-sm border border-red-200 p-7 mb-6">
            <h3 className="text-base font-bold text-red-800 mb-2">Корректность цитирования</h3>
            <p className="text-sm font-semibold text-red-700 leading-relaxed">
              {teacherMode
                ? '⚠ Соблюдение требований к объёму корректного цитирования — критерий допуска к защите. Автоматически он не проверяется: обязательно проверьте оригинальность работы вручную через систему «Антиплагиат».'
                : '⚠ Соблюдение требований к объёму корректного цитирования — критерий допуска к защите. Автоматически он не проверяется: обязательно проверьте оригинальность работы вручную через систему «Антиплагиат» перед отправкой научному руководителю.'}
            </p>
          </div>

          {/* 6. Анализ базы данных */}
          {a.databaseAnalysis && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 mb-6">
              <h3 className="text-base font-bold text-blue-800 mb-3">📁 Анализ базы данных</h3>

              <div className={`rounded-lg p-3 mb-3 text-sm ${a.databaseAnalysis.accessible ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                {a.databaseAnalysis.accessible
                  ? `✓ База данных доступна. Файлов в папке: ${a.databaseAnalysis.fileCount}.`
                  : `⚠ ${a.databaseAnalysis.note || 'База данных недоступна'}`}
              </div>

              {a.databaseAnalysis.accessible && a.databaseAnalysis.fileCounts && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 text-xs">
                  <div className="bg-slate-50 rounded-lg p-2 text-center">
                    <div className="text-slate-500">Аудио/видео</div>
                    <div className="font-bold text-slate-800">{a.databaseAnalysis.fileCounts.audio}</div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2 text-center">
                    <div className="text-slate-500">Таблицы</div>
                    <div className="font-bold text-slate-800">{a.databaseAnalysis.fileCounts.tables}</div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2 text-center">
                    <div className="text-slate-500">Документы</div>
                    <div className="font-bold text-slate-800">{a.databaseAnalysis.fileCounts.docs}</div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2 text-center">
                    <div className="text-slate-500">Другое</div>
                    <div className="font-bold text-slate-800">{a.databaseAnalysis.fileCounts.other}</div>
                  </div>
                </div>
              )}

              {a.databaseAnalysis.note && a.databaseAnalysis.accessible && (
                <p className="text-sm text-slate-700 mb-3 leading-relaxed">{a.databaseAnalysis.note}</p>
              )}

              {(a.databaseAnalysis.strengths.length > 0 || a.databaseAnalysis.issues.length > 0) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {a.databaseAnalysis.strengths.length > 0 && (
                    <div>
                      <div className="text-xs font-bold text-emerald-700 uppercase tracking-wide mb-2">Сильные стороны БД</div>
                      <ul className="space-y-1.5">
                        {a.databaseAnalysis.strengths.map((s, i) => (
                          <li key={i} className="text-sm text-slate-700 flex gap-2">
                            <span className="text-emerald-500 flex-shrink-0">•</span>
                            <span>{s}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {a.databaseAnalysis.issues.length > 0 && (
                    <div>
                      <div className="text-xs font-bold text-red-700 uppercase tracking-wide mb-2">Что улучшить</div>
                      <ul className="space-y-1.5">
                        {a.databaseAnalysis.issues.map((s, i) => (
                          <li key={i} className="text-sm text-slate-700 flex gap-2">
                            <span className="text-red-500 flex-shrink-0">•</span>
                            <span>{s}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 7. Приоритетные рекомендации (план действий) */}
          <div className="bg-white rounded-xl shadow-sm border border-blue-200 p-7 mb-6">
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

          {/* 8. Расширенные рекомендации (с фильтром по категориям) */}
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

          {/* Режим преподавателя: скачать готовый Word-отзыв */}
          {teacherMode && (
            <div className="bg-white rounded-xl shadow-sm border border-violet-200 p-7 mb-6 print:hidden">
              <h3 className="text-base font-bold text-violet-800 mb-2">Готовый отзыв преподавателя</h3>
              <p className="text-sm text-slate-600 mb-4">
                Сгенерируйте и скачайте Word-отзыв по шаблону Программы практики. Отзыв нужно выслать
                учебному офису по почте до 18.06.
              </p>
              {reviewError && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2.5 mb-3 text-sm">{reviewError}</div>
              )}
              <button onClick={downloadReview} disabled={downloadingReview}
                className="px-6 py-3 rounded-lg text-sm font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:bg-slate-300 transition">
                {downloadingReview ? 'Генерируем отзыв…' : '📄 Скачать Word-отзыв'}
              </button>
            </div>
          )}

          {/* Блок отправки преподавателю (только студенческий режим) */}
          {!teacherMode && (
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
          )}

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

          {/* Обратная связь разработчику */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 mb-6 print:hidden">
            <h3 className="text-base font-bold text-blue-800 mb-2">💬 Оцените работу сервиса</h3>
            <p className="text-sm text-slate-600 mb-4">
              Ваш отзыв поможет улучшить ИИ-консультанта — это обратная связь разработчику о качестве проверки (необязательно).
            </p>
            {feedbackSent ? (
              <div className="bg-emerald-50 border-2 border-emerald-400 text-emerald-800 rounded-lg px-4 py-3 text-sm font-semibold">
                ✓ Спасибо за отзыв!
              </div>
            ) : (
              <>
                <div className="flex gap-2 mb-3">
                  <button onClick={() => setFeedbackRating(feedbackRating === 'like' ? null : 'like')}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold border transition ${feedbackRating === 'like' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-400'}`}>
                    👍 Полезно
                  </button>
                  <button onClick={() => setFeedbackRating(feedbackRating === 'dislike' ? null : 'dislike')}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold border transition ${feedbackRating === 'dislike' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-slate-600 border-slate-200 hover:border-red-400'}`}>
                    👎 Не очень
                  </button>
                </div>
                <textarea value={feedbackText} onChange={e => setFeedbackText(e.target.value)}
                  placeholder="Что понравилось, что можно улучшить? (необязательно)"
                  rows={3} maxLength={2000}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 mb-3" />
                {feedbackError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2.5 mb-3 text-sm">{feedbackError}</div>
                )}
                <button onClick={submitFeedback} disabled={feedbackSending}
                  className="px-6 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-300 transition">
                  {feedbackSending ? 'Отправляем…' : 'Отправить отзыв'}
                </button>
              </>
            )}
          </div>

          {/* Кнопки */}
          <div className="flex gap-3 justify-end mt-6 print:hidden">
            <button onClick={exportPDF}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-slate-100 hover:bg-slate-200 border border-slate-200">
              {teacherMode ? '📄 Скачать PDF с рекомендациями (эта страница)' : 'Скачать PDF'}
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

      {/* Модалка пароля преподавателя */}
      {teacherModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-7">
            <h3 className="text-lg font-bold text-violet-800 mb-1">Вход для преподавателя</h3>
            <p className="text-xs text-slate-500 mb-4">Введите пароль преподавателя. Доступ сохранится на 25 минут на этом компьютере.</p>
            {teacherPwError && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2.5 mb-3 text-sm">{teacherPwError}</div>
            )}
            <input type="password" value={teacherPwInput}
              onChange={e => setTeacherPwInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && confirmTeacherPassword()}
              placeholder="Пароль преподавателя"
              className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 mb-4" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setTeacherModalOpen(false); setTeacherPwInput(''); setTeacherPwError(''); }}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-slate-100 hover:bg-slate-200">Отмена</button>
              <button onClick={confirmTeacherPassword}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-violet-600 text-white hover:bg-violet-700">Войти</button>
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

        {/* Переключатель режима преподавателя */}
        <div className="mb-6 flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-5 py-3 flex-wrap">
          <div className="text-sm">
            {teacherMode ? (
              <span className="font-semibold text-violet-700">👩‍🏫 Режим преподавателя — после анализа доступно скачивание готового Word-отзыва</span>
            ) : (
              <span className="text-slate-600">Вы преподаватель? Получите готовый Word-отзыв сразу, без отправки работы.</span>
            )}
          </div>
          {teacherMode ? (
            <button onClick={exitTeacherMode}
              className="text-xs px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-100">
              Выйти из режима преподавателя
            </button>
          ) : (
            <button onClick={() => { setTeacherModalOpen(true); setTeacherPwError(''); setTeacherPwInput(''); }}
              className="text-xs px-3 py-1.5 rounded-md bg-violet-100 text-violet-800 border border-violet-200 hover:bg-violet-200 font-semibold">
              Я преподаватель
            </button>
          )}
        </div>

        {/* Информационный блок */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 mb-6 text-sm text-blue-900 leading-relaxed">
          <p className="font-semibold mb-1">Интеллектуальная самопроверка курсовой работы</p>
          <p>
            Загрузите черновик курсовой — ИИ-консультант проанализирует структуру, объёмы разделов, логику изложения,
            качество текста и содержимое базы данных относительно методических рекомендаций ОП «Интегрированные коммуникации»
            и предложит <strong>приоритетные советы</strong> по улучшению.
          </p>
          <p className="mt-2 text-blue-800">
            ⚠ ИИ-консультант даёт рекомендации, но <strong>не выполняет работу за вас</strong>. Итоговое решение по работе
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
          <div className="mb-4">
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
              {teacherMode
                ? 'Тема будет заполнена в черновике отзыва.'
                : 'Тема будет видна преподавателю в сводной таблице (минимум 5 символов).'}
            </p>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1.5">Ссылка на базу данных (Яндекс.Диск) *</label>
            <input
              type="url"
              value={dbLink}
              onChange={e => setDbLink(e.target.value)}
              placeholder="https://disk.yandex.ru/d/..."
              className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <p className="text-xs text-slate-400 mt-1">
              Публичная папка с эмпирическими данными (интервью, опросы, таблицы, контент-анализ).
              ИИ-консультант сверит содержимое с заявленными в работе методами исследования.
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

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-md font-semibold border transition
        ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-400'}`}>
      {children}
    </button>
  );
}

function EmpiricalBlock({ title, hint, sub }: { title: string; hint: string; sub: EmpiricalSubAnalysis }) {
  return (
    <div className="border border-slate-200 rounded-lg p-4">
      <div className="font-semibold text-sm text-slate-800">{title}</div>
      <div className="text-xs text-slate-400 mb-2">{hint}</div>
      {sub.comment && (
        <p className="text-sm text-slate-700 leading-relaxed mb-2">{sub.comment}</p>
      )}
      {sub.strengths.length > 0 && (
        <ul className="space-y-1 mb-2">
          {sub.strengths.map((s, i) => (
            <li key={i} className="text-sm text-slate-700 flex gap-2 items-start">
              <span className="text-emerald-500 flex-shrink-0">•</span><span>{s}</span>
            </li>
          ))}
        </ul>
      )}
      {sub.issues.length > 0 && (
        <ul className="space-y-1">
          {sub.issues.map((s, i) => (
            <li key={i} className="text-sm text-slate-700 flex gap-2 items-start">
              <span className="text-amber-500 flex-shrink-0">•</span><span>{s}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ============ HEADER ============
function Header({ onLogout }: { onLogout?: () => void }) {
  return (
    <header className="bg-gradient-to-r from-slate-800 to-blue-700 text-white shadow-lg print:shadow-none">
      <div className="max-w-3xl mx-auto px-6 py-5 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold">Курсовая работа</h1>
          <p className="text-xs opacity-75 mt-0.5">ИИ-консультант по курсовым работам</p>
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
