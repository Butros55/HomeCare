'use client';

import { LayoutGrid, List, Search, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/misc';
import { cn } from '@/lib/utils';

/**
 * Filterleiste der Kundenliste. Zustand lebt in der URL (teilbar, Back-Button
 * funktioniert); die Suche ist entprellt.
 */
export function CustomerFilters({
  cities,
  employees,
  view,
}: {
  cities: string[];
  employees: { id: string; name: string }[];
  view: 'table' | 'cards';
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = React.useState(searchParams.get('q') ?? '');

  const setParam = React.useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === null || value === '' || value === 'ALL_VALUES') params.delete(key);
      else params.set(key, value);
      params.delete('page'); // Filterwechsel → zurück auf Seite 1
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  // Entprellte Suche.
  React.useEffect(() => {
    const current = searchParams.get('q') ?? '';
    if (query === current) return;
    const timer = setTimeout(() => setParam('q', query || null), 300);
    return () => clearTimeout(timer);
  }, [query, searchParams, setParam]);

  const status = searchParams.get('status') ?? 'ACTIVE';
  const city = searchParams.get('city') ?? '';
  const employeeId = searchParams.get('employeeId') ?? '';
  const openHours = searchParams.get('openHours') === '1';
  const hasFilters =
    Boolean(searchParams.get('q')) || status !== 'ACTIVE' || city || employeeId || openHours;

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
          placeholder="Name, Nummer, Telefon, Ort…"
          aria-label="Kunden durchsuchen"
          className="pl-9"
        />
      </div>

      <Select value={status} onValueChange={(value) => setParam('status', value === 'ACTIVE' ? null : value)}>
        <SelectTrigger className="w-36" aria-label="Status filtern">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ACTIVE">Aktiv</SelectItem>
          <SelectItem value="PAUSED">Pausiert</SelectItem>
          <SelectItem value="ARCHIVED">Archiviert</SelectItem>
          <SelectItem value="ALL">Alle</SelectItem>
        </SelectContent>
      </Select>

      <Select value={city || 'ALL_VALUES'} onValueChange={(value) => setParam('city', value)}>
        <SelectTrigger className="hidden w-40 md:flex" aria-label="Ort filtern">
          <SelectValue placeholder="Alle Orte" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL_VALUES">Alle Orte</SelectItem>
          {cities.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={employeeId || 'ALL_VALUES'} onValueChange={(value) => setParam('employeeId', value)}>
        <SelectTrigger className="hidden w-48 md:flex" aria-label="Nach Mitarbeiter filtern">
          <SelectValue placeholder="Alle Mitarbeiter" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL_VALUES">Alle Mitarbeiter</SelectItem>
          {employees.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <label className="flex h-9 pointer-coarse:h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-panel-sunken)] px-3 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
        <Checkbox
          checked={openHours}
          onCheckedChange={(checked) => setParam('openHours', checked ? '1' : null)}
          aria-label="Nur Kunden mit offenen Stunden"
        />
        Offene Stunden
      </label>

      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQuery('');
            router.replace(pathname, { scroll: false });
          }}
        >
          <X aria-hidden /> Zurücksetzen
        </Button>
      ) : null}

      <div className="ml-auto hidden items-center rounded-full bg-[var(--color-panel-sunken)] p-1 md:flex">
        <button
          type="button"
          onClick={() => setParam('view', null)}
          aria-pressed={view === 'table'}
          aria-label="Tabellenansicht"
          className={cn(
            'flex size-7 pointer-coarse:size-10 items-center justify-center rounded-full transition-colors',
            view === 'table'
              ? 'bg-[var(--color-panel)] text-[var(--color-ink)] shadow-[var(--shadow-panel)]'
              : 'text-[var(--color-ink-subtle)] hover:text-[var(--color-ink)]',
          )}
        >
          <List className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setParam('view', 'cards')}
          aria-pressed={view === 'cards'}
          aria-label="Kartenansicht"
          className={cn(
            'flex size-7 pointer-coarse:size-10 items-center justify-center rounded-full transition-colors',
            view === 'cards'
              ? 'bg-[var(--color-panel)] text-[var(--color-ink)] shadow-[var(--shadow-panel)]'
              : 'text-[var(--color-ink-subtle)] hover:text-[var(--color-ink)]',
          )}
        >
          <LayoutGrid className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** Sortierbare Spaltenüberschrift (URL-basiert). */
export function SortHeader({
  label,
  sortKey,
}: {
  label: string;
  sortKey: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeSort = searchParams.get('sort') ?? 'name';
  const dir = searchParams.get('dir') ?? 'asc';
  const isActive = activeSort === sortKey;

  return (
    <button
      type="button"
      onClick={() => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('sort', sortKey);
        params.set('dir', isActive && dir === 'asc' ? 'desc' : 'asc');
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }}
      className={cn(
        'inline-flex items-center gap-1 uppercase tracking-wider',
        isActive ? 'text-[var(--color-brand)]' : 'hover:text-[var(--color-ink)]',
      )}
    >
      {label}
      {isActive ? <span aria-hidden>{dir === 'asc' ? '↑' : '↓'}</span> : null}
    </button>
  );
}
