'use client';

import {
  ArrowLeft,
  CheckCircle2,
  Cloud,
  CloudOff,
  FilePenLine,
  Loader2,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { EmptyState, Panel, PanelHeader, PanelTitle } from '@/components/ui/panel';
import { cn } from '@/lib/utils';
import {
  createHandwrittenNoteAction,
  deleteHandwrittenNoteAction,
  saveHandwrittenNoteAction,
} from '@/server/actions/note-actions';

import {
  NOTE_LIMITS,
  type HandwrittenNoteClient,
  type NotebookDocumentV1,
} from './drawing-model';
import { NotebookCanvas } from './notebook-canvas';
import { StrokePreview } from './stroke-preview';
import { useNotebookPreferences } from './use-notebook-preferences';

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

const AUTOSAVE_DELAY_MS = 850;

function formatUpdatedAt(value: string, timezone: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

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
      label: `Gespeichert · ${formatUpdatedAt(updatedAt, timezone)}`,
      className: 'text-[var(--color-success)]',
    },
    dirty: {
      icon: <Cloud className="size-3.5" aria-hidden />,
      label: 'Noch nicht gespeichert',
      className: 'text-[var(--color-ink-subtle)]',
    },
    saving: {
      icon: <Loader2 className="size-3.5 animate-spin" aria-hidden />,
      label: 'Wird gespeichert …',
      className: 'text-[var(--color-brand)]',
    },
    error: {
      icon: <CloudOff className="size-3.5" aria-hidden />,
      label: 'Speichern fehlgeschlagen',
      className: 'text-[var(--color-danger)]',
    },
  }[state];

  return (
    <span
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-[length:var(--text-2xs)]',
        content.className,
      )}
      role="status"
      aria-live="polite"
    >
      {content.icon}
      <span className="truncate">{content.label}</span>
    </span>
  );
}

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
  const [mobileEditorOpen, setMobileEditorOpen] = React.useState(false);
  const [saveStates, setSaveStates] = React.useState<Record<string, SaveState>>(() =>
    Object.fromEntries(initialNotes.map((note) => [note.id, 'saved' as const])),
  );
  const [creating, setCreating] = React.useState(false);
  const [deleteTargetId, setDeleteTargetId] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState(false);
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
    if (selectedId) {
      const wasBlank = notesRef.current
        .find((note) => note.id === selectedId)
        ?.title.trim().length === 0;
      const current = normalizeCurrentTitle(selectedId);
      if (current && (wasBlank || saveStates[selectedId] === 'dirty')) queueSave(selectedId, 0);
    }
    setSelectedId(noteId);
    setMobileEditorOpen(true);
  }

  async function createNote() {
    setCreating(true);
    try {
      const result = await createHandwrittenNoteAction();
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      notesRef.current = [result.data, ...notesRef.current];
      setNotes(notesRef.current);
      revisionsRef.current.set(result.data.id, 0);
      setSaveStates((current) => ({ ...current, [result.data.id]: 'saved' }));
      setSelectedId(result.data.id);
      setMobileEditorOpen(true);
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
      revisionsRef.current.delete(noteId);
      setSaveStates((current) => {
        const next = { ...current };
        delete next[noteId];
        return next;
      });
      if (selectedId === noteId) {
        setSelectedId(remaining[0]?.id ?? null);
        setMobileEditorOpen(false);
      }
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
    <div className="h-[calc(100dvh-9.5rem)] min-h-[36rem] p-4 sm:p-5">
      <div className="grid h-full min-h-0 gap-4 md:grid-cols-[19rem_minmax(0,1fr)]">
        <Panel
          className={cn(
            'min-h-0 flex-col overflow-hidden',
            mobileEditorOpen ? 'hidden md:flex' : 'flex',
          )}
        >
          <PanelHeader className="shrink-0">
            <div className="min-w-0">
              <PanelTitle>Meine Notizen</PanelTitle>
              <p className="mt-0.5 text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">
                Nur für dich sichtbar
              </p>
            </div>
            <Button
              type="button"
              variant="primary"
              size="sm"
              loading={creating}
              onClick={() => void createNote()}
            >
              <Plus aria-hidden />
              Neu
            </Button>
          </PanelHeader>

          {notes.length === 0 ? (
            <div className="flex min-h-0 flex-1 items-center p-3">
              <EmptyState
                className="w-full"
                icon={<FilePenLine />}
                title="Noch keine Notiz"
                description="Lege eine Seite an und schreibe direkt mit Stift oder Finger."
                action={
                  <Button
                    type="button"
                    variant="primary"
                    loading={creating}
                    onClick={() => void createNote()}
                  >
                    <Plus aria-hidden />
                    Erste Notiz
                  </Button>
                }
              />
            </div>
          ) : (
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
              {notes.map((note) => {
                const active = note.id === selectedId;
                const state = saveStates[note.id] ?? 'saved';
                return (
                  <li key={note.id}>
                    <button
                      type="button"
                      onClick={() => openNote(note.id)}
                      className={cn(
                        'w-full overflow-hidden rounded-[var(--radius-lg)] border text-left transition-[border-color,background-color,box-shadow]',
                        active
                          ? 'border-[var(--color-brand)] bg-[var(--color-brand-subtle)] shadow-[0_0_0_2px_var(--color-brand-ring)]'
                          : 'border-[var(--color-line-subtle)] bg-[var(--color-panel)] hover:border-[var(--color-line-strong)] hover:bg-[var(--color-panel-raised)]',
                      )}
                      aria-current={active ? 'page' : undefined}
                    >
                      <StrokePreview document={note.document} className="h-20 w-full" />
                      <span className="block border-t border-[var(--color-line-subtle)] px-3 py-2.5">
                        <span className="block truncate text-[length:var(--text-sm)] font-medium text-[var(--color-ink)]">
                          {note.title.trim() || 'Unbenannte Notiz'}
                        </span>
                        <span className="mt-0.5 flex items-center justify-between gap-2 text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">
                          <span>{formatUpdatedAt(note.updatedAt, timezone)}</span>
                          {state !== 'saved' ? (
                            <span
                              className={cn(
                                state === 'error'
                                  ? 'text-[var(--color-danger)]'
                                  : 'text-[var(--color-brand)]',
                              )}
                            >
                              {state === 'saving'
                                ? 'Speichert …'
                                : state === 'error'
                                  ? 'Fehler'
                                  : 'Ungespeichert'}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel
          className={cn(
            'min-h-0 flex-col overflow-hidden',
            mobileEditorOpen ? 'flex' : 'hidden md:flex',
          )}
        >
          {selectedNote ? (
            <>
              <PanelHeader className="shrink-0 gap-2 px-3 sm:px-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="md:hidden"
                  onClick={() => {
                    const wasBlank = selectedNote.title.trim().length === 0;
                    normalizeCurrentTitle(selectedNote.id);
                    if (wasBlank || selectedSaveState === 'dirty') queueSave(selectedNote.id, 0);
                    setMobileEditorOpen(false);
                  }}
                  aria-label="Zur Notizliste"
                >
                  <ArrowLeft aria-hidden />
                </Button>
                <div className="min-w-0 flex-1">
                  <Input
                    value={selectedNote.title}
                    maxLength={NOTE_LIMITS.titleLength}
                    onChange={(event) =>
                      updateDraft(
                        selectedNote.id,
                        { title: event.target.value },
                        event.target.value.trim().length > 0,
                      )
                    }
                    onBlur={() => {
                      normalizeCurrentTitle(selectedNote.id);
                      queueSave(selectedNote.id, 0);
                    }}
                    aria-label="Name der Notiz"
                    className="h-8 border-transparent bg-transparent px-1 text-[length:var(--text-base)] font-semibold hover:border-[var(--color-line)] focus:bg-[var(--color-panel)]"
                  />
                  <SaveIndicator
                    state={selectedSaveState}
                    updatedAt={selectedNote.updatedAt}
                    timezone={timezone}
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={selectedSaveState === 'saving'}
                  disabled={selectedSaveState === 'saved'}
                  onClick={() => {
                    normalizeCurrentTitle(selectedNote.id);
                    void persistNote(selectedNote.id);
                  }}
                >
                  <Save aria-hidden />
                  <span className="hidden sm:inline">Speichern</span>
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
              </PanelHeader>

              <NotebookCanvas
                key={selectedNote.id}
                initialDocument={selectedNote.document}
                onDocumentChange={(document: NotebookDocumentV1) =>
                  updateDraft(selectedNote.id, { document })
                }
                preferences={preferences}
                onPreferenceChange={updatePreference}
                className="min-h-0 flex-1"
              />
            </>
          ) : (
            <div className="flex min-h-0 flex-1 items-center p-4">
              <EmptyState
                className="w-full"
                icon={<FilePenLine />}
                title="Notiz auswählen"
                description="Wähle links eine Notiz aus oder lege eine neue Seite an."
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
        </Panel>
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
