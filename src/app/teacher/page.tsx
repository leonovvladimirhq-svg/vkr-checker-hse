'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface StudentSummary {
  id: number;
  student_name: string;
  work_type: string;
  status: string;
  attempt_number: number;
  last_date: string;
  wave: number;
}

interface AttemptRow {
  id: number;
  student_name: string;
  work_type: string;
  status: string;
  attempt_number: number;
  created_at: string;
  file_name: string | null;
}

interface CheckResultItem {
  id: string;
  section: string;
  text: string;
  passed: boolean | null;
  note: string;
}

interface AttemptDetail {
  id: number;
  student_name: string;
  work_type: string;
  attempt_number: number;
  status: string;
  results: CheckResultItem[];
  file_name: string | null;
  db_link: string | null;
  pres_link: string | null;
  uses_ai: number;
  created_at: string;
}

interface StudentsData {
  students: StudentSummary[];
  stats: { total: number; passed: number; failed: number; pending: number };
  settings: { digestEmail: string; currentWave: string };
}

export default function TeacherPage() {
  // Авторизация
  const [authenticated, setAuthenticated] = useState(false);
  const [loginInput, setLoginInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState('');

  const [data, setData] = useState<StudentsData | null>(null);
  const [todayAttempts, setTodayAttempts] = useState<AttemptRow[]>([]);
  const [digestEmail, setDigestEmail] = useState('');
  const [currentWave, setCurrentWave] = useState('1');
  const [saving, setSaving] = useState(false);
  const [sendingDigest, setSendingDigest] = useState(false);
  const [message, setMessage] = useState('');

  // Раскрытые строки студентов (по имени)
  const [expandedStudent, setExpandedStudent] = useState<string | null>(null);
  const [studentAttempts, setStudentAttempts] = useState<AttemptRow[]>([]);
  const [loadingAttempts, setLoadingAttempts] = useState(false);

  // Модальное окно с деталями проверки
  const [selectedAttempt, setSelectedAttempt] = useState<AttemptDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Подтверждение удаления
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const handleLogin = () => {
    if (loginInput === 'admin 1029' && passwordInput === 'hsevkrch12') {
      setAuthenticated(true);
      setLoginError('');
    } else {
      setLoginError('Неверный логин или пароль');
    }
  };

  useEffect(() => {
    if (!authenticated) return;
    fetchData();
    fetchToday();
  }, [authenticated]);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/students');
      const json = await res.json();
      setData(json);
      setDigestEmail(json.settings?.digestEmail || '');
      setCurrentWave(json.settings?.currentWave || '1');
    } catch (err) {
      console.error('Failed to fetch students:', err);
    }
  };

  const fetchToday = async () => {
    try {
      const res = await fetch('/api/students?today=1');
      const json = await res.json();
      setTodayAttempts(json.attempts || []);
    } catch (err) {
      console.error('Failed to fetch today:', err);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      await fetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ digestEmail, currentWave }),
      });
      setMessage('Настройки сохранены');
      setTimeout(() => setMessage(''), 3000);
    } catch {
      setMessage('Ошибка сохранения');
    }
    setSaving(false);
  };

  const sendDigest = async () => {
    setSendingDigest(true);
    try {
      const res = await fetch('/api/digest', { method: 'POST' });
      const json = await res.json();
      setMessage(json.message || 'Дайджест отправлен');
      setTimeout(() => setMessage(''), 5000);
    } catch {
      setMessage('Ошибка отправки');
    }
    setSendingDigest(false);
  };

  // Раскрыть/свернуть попытки студента
  const toggleStudent = async (studentName: string) => {
    if (expandedStudent === studentName) {
      setExpandedStudent(null);
      setStudentAttempts([]);
      return;
    }
    setExpandedStudent(studentName);
    setLoadingAttempts(true);
    try {
      const res = await fetch(`/api/attempts?student=${encodeURIComponent(studentName)}`);
      const json = await res.json();
      setStudentAttempts(json.attempts || []);
    } catch {
      setStudentAttempts([]);
    }
    setLoadingAttempts(false);
  };

  // Открыть детали проверки
  const openDetail = async (attemptId: number) => {
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/attempts?id=${attemptId}`);
      const json = await res.json();
      setSelectedAttempt(json);
    } catch {
      setMessage('Ошибка загрузки деталей');
    }
    setLoadingDetail(false);
  };

  // Удалить попытку
  const handleDelete = async (attemptId: number) => {
    try {
      const res = await fetch(`/api/attempts?id=${attemptId}`, { method: 'DELETE' });
      if (res.ok) {
        setDeleteConfirm(null);
        setMessage('Проверка удалена');
        setTimeout(() => setMessage(''), 3000);
        // Обновить данные
        fetchData();
        fetchToday();
        // Обновить раскрытый список если открыт
        if (expandedStudent) {
          const updated = studentAttempts.filter(a => a.id !== attemptId);
          setStudentAttempts(updated);
          if (updated.length === 0) setExpandedStudent(null);
        }
      }
    } catch {
      setMessage('Ошибка удаления');
    }
  };

  const stats = data?.stats || { total: 57, passed: 0, failed: 0, pending: 57 };

  // Форма входа
  if (!authenticated) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 w-full max-w-sm">
          <h2 className="text-lg font-bold text-blue-800 mb-1">Вход в панель преподавателя</h2>
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
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-slate-800 to-blue-700 text-white shadow-lg">
        <div className="max-w-5xl mx-auto px-6 py-5 flex justify-between items-center">
          <div>
            <h1 className="text-xl font-bold">Проверка ВКР</h1>
            <p className="text-xs opacity-75 mt-0.5">Панель преподавателя</p>
          </div>
          <nav className="flex gap-1">
            <Link href="/" className="bg-white/15 hover:bg-white/25 px-4 py-2 rounded-lg text-sm transition">
              Студент
            </Link>
            <span className="bg-white/30 px-4 py-2 rounded-lg text-sm font-medium">Преподаватель</span>
          </nav>
        </div>
        <div className="border-t border-white/10">
          <div className="max-w-5xl mx-auto px-6 py-1.5 text-xs text-white/60">
            Нашли ошибку? Сообщите разработчику:{' '}
            <a href="mailto:vleonov@hse.ru" className="underline hover:text-white/80">vleonov@hse.ru</a>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Уведомление */}
        {message && (
          <div className="bg-blue-50 border border-blue-200 text-blue-700 rounded-lg px-4 py-3 mb-6 text-sm">
            {message}
          </div>
        )}

        {/* Настройки */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 mb-6">
          <h2 className="text-lg font-bold text-blue-800 mb-4">Настройка email-дайджеста</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-semibold mb-1.5">Email для дайджеста</label>
              <input type="email" value={digestEmail} onChange={e => setDigestEmail(e.target.value)}
                placeholder="professor@hse.ru"
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5">Текущая волна</label>
              <select value={currentWave} onChange={e => setCurrentWave(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-500">
                <option value="1">Волна 1 (до 20 апреля)</option>
                <option value="2">Волна 2 (до 27 апреля)</option>
                <option value="3">Волна 3 (до 12 мая)</option>
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={saveSettings} disabled={saving}
              className="px-5 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-300">
              {saving ? 'Сохранение...' : 'Сохранить настройки'}
            </button>
            <button onClick={sendDigest} disabled={sendingDigest}
              className="px-5 py-2 rounded-lg text-sm font-semibold bg-slate-100 hover:bg-slate-200 border border-slate-200">
              {sendingDigest ? 'Отправка...' : 'Отправить дайджест сейчас'}
            </button>
          </div>
        </div>

        {/* Статистика */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard num={stats.total} label="Всего студентов" color="text-blue-600" />
          <StatCard num={stats.passed} label="Зачёт" color="text-emerald-600" />
          <StatCard num={stats.failed} label="Незачёт" color="text-red-600" />
          <StatCard num={stats.pending} label="Не загрузили" color="text-amber-600" />
        </div>

        {/* Сводная таблица */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 mb-6">
          <h2 className="text-lg font-bold text-blue-800 mb-4">Сводная таблица студентов</h2>
          {data?.students && data.students.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="w-8 px-2 py-2.5 border-b-2 border-slate-200"></th>
                    <th className="text-left px-3 py-2.5 font-semibold border-b-2 border-slate-200">ФИО</th>
                    <th className="text-left px-3 py-2.5 font-semibold border-b-2 border-slate-200">Тип</th>
                    <th className="text-left px-3 py-2.5 font-semibold border-b-2 border-slate-200">Статус</th>
                    <th className="text-left px-3 py-2.5 font-semibold border-b-2 border-slate-200">Попытка</th>
                    <th className="text-left px-3 py-2.5 font-semibold border-b-2 border-slate-200">Дата</th>
                    <th className="text-left px-3 py-2.5 font-semibold border-b-2 border-slate-200">Волна</th>
                  </tr>
                </thead>
                <tbody>
                  {data.students.map((s, i) => (
                    <>
                      <tr key={`student-${i}`}
                        onClick={() => toggleStudent(s.student_name)}
                        className="hover:bg-blue-50 cursor-pointer transition-colors">
                        <td className="px-2 py-2.5 border-b border-slate-100 text-center text-slate-400">
                          <span className={`inline-block transition-transform ${expandedStudent === s.student_name ? 'rotate-90' : ''}`}>
                            &#9654;
                          </span>
                        </td>
                        <td className="px-3 py-2.5 border-b border-slate-100 font-medium">{s.student_name}</td>
                        <td className="px-3 py-2.5 border-b border-slate-100">{s.work_type === 'project' ? 'Проект' : 'Диссертация'}</td>
                        <td className="px-3 py-2.5 border-b border-slate-100">
                          <StatusChip status={s.status} />
                        </td>
                        <td className="px-3 py-2.5 border-b border-slate-100">{s.attempt_number} / 3</td>
                        <td className="px-3 py-2.5 border-b border-slate-100">{new Date(s.last_date).toLocaleDateString('ru-RU')}</td>
                        <td className="px-3 py-2.5 border-b border-slate-100">Волна {s.wave}</td>
                      </tr>
                      {/* Раскрытые попытки студента */}
                      {expandedStudent === s.student_name && (
                        <tr key={`attempts-${i}`}>
                          <td colSpan={7} className="px-0 py-0 border-b border-slate-200">
                            <div className="bg-slate-50 px-6 py-3">
                              {loadingAttempts ? (
                                <p className="text-xs text-slate-500 py-2">Загрузка попыток...</p>
                              ) : studentAttempts.length > 0 ? (
                                <div className="space-y-1.5">
                                  <p className="text-xs font-semibold text-slate-500 mb-2">Все попытки ({studentAttempts.length}):</p>
                                  {studentAttempts.map(a => (
                                    <div key={a.id} className="flex items-center gap-3 bg-white rounded-lg px-4 py-2.5 border border-slate-200">
                                      <span className={`text-base ${a.status === 'pass' ? 'text-emerald-600' : 'text-red-600'}`}>
                                        {a.status === 'pass' ? '✓' : '✗'}
                                      </span>
                                      <span className="text-sm flex-1">
                                        Попытка {a.attempt_number}
                                        {a.file_name && <span className="text-slate-400 ml-2">({a.file_name})</span>}
                                      </span>
                                      <span className="text-xs text-slate-500">
                                        {new Date(a.created_at).toLocaleString('ru-RU')}
                                      </span>
                                      <StatusChip status={a.status} />
                                      <button
                                        onClick={(e) => { e.stopPropagation(); openDetail(a.id); }}
                                        className="px-3 py-1 text-xs font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-700 transition">
                                        Подробнее
                                      </button>
                                      {deleteConfirm === a.id ? (
                                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                          <button onClick={() => handleDelete(a.id)}
                                            className="px-2 py-1 text-xs font-semibold bg-red-600 text-white rounded-md hover:bg-red-700">
                                            Да
                                          </button>
                                          <button onClick={() => setDeleteConfirm(null)}
                                            className="px-2 py-1 text-xs font-semibold bg-slate-200 text-slate-600 rounded-md hover:bg-slate-300">
                                            Нет
                                          </button>
                                        </div>
                                      ) : (
                                        <button
                                          onClick={(e) => { e.stopPropagation(); setDeleteConfirm(a.id); }}
                                          className="px-2 py-1 text-xs font-semibold text-red-600 bg-red-50 rounded-md hover:bg-red-100 border border-red-200 transition"
                                          title="Удалить проверку">
                                          Удалить
                                        </button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-slate-500 py-2">Нет попыток</p>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Пока нет загруженных работ</p>
          )}
        </div>

        {/* Дневной дайджест */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7">
          <h2 className="text-lg font-bold text-blue-800 mb-4">Загрузки за сегодня</h2>
          {todayAttempts.length > 0 ? (
            <div className="space-y-2">
              {todayAttempts.map((a, i) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
                  <span className={`text-lg ${a.status === 'pass' ? 'text-emerald-600' : 'text-red-600'}`}>
                    {a.status === 'pass' ? '✓' : '✗'}
                  </span>
                  <span className="text-sm flex-1">{a.student_name}</span>
                  <StatusChip status={a.status} />
                  <span className="text-xs text-slate-500">попытка {a.attempt_number}</span>
                </div>
              ))}
              <p className="text-xs text-slate-400 pt-2">Всего за день: {todayAttempts.length} загрузок</p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Сегодня никто не загружал работы</p>
          )}
        </div>
      </main>

      {/* Модальное окно деталей проверки */}
      {(selectedAttempt || loadingDetail) && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-10 overflow-y-auto"
          onClick={() => { setSelectedAttempt(null); setLoadingDetail(false); }}>
          <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full mx-4 mb-10"
            onClick={e => e.stopPropagation()}>
            {loadingDetail && !selectedAttempt ? (
              <div className="p-10 text-center">
                <div className="w-10 h-10 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm text-slate-500">Загрузка...</p>
              </div>
            ) : selectedAttempt && (
              <AttemptDetailModal attempt={selectedAttempt} onClose={() => setSelectedAttempt(null)} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============ МОДАЛЬНОЕ ОКНО ДЕТАЛЕЙ ============
function AttemptDetailModal({ attempt, onClose }: { attempt: AttemptDetail; onClose: () => void }) {
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
    <>
      <div className="p-7 border-b border-slate-200">
        <div className="flex justify-between items-start gap-4">
          <div>
            <h2 className="text-lg font-bold text-blue-800">Результаты проверки</h2>
            <p className="text-sm text-slate-500 mt-1">
              {attempt.student_name} &middot; {attempt.work_type === 'project' ? 'Магистерский проект' : 'Магистерская диссертация'} &middot; Попытка {attempt.attempt_number}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {new Date(attempt.created_at).toLocaleString('ru-RU')}
              {attempt.file_name && <> &middot; {attempt.file_name}</>}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className={`px-5 py-2.5 rounded-lg text-base font-bold border-2 ${attempt.status === 'pass' ? 'bg-emerald-50 text-emerald-700 border-emerald-600' : 'bg-red-50 text-red-700 border-red-600'}`}>
              {attempt.status === 'pass' ? '✓ ЗАЧЁТ' : '✗ НЕЗАЧЁТ'}
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
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

      <div className="p-7 max-h-[60vh] overflow-y-auto">
        {Object.entries(sections).map(([section, items]) => (
          <div key={section} className="mb-4">
            <h3 className="text-sm font-semibold text-blue-800 mb-2">{section}</h3>
            {items.map(item => (
              <div key={item.id} className="flex items-start gap-2.5 py-2 border-b border-slate-100 last:border-0">
                <span className={`text-lg flex-shrink-0 ${item.passed === true ? 'text-emerald-600' : item.passed === false ? 'text-red-600' : 'text-slate-400'}`}>
                  {item.passed === true ? '✓' : item.passed === false ? '✗' : '&#8856;'}
                </span>
                <div className="flex-1">
                  <div className="text-sm">{item.text}</div>
                  {item.note && <div className="text-xs text-slate-500 mt-0.5">{item.note}</div>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="p-5 border-t border-slate-200 flex justify-end">
        <button onClick={onClose}
          className="px-5 py-2 rounded-lg text-sm font-semibold bg-slate-100 hover:bg-slate-200 border border-slate-200">
          Закрыть
        </button>
      </div>
    </>
  );
}

// ============ ВСПОМОГАТЕЛЬНЫЕ КОМПОНЕНТЫ ============
function StatCard({ num, label, color }: { num: number; label: string; color: string }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 text-center">
      <div className={`text-3xl font-bold ${color}`}>{num}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const styles = {
    pass: 'bg-emerald-50 text-emerald-700',
    fail: 'bg-red-50 text-red-700',
    pending: 'bg-amber-50 text-amber-700',
  }[status] || 'bg-slate-100 text-slate-600';

  const labels = {
    pass: 'Зачёт',
    fail: 'Незачёт',
  }[status] || 'Ожидание';

  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${styles}`}>
      {labels}
    </span>
  );
}
