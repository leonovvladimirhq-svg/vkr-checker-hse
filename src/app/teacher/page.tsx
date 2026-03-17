'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface StudentSummary {
  student_name: string;
  work_type: string;
  status: string;
  attempt_number: number;
  last_date: string;
  wave: number;
}

interface AttemptRow {
  student_name: string;
  work_type: string;
  status: string;
  attempt_number: number;
  created_at: string;
}

interface StudentsData {
  students: StudentSummary[];
  stats: { total: number; passed: number; failed: number; pending: number };
  settings: { digestEmail: string; currentWave: string };
}

export default function TeacherPage() {
  const [data, setData] = useState<StudentsData | null>(null);
  const [todayAttempts, setTodayAttempts] = useState<AttemptRow[]>([]);
  const [digestEmail, setDigestEmail] = useState('');
  const [currentWave, setCurrentWave] = useState('1');
  const [saving, setSaving] = useState(false);
  const [sendingDigest, setSendingDigest] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetchData();
    fetchToday();
  }, []);

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

  const stats = data?.stats || { total: 57, passed: 0, failed: 0, pending: 57 };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-slate-800 to-blue-700 text-white py-5 shadow-lg">
        <div className="max-w-5xl mx-auto px-6 flex justify-between items-center">
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
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5 border-b border-slate-100">{s.student_name}</td>
                      <td className="px-3 py-2.5 border-b border-slate-100">{s.work_type === 'project' ? 'Проект' : 'Диссертация'}</td>
                      <td className="px-3 py-2.5 border-b border-slate-100">
                        <StatusChip status={s.status} />
                      </td>
                      <td className="px-3 py-2.5 border-b border-slate-100">{s.attempt_number} / 3</td>
                      <td className="px-3 py-2.5 border-b border-slate-100">{new Date(s.last_date).toLocaleDateString('ru-RU')}</td>
                      <td className="px-3 py-2.5 border-b border-slate-100">Волна {s.wave}</td>
                    </tr>
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
    </div>
  );
}

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
