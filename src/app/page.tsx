'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { saveAuth, readAuth, clearAuth } from '@/lib/authCache';
import { PROGRAMMES, DEFAULT_PROGRAMME, workTypeLabel } from '@/lib/programmes';
import type { ProgrammeId, WorkType, WorkLang } from '@/lib/checklist';

// Типы
interface CheckResultItem {
  id: string;
  section: string;
  text: string;
  passed: boolean | null;
  note: string;
}

interface TechnicalSummary {
  volume: {
    charsWithSpaces: number;
    charsNoSpaces: number;
    footnoteChars: number;
    threshold: number;
    requirementMet: boolean;
    conceptChars: number | null;
    conceptThreshold: number;
    conceptRequirementMet: boolean | null;
  } | null;
  database: {
    accessible: boolean;
    error: string | null;
    mediaFiles: number | null;
    tableFiles: number | null;
    otherFiles: number | null;
    totalFiles: number | null;
    disallowedFormats: string[];
    media: Array<{ name: string; size: number; ext: string; estMinutes: number | null; formatAllowed: boolean }>;
  };
}

interface CheckResponse {
  studentName: string;
  programme: ProgrammeId;
  programmeLabel: string;
  workType: string;
  workLang: WorkLang;
  technical: TechnicalSummary;
  status: 'pass' | 'fail' | 'pending';
  results: CheckResultItem[];
  summary: { total: number; passed: number; failed: number; manual: number };
  documentInfo: {
    fileName: string;
    wordCount: number;
    pageEstimate: number;
    headingsFound: number;
    textPreview: string;
  };
  saveData: {
    extractedTextPreview: string;
    dbLink: string;
    presLink: string;
    methodsJson: string;
    usesAI: boolean;
    fileName: string;
    resultsJson: string;
    programme: string;
    workLang: string;
    volumeJson: string;
  };
  error?: string;
}

