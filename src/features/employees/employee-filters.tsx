'use client';

import { LayoutGrid, List, Network, Search, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export function EmployeeFilters({ view }: { view: 'table' | 'cards' | 'hierarchy' }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = React.useState(searchParams.get('q') ?? '');

  const setParam = React.useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === null || value === '') params.delete(key);
      else params.set(key, value);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  React.useEffect(() => {
    const current = searchParams.get('q') ?? '';
    if (query === current) return;
    const timer = setTimeout(() => setParam('q', query || null), 300);
    return () => clearTimeout(timer);
  }, [query, searchParams, setParam]);

  const status = searchParams.get('status') ?? 'ACTIVE';
  const missingHours = searchParams.get('missingHours') === '1';
  const hasFilters = Boolean(searchParams.get('q')) || status !== 'ACTIVE' || missingHours;

  const views = [
    { key: 'table', icon: List, label: 'Tabellenansicht' },
    { key: 'cards', icon: LayoutGrid, label: 'Kartenansicht' },
    { key: 'hierarchy', icon: Network, label: 'Hierarchieansicht' },
  ] as const;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-52 flex-1 sm:max-w-xs">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[var(--color-ink-subtle)]"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name, Personalnummer…"
          aria-label="Mitarbeiter durchsuchen"
          className="pl-9"
        />
      </div>

      <Select value={status} onValueChange={(value) => setParam('status', value === 'ACTIVE' ? null : value)}>
        <SelectTrigger className="w-32" aria-label="Status filtern">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ACTIVE">Aktiv</SelectItem>
          <SelectItem value="INACTIVE">Inaktiv</SelectItem>
          <SelectItem value="ALL">Alle</SelectItem>
        </SelectContent>
      </Select>

      <label className="flex h-9 pointer-coarse:h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-panel-sunken)] px-3 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
        <Checkbox
          checked={missingHours}
          onCheckedChange={(checked) => setParam('missingHours', checked ? '1' : null)}
          aria-label="Nur Mitarbeiter mit fehlenden Zielstunden"
        />
        Fehlende Stunden
      </label>

      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQuery('');
            const params = new URLSearchParams();
            const currentView = searchParams.get('view');
            if (currentView) params.set('view', currentView);
            router.replace(`${pathname}?${params.toString()}`, { scroll: false });
          }}
        >
          <X aria-hidden /> Zurücksetzen
        </Button>
      ) : null}

      <div className="ml-auto hidden items-center rounded-full bg-[var(--color-panel-sunken)] p-1 md:flex">
        {views.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setParam('view', key === 'table' ? null : key)}
            aria-pressed={view === key}
            aria-label={label}
            className={cn(
              'flex size-7 pointer-coarse:size-10 items-center justify-center rounded-full transition-colors',
              view === key
                ? 'bg-[var(--color-panel)] text-[var(--color-ink)] shadow-[var(--shadow-panel)]'
                : 'text-[var(--color-ink-subtle)] hover:text-[var(--color-ink)]',
            )}
          >
            <Icon className="size-4" aria-hidden />
          </button>
        ))}
      </div>
    </div>
  );
}
