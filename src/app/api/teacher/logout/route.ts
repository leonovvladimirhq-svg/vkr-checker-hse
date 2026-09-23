// POST /api/teacher/logout — выход: кука сессии стирается.

import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/teacher-auth';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  return res;
}
