'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { EDITABLE_PERMISSIONS } from '@/lib/permission-catalog';
import { writeAuditLog } from '@/server/audit';
import { db } from '@/server/db';
import { runAction, type ActionResult } from '@/server/errors';
import { requirePermission } from '@/server/permissions';
import { updateOrganizationSettings } from '@/server/services/organization-service';

const organizationSchema = z.object({
  name: z.string().trim().min(2, 'Der Name braucht mindestens 2 Zeichen.').max(120),
  timezone: z.string().trim().min(3).max(60),
  startLocation: z
    .object({
      label: z.string().trim().min(1).max(60),
      street: z.string().trim().min(1, 'Straße ist erforderlich.').max(150),
      houseNumber: z.string().trim().min(1, 'Hausnummer ist erforderlich.').max(20),
      postalCode: z.string().trim().regex(/^\d{4,5}$/, 'Gültige PLZ eingeben.'),
      city: z.string().trim().min(1, 'Ort ist erforderlich.').max(100),
    })
    .nullable()
    .optional(),
});

export async function updateOrganizationAction(
  input: z.input<typeof organizationSchema>,
): Promise<ActionResult<{ geocoded: boolean }>> {
  return runAction(async () => {
    const data = organizationSchema.parse(input);
    const result = await updateOrganizationSettings(data);
    revalidatePath('/settings');
    revalidatePath('/dashboard');
    // Start-/Zieladresse fließt in die Routenplanung ein.
    revalidatePath('/routes');
    return result;
  });
}

const defaultPermissionsSchema = z.object({
  leadership: z.array(z.enum(EDITABLE_PERMISSIONS as [string, ...string[]])),
  employee: z.array(z.enum(EDITABLE_PERMISSIONS as [string, ...string[]])),
});

/**
 * Standard-Berechtigungen für neue Konten (Leitung / Mitarbeiter) speichern.
 * Sie greifen beim Einladen bzw. beim Wechsel der Konto-Art; bestehende
 * Konten bleiben unverändert.
 */
export async function updateDefaultPermissionsAction(
  input: z.input<typeof defaultPermissionsSchema>,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    const ctx = await requirePermission('settings.manage');
    const data = defaultPermissionsSchema.parse(input);
    await db.organization.update({
      where: { id: ctx.organization.id },
      data: {
        defaultLeadershipPermissions: [...new Set(data.leadership)],
        defaultEmployeePermissions: [...new Set(data.employee)],
      },
    });
    await writeAuditLog({
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: 'organization.defaultPermissionsChanged',
      entityType: 'Organization',
      entityId: ctx.organization.id,
      metadata: { leadership: data.leadership, employee: data.employee },
    });
    revalidatePath('/settings');
    return { done: true as const };
  });
}
