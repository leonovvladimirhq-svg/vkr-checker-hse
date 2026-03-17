import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Проверка ВКР — Сервис автоматической проверки',
  description: 'Автоматическая проверка магистерских работ по чек-листу требований',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body className="bg-slate-50 text-slate-800 min-h-screen">{children}</body>
    </html>
  );
}
