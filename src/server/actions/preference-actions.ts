'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/server/db';
import { AppError, runAction, type ActionResult } from '@/server/errors';
import {
  canTogglePersonalView,
  requireAuthenticatedUser,
  requireOrganizationMembership,
} from '@/server/permissions';

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

/**
 * Schnell-Umschalter der Leitung: persönliche Kompakt-Ansicht („Mein Tag“)
 * ein-/ausschalten. Reiner Ansichtswechsel pro Benutzer – Daten und
 * Zuordnungen bleiben unangetastet.
 */
export async function togglePersonalViewAction(
  active: boolean,
): Promise<ActionResult<{ personalView: boolean }>> {
  return runAction(async () => {
    const ctx = await requireOrganizationMembership();
    if (!canTogglePersonalView(ctx)) {
      throw new AppError('ACCESS_DENIED', {
        message: 'Der Ansichtswechsel ist nur für Leitungs-Konten im Team-Modus verfügbar.',
      });
    }
    await db.userPreference.upsert({
      where: { userId: ctx.user.id },
      create: { userId: ctx.user.id, personalViewActive: Boolean(active) },
      update: { personalViewActive: Boolean(active) },
    });
    revalidatePath('/', 'layout');
    return { personalView: Boolean(active) };
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
