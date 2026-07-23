'use client';

/**
 * ProCalendarSidePanel — nach dem StudyMate-CalendarSidePanel gestaltet:
 * links einschwebende Leiste (mobil: Bottom-Sheet) mit zwei Seiten —
 * „Kalender“ (Ebenen nach Status ein-/ausblenden) und „Tag“ (Termine des
 * gewählten Tages, Klick öffnet den Termin-Drawer).
 */

import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarBlank, CaretLeft, Check, ListBullets, Plus, Warning } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useIsMobile } from './use-viewport';
import { PRO_EVENT_KINDS, PRO_KIND_LABELS, type ProCalendarEvent, type ProEventKind } from './types';

export type CalendarPanelPage = 'calendars' | 'day';

interface ProCalendarSidePanelProps {
  open: boolean;
  page: CalendarPanelPage;
  onOpenChange: (open: boolean) => void;
  onPageChange: (page: CalendarPanelPage) => void;
  selectedDate: Date;
  selectedEvents: ProCalendarEvent[];
  visibleKinds: ReadonlySet<ProEventKind>;
  kindCounts: Record<ProEventKind, number>;
  onToggleKind: (kind: ProEventKind) => void;
  onOpenEvent: (id: string) => void;
  onCreate: () => void;
}

const KIND_META: Record<ProEventKind, { description: string; color: string }> = {
  planned: { description: 'Geplante Einsätze', color: 'bg-sky-500' },
  confirmed: { description: 'Bestätigt oder unterwegs', color: 'bg-emerald-500' },
  done: { description: 'Abgeschlossene Einsätze', color: 'bg-violet-500' },
  open: { description: 'Noch keinem Mitarbeiter zugeordnet', color: 'bg-amber-500' },
  cancelled: { description: 'Abgesagt / nicht erschienen', color: 'bg-slate-400' },
};

const PAGE_META: Array<{ page: CalendarPanelPage; label: string; icon: typeof CalendarBlank }> = [
  { page: 'calendars', label: 'Kalender', icon: CalendarBlank },
  { page: 'day', label: 'Tag', icon: ListBullets },
];

const DOT_BY_KIND: Record<ProEventKind, string> = {
  planned: 'bg-sky-500',
  confirmed: 'bg-emerald-500',
  done: 'bg-violet-500',
  open: 'bg-amber-500',
  cancelled: 'bg-slate-400',
};

export function ProCalendarSidePanel({
  open,
  page,
  onOpenChange,
  onPageChange,
  selectedDate,
  selectedEvents,
  visibleKinds,
  kindCounts,
  onToggleKind,
  onOpenEvent,
  onCreate,
}: ProCalendarSidePanelProps) {
  const isMobile = useIsMobile();

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            type="button"
            aria-label="Kalender-Seitenleiste schließen"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => onOpenChange(false)}
            className="absolute inset-0 z-[60] bg-slate-950/35 backdrop-blur-[1px]"
          />
          <motion.aside
            initial={isMobile ? { y: '100%' } : { x: '-104%', opacity: 0.7 }}
            animate={isMobile ? { y: 0 } : { x: 0, opacity: 1 }}
            exit={isMobile ? { y: '100%' } : { x: '-104%', opacity: 0.7 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              'absolute z-[70] flex flex-col overflow-hidden bg-background/95 shadow-2xl backdrop-blur-xl',
              isMobile
                ? 'inset-x-0 bottom-0 max-h-[88dvh] rounded-t-3xl border-t border-border/60'
                : 'inset-y-0 left-0 w-[min(24rem,92vw)] border-r border-border/60',
            )}
          >
            {isMobile && (
              <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/30" aria-hidden="true" />
            )}
            <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-3">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label="Schließen"
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-primary transition-colors hover:bg-primary/10"
              >
                <CaretLeft size={18} weight="bold" />
              </button>
              <div
                role="tablist"
                aria-label="Panel-Seite"
                className="flex min-w-0 flex-1 items-center gap-0.5 rounded-xl border border-border/60 bg-background/55 p-0.5"
              >
                {PAGE_META.map(({ page: p, label, icon: Icon }) => (
                  <button
                    key={p}
                    type="button"
                    role="tab"
                    aria-selected={page === p}
                    onClick={() => onPageChange(p)}
                    className={cn(
                      'inline-flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold transition-colors',
                      page === p ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground',
                    )}
                  >
                    <Icon size={15} />
                    {label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={onCreate}
                aria-label="Neuen Termin anlegen"
                className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm"
              >
                <Plus size={16} weight="bold" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              {page === 'calendars' ? (
                <div className="space-y-1.5">
                  <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Ebenen
                  </p>
                  {PRO_EVENT_KINDS.map((kind) => {
                    const meta = KIND_META[kind];
                    const active = visibleKinds.has(kind);
                    return (
                      <button
                        key={kind}
                        type="button"
                        onClick={() => onToggleKind(kind)}
                        aria-pressed={active}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors',
                          active
                            ? 'border-border/60 bg-card/70 hover:bg-muted/40'
                            : 'border-border/40 bg-background/40 opacity-60 hover:opacity-90',
                        )}
                      >
                        <span className={cn('size-3 shrink-0 rounded-full', meta.color)} aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">
                            {PRO_KIND_LABELS[kind]}
                            <span className="ml-1.5 text-[11px] font-medium text-muted-foreground">
                              {kindCounts[kind]}
                            </span>
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">{meta.description}</span>
                        </span>
                        <span
                          className={cn(
                            'flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors',
                            active
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border/70 bg-background text-transparent',
                          )}
                        >
                          <Check size={12} weight="bold" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="px-1 text-sm font-bold capitalize">
                    {format(selectedDate, 'EEEE, d. MMMM yyyy', { locale: de })}
                  </p>
                  {selectedEvents.length === 0 ? (
                    <p className="rounded-xl border border-border/50 bg-card/60 px-3 py-6 text-center text-sm text-muted-foreground">
                      Keine Termine an diesem Tag.
                    </p>
                  ) : (
                    selectedEvents.map((event) => (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => onOpenEvent(event.id)}
                        className="flex w-full items-start gap-2.5 rounded-xl border border-border/60 bg-card/70 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
                      >
                        <span className={cn('mt-1 size-2.5 shrink-0 rounded-full', DOT_BY_KIND[event.kind])} />
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{event.summary}</span>
                            {event.hasConflict && (
                              <Warning size={13} weight="fill" className="shrink-0 text-red-500" aria-label="Konflikt" />
                            )}
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">{event.detail}</span>
                          <span className="mt-0.5 block text-[11px] font-semibold text-muted-foreground">
                            {format(new Date(event.start), 'HH:mm')} – {format(new Date(event.end), 'HH:mm')} ·{' '}
                            {PRO_KIND_LABELS[event.kind]}
                          </span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
