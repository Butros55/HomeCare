'use client';

import { ChevronDown, Plus } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

import { NOTE_LIMITS, type HandwrittenNoteClient } from './drawing-model';
import { formatNoteUpdatedAt } from './format';
import { StrokePreview } from './stroke-preview';

export type NoteSaveState = 'saved' | 'dirty' | 'saving' | 'error';

/**
 * Karten-Höhe skaliert mit der Bildschirmhöhe (rund ein Viertel), die Breite
 * folgt über das A4-nahe Seitenverhältnis. `--sheet-h` versorgt Karten,
 * Beschriftung und die Zentrier-Innenabstände des Scrollers aus einer Quelle.
 */
const SHEET_HEIGHT = 'clamp(9rem, 25vh, 20rem)';
const SHEET_RATIO = 1.414;
const SHEET_WIDTH = `calc(var(--sheet-h) / ${SHEET_RATIO})`;

/** Fächer-Geometrie: wie eine Handvoll Karten, nicht schnurgerade. */
const MAX_TILT = 1.4;
const TILT_DEGREES = 7;
const DROP_PIXELS = 26;

/** Einflug: von links nach rechts nacheinander, mit leichtem Überschwingen. */
const ENTER_STAGGER_MS = 45;
const LEAVE_STAGGER_MS = 30;
const ENTER_EASING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const LEAVE_EASING = 'cubic-bezier(0.4, 0, 1, 1)';

/**
 * Blätter-Karussell: die Seiten liegen als hochkante Papier-Karten direkt auf
 * dem Blatt – ohne eigenes Panel dahinter. Es öffnet sich oberhalb des
 * Stift-Docks, das dadurch nie verdeckt wird. Beim Öffnen fliegen die Karten
 * von unten herein (links zuerst, rechts zuletzt), beim Schließen umgekehrt
 * wieder hinaus. Gescrollt wird waagerecht; zum Rand hin kippen und sinken die
 * Karten samt Beschriftung ab, als hielte man sie in der Hand. Ganz links
 * liegt ein leeres Blatt mit „+" zum sofortigen Anlegen.
 *
 * Beschriftungen sind bewusst dunkel – der Hintergrund ist immer das helle
 * Papier, nie ein Panel.
 */
