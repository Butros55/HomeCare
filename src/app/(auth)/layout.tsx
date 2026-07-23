import { redirect } from 'next/navigation';

import { APP_NAME } from '@/lib/app-config';
import { getCurrentSession } from '@/server/auth/session';

/** Öffentliche Auth-Seiten: angemeldete Benutzer werden zum Dashboard geleitet. */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();
  if (session) redirect('/dashboard');

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[var(--color-canvas)] px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <div
          className="bg-brand-gradient flex size-10 items-center justify-center rounded-[var(--radius-lg)] text-[length:var(--text-lg)] font-bold text-white shadow-[0_6px_16px_var(--color-brand-ring)]"
          aria-hidden
        >
          {APP_NAME.charAt(0)}
        </div>
        <span className="text-[length:var(--text-2xl)] font-semibold tracking-tight">{APP_NAME}</span>
      </div>
      <div className="w-full max-w-sm rounded-[var(--radius-xl)] border border-[var(--color-line-subtle)] bg-[var(--color-panel)] p-6 shadow-[var(--shadow-panel)]">
        {children}
      </div>
      <p className="mt-6 max-w-sm text-center text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
        Einsatzplanung für Haushaltshilfen – Kunden, Stunden, Termine und Routen an einem Ort.
      </p>
    </div>
  );
}
