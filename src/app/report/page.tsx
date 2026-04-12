'use client';

import { useState } from 'react';
import Link from 'next/link';

interface CheckResultItem {
  id: string;
  section: string;
  text: string;
  passed: boolean | null;
  note: string;
}

interface ReportAttempt {
  id: number;
  student_name: string;
  status: string;
  work_type: string;
  attempt_number: number;
  teacher_review: string | null;
  results: CheckResultItem[];
  created_at: string;
}

interface ReportData {
  reportReady: boolean;
  studentFound?: boolean;
  reportGeneratedAt?: string;
  attempt?: ReportAttempt;
}

export default function ReportPage() {
  const [studentInput, setStudentInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    const name = studentInput.trim();
    if (!name) {
      setError('Введите ФИО');
      return;
    }
    setLoading(true);
    setError('');
    setData(null);
    try {
      const res = await fetch(`/api/report?student=${encodeURIComponent(name)}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Ошибка запроса');
      } else {
        setData(json);
      }
    } catch {
      setError('Ошибка соединения с сервером');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-slate-800 to-blue-700 text-white shadow-lg">
        <div className="max-w-3xl mx-auto px-6 py-5 flex justify-between items-center">
          <div>
            <h1 className="text-xl font-bold">Проверка ВКР</h1>
            <p className="text-xs opacity-75 mt-0.5">Итоговый отчёт</p>
          </div>
          <nav className="flex gap-1">
            <Link href="/" className="bg-white/15 hover:bg-white/25 px-4 py-2 rounded-lg text-sm transition">
              Студент
            </Link>
            <Link href="/teacher" className="bg-white/15 hover:bg-white/25 px-4 py-2 rounded-lg text-sm transition">
              Преподаватель
            </Link>
            <span className="bg-white/30 px-4 py-2 rounded-lg text-sm font-medium">Итоговый отчет</span>
          </nav>
        </div>
        <div className="border-t border-white/10">
          <div className="max-w-3xl mx-auto px-6 py-1.5 text-xs text-white/60">
            Нашли ошибку? Сообщите разработчику:{' '}
            <a href="mailto:vleonov@hse.ru" className="underline hover:text-white/80">vleonov@hse.ru</a>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        {/* Форма поиска */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 mb-6">
          <h2 className="text-lg font-bold text-blue-800 mb-1">Итоговый отчёт по проверке ВКР</h2>
          <p className="text-xs text-slate-500 mb-5">Введите ФИО для просмотра результатов проверки</p>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <input
              type="text"
              value={studentInput}
              onChange={e => setStudentInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              placeholder="Например: Иванов Иван Иванович"
              className="flex-1 px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="px-6 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-300 transition"
            >
              {loading ? 'Поиск...' : 'Подтвердить'}
            </button>
          </div>
        </div>

        {/* Результат: отчёт не сформирован */}
        {data && !data.reportReady && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-6 py-5 text-center">
            <div className="text-3xl mb-3">&#8987;</div>
            <h3 className="text-lg font-bold text-amber-800 mb-2">Работа ещё на проверке преподавателем</h3>
            <p className="text-sm text-amber-700">
              Итоговый отчёт ещё не сформирован. Пожалуйста, дождитесь завершения проверки.
            </p>
          </div>
        )}

        {/* Результат: студент не найден */}
        {data && data.reportReady && data.studentFound === false && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-6 py-5 text-center">
            <div className="text-3xl mb-3">&#10060;</div>
            <h3 className="text-lg font-bold text-red-800 mb-2">Студент не найден</h3>
            <p className="text-sm text-red-700">
              Проверьте правильность написания ФИО. Оно должно совпадать с тем, которое было указано при загрузке работы.
            </p>
          </div>
        )}

        {/* Результат: данные найдены */}
        {data && data.reportReady && data.studentFound && data.attempt && (
          <ReportResult attempt={data.attempt} />
        )}
      </main>

      <footer className="max-w-3xl mx-auto px-6 py-4 text-center">
        <p className="text-xs text-slate-400">
          Продолжая работу с приложением, вы подтверждаете своё согласие на обработку персональных данных
        </p>
      </footer>
    </div>
  );
}

// ============ КАРТОЧКА РЕЗУЛЬТАТА ============
function ReportResult({ attempt }: { attempt: ReportAttempt }) {
  const results = attempt.results || [];
  const passed = results.filter(r => r.passed === true).length;
  const failed = results.filter(r => r.passed === false).length;
  const manual = results.filter(r => r.passed === null).length;
  const total = results.length;
  const pct = total > 0 ? Math.round(passed / total * 100) : 0;

  // Группировка по секциям
  const sections: Record<string, typeof results> = {};
  results.forEach(item => {
    if (!sections[item.section]) sections[item.section] = [];
    sections[item.section].push(item);
  });

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Статус */}
      <div className="p-7 border-b border-slate-200">
        <div className="flex justify-between items-start gap-4">
          <div>
            <h2 className="text-lg font-bold text-blue-800">{attempt.student_name}</h2>
            <p className="text-sm text-slate-500 mt-1">
              {attempt.work_type === 'project' ? 'Магистерский проект' : 'Магистерская диссертация'}
              {' '}&middot; Попытка {attempt.attempt_number}
              {' '}&middot; {new Date(attempt.created_at).toLocaleDateString('ru-RU')}
            </p>
          </div>
          <div className={`px-5 py-2.5 rounded-lg text-base font-bold border-2 ${
            attempt.status === 'pass' ? 'bg-emerald-50 text-emerald-700 border-emerald-600' :
            attempt.status === 'pending' ? 'bg-amber-50 text-amber-700 border-amber-500' :
            'bg-red-50 text-red-700 border-red-600'
          }`}>
            {attempt.status === 'pass' ? 'ЗАЧЁТ' : attempt.status === 'pending' ? 'ОЖИДАЕТ ПРОВЕРКИ' : 'НЕЗАЧЁТ'}
          </div>
        </div>

        {/* Прогресс */}
        <div className="mt-4">
          <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden mb-1">
            <div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-slate-500">
            {passed} из {total} выполнено ({pct}%) &middot; {failed} не выполнено &middot; {manual} ручная проверка
          </p>
        </div>
      </div>

      {/* Отзыв преподавателя */}
      {attempt.teacher_review && (
        <div className="px-7 py-4 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-blue-800 mb-2">Отзыв преподавателя</h3>
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-slate-700 whitespace-pre-wrap">
            {attempt.teacher_review}
          </div>
        </div>
      )}

      {/* Чек-лист по секциям */}
      <div className="p-7">
        <h3 className="text-sm font-semibold text-blue-800 mb-4">Результаты проверки</h3>
        {Object.entries(sections).map(([section, items]) => (
          <div key={section} className="mb-4">
            <h4 className="text-sm font-semibold text-slate-600 mb-2">{section}</h4>
            {items.map(item => (
              <div key={item.id} className="flex items-start gap-2.5 py-2 border-b border-slate-100 last:border-0">
                <span className={`text-lg flex-shrink-0 ${item.passed === true ? 'text-emerald-600' : item.passed === false ? 'text-red-600' : 'text-slate-400'}`}>
                  {item.passed === true ? '\u2713' : item.passed === false ? '\u2717' : '\u2298'}
                </span>
                <div className="flex-1">
                  <div className="text-sm">{item.text}</div>
                  {item.note && <div className="text-xs text-slate-500 mt-0.5">{item.note}</div>}
                </div>
              </div>
            ))}
          </div>
        ))}
        {results.length === 0 && (
          <p className="text-sm text-slate-500">Детали проверки недоступны</p>
        )}
      </div>
    </div>
  );
}
