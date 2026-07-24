'use client';

import {
  CheckCircle2,
  Cloud,
  CloudOff,
  FilePenLine,
  GalleryHorizontalEnd,
  Loader2,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/panel';
import { cn } from '@/lib/utils';
import {
  createHandwrittenNoteAction,
  deleteHandwrittenNoteAction,
  saveHandwrittenNoteAction,
} from '@/server/actions/note-actions';

import { type HandwrittenNoteClient, type NotebookDocumentV1 } from './drawing-model';
import { formatNoteUpdatedAt, nextUntitledNoteName } from './format';
import { NoteCarousel } from './note-carousel';
import { NotebookCanvas } from './notebook-canvas';
import { useNotebookPreferences } from './use-notebook-preferences';

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

const AUTOSAVE_DELAY_MS = 850;

function SaveIndicator({
  state,
  updatedAt,
  timezone,
}: {
  state: SaveState;
  updatedAt: string;
  timezone: string;
}) {
  const content = {
    saved: {
      icon: <CheckCircle2 className="size-3.5" aria-hidden />,
      label: `Gespeichert · ${formatNoteUpdatedAt(updatedAt, timezone)}`,
      short: 'Gespeichert',
      className: 'text-[var(--color-success)]',
    },
    dirty: {
      icon: <Cloud className="size-3.5" aria-hidden />,
      label: 'Noch nicht gespeichert',
      short: 'Ungespeichert',
      className: 'text-[var(--color-ink-subtle)]',
    },
    saving: {
      icon: <Loader2 className="size-3.5 animate-spin" aria-hidden />,
      label: 'Wird gespeichert …',
      short: 'Speichert …',
      className: 'text-[var(--color-brand)]',
    },
    error: {
      icon: <CloudOff className="size-3.5" aria-hidden />,
      label: 'Speichern fehlgeschlagen',
      short: 'Fehler',
      className: 'text-[var(--color-danger)]',
    },
  }[state];

  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1.5 text-[length:var(--text-2xs)]',
        content.className,
      )}
      role="status"
      aria-live="polite"
    >
      {content.icon}
      <span className="hidden truncate lg:inline">{content.label}</span>
      <span className="truncate lg:hidden">{content.short}</span>
    </span>
  );
}

/**
 * Notizbuch-Arbeitsfläche – „Papier zuerst": Die Seite füllt praktisch den
 * gesamten Bereich (besonders auf dem iPad hochkant), darüber liegt nur eine
 * schmale Kopfzeile und das schwebende Stift-Dock. Gewechselt, umbenannt und
 * angelegt wird im Blätter-Karussell, das von unten hereinfährt – deshalb
 * braucht es weder eine feste Listenspalte noch einen Vollbildmodus.
 */
