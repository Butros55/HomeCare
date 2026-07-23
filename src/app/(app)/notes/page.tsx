import type { Metadata } from 'next';

import { PageHeader } from '@/components/layout/page-header';
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

  return (
    <>
      <PageHeader
        title="Notizbuch"
        description="Handschriftliche Notizen mit Stift, Marker und Radierer."
      />
      <NotesWorkspace
        initialNotes={initialNotes}
        timezone={ctx.organization.timezone}
      />
    </>
  );
}
