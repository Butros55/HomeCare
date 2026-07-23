'use server';

import { z } from 'zod';

import { db } from '@/server/db';
import { runAction, type ActionResult } from '@/server/errors';
import { requireOrganizationMembership } from '@/server/permissions';

/**
 * Fortschritt der Hinweis-Touren. Pro Konto+Organisation wird je Tour genau
 * ein Datensatz geführt; höhere Tour-Versionen dürfen erneut starten.
 */

const saveSchema = z.object({
  tourId: z.string().trim().min(1).max(80),
  version: z.number().int().min(1).max(1000),
  status: z.enum(['IN_PROGRESS', 'COMPLETED', 'SKIPPED']),
  currentStepId: z.string().trim().max(120).nullable().optional(),
});

export async function saveTourProgressAction(
  input: z.input<typeof saveSchema>,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    const ctx = await requireOrganizationMembership();
    const data = saveSchema.parse(input);
    await db.userTourProgress.upsert({
      where: {
        userId_organizationId_tourId: {
          userId: ctx.user.id,
          organizationId: ctx.organization.id,
          tourId: data.tourId,
        },
      },
      create: {
        userId: ctx.user.id,
        organizationId: ctx.organization.id,
        tourId: data.tourId,
        version: data.version,
        status: data.status,
        currentStepId: data.currentStepId ?? null,
        completedAt: data.status === 'COMPLETED' ? new Date() : null,
      },
      update: {
        version: data.version,
        status: data.status,
        currentStepId: data.currentStepId ?? null,
        completedAt: data.status === 'COMPLETED' ? new Date() : undefined,
      },
    });
    return { done: true as const };
  });
}

export interface TourProgressSnapshot {
  tourId: string;
  version: number;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';
  currentStepId: string | null;
}

/** Alle Fortschritts-Einträge des Kontos in der aktiven Organisation. */
export async function loadTourProgress(): Promise<TourProgressSnapshot[]> {
  const ctx = await requireOrganizationMembership();
  const rows = await db.userTourProgress.findMany({
    where: { userId: ctx.user.id, organizationId: ctx.organization.id },
    select: { tourId: true, version: true, status: true, currentStepId: true },
  });
  return rows;
}
