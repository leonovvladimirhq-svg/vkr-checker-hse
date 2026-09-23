// ============================================================
// POST /api/teacher/login — вход преподавателя { login, password }
//
// Ограничения числа попыток нет намеренно: пароли выдаются случайные,
// 12 знаков из 55-символьного алфавита (~69 бит) — подбор бессмыслен, а
// блокировка по числу ошибок заперла бы преподавателя, ошибившегося
// несколько раз подряд (заказчик просил такого не делать — см. дашборд).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { authenticate, issueSessionCookie } from '@/lib/teacher-auth';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const login = typeof body.login === 'string' ? body.login : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!login || !password) {
    return NextResponse.json({ error: 'Выберите учётную запись и введите пароль' }, { status: 400 });
  }

  const account = authenticate(login, password);
  if (!account) {
    return NextResponse.json({ error: 'Неверный пароль' }, { status: 401 });
  }

  const res = NextResponse.json({
    id: account.id,
    fullName: account.full_name,
    programme: account.programme,
    role: account.role,
  });
  issueSessionCookie(res, req, account);
  return res;
}
