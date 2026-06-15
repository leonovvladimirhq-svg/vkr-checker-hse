'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { saveAuth, readAuth, clearAuth } from '@/lib/authCache';

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
  file_path: string | null;
  feedback: string | null;
  teacher_review: string | null;
  tech_comment: string | null;
  created_at: string;
}

interface StudentsData {
  students: StudentSummary[];
  stats: { total: number; passed: number; failed: number; pendingReview: number; notSubmitted: number };
  settings: { digestEmail: string; currentWave: string };
}

// ===== Курсовые работы =====
interface CourseSummary {
  id: number;
  studentName: string;
  workTitle: string | null;
  courseType: 'research' | 'project';
  fileName: string | null;
  wordCount: number | null;
  pageEstimate: number | null;
  submittedAt: string;
  createdAt: string;
  readinessStatus: string | null;
  readinessText: string | null;
  attemptNumber: number;
  hasFile: boolean;
  source?: string;
  hasTeacherReview?: boolean;
  checkerGrade?: string | null;
  feedbackRating?: string | null;
  feedbackText?: string | null;
  hasFeedback?: boolean;
}

interface CourseDetail extends CourseSummary {
  analysis: any | null;
}

const READINESS_COLORS: Record<string, string> = {
  ready_for_credit: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  almost_there:     'bg-lime-100 text-lime-800 border-lime-300',
  right_direction:  'bg-yellow-100 text-yellow-800 border-yellow-300',
  fix_then_defend:  'bg-amber-100 text-amber-800 border-amber-300',
  critical_issues:  'bg-red-100 text-red-800 border-red-300',
};

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

  // === Курсовые работы (отдельный блок) ===
  const [courseList, setCourseList] = useState<CourseSummary[]>([]);
  const [courseDetail, setCourseDetail] = useState<CourseDetail | null>(null);
  const [reanalyzingId, setReanalyzingId] = useState<number | null>(null);
  const [courseMsg, setCourseMsg] = useState('');
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [uploadingReviewId, setUploadingReviewId] = useState<number | null>(null);
  const [deletingCourseId, setDeletingCourseId] = useState<number | null>(null);
  const [feedbackModal, setFeedbackModal] = useState<{ studentName: string; rating: string | null; text: string | null } | null>(null);

  // Подтверждение удаления
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  // Восстановление авторизации из localStorage при первом рендере (TTL 24 часа)
  useEffect(() => {
    if (readAuth('teacher')) {
      setAuthenticated(true);
    }
  }, []);

  const handleLogin = () => {
    if (loginInput === 'admin 1029' && passwordInput === 'hsevkrch12') {
      setAuthenticated(true);
      setLoginError('');
      saveAuth('teacher');
    } else {
      setLoginError('Неверный логин или пароль');
    }
  };

  const handleLogout = () => {
    clearAuth('teacher');
    setAuthenticated(false);
    setLoginInput('');
    setPasswordInput('');
    setData(null);
    setTodayAttempts([]);
  };

  useEffect(() => {
    if (!authenticated) return;
    fetchData();
    fetchToday();
    fetchCourseList();
  }, [authenticated]);

  const fetchCourseList = async () => {
    try {
      const res = await fetch('/api/course/teacher');
      const json = await res.json();
      setCourseList(json.items || []);
    } catch (err) {
      console.error('Failed to fetch course works:', err);
    }
  };

  const openCourseDetail = async (id: number) => {
    try {
      const res = await fetch(`/api/course/teacher?id=${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Не удалось загрузить детали');
      setCourseDetail(json as CourseDetail);
    } catch (err: any) {
      setCourseMsg('Ошибка: ' + (err.message || err));
    }
  };

  const downloadCourseFile = (id: number) => {
    window.open(`/api/course/download?id=${id}`, '_blank');
  };

  const reanalyzeCourse = async (id: number) => {
    if (!window.confirm('Запустить повторный анализ через ChatGPT и сгенерировать Word-отзыв? Это займёт 1–2 минуты.')) return;
    setReanalyzingId(id);
    setCourseMsg('');
    try {
      const res = await fetch('/api/course/reanalyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Ошибка ${res.status}`);
      }
      // Скачиваем .docx
      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition') || '';
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/i) || disposition.match(/filename="?([^";]+)"?/i);
      const filename = match ? decodeURIComponent(match[1]) : `Отзыв_${id}.docx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setCourseMsg('✓ Word-отзыв сгенерирован и скачан.');
    } catch (err: any) {
      setCourseMsg('Ошибка повторного исследования: ' + (err.message || err));
    } finally {
      setReanalyzingId(null);
    }
  };

  // Загрузка подписанного итогового отзыва преподавателя к конкретной работе
  const uploadTeacherReview = async (id: number, file: File) => {
    setUploadingReviewId(id);
    setCourseMsg('');
    try {
      const fd = new FormData();
      fd.append('attemptId', String(id));
      fd.append('file', file);
      const res = await fetch('/api/course/upload-review', { method: 'POST', body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Ошибка ${res.status}`);
      setCourseMsg('✓ Итоговый отзыв загружен.');
      await fetchCourseList();
    } catch (err: any) {
      setCourseMsg('Ошибка загрузки отзыва: ' + (err.message || err));
    } finally {
      setUploadingReviewId(null);
    }
  };

  // Выгрузка архива со всеми загруженными итоговыми отзывами
  const exportAllReviews = () => {
    window.open('/api/course/export-reviews', '_blank');
  };

  // Удаление работы курсовой (строка БД + файлы на сервере)
  const deleteCourseWork = async (c: CourseSummary) => {
    if (!window.confirm(`Удалить работу «${c.studentName}» безвозвратно? Будут удалены файл работы и загруженный отзыв.`)) return;
    setDeletingCourseId(c.id);
    setCourseMsg('');
    try {
      const res = await fetch(`/api/course/teacher?id=${c.id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Ошибка ${res.status}`);
      setCourseMsg('✓ Работа удалена.');
      await fetchCourseList();
    } catch (err: any) {
      setCourseMsg('Ошибка удаления: ' + (err.message || err));
    } finally {
      setDeletingCourseId(null);
    }
  };

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

  // Поставить зачёт (или принудительно перезаписать "Незачёт")
  const handleApprove = async (attemptId: number, currentStatus?: string) => {
    // Для статуса "Незачёт" требуется подтверждение — это перезаписывает автоматическую оценку
    if (currentStatus === 'fail') {
      const ok = window.confirm(
        'Вы действительно хотите принудительно поставить ЗАЧЁТ работе со статусом «Незачёт»?\n\n' +
        'Это перезапишет автоматическую оценку системы.'
      );
      if (!ok) return;
    }
    try {
      const res = await fetch(`/api/attempts?id=${attemptId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'pass' }),
      });
      if (res.ok) {
        setMessage(currentStatus === 'fail' ? 'Зачёт проставлен принудительно' : 'Зачёт поставлен');
        setTimeout(() => setMessage(''), 3000);
        fetchData();
        fetchToday();
        // Обновить раскрытый список
        if (expandedStudent) {
          setStudentAttempts(prev => prev.map(a => a.id === attemptId ? { ...a, status: 'pass' } : a));
        }
        // Обновить модалку
        if (selectedAttempt && selectedAttempt.id === attemptId) {
          setSelectedAttempt({ ...selectedAttempt, status: 'pass' });
        }
      }
    } catch {
      setMessage('Ошибка обновления статуса');
    }
  };

  // Поставить незачёт (принудительно для зачтённых работ)
  const handleReject = async (attemptId: number) => {
    const ok = window.confirm(
      'Вы действительно хотите принудительно поставить НЕЗАЧЁТ работе со статусом «Зачёт»?\n\n' +
      'Это перезапишет текущую оценку.'
    );
    if (!ok) return;
    try {
      const res = await fetch(`/api/attempts?id=${attemptId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'fail' }),
      });
      if (res.ok) {
        setMessage('Незачёт проставлен принудительно');
        setTimeout(() => setMessage(''), 3000);
        fetchData();
        fetchToday();
        if (expandedStudent) {
          setStudentAttempts(prev => prev.map(a => a.id === attemptId ? { ...a, status: 'fail' } : a));
        }
        if (selectedAttempt && selectedAttempt.id === attemptId) {
          setSelectedAttempt({ ...selectedAttempt, status: 'fail' });
        }
      }
    } catch {
      setMessage('Ошибка обновления статуса');
    }
  };

  // Выгрузка в Excel
  const exportExcel = async () => {
    if (!data?.students?.length) return;
    const XLSX = await import('xlsx');
    const rows = data.students.map(s => ({
      'ФИО': s.student_name,
      'Статус': s.status === 'pass' ? 'Зачёт' : s.status === 'pending' ? 'Ожидает проверки' : 'Незачёт',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 35 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Студенты');
    XLSX.writeFile(wb, 'студенты_вкр.xlsx');
  };

  const stats = data?.stats || { total: 57, passed: 0, failed: 0, pendingReview: 0, notSubmitted: 57 };

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
          <nav className="flex gap-1 print:hidden">
            <Link href="/" className="bg-white/15 hover:bg-white/25 px-4 py-2 rounded-lg text-sm transition">
              Студент
            </Link>
            <span className="bg-white/30 px-4 py-2 rounded-lg text-sm font-medium">Преподаватель</span>
            <Link href="/report" className="bg-white/15 hover:bg-white/25 px-4 py-2 rounded-lg text-sm transition">
              Итоговый отчет/Статус работы
            </Link>
            <Link href="/course" className="bg-white/15 hover:bg-white/25 px-4 py-2 rounded-lg text-sm transition">
              Курсовая работа
            </Link>
            <button onClick={handleLogout}
              className="bg-white/15 hover:bg-white/25 px-4 py-2 rounded-lg text-sm transition"
              title="Выйти (удалить сохранённый вход)">
              Выйти
            </button>
          </nav>
        </div>
        <div className="border-t border-white/10 print:hidden">
          <div className="max-w-5xl mx-auto px-6 py-1.5 text-xs text-white/60">
            Нашли ошибку? Сообщите разработчику:{' '}
            <a href="mailto:vleonov@hse.ru" className="underline hover:text-white/80">vleonov@hse.ru</a>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Уведомление */}
        {message && (
          <div className="bg-blue-50 border border-blue-200 text-blue-700 rounded-lg px-4 py-3 mb-6 text-sm print:hidden">
            {message}
          </div>
        )}

        {/* Настройки */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 mb-6 print:hidden">
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

        {/* Итоговый отчёт */}
        <ReportSection message={message} setMessage={setMessage} />

        {/* Статистика */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6 print:hidden">
          <StatCard num={stats.total} label="Всего студентов" color="text-blue-600" />
          <StatCard num={stats.passed} label="Зачёт" color="text-emerald-600" />
          <StatCard num={stats.failed} label="Незачёт" color="text-red-600" />
          <StatCard num={stats.pendingReview} label="Ожидает проверки" color="text-amber-600" />
          <StatCard num={stats.notSubmitted} label="Не загрузили" color="text-slate-400" />
        </div>

        {/* Сводная таблица */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 mb-6 print:shadow-none print:border-0 print:p-0">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-bold text-blue-800">Сводная таблица студентов</h2>
            <div className="flex gap-2 print:hidden">
              <button onClick={exportExcel}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition">
                Выгрузить в Excel
              </button>
              <button onClick={() => window.print()}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition">
                Выгрузить в PDF
              </button>
            </div>
          </div>
          {data?.students && data.students.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="w-8 px-2 py-2.5 border-b-2 border-slate-200 print:hidden"></th>
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
                        <td className="px-2 py-2.5 border-b border-slate-100 text-center text-slate-400 print:hidden">
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
                        <tr key={`attempts-${i}`} className="print:hidden">
                          <td colSpan={7} className="px-0 py-0 border-b border-slate-200">
                            <div className="bg-slate-50 px-6 py-3">
                              {loadingAttempts ? (
                                <p className="text-xs text-slate-500 py-2">Загрузка попыток...</p>
                              ) : studentAttempts.length > 0 ? (
                                <div className="space-y-1.5">
                                  <p className="text-xs font-semibold text-slate-500 mb-2">Все попытки ({studentAttempts.length}):</p>
                                  {studentAttempts.map(a => (
                                    <div key={a.id} className="flex items-center gap-3 bg-white rounded-lg px-4 py-2.5 border border-slate-200">
                                      <span className={`text-base ${a.status === 'pass' ? 'text-emerald-600' : a.status === 'pending' ? 'text-amber-600' : 'text-red-600'}`}>
                                        {a.status === 'pass' ? '✓' : a.status === 'pending' ? '⊘' : '✗'}
                                      </span>
                                      <span className="text-sm flex-1">
                                        Попытка {a.attempt_number}
                                        {a.file_name && <span className="text-slate-400 ml-2">({a.file_name})</span>}
                                      </span>
                                      <span className="text-xs text-slate-500">
                                        {new Date(a.created_at).toLocaleString('ru-RU')}
                                      </span>
                                      <StatusChip status={a.status} />
                                      {a.status !== 'pass' && (
                                        <button
                                          onClick={(e) => { e.stopPropagation(); handleApprove(a.id, a.status); }}
                                          className={`px-3 py-1 text-xs font-semibold text-white rounded-md transition ${
                                            a.status === 'fail'
                                              ? 'bg-orange-600 hover:bg-orange-700'
                                              : 'bg-emerald-600 hover:bg-emerald-700'
                                          }`}
                                          title={a.status === 'fail' ? 'Принудительно перезаписать незачёт' : 'Поставить зачёт'}>
                                          Поставить зачёт
                                        </button>
                                      )}
                                      {a.status === 'pass' && (
                                        <button
                                          onClick={(e) => { e.stopPropagation(); handleReject(a.id); }}
                                          className="px-3 py-1 text-xs font-semibold text-white rounded-md transition bg-red-600 hover:bg-red-700"
                                          title="Принудительно поставить незачёт">
                                          Поставить незачёт
                                        </button>
                                      )}
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
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 print:hidden">
          <h2 className="text-lg font-bold text-blue-800 mb-4">Загрузки за сегодня</h2>
          {todayAttempts.length > 0 ? (
            <div className="space-y-2">
              {todayAttempts.map((a, i) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
                  <span className={`text-lg ${a.status === 'pass' ? 'text-emerald-600' : a.status === 'pending' ? 'text-amber-600' : 'text-red-600'}`}>
                    {a.status === 'pass' ? '✓' : a.status === 'pending' ? '⊘' : '✗'}
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

        {/* ===== Курсовые работы студентов ===== */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 mb-6 mt-6">
          <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-bold text-blue-800">📚 Курсовые работы студентов</h2>
              <p className="text-xs text-slate-500 mt-0.5">Отдельный контур от ВКР: работы, отправленные через модуль «Курсовая работа»</p>
            </div>
            <button onClick={fetchCourseList} className="text-xs px-3 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 border border-slate-200">
              ↻ Обновить
            </button>
          </div>

          {courseMsg && (
            <div className={`text-sm rounded-lg px-4 py-2.5 mb-3 ${courseMsg.startsWith('✓') ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
              {courseMsg}
            </div>
          )}

          {courseList.length === 0 ? (
            <p className="text-sm text-slate-500">Пока ни одна курсовая не отправлена.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-200 text-left text-xs text-slate-500 uppercase">
                    <th className="py-2 px-2">№</th>
                    <th className="py-2 px-2">ФИО</th>
                    <th className="py-2 px-2">Тема работы</th>
                    <th className="py-2 px-2">Тип</th>
                    <th className="py-2 px-2">Дата отправки</th>
                    <th className="py-2 px-2">Итог анализа</th>
                    <th className="py-2 px-2 text-right">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {courseList.map((c, i) => (
                    <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2 px-2 text-slate-400">{i + 1}</td>
                      <td className="py-2 px-2 font-medium">
                        {c.studentName}
                        {c.source === 'teacher' && (
                          <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200 align-middle">препод.</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-slate-700 max-w-xs truncate" title={c.workTitle || ''}>{c.workTitle || '—'}</td>
                      <td className="py-2 px-2 text-xs text-slate-500">{c.courseType === 'research' ? 'ИКР' : 'КП'}</td>
                      <td className="py-2 px-2 text-xs text-slate-500 whitespace-nowrap">
                        {c.submittedAt ? new Date(c.submittedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                      </td>
                      <td className="py-2 px-2">
                        {c.readinessStatus ? (
                          <span className={`text-xs px-2 py-1 rounded-md border font-semibold ${READINESS_COLORS[c.readinessStatus] || 'bg-slate-100 text-slate-700 border-slate-300'}`}>
                            {c.readinessText || c.readinessStatus}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="py-2 px-2 text-right whitespace-nowrap">
                        <button onClick={() => openCourseDetail(c.id)}
                          className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 mr-1"
                          title="Посмотреть результаты анализа и рекомендации">
                          👁 Подробнее
                        </button>
                        <button onClick={() => downloadCourseFile(c.id)}
                          disabled={!c.hasFile}
                          className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 mr-1 disabled:opacity-40"
                          title="Скачать оригинал работы">
                          📥 Скачать
                        </button>
                        <button onClick={() => reanalyzeCourse(c.id)}
                          disabled={reanalyzingId === c.id || !c.hasFile}
                          className="text-xs px-2 py-1 rounded bg-violet-100 text-violet-800 hover:bg-violet-200 disabled:opacity-40 mr-1"
                          title="Повторный анализ через ChatGPT + Word-отзыв по шаблону">
                          {reanalyzingId === c.id ? '⏳ Идёт…' : '🔄 Повторное исследование'}
                        </button>
                        {c.hasTeacherReview && (
                          <span className="text-xs px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 mr-1" title="Итоговый отзыв загружен">
                            ✓ отзыв
                          </span>
                        )}
                        <label
                          className={`text-xs px-2 py-1 rounded bg-orange-100 text-orange-800 hover:bg-orange-200 cursor-pointer inline-block mr-1 ${uploadingReviewId === c.id ? 'opacity-50 pointer-events-none' : ''}`}
                          title="Загрузить подписанный итоговый отзыв (.docx/.pdf)">
                          {uploadingReviewId === c.id ? '⏳ Загрузка…' : (c.hasTeacherReview ? '📤 Заменить отзыв' : '📤 Загрузить итоговый отзыв')}
                          <input type="file" accept=".docx,.pdf" className="hidden"
                            onChange={e => { const f = e.target.files?.[0]; if (f) uploadTeacherReview(c.id, f); e.currentTarget.value = ''; }} />
                        </label>
                        {c.hasFeedback && (
                          <button onClick={() => setFeedbackModal({ studentName: c.studentName, rating: c.feedbackRating || null, text: c.feedbackText || null })}
                            className="text-xs px-2 py-1 rounded bg-sky-100 text-sky-800 hover:bg-sky-200 mr-1"
                            title="Отзыв пользователя о работе сервиса">
                            {c.feedbackRating === 'like' ? '👍' : c.feedbackRating === 'dislike' ? '👎' : '💬'} Отзыв
                          </button>
                        )}
                        <button onClick={() => deleteCourseWork(c)}
                          disabled={deletingCourseId === c.id}
                          className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-40"
                          title="Удалить работу безвозвратно (файл и запись)">
                          {deletingCourseId === c.id ? '⏳ Удаление…' : '🗑 Удалить'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-5 pt-4 border-t border-slate-100 flex items-center gap-3 flex-wrap">
            <button onClick={exportAllReviews}
              className="text-xs px-4 py-2 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 font-semibold">
              📦 Выгрузить всех
            </button>
            <span className="text-xs text-slate-400">
              Скачивает ZIP со всеми загруженными ИТОГОВЫМИ отзывами преподавателей (имена файлов — ФИО студентов).
            </span>
          </div>
        </div>
      </main>

      {/* Модальное окно деталей проверки */}
      {(selectedAttempt || loadingDetail) && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-10 overflow-y-auto print:hidden"
          onClick={() => { setSelectedAttempt(null); setLoadingDetail(false); }}>
          <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full mx-4 mb-10"
            onClick={e => e.stopPropagation()}>
            {loadingDetail && !selectedAttempt ? (
              <div className="p-10 text-center">
                <div className="w-10 h-10 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm text-slate-500">Загрузка...</p>
              </div>
            ) : selectedAttempt && (
              <AttemptDetailModal attempt={selectedAttempt} onClose={() => setSelectedAttempt(null)} onApprove={handleApprove} onReject={handleReject} />
            )}
          </div>
        </div>
      )}

      {/* ===== Модалка с деталями курсовой работы ===== */}
      {courseDetail && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-10 overflow-y-auto print:hidden"
          onClick={(e) => { if (e.target === e.currentTarget) setCourseDetail(null); }}>
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full mx-4 my-4 max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-7 py-4 flex justify-between items-start z-10">
              <div>
                <h2 className="text-lg font-bold text-blue-800">{courseDetail.studentName}</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  {courseDetail.courseType === 'research' ? 'Исследовательская курсовая' : 'Курсовой проект'}
                  {' · попытка №'}{courseDetail.attemptNumber}
                  {courseDetail.submittedAt && ' · отправлена ' + new Date(courseDetail.submittedAt).toLocaleString('ru-RU')}
                </p>
                {courseDetail.workTitle && <p className="text-sm mt-1"><span className="font-semibold">Тема:</span> {courseDetail.workTitle}</p>}
              </div>
              <button onClick={() => setCourseDetail(null)} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
            </div>

            <div className="p-7">
              {courseDetail.readinessText && (
                <div className={`rounded-lg border-2 px-4 py-3 mb-4 font-semibold ${READINESS_COLORS[courseDetail.readinessStatus || ''] || 'bg-slate-50 text-slate-700 border-slate-300'}`}>
                  Готовность к зачёту: {courseDetail.readinessText}
                </div>
              )}

              {courseDetail.analysis?.overallSummary && (
                <div className="mb-4">
                  <h3 className="text-sm font-bold text-blue-800 mb-1.5">Общая оценка</h3>
                  <p className="text-sm text-slate-700 leading-relaxed">{courseDetail.analysis.overallSummary}</p>
                </div>
              )}

              {courseDetail.analysis?.priorityAdvice?.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-bold text-blue-800 mb-2">🎯 Приоритетные рекомендации ({courseDetail.analysis.priorityAdvice.length})</h3>
                  <ol className="space-y-2">
                    {courseDetail.analysis.priorityAdvice.map((tip: string, i: number) => (
                      <li key={i} className="flex gap-2 items-start bg-blue-50 rounded px-3 py-2 border border-blue-100">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-xs">{i + 1}</span>
                        <span className="text-sm text-slate-800">{tip}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {courseDetail.analysis?.structuralAnalysis && (
                <div className="mb-4">
                  <h3 className="text-sm font-bold text-blue-800 mb-2">Структура работы</h3>
                  {courseDetail.analysis.structuralAnalysis.missingSections?.length > 0 && (
                    <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded px-3 py-2 mb-2">
                      <span className="font-semibold">Отсутствует:</span> {courseDetail.analysis.structuralAnalysis.missingSections.join(', ')}
                    </div>
                  )}
                  {courseDetail.analysis.structuralAnalysis.sections?.map((s: any, i: number) => (
                    <div key={i} className="border border-slate-200 rounded p-2.5 mb-1.5 text-sm">
                      <div className="flex justify-between gap-2"><span className="font-semibold">{s.section}</span><span className="text-xs text-slate-500">{s.verdict}</span></div>
                      {s.comment && <p className="text-xs text-slate-600 mt-1">{s.comment}</p>}
                    </div>
                  ))}
                </div>
              )}

              {courseDetail.analysis?.recommendations?.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-bold text-blue-800 mb-2">Все рекомендации ({courseDetail.analysis.recommendations.length})</h3>
                  <div className="space-y-2">
                    {courseDetail.analysis.recommendations.map((r: any, i: number) => (
                      <div key={i} className="border border-slate-200 rounded p-2.5 text-sm">
                        <div className="text-xs text-slate-500 mb-0.5">[{r.category}] {r.section && '· ' + r.section}</div>
                        <div className="font-medium">{r.issue}</div>
                        <div className="text-slate-600 text-sm mt-1">{r.suggestion}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {courseDetail.hasFeedback && (
                <div className="mb-4 bg-sky-50 border border-sky-200 rounded-lg p-3">
                  <h3 className="text-sm font-bold text-sky-800 mb-1">
                    💬 Отзыв о работе сервиса {courseDetail.feedbackRating === 'like' ? '👍' : courseDetail.feedbackRating === 'dislike' ? '👎' : ''}
                  </h3>
                  {courseDetail.feedbackText
                    ? <p className="text-sm text-slate-700 whitespace-pre-line">{courseDetail.feedbackText}</p>
                    : <p className="text-sm text-slate-500">Без текста — только оценка.</p>}
                </div>
              )}

              <div className="flex gap-3 mt-6 pt-4 border-t border-slate-200">
                <button onClick={() => downloadCourseFile(courseDetail.id)}
                  disabled={!courseDetail.hasFile}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-slate-100 hover:bg-slate-200 disabled:opacity-40">
                  📥 Скачать оригинал
                </button>
                <button onClick={() => { reanalyzeCourse(courseDetail.id); }}
                  disabled={reanalyzingId === courseDetail.id || !courseDetail.hasFile}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40">
                  {reanalyzingId === courseDetail.id ? '⏳ Генерация…' : '🔄 Повторное исследование (.docx)'}
                </button>
                <button onClick={() => setCourseDetail(null)} className="ml-auto px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700">
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Модалка отзыва пользователя о работе сервиса */}
      {feedbackModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 print:hidden"
          onClick={(e) => { if (e.target === e.currentTarget) setFeedbackModal(null); }}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex justify-between items-start mb-2">
              <h3 className="text-base font-bold text-sky-800">
                💬 Отзыв о работе сервиса {feedbackModal.rating === 'like' ? '👍 Полезно' : feedbackModal.rating === 'dislike' ? '👎 Не очень' : ''}
              </h3>
              <button onClick={() => setFeedbackModal(null)} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
            </div>
            <p className="text-xs text-slate-500 mb-3">{feedbackModal.studentName}</p>
            {feedbackModal.text
              ? <p className="text-sm text-slate-700 whitespace-pre-line">{feedbackModal.text}</p>
              : <p className="text-sm text-slate-500">Без текста — пользователь оставил только оценку.</p>}
          </div>
        </div>
      )}

      {/* Оверлей при генерации Word */}
      {reanalyzingId !== null && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl p-10 text-center max-w-md shadow-xl">
            <div className="w-12 h-12 border-4 border-slate-200 border-t-violet-600 rounded-full animate-spin mx-auto mb-4" />
            <div className="font-semibold text-slate-800 mb-2">Повторный анализ через ChatGPT…</div>
            <div className="text-sm text-slate-500">Заполнение шаблона отзыва и генерация Word-файла. Может занять 1–2 минуты.</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ МОДАЛЬНОЕ ОКНО ДЕТАЛЕЙ ============
function AttemptDetailModal({ attempt, onClose, onApprove, onReject }: { attempt: AttemptDetail; onClose: () => void; onApprove: (id: number, currentStatus?: string) => void; onReject: (id: number) => void }) {
  const [reviewText, setReviewText] = useState(attempt.teacher_review || '');
  const [techText, setTechText] = useState(attempt.tech_comment || '');
  const [savingReview, setSavingReview] = useState(false);
  const [savingTech, setSavingTech] = useState(false);
  const [reviewSaved, setReviewSaved] = useState(false);
  const [techSaved, setTechSaved] = useState(false);

  const saveField = async (field: 'teacher_review' | 'tech_comment') => {
    const isTech = field === 'tech_comment';
    isTech ? setSavingTech(true) : setSavingReview(true);
    try {
      const res = await fetch(`/api/attempts?id=${attempt.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: isTech ? techText : reviewText }),
      });
      if (res.ok) {
        if (isTech) { setTechSaved(true); setTimeout(() => setTechSaved(false), 3000); }
        else { setReviewSaved(true); setTimeout(() => setReviewSaved(false), 3000); }
      }
    } catch {}
    isTech ? setSavingTech(false) : setSavingReview(false);
  };

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
              {attempt.file_path
                ? <> &middot; <a href={`/api/download?id=${attempt.id}`} className="text-blue-600 hover:text-blue-800 font-semibold underline" onClick={e => e.stopPropagation()}>Скачать работу</a></>
                : <> &middot; <span className="text-amber-600 font-medium">Файл не сохранён</span></>
              }
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className={`px-5 py-2.5 rounded-lg text-base font-bold border-2 ${
              attempt.status === 'pass' ? 'bg-emerald-50 text-emerald-700 border-emerald-600' :
              attempt.status === 'pending' ? 'bg-amber-50 text-amber-700 border-amber-500' :
              'bg-red-50 text-red-700 border-red-600'
            }`}>
              {attempt.status === 'pass' ? '✓ ЗАЧЁТ' : attempt.status === 'pending' ? '⊘ ОЖИДАЕТ ПРОВЕРКУ' : '✗ НЕЗАЧЁТ'}
            </div>
            {attempt.status !== 'pass' && (
              <button onClick={() => onApprove(attempt.id, attempt.status)}
                className={`px-4 py-2.5 rounded-lg text-sm font-bold text-white transition ${
                  attempt.status === 'fail'
                    ? 'bg-orange-600 hover:bg-orange-700'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
                title={attempt.status === 'fail' ? 'Принудительно перезаписать незачёт' : 'Поставить зачёт'}>
                Поставить зачёт
              </button>
            )}
            {attempt.status === 'pass' && (
              <button onClick={() => onReject(attempt.id)}
                className="px-4 py-2.5 rounded-lg text-sm font-bold text-white transition bg-red-600 hover:bg-red-700"
                title="Принудительно поставить незачёт">
                Поставить незачёт
              </button>
            )}
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

      {/* Отзыв студента */}
      {attempt.feedback && (
        <div className="px-7 pb-4">
          <h3 className="text-sm font-semibold text-blue-800 mb-2">Комментарий студента</h3>
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-slate-700">
            {attempt.feedback}
          </div>
        </div>
      )}

      {/* Отзыв преподавателя на работу */}
      <div className="px-7 pb-4">
        <h3 className="text-sm font-semibold text-blue-800 mb-2">Отзыв преподавателя на работу</h3>
        <p className="text-xs text-slate-400 mb-2">Этот отзыв будет виден студенту в итоговом отчёте</p>
        <textarea
          value={reviewText}
          onChange={e => setReviewText(e.target.value)}
          rows={3}
          placeholder="Напишите отзыв на работу студента..."
          className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 resize-y"
        />
        <div className="flex items-center gap-3 mt-2">
          <button onClick={() => saveField('teacher_review')} disabled={savingReview}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-300 transition">
            {savingReview ? 'Сохранение...' : 'Сохранить отзыв'}
          </button>
          {reviewSaved && <span className="text-xs text-emerald-600 font-medium">Сохранено</span>}
        </div>
      </div>

      {/* Технический комментарий */}
      <div className="px-7 pb-4">
        <h3 className="text-sm font-semibold text-slate-500 mb-2">Технический комментарий</h3>
        <p className="text-xs text-slate-400 mb-2">Виден только вам, не включается в отчёт для студента</p>
        <textarea
          value={techText}
          onChange={e => setTechText(e.target.value)}
          rows={2}
          placeholder="Заметки для себя..."
          className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100 resize-y"
        />
        <div className="flex items-center gap-3 mt-2">
          <button onClick={() => saveField('tech_comment')} disabled={savingTech}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-slate-500 text-white hover:bg-slate-600 disabled:bg-slate-300 transition">
            {savingTech ? 'Сохранение...' : 'Сохранить комментарий'}
          </button>
          {techSaved && <span className="text-xs text-emerald-600 font-medium">Сохранено</span>}
        </div>
      </div>

      <div className="p-5 border-t border-slate-200 flex justify-end gap-3 items-center">
        {attempt.file_path
          ? <a href={`/api/download?id=${attempt.id}`}
              className="px-5 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition inline-flex items-center gap-1.5">
              Скачать работу
            </a>
          : <span className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
              ⚠️ Файл утерян — попросите студента загрузить работу заново
            </span>
        }
        <button onClick={onClose}
          className="px-5 py-2 rounded-lg text-sm font-semibold bg-slate-100 hover:bg-slate-200 border border-slate-200">
          Закрыть
        </button>
      </div>
    </>
  );
}

// ============ СЕКЦИЯ «СОЗДАТЬ / ЗАКРЫТЬ ОТЧЁТ» ============
const REPORT_PASSWORD = '1234';

function ReportSection({ message, setMessage }: { message: string; setMessage: (m: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [reportOpen, setReportOpen] = useState<boolean | null>(null); // null = загружается
  const [reportDate, setReportDate] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/report?student=__status__')
      .then(r => r.json())
      .then(json => {
        setReportOpen(!!json.reportReady);
        if (json.reportReady) setReportDate(null); // дата не нужна
      })
      .catch(() => setReportOpen(false));
  }, []);

  const handleCreate = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: REPORT_PASSWORD }),
      });
      const json = await res.json();
      if (res.ok) {
        setReportOpen(true);
        setReportDate(json.generatedAt);
        setMessage('Итоговый отчёт опубликован — студенты могут видеть результаты');
        setTimeout(() => setMessage(''), 4000);
      } else {
        setMessage('Ошибка: ' + (json.error || 'неизвестная'));
      }
    } catch {
      setMessage('Ошибка создания отчёта');
    }
    setLoading(false);
  };

  const handleClose = async () => {
    const ok = window.confirm('Закрыть отчёт? Студенты перестанут видеть результаты до следующей публикации.');
    if (!ok) return;
    setLoading(true);
    try {
      const res = await fetch('/api/report', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: REPORT_PASSWORD }),
      });
      if (res.ok) {
        setReportOpen(false);
        setReportDate(null);
        setMessage('Итоговый отчёт закрыт');
        setTimeout(() => setMessage(''), 3000);
      }
    } catch {
      setMessage('Ошибка закрытия отчёта');
    }
    setLoading(false);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-7 mb-6 print:hidden">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-blue-800 mb-1">Итоговый отчёт</h2>
          <p className="text-xs text-slate-500">
            После публикации студенты смогут увидеть свои результаты на вкладке «Итоговый отчет/Статус работы»
          </p>
        </div>
        {reportOpen !== null && (
          <span className={`px-3 py-1 rounded-full text-xs font-semibold flex-shrink-0 ${reportOpen ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            {reportOpen ? '● Опубликован' : '○ Закрыт'}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 mt-4">
        {reportOpen === false && (
          <button onClick={handleCreate} disabled={loading}
            className="px-5 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-300 transition">
            {loading ? 'Публикация...' : 'Создать отчёт'}
          </button>
        )}
        {reportOpen === true && (
          <button onClick={handleClose} disabled={loading}
            className="px-5 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 disabled:bg-slate-300 transition">
            {loading ? 'Закрытие...' : 'Закрыть отчёт'}
          </button>
        )}
        {reportOpen === null && (
          <span className="text-xs text-slate-400">Загрузка...</span>
        )}
        {reportDate && (
          <span className="text-xs text-slate-500">
            Опубликован: {new Date(reportDate).toLocaleString('ru-RU')}
          </span>
        )}
      </div>
    </div>
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
    pending: 'Ожидает проверки',
  }[status] || 'Неизвестно';

  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${styles}`}>
      {labels}
    </span>
  );
}