export function NotesWorkspace({
  initialNotes,
  timezone,
}: {
  initialNotes: HandwrittenNoteClient[];
  timezone: string;
}) {
  const [notes, setNotes] = React.useState(initialNotes);
  const notesRef = React.useRef(initialNotes);
  const [selectedId, setSelectedId] = React.useState<string | null>(initialNotes[0]?.id ?? null);
  const [saveStates, setSaveStates] = React.useState<Record<string, SaveState>>(() =>
    Object.fromEntries(initialNotes.map((note) => [note.id, 'saved' as const])),
  );
  const [creating, setCreating] = React.useState(false);
  const [deleteTargetId, setDeleteTargetId] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  // Startet geschlossen. Ohne jede Notiz erscheint das Karussell gar nicht –
  // dann führt der leere Zustand in der Mitte („Neue Notiz") durchs Anlegen,
  // statt ein einzelnes „+"-Blatt unten einzublenden (wirkte verloren).
  const [carouselOpen, setCarouselOpen] = React.useState(false);
  const hasNotes = notes.length > 0;
  const { preferences, updatePreference } = useNotebookPreferences();

  const saveTimersRef = React.useRef<Map<string, number>>(new Map());
  const savingIdsRef = React.useRef<Set<string>>(new Set());
  const pendingSaveIdsRef = React.useRef<Set<string>>(new Set());
  const deletedIdsRef = React.useRef<Set<string>>(new Set());
  const revisionsRef = React.useRef<Map<string, number>>(
    new Map(initialNotes.map((note) => [note.id, 0])),
  );

  const selectedNote = notes.find((note) => note.id === selectedId) ?? null;
  const selectedSaveState = selectedNote ? (saveStates[selectedNote.id] ?? 'saved') : 'saved';

  function clearSaveTimer(noteId: string) {
    const timer = saveTimersRef.current.get(noteId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      saveTimersRef.current.delete(noteId);
    }
  }

  function queueSave(noteId: string, delay = AUTOSAVE_DELAY_MS) {
    clearSaveTimer(noteId);
    const timer = window.setTimeout(() => {
      saveTimersRef.current.delete(noteId);
      void persistNote(noteId);
    }, delay);
    saveTimersRef.current.set(noteId, timer);
  }

  function replaceNote(
    noteId: string,
    updater: (note: HandwrittenNoteClient) => HandwrittenNoteClient,
  ) {
    const next = notesRef.current.map((note) => (note.id === noteId ? updater(note) : note));
    notesRef.current = next;
    setNotes(next);
  }

  function updateDraft(
    noteId: string,
    patch: Partial<Pick<HandwrittenNoteClient, 'title' | 'document'>>,
    autosave = true,
  ) {
    if (deletedIdsRef.current.has(noteId)) return;
    replaceNote(noteId, (note) => ({ ...note, ...patch }));
    revisionsRef.current.set(noteId, (revisionsRef.current.get(noteId) ?? 0) + 1);
    setSaveStates((current) => ({ ...current, [noteId]: 'dirty' }));
    if (autosave) queueSave(noteId);
    else clearSaveTimer(noteId);
  }

  async function persistNote(noteId: string) {
    if (deletedIdsRef.current.has(noteId)) return;
    if (savingIdsRef.current.has(noteId)) {
      pendingSaveIdsRef.current.add(noteId);
      return;
    }

    clearSaveTimer(noteId);
    const note = notesRef.current.find((item) => item.id === noteId);
    if (!note) return;
    const title = note.title.trim();
    if (!title) {
      setSaveStates((current) => ({ ...current, [noteId]: 'error' }));
      return;
    }

    if (title !== note.title) {
      replaceNote(noteId, (current) => ({ ...current, title }));
    }
    const capturedRevision = revisionsRef.current.get(noteId) ?? 0;
    savingIdsRef.current.add(noteId);
    setSaveStates((current) => ({ ...current, [noteId]: 'saving' }));

    let succeeded = false;
    let conflict = false;
    try {
      const result = await saveHandwrittenNoteAction({
        id: note.id,
        title,
        document: note.document,
        expectedUpdatedAt: note.updatedAt,
      });
      if (deletedIdsRef.current.has(noteId)) return;
      if (!result.ok) {
        conflict = result.code === 'CONFLICT';
        setSaveStates((current) => ({ ...current, [noteId]: 'error' }));
        toast.error(result.message);
        return;
      }

      succeeded = true;
      replaceNote(noteId, (current) => ({
        ...current,
        updatedAt: result.data.updatedAt,
        contentVersion: result.data.contentVersion,
      }));
      const unchanged = (revisionsRef.current.get(noteId) ?? 0) === capturedRevision;
      setSaveStates((current) => ({
        ...current,
        [noteId]: unchanged ? 'saved' : 'dirty',
      }));
    } catch {
      setSaveStates((current) => ({ ...current, [noteId]: 'error' }));
      toast.error('Die Notiz konnte nicht gespeichert werden.');
    } finally {
      savingIdsRef.current.delete(noteId);
      const pending = pendingSaveIdsRef.current.delete(noteId);
      const changed = (revisionsRef.current.get(noteId) ?? 0) !== capturedRevision;
      if (!deletedIdsRef.current.has(noteId) && !conflict && (pending || (succeeded && changed))) {
        queueSave(noteId, 0);
      }
    }
  }

  function normalizeCurrentTitle(noteId: string): HandwrittenNoteClient | null {
    const note = notesRef.current.find((item) => item.id === noteId);
    if (!note) return null;
    const normalized = note.title.trim() || 'Unbenannte Notiz';
    if (normalized !== note.title) updateDraft(noteId, { title: normalized }, false);
    return notesRef.current.find((item) => item.id === noteId) ?? null;
  }

  function openNote(noteId: string) {
    if (selectedId && selectedId !== noteId) {
      const wasBlank = notesRef.current
        .find((note) => note.id === selectedId)
        ?.title.trim().length === 0;
      const current = normalizeCurrentTitle(selectedId);
      if (current && (wasBlank || saveStates[selectedId] === 'dirty')) queueSave(selectedId, 0);
    }
    setSelectedId(noteId);
  }

  async function createNote() {
    setCreating(true);
    try {
      // Standardname fortlaufend nummerieren, damit „Neue Notiz" eindeutig bleibt.
      const title = nextUntitledNoteName(notesRef.current.map((note) => note.title));
      const result = await createHandwrittenNoteAction({ title });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      notesRef.current = [result.data, ...notesRef.current];
      setNotes(notesRef.current);
      revisionsRef.current.set(result.data.id, 0);
      setSaveStates((current) => ({ ...current, [result.data.id]: 'saved' }));
      setSelectedId(result.data.id);
    } catch {
      toast.error('Die Notiz konnte nicht angelegt werden.');
    } finally {
      setCreating(false);
    }
  }

  async function deleteNote() {
    const noteId = deleteTargetId;
    if (!noteId) return;
    setDeleting(true);
    try {
      const result = await deleteHandwrittenNoteAction(noteId);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      deletedIdsRef.current.add(noteId);
      clearSaveTimer(noteId);
      pendingSaveIdsRef.current.delete(noteId);
      const remaining = notesRef.current.filter((note) => note.id !== noteId);
      notesRef.current = remaining;
      setNotes(remaining);
      // War es die letzte Notiz, das Karussell schließen – so taucht es beim
      // nächsten Anlegen nicht ungefragt wieder auf.
      if (remaining.length === 0) setCarouselOpen(false);
      revisionsRef.current.delete(noteId);
      setSaveStates((current) => {
        const next = { ...current };
        delete next[noteId];
        return next;
      });
      if (selectedId === noteId) setSelectedId(remaining[0]?.id ?? null);
      setDeleteTargetId(null);
      toast.success('Notiz gelöscht.');
    } catch {
      toast.error('Die Notiz konnte nicht gelöscht werden.');
    } finally {
      setDeleting(false);
    }
  }

  React.useEffect(
    () => () => {
      saveTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      saveTimersRef.current.clear();
    },
    [],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--color-canvas)]">
      {/* Schmale Kopfzeile: Blätter-Schalter, Name der Seite, Status, Aktionen. */}
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-[var(--color-line-subtle)] bg-[var(--color-panel)] px-2 pointer-coarse:h-14">
        {/* Blätter-Schalter erst, wenn es überhaupt Notizen zu blättern gibt. */}
        {hasNotes ? (
          <Button
            type="button"
            data-notes-carousel-toggle
            variant={carouselOpen ? 'primary' : 'ghost'}
            size="icon"
            onClick={() => setCarouselOpen(!carouselOpen)}
            aria-label={carouselOpen ? 'Blätter schließen' : 'Blätter öffnen'}
            aria-expanded={carouselOpen}
          >
            <GalleryHorizontalEnd aria-hidden />
          </Button>
        ) : null}

        {selectedNote ? (
          <>
            {/* Umbenannt wird unten im Karussell – hier steht der Name nur. */}
            <span className="min-w-0 flex-1 truncate px-2 text-[length:var(--text-base)] font-semibold text-[var(--color-ink)]">
              {selectedNote.title.trim() || 'Unbenannte Notiz'}
            </span>
            <SaveIndicator
              state={selectedSaveState}
              updatedAt={selectedNote.updatedAt}
              timezone={timezone}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              loading={selectedSaveState === 'saving'}
              disabled={selectedSaveState === 'saved'}
              onClick={() => {
                normalizeCurrentTitle(selectedNote.id);
                void persistNote(selectedNote.id);
              }}
              aria-label="Jetzt speichern"
            >
              <Save aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-[var(--color-danger)] hover:text-[var(--color-danger)]"
              onClick={() => setDeleteTargetId(selectedNote.id)}
              aria-label="Notiz löschen"
            >
              <Trash2 aria-hidden />
            </Button>
          </>
        ) : (
          <span className="min-w-0 flex-1 px-2 text-[length:var(--text-base)] font-semibold text-[var(--color-ink)]">
            Notizbuch
          </span>
        )}
      </header>

      <div className="relative flex min-h-0 flex-1 overflow-hidden">

        {/* Das Papier: nimmt den gesamten verbleibenden Platz ein. */}
        <div className="min-h-0 min-w-0 flex-1">
          {selectedNote ? (
            <NotebookCanvas
              key={selectedNote.id}
              initialDocument={selectedNote.document}
              onDocumentChange={(document: NotebookDocumentV1) =>
                updateDraft(selectedNote.id, { document })
              }
              preferences={preferences}
              onPreferenceChange={updatePreference}
              className="size-full"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6">
              <EmptyState
                icon={<FilePenLine />}
                title="Neue Seite beginnen"
                description="Lege eine Notiz an und schreibe direkt mit Stift oder Finger – die Seite füllt den ganzen Bildschirm."
                action={
                  <Button
                    type="button"
                    variant="primary"
                    loading={creating}
                    onClick={() => void createNote()}
                  >
                    <Plus aria-hidden />
                    Neue Notiz
                  </Button>
                }
              />
            </div>
          )}
        </div>

        {/* Blätter-Karussell: fährt von unten über das Papier. Ohne Notizen gibt
            es nichts zu blättern – dann bleibt es ganz weg. */}
        {hasNotes ? (
          <NoteCarousel
            notes={notes}
            selectedId={selectedId}
            saveStates={saveStates}
            timezone={timezone}
            open={carouselOpen}
            creating={creating}
            onSelect={openNote}
            onCreate={() => void createNote()}
            onRename={(noteId, title) =>
              updateDraft(noteId, { title }, title.trim().length > 0)
            }
            onRenameCommit={(noteId) => {
              normalizeCurrentTitle(noteId);
              queueSave(noteId, 0);
            }}
            onClose={() => setCarouselOpen(false)}
          />
        ) : null}
      </div>

      <ConfirmDialog
        open={deleteTargetId !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTargetId(null);
        }}
        title="Notiz löschen?"
        description="Die handschriftliche Notiz wird dauerhaft gelöscht. Dieser Schritt kann nicht rückgängig gemacht werden."
        confirmLabel="Notiz löschen"
        destructive
        loading={deleting}
        onConfirm={deleteNote}
      />
    </div>
  );
}
