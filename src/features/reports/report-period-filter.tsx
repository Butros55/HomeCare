'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { Input, Label } from '@/components/ui/input';

/** Schlanker Zeitraumfilter für die persönliche Solo-/Kompakt-Auswertung. */
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
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <Label htmlFor="rpf-from">Von</Label>
        <Input
          id="rpf-from"
          type="date"
          defaultValue={searchParams.get('from') ?? defaultFrom}
          onChange={(event) =>
            setParam('from', event.target.value || null)
          }
          className="w-36"
        />
      </div>
      <div>
        <Label htmlFor="rpf-to">Bis</Label>
        <Input
          id="rpf-to"
          type="date"
          defaultValue={searchParams.get('to') ?? defaultTo}
          onChange={(event) => setParam('to', event.target.value || null)}
          className="w-36"
        />
      </div>
    </div>
  );
}
