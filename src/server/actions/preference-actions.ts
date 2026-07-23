'use server';

import { z } from 'zod';

import { db } from '@/server/db';
import { runAction, type ActionResult } from '@/server/errors';
import { requireAuthenticatedUser } from '@/server/permissions';

const calendarPrefSchema = z.object({
  calendarView: z
    .enum(['multiMonthYear', 'dayGridMonth', 'timeGridWeek', 'timeGridDay', 'listWeek', 'listMonth'])
    .optional(),
  calendarColorBy: z.enum(['customer', 'employee', 'status', 'team']).optional(),
});

/** Letzte Kalenderansicht/Farbcodierung pro Benutzer speichern (Anforderung 13). */
export async function saveCalendarPreferenceAction(
  input: z.input<typeof calendarPrefSchema>,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    const user = await requireAuthenticatedUser();
    const data = calendarPrefSchema.parse(input);
    await db.userPreference.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: data,
    });
    return { done: true as const };
  });
}

const notificationPrefsSchema = z.record(z.string(), z.boolean());

export async function saveNotificationPrefsAction(
  input: Record<string, boolean>,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    const user = await requireAuthenticatedUser();
    const data = notificationPrefsSchema.parse(input);
    await db.userPreference.upsert({
      where: { userId: user.id },
      create: { userId: user.id, notificationPrefs: data },
      update: { notificationPrefs: data },
    });
    return { done: true as const };
  });
}
