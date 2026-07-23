'use client';

import { CalendarRange } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/** Kompakter Zeitraumfilter (eine Zeile) für die persönliche Auswertung. */
export function ReportPeriodFilter({
  defaultFrom,
  defaultTo,
}: {
  defaultFrom: string;
  defaultTo: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setParam = (key: 'from' | 'to', value: string | null) => {
    const params = new URLSearchParams();
    const from = key === 'from' ? value : searchParams.get('from');
    const to = key === 'to' ? value : searchParams.get('to');
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="flex items-center gap-1.5 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-panel)] px-2.5 py-1.5 shadow-[var(--shadow-panel)]">
      <CalendarRange className="size-4 shrink-0 text-[var(--color-ink-subtle)]" aria-hidden />
      <input
        aria-label="Zeitraum von"
        type="date"
        defaultValue={searchParams.get('from') ?? defaultFrom}
        onChange={(event) => setParam('from', event.target.value || null)}
        className="w-[7.5rem] bg-transparent text-[length:var(--text-sm)] text-[var(--color-ink)] outline-none [color-scheme:light] dark:[color-scheme:dark]"
      />
      <span className="text-[var(--color-ink-subtle)]">–</span>
      <input
        aria-label="Zeitraum bis"
        type="date"
        defaultValue={searchParams.get('to') ?? defaultTo}
        onChange={(event) => setParam('to', event.target.value || null)}
        className="w-[7.5rem] bg-transparent text-[length:var(--text-sm)] text-[var(--color-ink)] outline-none [color-scheme:light] dark:[color-scheme:dark]"
      />
    </div>
  );
}