export default function StudentPage() {
  // Авторизация
  const [authenticated, setAuthenticated] = useState(false);
  const [loginInput, setLoginInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState('');

  // Форма
  const [programmeId, setProgrammeId] = useState<ProgrammeId>(DEFAULT_PROGRAMME);
  const [studentName, setStudentName] = useState('');
  const [workType, setWorkType] = useState<WorkType | ''>('');
  const [workLang, setWorkLang] = useState<WorkLang>('ru');
  const [usesAI, setUsesAI] = useState(false);
  const [dbLink, setDbLink] = useState('');
  const [presLink, setPresLink] = useState('');
  const [empMethods, setEmpMethods] = useState<string[]>([]);
  const [compMethods, setCompMethods] = useState<string[]>([]);
  const [otherMethodName, setOtherMethodName] = useState('');
  const [file, setFile] = useState<File | null>(null);

  // Состояние
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [result, setResult] = useState<CheckResponse | null>(null);
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState<Array<{ status: string }>>([]);
  const [savingResult, setSavingResult] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [feedback, setFeedback] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // Восстановление авторизации из localStorage при первом рендере (TTL 24 часа)
  useEffect(() => {
    if (readAuth('student')) {
      setAuthenticated(true);
    }
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

  // Конфигурация выбранной образовательной программы
  const programme = PROGRAMMES[programmeId];
  const needsPresentation = workType ? programme.requiresPresentation(workType as WorkType) : false;
  const minMethods = workType ? programme.minMethods(workType as WorkType) : 1;

  // Смена программы сбрасывает всё, что от неё зависит: у программ разные
  // типы работ и разные наборы методов, и «залипший» выбор ушёл бы в API.
  const handleProgrammeChange = (id: ProgrammeId) => {
    if (id === programmeId) return;
    setProgrammeId(id);
    const types = PROGRAMMES[id].workTypes;
    setWorkType(types.length === 1 ? types[0].value : '');
    setEmpMethods([]);
    setCompMethods([]);
    setOtherMethodName('');
    setPresLink('');
    setWorkLang('ru');
    setError('');
  };

  // Валидация формы
  const nameWords = studentName.trim().split(/\s+/).filter(Boolean).length;
  const hasOtherMethod = empMethods.includes('other') || compMethods.includes('other_comp');
  const isFormValid = nameWords >= 2 && workType && file && dbLink.trim() &&
    (!needsPresentation || presLink.trim()) &&
    empMethods.length >= minMethods &&
    (!hasOtherMethod || otherMethodName.trim().length > 0);

  // Обработка методов
  const toggleMethod = (list: string[], setter: (v: string[]) => void, value: string) => {
    setter(list.includes(value) ? list.filter(m => m !== value) : [...list, value]);
  };

  // Обработка файла
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

  // Drag & drop
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  }, [handleFile]);

  // Отправка на проверку
  const handleSubmit = async () => {
    if (!isFormValid || !file) return;

    setLoading(true);
    setError('');
    setLoadingProgress(10);
    setLoadingStatus('Загрузка файла на сервер...');

    try {
      const formData = new FormData();
      formData.append('studentName', studentName);
      formData.append('programme', programmeId);
      formData.append('workType', workType);
      formData.append('workLang', workLang);
      formData.append('usesAI', String(usesAI));
      formData.append('dbLink', dbLink);
      formData.append('presLink', presLink);
      formData.append('empMethods', JSON.stringify(empMethods));
      formData.append('compMethods', JSON.stringify(compMethods));
      if (otherMethodName.trim()) {
        formData.append('otherMethodName', otherMethodName.trim());
      }
      formData.append('file', file);

      setLoadingProgress(30);
      setLoadingStatus('Извлечение текста...');

      // Пауза для обновления UI
      await new Promise(r => setTimeout(r, 100));

      setLoadingProgress(50);
      setLoadingStatus('Анализ работы...');

      const res = await fetch('/api/check', {
        method: 'POST',
        body: formData,
      });

      setLoadingProgress(90);
      setLoadingStatus('Формирование отчёта...');

      const data: CheckResponse = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Ошибка сервера: ${res.status}`);
      }

      setLoadingProgress(100);
      setResult(data);
      setAttempts(prev => [...prev, { status: data.status }]);

    } catch (err: any) {
      setError(err.message || 'Произошла ошибка при проверке');
    } finally {
      setLoading(false);
    }
  };

  // Сохранение результата
  const handleSave = async () => {
    if (!result) return;
    setSavingResult(true);
    setSaveError('');
    try {
      const formData = new FormData();
      formData.append('studentName', result.studentName);
      formData.append('workType', result.workType);
      formData.append('programme', result.saveData.programme);
      formData.append('workLang', result.saveData.workLang);
      formData.append('volumeJson', result.saveData.volumeJson);
      formData.append('status', result.status);
      formData.append('resultsJson', result.saveData.resultsJson);
      formData.append('extractedTextPreview', result.saveData.extractedTextPreview);
      formData.append('fileName', result.saveData.fileName);
      formData.append('dbLink', result.saveData.dbLink);
      formData.append('presLink', result.saveData.presLink);
      formData.append('methodsJson', result.saveData.methodsJson);
      formData.append('usesAI', String(result.saveData.usesAI));
      formData.append('feedback', feedback);
      if (file) {
        formData.append('file', file);
      }

      const res = await fetch('/api/attempts', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Ошибка сохранения');
      }
      setSaved(true);
      setAttempts(prev => [...prev, { status: result.status }]);
    } catch (err: any) {
      setSaveError(err.message || 'Ошибка сохранения результата');
    } finally {
      setSavingResult(false);
    }
  };

  // Сброс для новой попытки
  const resetForm = () => {
    setResult(null);
    setFile(null);
    setError('');
    setSaved(false);
    setSaveError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Экспорт PDF
  const exportPDF = () => {
    window.print();
  };

  // ============ RENDER ============

  // Если не авторизован — показываем экран входа
  if (!authenticated) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Header />
        <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 120px)' }}>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 w-full max-w-sm">
            <h2 className="text-lg font-bold text-blue-800 mb-1">Вход в систему проверки ВКР</h2>
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

  // Если есть результат — показываем отчёт
  if (result) {
    const { summary, results: checks, documentInfo } = result;
    const pct = Math.round(summary.passed / summary.total * 100);

    // Группировка по секциям
    const sections: Record<string, CheckResultItem[]> = {};
    checks.forEach(item => {
      if (!sections[item.section]) sections[item.section] = [];
      sections[item.section].push(item);
    });

    return (
      <div className="min-h-screen bg-slate-50">
        <Header onLogout={handleLogout} />
        <main className="max-w-3xl mx-auto px-6 py-8">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7">
            {/* Заголовок и бейдж */}
            <div className="flex justify-between items-start flex-wrap gap-4 mb-4">
              <div>
                <h2 className="text-lg font-bold text-blue-800">Результаты проверки</h2>
                <p className="text-sm text-slate-500 mt-1">
                  {result.studentName} &middot; {result.programmeLabel} &middot; {workTypeLabel(result.workType)} &middot; {new Date().toLocaleDateString('ru-RU')}
                </p>
              </div>
              <div className={`px-6 py-3 rounded-lg text-lg font-bold border-2 ${
                result.status === 'pass' ? 'bg-emerald-50 text-emerald-700 border-emerald-600' :
                result.status === 'pending' ? 'bg-amber-50 text-amber-700 border-amber-500' :
                'bg-red-50 text-red-700 border-red-600'
              }`}>
                {result.status === 'pass' ? '✓ ЗАЧЁТ' : result.status === 'pending' ? '⊘ ОЖИДАЙТЕ ПРОВЕРКУ ПРЕПОДАВАТЕЛЕМ' : '✗ НЕЗАЧЁТ'}
              </div>
            </div>
            <div className="bg-amber-50 border-2 border-amber-400 rounded-xl px-5 py-3 mt-3 mb-1 flex items-start gap-3">
              <span className="text-amber-500 text-xl flex-shrink-0">⚠️</span>
              <p className="text-sm font-semibold text-amber-800">
                Предварительный результат — окончательный итог определяет преподаватель после проверки вашей работы
              </p>
            </div>

            {/* Информация о документе */}
            <div className="bg-slate-50 rounded-lg p-3 mb-4 text-xs text-slate-600">
              <span className="font-semibold">Документ:</span> {documentInfo.fileName} &middot; {documentInfo.wordCount.toLocaleString()} слов &middot; ~{documentInfo.pageEstimate} стр. &middot; {documentInfo.headingsFound} заголовков найдено
            </div>

            {/* Технические параметры — основа для отзыва руководителя */}
            <TechnicalBlock technical={result.technical} />

            {/* Прогресс */}
            <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden mb-1">
              <div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-xs text-slate-500 mb-6">
              {summary.passed} из {summary.total} выполнено ({pct}%) &middot; {summary.failed} не выполнено &middot; {summary.manual} ручная проверка
            </p>

            {/* Пункты по секциям */}
            {Object.entries(sections).map(([section, items]) => (
              <div key={section} className="mb-4">
                <h3 className="text-sm font-semibold text-blue-800 mb-2">{section}</h3>
                {items.map(item => (
                  <div key={item.id} className="flex items-start gap-2.5 py-2 border-b border-slate-100 last:border-0">
                    <span className={`text-lg flex-shrink-0 ${item.passed === true ? 'text-emerald-600' : item.passed === false ? 'text-red-600' : 'text-slate-400'}`}>
                      {item.passed === true ? '✓' : item.passed === false ? '✗' : '⊘'}
                    </span>
                    <div className="flex-1">
                      <div className="text-sm">{item.text}</div>
                      {item.note && <div className="text-xs text-slate-500 mt-0.5">{item.note}</div>}
                    </div>
                  </div>
                ))}
              </div>
            ))}

            {/* Отзыв студента */}
            <div className="mt-6 mb-2 print:hidden">
              <label className="block text-sm font-semibold mb-1.5">Комментарий для преподавателя</label>
              <textarea
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                placeholder="Оставьте комментарий для преподавателя о вашей работе или выразите несогласие с результатами оценивания (необязательно)"
                rows={3}
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 resize-y"
              />
            </div>

            {/* Оверлей сохранения */}
            {savingResult && (
              <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
                <div className="bg-white rounded-xl p-10 text-center max-w-sm shadow-xl">
                  <div className="w-12 h-12 border-4 border-slate-200 border-t-emerald-600 rounded-full animate-spin mx-auto mb-4" />
                  <div className="font-semibold text-slate-800 mb-2">Сохранение результата...</div>
                  <div className="text-sm text-red-600 font-medium">Не закрывайте страницу!</div>
                </div>
              </div>
            )}

            {/* Ошибка сохранения */}
            {saveError && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mt-4 text-sm">
                {saveError}
              </div>
            )}

            {/* Кнопки */}
            <div className="flex gap-3 justify-end mt-6 print:hidden">
              <button onClick={handleSave} disabled={savingResult || saved}
                className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition ${saved ? 'bg-emerald-100 text-emerald-700 border border-emerald-300 cursor-default' : 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-slate-300'}`}>
                {saved ? '✓ Результат сохранён' : savingResult ? 'Сохранение...' : 'Сохранить результат'}
              </button>
              <button onClick={exportPDF} className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-slate-100 hover:bg-slate-200 border border-slate-200">
                Скачать PDF
              </button>
              <button onClick={resetForm} className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700">
                Загрузить повторно
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

  // ============ ФОРМА ============
  return (
    <div className="min-h-screen bg-slate-50">
      <Header onLogout={handleLogout} />

      {/* Оверлей загрузки */}
      {loading && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl p-10 text-center max-w-md shadow-xl">
            <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4" />
            <div className="font-semibold mb-2">Анализ работы...</div>
            <div className="text-sm text-slate-500 mb-4">{loadingStatus}</div>
            <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div className="h-full bg-blue-600 rounded-full transition-all duration-500" style={{ width: `${loadingProgress}%` }} />
            </div>
          </div>
        </div>
      )}

      <main className="max-w-3xl mx-auto px-6 py-8">
        {/* Ошибка */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-6 text-sm">
            {error}
          </div>
        )}

        {/* Шаг 1: Образовательная программа */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 mb-6">
          <h2 className="text-lg font-bold text-blue-800 mb-1">Шаг 1. Образовательная программа</h2>
          <p className="text-xs text-slate-500 mb-4">
            От программы зависят чек-лист, требования к объёму и состав базы данных — выберите свою программу
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Object.values(PROGRAMMES).map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleProgrammeChange(p.id)}
                className={`text-left rounded-xl border-2 px-4 py-3 transition ${
                  programmeId === p.id
                    ? 'border-blue-600 bg-blue-50'
                    : 'border-slate-200 hover:border-blue-300 bg-white'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${
                    programmeId === p.id ? 'border-blue-600 bg-blue-600' : 'border-slate-300'
                  }`} />
                  <span className="text-sm font-semibold">{p.label}</span>
                </div>
                <p className="text-xs text-slate-500 mt-1.5 ml-6">{p.hint}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Шаг 2: Информация */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 mb-6">
          <h2 className="text-lg font-bold text-blue-800 mb-4">Шаг 2. Информация о работе</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-semibold mb-1.5">ФИО студента *</label>
              <input type="text" value={studentName} onChange={e => setStudentName(e.target.value)}
                placeholder="Фамилия Имя Отчество"
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
              <p className="text-xs text-slate-400 mt-1">Укажите полное ФИО (Фамилия Имя Отчество)</p>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5">Тип работы *</label>
              <select value={workType} onChange={e => setWorkType(e.target.value as WorkType | '')}
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 bg-white">
                {programme.workTypes.length > 1 && <option value="">— Выберите —</option>}
                {programme.workTypes.map(w => (
                  <option key={w.value} value={w.value}>{w.label}</option>
                ))}
              </select>
            </div>
          </div>

          {programme.hasLangChoice && (
            <div className="mb-4 max-w-xs">
              <label className="block text-sm font-semibold mb-1.5">Язык работы *</label>
              <select value={workLang} onChange={e => setWorkLang(e.target.value as WorkLang)}
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 bg-white">
                <option value="ru">Русский</option>
                <option value="en">Английский</option>
              </select>
              <p className="text-xs text-slate-400 mt-1">
                От языка зависит порог объёма: {programme.volumeThresholds
                  ? `${programme.volumeThresholds.ru.toLocaleString('ru-RU')} знаков (рус.) / ${programme.volumeThresholds.en.toLocaleString('ru-RU')} знаков (англ.)`
                  : '—'}
              </p>
            </div>
          )}

          <div className="mb-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={usesAI} onChange={e => setUsesAI(e.target.checked)}
                className="w-4.5 h-4.5 accent-blue-600" />
              <span className="text-sm">Работа содержит контент, сгенерированный алгоритмами автоматической генерации</span>
            </label>
          </div>

          {/* Методы эмпирической части */}
          {workType && (
            <div className="mb-4">
              <h3 className="text-sm font-semibold mb-2">Методы исследования (эмпирическая часть) *</h3>
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-3.5 py-2.5 text-xs text-blue-700 mb-2">
                {minMethods >= 2
                  ? `Смешанный/мультимодальный подход: минимум ${minMethods} метода`
                  : 'Выберите хотя бы один метод'}
              </div>
              {programme.methods.map(m => (
                <label key={m.value} className="flex items-start gap-2 py-1 cursor-pointer">
                  <input type="checkbox" checked={empMethods.includes(m.value)}
                    onChange={() => toggleMethod(empMethods, setEmpMethods, m.value)}
                    className="w-4 h-4 accent-blue-600 mt-0.5" />
                  <span className="text-sm">{m.label}</span>
                </label>
              ))}
              {/* Поле названия для метода «Другое» */}
              {hasOtherMethod && (
                <div className="mt-2 ml-6">
                  <label className="block text-sm font-semibold mb-1 text-amber-700">Укажите название метода *</label>
                  <input type="text" value={otherMethodName} onChange={e => setOtherMethodName(e.target.value)}
                    placeholder="Например: нетнография, A/B тестирование..."
                    className="w-full px-3.5 py-2.5 border border-amber-300 rounded-lg text-sm focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 bg-amber-50" />
                  <p className="text-xs text-amber-600 mt-1">Обязательно заполните название выбранного метода</p>
                </div>
              )}
            </div>
          )}

          {/* Методы анализа конкурентов — только для программ, где этот блок есть (ОП ИК, проект) */}
          {workType === 'project' && programme.competitorMethods.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2">Методы исследования (анализ конкурентов)</h3>
              {programme.competitorMethods.map(m => (
                <label key={m.value} className="flex items-center gap-2 py-1 cursor-pointer">
                  <input type="checkbox" checked={compMethods.includes(m.value)}
                    onChange={() => toggleMethod(compMethods, setCompMethods, m.value)}
                    className="w-4 h-4 accent-blue-600" />
                  <span className="text-sm">{m.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Шаг 2: Загрузка */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 mb-6">
          <h2 className="text-lg font-bold text-blue-800 mb-4">Шаг 3. Загрузка файлов и ссылок</h2>

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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-semibold mb-1.5">Ссылка на базу данных (Яндекс.Диск) *</label>
              <input type="url" value={dbLink} onChange={e => setDbLink(e.target.value)}
                placeholder="https://disk.yandex.ru/d/..."
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
            </div>
            {needsPresentation && (
              <div>
                <label className="block text-sm font-semibold mb-1.5">Ссылка на презентацию *</label>
                <input type="url" value={presLink} onChange={e => setPresLink(e.target.value)}
                  placeholder="Прямая ссылка на файл презентации (не на папку)"
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button onClick={handleSubmit} disabled={!isFormValid || loading}
              className="px-7 py-3 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition">
              Проверить работу
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

// ============ ТЕХНИЧЕСКИЕ ПАРАМЕТРЫ ============
// Блок с измеримыми фактами: объём работы и состав базы данных.
// По договорённости встречи 10.07.2026 именно эту часть отзыва
// автоматизируем — содержательную оценку даёт научный руководитель.
function TechnicalBlock({ technical }: { technical?: TechnicalSummary }) {
  if (!technical) return null;
  const { volume, database } = technical;
  if (!volume && !database.accessible) return null;

  const nf = (n: number) => n.toLocaleString('ru-RU');

  return (
    <div className="border border-slate-200 rounded-xl p-4 mb-6 bg-white">
      <h3 className="text-sm font-bold text-slate-700 mb-3">Технические параметры работы</h3>

      {volume && (
        <div className="mb-3">
          <div className="text-xs font-semibold text-slate-500 mb-1">Объём</div>
          <div className="text-sm">
            <span className={volume.requirementMet ? 'text-emerald-700' : 'text-red-700'}>
              {volume.requirementMet ? '✓' : '✗'} {nf(volume.charsWithSpaces)} знаков с пробелами
            </span>
            <span className="text-slate-500"> при требовании не менее {nf(volume.threshold)}</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Считается тело работы со сносками ({nf(volume.footnoteChars)} знаков), без титульного листа,
            содержания, списка литературы и приложений. Без пробелов: {nf(volume.charsNoSpaces)}.
          </p>
          <div className="text-sm mt-1.5">
            {volume.conceptChars === null ? (
              <span className="text-amber-700">
                ⊘ Концептуальная глава: границы не распознаны, объём проверяется вручную
                (требование — не менее {nf(volume.conceptThreshold)} знаков)
              </span>
            ) : (
              <span className={volume.conceptRequirementMet ? 'text-emerald-700' : 'text-red-700'}>
                {volume.conceptRequirementMet ? '✓' : '✗'} Концептуальная глава: {nf(volume.conceptChars)} знаков
                <span className="text-slate-500"> при требовании не менее {nf(volume.conceptThreshold)}</span>
              </span>
            )}
          </div>
        </div>
      )}

      <div>
        <div className="text-xs font-semibold text-slate-500 mb-1">База данных</div>
        {database.accessible ? (
          <>
            <p className="text-sm">
              Содержит {database.mediaFiles ?? 0} аудио/видеофайл(ов), {database.tableFiles ?? 0} таблиц,{' '}
              {database.otherFiles ?? 0} других файлов (всего {database.totalFiles ?? 0}).
            </p>
            {database.disallowedFormats.length > 0 && (
              <p className="text-xs text-amber-700 mt-1">
                Форматы вне списка приложения 35: {database.disallowedFormats.join(', ')}
              </p>
            )}
            {database.media.length > 0 && (
              <p className="text-xs text-slate-500 mt-1">
                Длительность записей оценена по размеру файлов и требует проверки вручную —
                публичный API Яндекс.Диска её не возвращает.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-red-700">
            Не удалось открыть базу данных{database.error ? `: ${database.error}` : ''}
          </p>
        )}
      </div>
    </div>
  );
}

// ============ HEADER ============
function Header({ onLogout }: { onLogout?: () => void }) {
  return (
    <header className="bg-gradient-to-r from-slate-800 to-blue-700 text-white shadow-lg print:shadow-none">
      <div className="max-w-3xl mx-auto px-6 py-5 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold">Проверка ВКР</h1>
          <p className="text-xs opacity-75 mt-0.5">Автоматическая проверка ВКР по чек-листу образовательной программы</p>
        </div>
        <nav className="flex gap-1 print:hidden">
          <span className="bg-white/30 px-4 py-2 rounded-lg text-sm font-medium">Студент</span>
          <Link href="/teacher" className="bg-white/15 hover:bg-white/25 px-4 py-2 rounded-lg text-sm transition">
            Преподаватель
          </Link>
          <Link href="/report" className="bg-white/15 hover:bg-white/25 px-4 py-2 rounded-lg text-sm transition">
            Итоговый отчет/Статус работы
          </Link>
          <Link href="/course" className="bg-white/15 hover:bg-white/25 px-4 py-2 rounded-lg text-sm transition">
            Курсовая работа
          </Link>
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
