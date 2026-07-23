'use client';

import { Loader2, MapPin } from 'lucide-react';
import * as React from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { suggestAddressesAction } from '@/server/actions/geo-actions';
import type { AddressSuggestion } from '@/server/providers/types';

/**
 * Adress-Autocomplete: Beim Tippen erscheinen Vorschläge (Provider: Mock/
 * Nominatim, serverseitig); die Auswahl füllt Straße, Hausnummer, PLZ, Ort
 * und liefert die Koordinate mit. Vollständig per Tastatur bedienbar
 * (Pfeile, Enter, Escape) – Enter löst dabei nie das umgebende Formular aus.
 */
export function AddressAutocomplete({
  id,
  placeholder = 'Straße und Hausnummer eingeben …',
  onSelect,
}: {
  id?: string;
  placeholder?: string;
  onSelect: (suggestion: AddressSuggestion) => void;
}) {
  const [query, setQuery] = React.useState('');
  const [items, setItems] = React.useState<AddressSuggestion[]>([]);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState(0);
  const listId = React.useId();

  // Entprellte Suche; State-Änderungen nur im asynchronen Callback.
  React.useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      setLoading(true);
      try {
        const results = await suggestAddressesAction(trimmed);
        if (!cancelled) {
          setItems(results);
          setOpen(results.length > 0);
          setHighlighted(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const handleChange = (value: string) => {
    setQuery(value);
    if (value.trim().length < 3) {
      setItems([]);
      setOpen(false);
    }
  };

  const select = (suggestion: AddressSuggestion) => {
    onSelect(suggestion);
    setQuery(suggestion.label);
    setOpen(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (event.key === 'ArrowDown' && items.length > 0) setOpen(true);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((current) => Math.min(current + 1, items.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault(); // nicht das Formular absenden
      const suggestion = items[highlighted];
      if (suggestion) select(suggestion);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <MapPin
        className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[var(--color-ink-subtle)]"
        aria-hidden
      />
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        value={query}
        onChange={(event) => handleChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (items.length > 0) setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        autoComplete="off"
        className="pr-9 pl-9"
      />
      {loading ? (
        <Loader2
          className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-[var(--color-ink-subtle)]"
          aria-hidden
        />
      ) : null}

      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Adressvorschläge"
          className="animate-pop-in absolute top-full z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-line-subtle)] bg-[var(--color-panel)] p-1 shadow-[var(--shadow-popover)]"
        >
          {items.map((suggestion, index) => (
            <li key={`${suggestion.label}-${index}`} role="option" aria-selected={index === highlighted}>
              <button
                type="button"
                tabIndex={-1}
                // onMouseDown statt onClick: gewinnt gegen das onBlur-Schließen.
                onMouseDown={(event) => {
                  event.preventDefault();
                  select(suggestion);
                }}
                onMouseEnter={() => setHighlighted(index)}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2 text-left text-[length:var(--text-sm)] transition-colors pointer-coarse:py-3',
                  index === highlighted && 'bg-[var(--color-panel-raised)]',
                )}
              >
                <MapPin className="mt-0.5 size-3.5 shrink-0 text-[var(--color-brand)]" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate">
                    {suggestion.street}
                    {suggestion.houseNumber ? ` ${suggestion.houseNumber}` : ''}
                  </span>
                  <span className="block truncate text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                    {suggestion.postalCode ? `${suggestion.postalCode} ` : ''}
                    {suggestion.city}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
