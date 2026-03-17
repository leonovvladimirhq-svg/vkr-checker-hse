'use client';

import { useState, useRef, useCallback } from 'react';
import Link from 'next/link';

// Типы
interface CheckResultItem {
  id: string;
  section: string;
  text: string;
  passed: boolean | null;
  note: string;
}

interface CheckResponse {
  id: number;
  studentName: string;
  workType: string;
  attemptNumber: number;
  maxAttempts: number;
  status: 'pass' | 'fail';
  results: CheckResultItem[];
  summary: { total: number; passed: number; failed: number; manual: number };
  documentInfo: {
    fileName: string;
    wordCount: number;
    pageEstimate: number;
    headingsFound: number;
    textPreview: string;
  };
  error?: string;
}

export default function StudentPage() {
  // Форма
  const [studentName, setStudentName] = useState('');
  const [workType, setWorkType] = useState<'project' | 'dissertation' | ''>('');
  const [usesAI, setUsesAI] = useState(false);
  const [dbLink, setDbLink] = useState('');
  const [presLink, setPresLink] = useState('');
  const [empMethods, setEmpMethods] = useState<string[]>([]);
  const [compMethods, setCompMethods] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);

  // Состояние
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [result, setResult] = useState<CheckResponse | null>(null);
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState<Array<{ status: string }>>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // Валидация формы
  const isFormValid = studentName.trim() && workType && file && dbLink.trim() &&
    (workType !== 'project' || presLink.trim()) &&
    empMethods.length > 0 &&
    (workType !== 'dissertation' || empMethods.length >= 2);

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
      formData.append('workType', workType);
      formData.append('usesAI', String(usesAI));
      formData.append('dbLink', dbLink);
      formData.append('presLink', presLink);
      formData.append('empMethods', JSON.stringify(empMethods));
      formData.append('compMethods', JSON.stringify(compMethods));
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

  // Сброс для новой попытки
  const resetForm = () => {
    if (result && result.attemptNumber >= result.maxAttempts) {
      alert('Все 3 попытки использованы. Обратитесь к научному руководителю.');
      return;
    }
    setResult(null);
    setFile(null);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Экспорт PDF
  const exportPDF = () => {
    window.print();
  };

  // ============ RENDER ============

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
        <Header />
        <main className="max-w-3xl mx-auto px-6 py-8">
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 mb-4 text-sm text-amber-800">
            Несогласны с результатами анализа? Напишите нам{' '}
            <a href="mailto:example@hse.ru" className="font-semibold underline">example@hse.ru</a>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7">
            {/* Заголовок и бейдж */}
            <div className="flex justify-between items-start flex-wrap gap-4 mb-4">
              <div>
                <h2 className="text-lg font-bold text-blue-800">Результаты проверки</h2>
                <p className="text-sm text-slate-500 mt-1">
                  {result.studentName} &middot; {result.workType === 'project' ? 'Магистерский проект' : 'Магистерская диссертация'} &middot; {new Date().toLocaleDateString('ru-RU')}
                </p>
                {/* Счётчик попыток */}
                <div className="flex items-center gap-2 mt-3">
                  <span className="text-xs text-slate-500">Попытка {result.attemptNumber} из {result.maxAttempts}:</span>
                  {Array.from({ length: result.maxAttempts }, (_, i) => {
                    const idx = i + 1;
                    if (idx < result.attemptNumber) {
                      const prev = attempts[idx - 1];
                      return <span key={i} className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white ${prev?.status === 'pass' ? 'bg-emerald-600' : 'bg-red-600'}`}>{idx}</span>;
                    }
                    if (idx === result.attemptNumber) {
                      return <span key={i} className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white bg-blue-600">{idx}</span>;
                    }
                    return <span key={i} className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-slate-400 bg-slate-200">{idx}</span>;
                  })}
                </div>
              </div>
              <div className={`px-6 py-3 rounded-lg text-lg font-bold border-2 ${result.status === 'pass' ? 'bg-emerald-50 text-emerald-700 border-emerald-600' : 'bg-red-50 text-red-700 border-red-600'}`}>
                {result.status === 'pass' ? '✓ ЗАЧЁТ' : '✗ НЕЗАЧЁТ'}
              </div>
            </div>

            {/* Информация о документе */}
            <div className="bg-slate-50 rounded-lg p-3 mb-4 text-xs text-slate-600">
              <span className="font-semibold">Документ:</span> {documentInfo.fileName} &middot; {documentInfo.wordCount.toLocaleString()} слов &middot; ~{documentInfo.pageEstimate} стр. &middot; {documentInfo.headingsFound} заголовков найдено
            </div>

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

            {/* Кнопки */}
            <div className="flex gap-3 justify-end mt-6 print:hidden">
              <button onClick={exportPDF} className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-slate-100 hover:bg-slate-200 border border-slate-200">
                Скачать PDF
              </button>
              <button onClick={resetForm} className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700">
                Загрузить повторно
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ============ ФОРМА ============
  return (
    <div className="min-h-screen bg-slate-50">
      <Header />

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

        {/* Шаг 1: Информация */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 mb-6">
          <h2 className="text-lg font-bold text-blue-800 mb-4">Шаг 1. Информация о работе</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-semibold mb-1.5">ФИО студента *</label>
              <input type="text" value={studentName} onChange={e => setStudentName(e.target.value)}
                placeholder="Иванов Иван Иванович"
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5">Тип работы *</label>
              <select value={workType} onChange={e => setWorkType(e.target.value as any)}
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 bg-white">
                <option value="">— Выберите —</option>
                <option value="project">Магистерский проект</option>
                <option value="dissertation">Магистерская диссертация</option>
              </select>
            </div>
          </div>

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
                {workType === 'dissertation'
                  ? 'Диссертация: смешанный/мультимодальный подход (минимум 2 метода)'
                  : 'Выберите хотя бы один метод'}
              </div>
              {[
                { val: 'interviews', label: 'Глубинные интервью' },
                { val: 'focus_groups', label: 'Фокус-группы' },
                { val: 'text_analysis', label: 'Методы анализа текстов (контент-анализ, дискурс-анализ и др.)' },
                { val: 'survey', label: 'Опрос' },
                { val: 'quant_content', label: 'Количественный контент-анализ' },
                { val: 'monitoring', label: 'Мониторинговый анализ' },
              ].map(m => (
                <label key={m.val} className="flex items-center gap-2 py-1 cursor-pointer">
                  <input type="checkbox" checked={empMethods.includes(m.val)}
                    onChange={() => toggleMethod(empMethods, setEmpMethods, m.val)}
                    className="w-4 h-4 accent-blue-600" />
                  <span className="text-sm">{m.label}</span>
                </label>
              ))}
            </div>
          )}

          {/* Методы анализа конкурентов (только проект) */}
          {workType === 'project' && (
            <div>
              <h3 className="text-sm font-semibold mb-2">Методы исследования (анализ конкурентов)</h3>
              {[
                { val: 'text_analysis_comp', label: 'Методы анализа текстов' },
                { val: 'quant_content_comp', label: 'Количественный контент-анализ' },
              ].map(m => (
                <label key={m.val} className="flex items-center gap-2 py-1 cursor-pointer">
                  <input type="checkbox" checked={compMethods.includes(m.val)}
                    onChange={() => toggleMethod(compMethods, setCompMethods, m.val)}
                    className="w-4 h-4 accent-blue-600" />
                  <span className="text-sm">{m.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Шаг 2: Загрузка */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 mb-6">
          <h2 className="text-lg font-bold text-blue-800 mb-4">Шаг 2. Загрузка файлов и ссылок</h2>

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
              <label className="block text-sm font-semibold mb-1.5">Ссылка на базу данных *</label>
              <input type="url" value={dbLink} onChange={e => setDbLink(e.target.value)}
                placeholder="https://drive.google.com/..."
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
            </div>
            {workType === 'project' && (
              <div>
                <label className="block text-sm font-semibold mb-1.5">Ссылка на презентацию *</label>
                <input type="url" value={presLink} onChange={e => setPresLink(e.target.value)}
                  placeholder="https://drive.google.com/..."
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
    </div>
  );
}

// ============ HEADER ============
function Header() {
  return (
    <header className="bg-gradient-to-r from-slate-800 to-blue-700 text-white shadow-lg print:shadow-none">
      <div className="max-w-3xl mx-auto px-6 py-5 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold">Проверка ВКР</h1>
          <p className="text-xs opacity-75 mt-0.5">Автоматическая проверка магистерских работ по чек-листу</p>
        </div>
        <nav className="flex gap-1 print:hidden">
          <span className="bg-white/30 px-4 py-2 rounded-lg text-sm font-medium">Студент</span>
          <Link href="/teacher" className="bg-white/15 hover:bg-white/25 px-4 py-2 rounded-lg text-sm transition">
            Преподаватель
          </Link>
        </nav>
      </div>
      <div className="border-t border-white/10 print:hidden">
        <div className="max-w-3xl mx-auto px-6 py-1.5 text-xs text-white/60">
          Нашли ошибку? Сообщите разработчику:{' '}
          <a href="mailto:example@hse.ru" className="underline hover:text-white/80">example@hse.ru</a>
        </div>
      </div>
    </header>
  );
}
