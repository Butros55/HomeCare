'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { runAction, type ActionResult } from '@/server/errors';
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
