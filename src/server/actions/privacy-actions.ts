'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { writeAuditLog } from '@/server/audit';
import { db } from '@/server/db';
import { runAction, type ActionResult } from '@/server/errors';
import { requirePermission } from '@/server/permissions';
import { anonymizeCustomer } from '@/server/services/privacy-service';

export async function anonymizeCustomerAction(
  customerId: string,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    await anonymizeCustomer(customerId);
    revalidatePath('/customers');
    revalidatePath('/settings');
    return { done: true as const };
  });
}

const retentionSchema = z.object({
  /** Aufbewahrung abgeschlossener Termine/Zeiten in Monaten (0 = unbegrenzt). */
  appointmentRetentionMonths: z.number().int().min(0).max(120),
  auditRetentionMonths: z.number().int().min(0).max(120),
  notificationRetentionMonths: z.number().int().min(0).max(24),
});
export type RetentionInput = z.input<typeof retentionSchema>;

/** Konfigurierbare Aufbewahrungsfristen (angewendet durch scripts/retention-cleanup.ts). */
export async function saveRetentionAction(
  input: RetentionInput,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    const ctx = await requirePermission('settings.manage');
    const data = retentionSchema.parse(input);
    const settings = ((ctx.organization.settings as Record<string, unknown> | null) ?? {}) as Record<
      string,
      unknown
    >;
    await db.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id: ctx.organization.id },
        data: { settings: { ...settings, retention: data } },
      });
      await writeAuditLog(
        {
          organizationId: ctx.organization.id,
          actorUserId: ctx.user.id,
          action: 'organization.updated',
          entityType: 'Organization',
          entityId: ctx.organization.id,
          metadata: { retention: data },
        },
        tx,
      );
    });
    revalidatePath('/settings');
    return { done: true as const };
  });
}
