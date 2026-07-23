import type { Metadata } from 'next';

import {
  normalizeNotebookDocument,
  type HandwrittenNoteClient,
} from '@/features/notes/drawing-model';
import { NotesWorkspace } from '@/features/notes/notes-workspace';
import { db } from '@/server/db';
import { requireOrganizationMembership } from '@/server/permissions';

export const metadata: Metadata = { title: 'Notizen' };

interface StoredNoteRow {
  id: string;
  title: string;
  document: unknown;
  contentVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export default async function NotesPage() {
  const ctx = await requireOrganizationMembership();
  const notes = (await db.handwrittenNote.findMany({
    where: {
      organizationId: ctx.organization.id,
      userId: ctx.user.id,
    },
    select: {
      id: true,
      title: true,
      document: true,
      contentVersion: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
  })) as StoredNoteRow[];

  const initialNotes: HandwrittenNoteClient[] = notes.map((note) => ({
    id: note.id,
    title: note.title,
    document: normalizeNotebookDocument(note.document),
    contentVersion: note.contentVersion,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  }));

  // Bewusst ohne PageHeader: die Seite ist „Papier zuerst" und nutzt die volle
  // Höhe – Titel und Aktionen stehen in der schmalen Kopfzeile des Notizbuchs.
  return (
    <div className="flex h-full min-h-0 flex-col">
      <NotesWorkspace initialNotes={initialNotes} timezone={ctx.organization.timezone} />
    </div>
  );
}
