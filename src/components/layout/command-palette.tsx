'use client';

import { Command } from 'cmdk';
import { CalendarPlus, Clock, Search, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { navSectionsFor, type NavPermissions, type NavUiMode } from '@/components/layout/nav-items';
import { EntityAvatar } from '@/components/ui/misc';

/** Treffer der globalen Suche (Server Action, organisationsgebunden). */
export interface SearchResultItem {
  id: string;
  group: 'Kunden' | 'Mitarbeiter' | 'Termine';
  title: string;
  subtitle?: string;
  href: string;
  color?: string | null;
}

/** Anzeige-Reihenfolge der Ergebnis-Kategorien. */
const GROUP_ORDER: SearchResultItem['group'][] = ['Kunden', 'Mitarbeiter', 'Termine'];

const GROUP_HEADING_CLASS =
  'mb-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[length:var(--text-2xs)] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--color-ink-subtle)] [&_[cmdk-group-heading]]:uppercase';

const ITEM_CLASS =
  'flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2 text-[length:var(--text-sm)] data-[selected=true]:bg-[var(--color-panel-raised)]';

export function CommandPalette({
  open,
  onOpenChange,
  permissions,
  uiMode = 'team',
  canCreate,
  onSearch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  permissions: NavPermissions;
  uiMode?: NavUiMode;
  canCreate: boolean;
  /** Globale Suche; wird ab dem Suchmodul gesetzt (Phase 12). */
  onSearch?: (query: string) => Promise<SearchResultItem[]>;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<SearchResultItem[]>([]);
  const [searching, setSearching] = React.useState(false);

  // Schließen setzt die lokale Suche zurück – sonst zeigt die nächste Öffnung
  // alte Treffer. Kein Effekt nötig: alle Schließpfade laufen hier zusammen.
  const close = React.useCallback(() => {
    setQuery('');
    setResults([]);
    setSearching(false);
    onOpenChange(false);
  }, [onOpenChange]);

  // Ctrl/Cmd+K öffnet bzw. schließt die Palette.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (open) close();
        else onOpenChange(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange, close]);

  // Debounced Suche – State-Änderungen nur im asynchronen Callback.
  React.useEffect(() => {
    if (!onSearch) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      setSearching(true);
      try {
        const items = await onSearch(trimmed);
        if (!cancelled) setResults(items);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, onSearch]);

  const handleQueryChange = React.useCallback((value: string) => {
    setQuery(value);
    if (value.trim().length < 2) setResults([]);
  }, []);

  const go = React.useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  if (!open) return null;

  const navItems = navSectionsFor(uiMode)
    .flatMap((section) => section.items)
    .filter((item) => !item.requires || permissions[item.requires]);

  const quickActions = canCreate
    ? [
        { label: 'Neuen Kunden anlegen', href: '/customers/new', icon: UserPlus },
        { label: 'Neuen Termin anlegen', href: '/calendar?neu=1', icon: CalendarPlus },
        { label: 'Stunden verteilen', href: '/customers?openHours=1', icon: Clock },
      ]
    : [];

  // Filtern übernehmen wir selbst: Server-Treffer (ab 2 Zeichen) + Seiten/Aktionen.
  const trimmedQuery = query.trim().toLowerCase();
  const searchMode = trimmedQuery.length >= 2;
  const matchedNav = trimmedQuery
    ? navItems.filter((item) => item.label.toLowerCase().includes(trimmedQuery))
    : navItems;
  const matchedActions = trimmedQuery
    ? quickActions.filter((action) => action.label.toLowerCase().includes(trimmedQuery))
    : quickActions;

  const grouped = new Map<string, SearchResultItem[]>();
  for (const result of results) {
    const list = grouped.get(result.group) ?? [];
    list.push(result);
    grouped.set(result.group, list);
  }
  const orderedGroups = [
    ...GROUP_ORDER.filter((group) => grouped.has(group)).map(
      (group) => [group, grouped.get(group)!] as const,
    ),
    ...[...grouped.entries()].filter(([group]) => !GROUP_ORDER.includes(group as SearchResultItem['group'])),
  ];

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Suche schließen"
        className="animate-overlay-in absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={close}
      />
      <div className="animate-pop-in absolute inset-x-3 top-[10dvh] mx-auto max-w-xl">
        <Command
          shouldFilter={false}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
            }
          }}
          className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-line-subtle)] bg-[var(--color-panel)] shadow-[var(--shadow-popover)]"
        >
          <div className="flex items-center gap-2.5 border-b border-[var(--color-line-subtle)] px-4">
            <Search className="size-4 shrink-0 text-[var(--color-ink-subtle)]" aria-hidden />
            <Command.Input
              value={query}
              onValueChange={handleQueryChange}
              placeholder="Kunden, Mitarbeiter, Termine, Seiten…"
              className="h-12 w-full bg-transparent text-[length:var(--text-base)] outline-none placeholder:text-[var(--color-ink-subtle)]"
              autoFocus
            />
            <kbd className="shrink-0 rounded-full border border-[var(--color-line)] bg-[var(--color-panel-sunken)] px-2 py-0.5 text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">
              Esc
            </kbd>
          </div>
          <Command.List className="max-h-[50dvh] overflow-y-auto p-2">
            <Command.Empty className="px-3 py-8 text-center text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
              {searching ? 'Suche läuft…' : 'Keine Treffer.'}
            </Command.Empty>

            {orderedGroups.map(([group, items]) => (
              <Command.Group key={group} heading={group} className={GROUP_HEADING_CLASS}>
                {items.map((item) => (
                  <Command.Item
                    key={`${item.group}-${item.id}`}
                    value={`${item.group}-${item.id}`}
                    onSelect={() => go(item.href)}
                    className={ITEM_CLASS}
                  >
                    <EntityAvatar id={item.id} name={item.title} color={item.color} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.title}</span>
                      {item.subtitle ? (
                        <span className="block truncate text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                          {item.subtitle}
                        </span>
                      ) : null}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            ))}

            {matchedNav.length > 0 ? (
              <Command.Group heading={searchMode ? 'Seiten' : 'Navigation'} className={GROUP_HEADING_CLASS}>
                {matchedNav.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Command.Item
                      key={item.href}
                      value={item.label}
                      onSelect={() => go(item.href)}
                      className={ITEM_CLASS}
                    >
                      <Icon className="size-4 text-[var(--color-ink-subtle)]" aria-hidden />
                      {item.label}
                    </Command.Item>
                  );
                })}
              </Command.Group>
            ) : null}

            {matchedActions.length > 0 ? (
              <Command.Group heading="Schnellaktionen" className={GROUP_HEADING_CLASS}>
                {matchedActions.map((action) => {
                  const Icon = action.icon;
                  return (
                    <Command.Item
                      key={action.href}
                      value={action.label}
                      onSelect={() => go(action.href)}
                      className={ITEM_CLASS}
                    >
                      <Icon className="size-4 text-[var(--color-ink-subtle)]" aria-hidden />
                      {action.label}
                    </Command.Item>
                  );
                })}
              </Command.Group>
            ) : null}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
