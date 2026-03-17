// ============================================================
// POST /api/digest — Отправка ежедневного email-дайджеста
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getTodayAttempts, getSetting } from '@/lib/db';
import nodemailer from 'nodemailer';

export async function POST(req: NextRequest) {
  try {
    const digestEmail = getSetting('digest_email');
    if (!digestEmail) {
      return NextResponse.json(
        { error: 'Email для дайджеста не настроен' },
        { status: 400 }
      );
    }

    const attempts = getTodayAttempts();
    if (attempts.length === 0) {
      return NextResponse.json({ message: 'Нет загрузок за сегодня — дайджест не отправлен' });
    }

    // Формирование HTML-письма
    const rows = attempts.map(a => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee">${a.student_name}</td>
        <td style="padding:8px;border-bottom:1px solid #eee">${a.work_type === 'project' ? 'Проект' : 'Диссертация'}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;color:${a.status === 'pass' ? '#059669' : '#dc2626'};font-weight:bold">
          ${a.status === 'pass' ? 'ЗАЧЁТ' : 'НЕЗАЧЁТ'}
        </td>
        <td style="padding:8px;border-bottom:1px solid #eee">${a.attempt_number} / 3</td>
      </tr>
    `).join('');

    const passCount = attempts.filter(a => a.status === 'pass').length;
    const failCount = attempts.filter(a => a.status === 'fail').length;

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#1e40af">Дайджест проверки ВКР</h2>
        <p style="color:#64748b">${new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>

        <div style="display:flex;gap:16px;margin:16px 0">
          <div style="background:#ecfdf5;padding:12px 20px;border-radius:8px">
            <strong style="color:#059669;font-size:24px">${passCount}</strong><br>
            <span style="color:#059669;font-size:12px">Зачёт</span>
          </div>
          <div style="background:#fef2f2;padding:12px 20px;border-radius:8px">
            <strong style="color:#dc2626;font-size:24px">${failCount}</strong><br>
            <span style="color:#dc2626;font-size:12px">Незачёт</span>
          </div>
        </div>

        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead>
            <tr style="background:#f1f5f9">
              <th style="padding:8px;text-align:left">ФИО</th>
              <th style="padding:8px;text-align:left">Тип</th>
              <th style="padding:8px;text-align:left">Статус</th>
              <th style="padding:8px;text-align:left">Попытка</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>

        <p style="color:#94a3b8;font-size:12px;margin-top:24px">
          Всего загрузок за день: ${attempts.length}
        </p>
      </div>
    `;

    // Отправка через SMTP
    if (process.env.SMTP_HOST && process.env.SMTP_USER) {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      await transporter.sendMail({
        from: process.env.SMTP_USER,
        to: digestEmail,
        subject: `Дайджест ВКР — ${new Date().toLocaleDateString('ru-RU')}`,
        html,
      });

      return NextResponse.json({ message: 'Дайджест отправлен', to: digestEmail });
    }

    // Если SMTP не настроен — возвращаем HTML для превью
    return NextResponse.json({
      message: 'SMTP не настроен — дайджест не отправлен',
      preview: html,
      to: digestEmail,
    });

  } catch (error: any) {
    console.error('Digest error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