export function NoteCarousel({
  notes,
  selectedId,
  saveStates,
  timezone,
  open,
  creating,
  onSelect,
  onCreate,
  onRename,
  onRenameCommit,
  onClose,
}: {
  notes: HandwrittenNoteClient[];
  selectedId: string | null;
  saveStates: Record<string, NoteSaveState>;
  timezone: string;
  open: boolean;
  creating: boolean;
  onSelect: (noteId: string) => void;
  onCreate: () => void;
  onRename: (noteId: string, title: string) => void;
  onRenameCommit: (noteId: string) => void;
  onClose: () => void;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const cardRefs = React.useRef<Map<string, HTMLElement>>(new Map());
  const frameRef = React.useRef<number | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);

  // Index 0 ist das leere „+"-Blatt ganz links – es fliegt als Erstes herein.
  const total = notes.length + 1;

  const registerCard = React.useCallback((key: string, node: HTMLElement | null) => {
    if (node) cardRefs.current.set(key, node);
    else cardRefs.current.delete(key);
  }, []);

  /**
   * Neigung/Absinken je nach Abstand zur Mitte – wird auf die ganze Spalte
   * (Karte samt Name und Datum) gelegt, damit die Beschriftung mitkippt.
   */
  const applyFan = React.useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    if (rect.width === 0) return;
    const center = rect.left + rect.width / 2;
    const half = rect.width / 2;
    cardRefs.current.forEach((node) => {
      const cardRect = node.getBoundingClientRect();
      const offset = (cardRect.left + cardRect.width / 2 - center) / half;
      const tilt = Math.max(-MAX_TILT, Math.min(MAX_TILT, offset));
      const distance = Math.abs(tilt);
      node.style.transform = `translateY(${(distance ** 1.7 * DROP_PIXELS).toFixed(2)}px) rotate(${(tilt * TILT_DEGREES).toFixed(2)}deg) scale(${(1 - distance * 0.05).toFixed(3)})`;
      node.style.zIndex = String(100 - Math.round(distance * 50));
    });
  }, []);

  const scheduleFan = React.useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      applyFan();
    });
  }, [applyFan]);

  React.useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    applyFan();
    const observer = new ResizeObserver(() => applyFan());
    observer.observe(scroller);
    return () => {
      observer.disconnect();
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [applyFan, notes.length, open]);

  React.useEffect(() => {
    if (!open || !selectedId) return;
    const node = cardRefs.current.get(selectedId);
    node?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [open, selectedId]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !editingId) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [editingId, onClose, open]);

  // Tipp neben das Karussell (z. B. aufs Papier) schließt es. Capture-Phase,
  // weil die Zeichenfläche ihre eigenen Pointer-Events stoppt.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      // Der Umschalter in der Kopfzeile schaltet selbst um – sonst ginge das
      // Karussell hier zu und dort sofort wieder auf.
      if (target.closest('[data-notes-carousel-toggle]')) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [onClose, open]);

  /** Doppeltipp auf ein Blatt: öffnen und das Karussell gleich wegräumen. */
  const openAndClose = (noteId: string) => {
    onSelect(noteId);
    setEditingId(null);
    onClose();
  };

  /**
   * Gestaffelter Ein-/Ausflug je Karte – offen: links zuerst, zu: rechts
   * zuerst. Bewusst als Inline-Transform: Tailwinds `translate-y-*` schreibt
   * die CSS-Eigenschaft `translate`, die hier nicht mitanimiert würde.
   */
  const flightStyle = (index: number): React.CSSProperties => ({
    transform: open ? 'translateY(0)' : 'translateY(135%)',
    opacity: open ? 1 : 0,
    transitionProperty: 'transform, opacity',
    transitionDuration: open ? '420ms' : '260ms',
    transitionTimingFunction: open ? ENTER_EASING : LEAVE_EASING,
    transitionDelay: `${(open ? index : total - 1 - index) * (open ? ENTER_STAGGER_MS : LEAVE_STAGGER_MS)}ms`,
    willChange: 'transform, opacity',
  });

  return (
    <div
      ref={rootRef}
      className={cn(
        // Kein eigenes Panel: die Karten liegen direkt auf dem Papier – und
        // oberhalb des Stift-Docks, damit dieses frei bedienbar bleibt.
        'absolute inset-x-0 bottom-16 z-40 overflow-hidden pointer-coarse:bottom-20',
        open ? 'pointer-events-auto' : 'pointer-events-none',
      )}
      style={
        {
          '--sheet-h': SHEET_HEIGHT,
          height: `calc(${SHEET_HEIGHT} + 8.5rem)`,
        } as React.CSSProperties
      }
      aria-hidden={!open}
    >
      <div
        className={cn(
          'flex items-center gap-2 px-3 pt-2 transition-opacity duration-200',
          open ? 'opacity-100' : 'opacity-0',
        )}
      >
        <span className="text-[length:var(--text-xs)] font-semibold text-slate-700">Blätter</span>
        <span className="text-[length:var(--text-2xs)] text-slate-500">
          {notes.length === 1 ? '1 Seite' : `${notes.length} Seiten`}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Blätter schließen"
          className="flex size-7 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-black/10 hover:text-slate-900 pointer-coarse:size-10"
        >
          <ChevronDown className="size-4" aria-hidden />
        </button>
      </div>

      <div
        ref={scrollerRef}
        onScroll={scheduleFan}
        className="scrollbar-none flex snap-x snap-proximity items-end gap-3 overflow-x-auto overflow-y-hidden pt-3 pb-8"
        style={{ paddingInline: `max(1rem, calc(50% - var(--sheet-h) / ${SHEET_RATIO * 2}))` }}
      >
        {/* Leeres Blatt: ein Tipp darauf legt sofort eine neue Seite an. */}
        <div className="shrink-0" style={flightStyle(0)}>
          <SheetColumn ref={(node) => registerCard('__new__', node)}>
            <SheetShell
              onClick={onCreate}
              disabled={creating}
              label="Neue Seite anlegen"
              className="snap-center"
            >
              <span className="flex size-full flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border-2 border-dashed border-slate-400/80 bg-white/55 text-slate-500 shadow-[0_6px_16px_-10px_rgb(0_0_0/0.5)] backdrop-blur-[2px]">
                <Plus className="size-6" aria-hidden />
                <span className="text-[length:var(--text-2xs)] font-medium">Neue Seite</span>
              </span>
            </SheetShell>
            <span className="text-[length:var(--text-2xs)] font-medium text-slate-500">Anlegen</span>
          </SheetColumn>
        </div>

        {notes.map((note, index) => {
          const active = note.id === selectedId;
          const state = saveStates[note.id] ?? 'saved';
          const editing = editingId === note.id;
          return (
            <div
              key={note.id}
              className={cn('shrink-0 will-change-transform', flightClass)}
              style={flightStyle(index + 1)}
            >
              <SheetColumn ref={(node) => registerCard(note.id, node)}>
                <SheetShell
                  onClick={() => onSelect(note.id)}
                  onDoubleClick={() => openAndClose(note.id)}
                  label={`Seite „${note.title.trim() || 'Unbenannte Notiz'}" öffnen`}
                  title="Tippen zum Wechseln · Doppeltippen zum Öffnen"
                  current={active}
                  className="snap-center"
                >
                  <span
                    className={cn(
                      'block size-full overflow-hidden rounded-[var(--radius-lg)] border bg-[#faf9f6] transition-[border-color,box-shadow]',
                      active
                        ? 'border-[var(--color-brand)] shadow-[0_0_0_2px_var(--color-brand-ring),0_10px_24px_-10px_rgb(0_0_0/0.55)]'
                        : 'border-slate-300 shadow-[0_6px_18px_-10px_rgb(0_0_0/0.55)]',
                    )}
                  >
                    <StrokePreview document={note.document} className="size-full" />
                  </span>
                </SheetShell>

                {/* Name direkt hier umbenennbar – ein Klick auf die aktive Seite genügt. */}
                {editing ? (
                  <input
                    autoFocus
                    value={note.title}
                    maxLength={NOTE_LIMITS.titleLength}
                    onChange={(event) => onRename(note.id, event.target.value)}
                    onBlur={() => {
                      onRenameCommit(note.id);
                      setEditingId(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === 'Escape') {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                    }}
                    aria-label="Name der Seite"
                    style={{ width: SHEET_WIDTH }}
                    className="h-7 rounded-[var(--radius-sm)] border border-[var(--color-brand)] bg-white px-2 text-center text-[length:var(--text-2xs)] font-semibold text-slate-900 shadow-sm outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (active) setEditingId(note.id);
                      else onSelect(note.id);
                    }}
                    title={active ? 'Namen bearbeiten' : 'Seite öffnen'}
                    style={{ maxWidth: SHEET_WIDTH }}
                    className={cn(
                      'truncate rounded-[var(--radius-sm)] px-2 py-1 text-[length:var(--text-2xs)] transition-colors hover:bg-black/10',
                      active ? 'font-semibold text-slate-900' : 'font-medium text-slate-600',
                    )}
                  >
                    {note.title.trim() || 'Unbenannte Notiz'}
                  </button>
                )}

                <span className="text-[length:var(--text-2xs)] text-slate-500">
                  {state === 'saving' ? (
                    <span className="font-medium text-[var(--color-brand)]">Speichert …</span>
                  ) : state === 'error' ? (
                    <span className="font-medium text-[var(--color-danger)]">Fehler</span>
                  ) : state === 'dirty' ? (
                    <span className="font-medium text-[var(--color-brand)]">Ungespeichert</span>
                  ) : (
                    formatNoteUpdatedAt(note.updatedAt, timezone)
                  )}
                </span>
              </SheetColumn>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Spalte aus Karte + Beschriftung. Sie trägt die Fächer-Neigung, damit Name
 * und Datum mit dem Blatt mitkippen; Drehpunkt ist unten, wie bei Karten in
 * der Hand.
 */
const SheetColumn = React.forwardRef<HTMLDivElement, { children: React.ReactNode }>(
  function SheetColumn({ children }, ref) {
    return (
      <div
        ref={ref}
        style={{ transformOrigin: 'bottom center' }}
        className="flex flex-col items-center gap-1.5 will-change-transform"
      >
        {children}
      </div>
    );
  },
);

/** Hochkantes „Blatt" – Höhe aus `--sheet-h`, Breite über das Seitenverhältnis. */
function SheetShell({
  onClick,
  onDoubleClick,
  label,
  title,
  children,
  current,
  disabled,
  className,
}: {
  onClick: () => void;
  onDoubleClick?: () => void;
  label: string;
  title?: string;
  children: React.ReactNode;
  current?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      disabled={disabled}
      aria-label={label}
      title={title}
      aria-current={current ? 'page' : undefined}
      style={{ height: 'var(--sheet-h)', aspectRatio: `1 / ${SHEET_RATIO}` }}
      className={cn(
        'shrink-0 rounded-[var(--radius-lg)]',
        'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-brand)]',
        'disabled:opacity-60',
        className,
      )}
    >
      {children}
    </button>
  );
}
