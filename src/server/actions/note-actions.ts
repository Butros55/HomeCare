'use server';

import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  createEmptyNotebookDocument,
  NOTE_DOCUMENT_VERSION,
  notebookDocumentSchema,
  noteTitleSchema,
  type HandwrittenNoteClient,
} from '@/features/notes/drawing-model';
import { db } from '@/server/db';
import { AppError, runAction, type ActionResult } from '@/server/errors';
import { requireOrganizationMembership } from '@/server/permissions';

const noteIdSchema = z.string().trim().min(1).max(100);

const createNoteSchema = z.object({
  title: noteTitleSchema.optional(),
});

const saveNoteSchema = z.object({
  id: noteIdSchema,
  title: noteTitleSchema,
  document: notebookDocumentSchema,
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
});

function serializeNote(note: {
  id: string;
  title: string;
  document: unknown;
  contentVersion: number;
  createdAt: Date;
  updatedAt: Date;
}): HandwrittenNoteClient {
  return {
    id: note.id,
    title: note.title,
    document: notebookDocumentSchema.parse(note.document),
    contentVersion: note.contentVersion,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

export async function createHandwrittenNoteAction(
  input: z.input<typeof createNoteSchema> = {},
): Promise<ActionResult<HandwrittenNoteClient>> {
  return runAction(async () => {
    const ctx = await requireOrganizationMembership();
    const data = createNoteSchema.parse(input);
    const document = createEmptyNotebookDocument();
    const note = await db.handwrittenNote.create({
      data: {
        organizationId: ctx.organization.id,
        userId: ctx.user.id,
        title: data.title ?? 'Neue Notiz',
        document: document as unknown as Prisma.InputJsonValue,
        contentVersion: NOTE_DOCUMENT_VERSION,
      },
    });
    revalidatePath('/notes');
    return serializeNote(note);
  });
}

/**
 * Speichert ausschließlich private Notizen des aktuell angemeldeten Kontos.
 * `updatedAt` dient als leichtgewichtige optimistische Sperre, damit ein
 * verspätetes Autosave keinen neueren Stand eines zweiten Tabs überschreibt.
 */
export async function saveHandwrittenNoteAction(
  input: z.input<typeof saveNoteSchema>,
): Promise<ActionResult<HandwrittenNoteClient>> {
  return runAction(async () => {
    const ctx = await requireOrganizationMembership();
    const data = saveNoteSchema.parse(input);
    const scope = {
      id: data.id,
      organizationId: ctx.organization.id,
      userId: ctx.user.id,
    };

    const update = await db.handwrittenNote.updateMany({
      where: {
        ...scope,
        ...(data.expectedUpdatedAt
          ? { updatedAt: new Date(data.expectedUpdatedAt) }
          : {}),
      },
      data: {
        title: data.title,
        document: data.document as unknown as Prisma.InputJsonValue,
        contentVersion: NOTE_DOCUMENT_VERSION,
      },
    });

    if (update.count === 0) {
      const exists = await db.handwrittenNote.findFirst({
        where: scope,
        select: { id: true },
      });
      if (!exists) {
        throw new AppError('NOT_FOUND', { message: 'Die Notiz wurde nicht gefunden.' });
      }
      throw new AppError('CONFLICT', {
        message:
          'Die Notiz wurde zwischenzeitlich in einem anderen Fenster geändert. Bitte die Seite neu laden.',
      });
    }

    const note = await db.handwrittenNote.findFirst({ where: scope });
    if (!note) {
      throw new AppError('NOT_FOUND', { message: 'Die Notiz wurde nicht gefunden.' });
    }
    return serializeNote(note);
  });
}

export async function deleteHandwrittenNoteAction(
  noteId: string,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireOrganizationMembership();
    const id = noteIdSchema.parse(noteId);
    const deleted = await db.handwrittenNote.deleteMany({
      where: {
        id,
        organizationId: ctx.organization.id,
        userId: ctx.user.id,
      },
    });
    if (deleted.count === 0) {
      throw new AppError('NOT_FOUND', { message: 'Die Notiz wurde nicht gefunden.' });
    }
    revalidatePath('/notes');
    return { id };
  });
}
