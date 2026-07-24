'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { writeAuditLog } from '@/server/audit';
import { db } from '@/server/db';
import { AppError, runAction, type ActionResult } from '@/server/errors';
import {
  canTogglePersonalView,
  isLeadershipRole,
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

const earningsSettingsSchema = z.object({
  hourlyWageCents: z
    .number()
    .int()
    .min(0, 'Der Stundenlohn darf nicht negativ sein.')
    .max(1_000_000, 'Der Stundenlohn ist zu hoch.'),
  employeeCommissionCentsPerHour: z
    .number()
    .int()
    .min(0, 'Die Provision darf nicht negativ sein.')
    .max(1_000_000, 'Die Provision ist zu hoch.')
    .optional(),
  // Angaben für die Netto-Schätzung. Alles optional – ohne sie zeigt der
  // Bericht ausschließlich Brutto.
  taxEmploymentType: z.enum(['MINIJOB', 'EMPLOYED', 'SELF_EMPLOYED']).nullable().optional(),
  incomeTaxRatePercent: z
    .number()
    .min(0, 'Der Steuersatz darf nicht negativ sein.')
    .max(60, 'Der Steuersatz ist zu hoch.')
    .nullable()
    .optional(),
  churchTaxRatePercent: z.number().min(0).max(12).optional(),
  healthInsuranceExtraRatePercent: z.number().min(0).max(10).optional(),
  hasChildren: z.boolean().optional(),
  applySolidarity: z.boolean().optional(),
  taxFreeBonusCentsPerHour: z
    .number()
    .int()
    .min(0, 'Der Zuschlag darf nicht negativ sein.')
    .max(1_000_000, 'Der Zuschlag ist zu hoch.')
    .optional(),
  taxFreeBonusLabel: z.string().trim().min(1).max(60).optional(),
});

/**
 * Persönliche Verdienst-Sätze je Organisation speichern.
 *
 * Die Provision ist ausschließlich für Leitungs-Konten im Teammodus
 * beschreibbar. Im Solo-Modus bleibt ein früherer Satz erhalten, wird aber
 * weder angezeigt noch in der Auswertung berücksichtigt.
 */
export async function saveEarningsSettingsAction(
  input: z.input<typeof earningsSettingsSchema>,
): Promise<
  ActionResult<{
    hourlyWageCents: number;
    employeeCommissionCentsPerHour: number;
  }>
> {
  return runAction(async () => {
    const ctx = await requireOrganizationMembership();
    const data = earningsSettingsSchema.parse(input);
    const canSetCommission =
      isLeadershipRole(ctx.membership.role) && !ctx.organization.soloMode;
    const updateCommission =
      canSetCommission &&
      data.employeeCommissionCentsPerHour !== undefined;

    await db.$transaction(async (tx) => {
      await tx.organizationMembership.update({
        where: { id: ctx.membership.id },
        data: {
          hourlyWageCents: data.hourlyWageCents,
          ...(updateCommission
            ? {
                employeeCommissionCentsPerHour:
                  data.employeeCommissionCentsPerHour,
              }
            : {}),
          // Nur übernehmen, was auch geschickt wurde – so lassen sich einzelne
          // Angaben ergänzen, ohne die übrigen zu überschreiben.
          ...(data.taxEmploymentType !== undefined
            ? { taxEmploymentType: data.taxEmploymentType }
            : {}),
          ...(data.incomeTaxRatePercent !== undefined
            ? { incomeTaxRatePercent: data.incomeTaxRatePercent }
            : {}),
          ...(data.churchTaxRatePercent !== undefined
            ? { churchTaxRatePercent: data.churchTaxRatePercent }
            : {}),
          ...(data.healthInsuranceExtraRatePercent !== undefined
            ? { healthInsuranceExtraRatePercent: data.healthInsuranceExtraRatePercent }
            : {}),
          ...(data.hasChildren !== undefined ? { hasChildren: data.hasChildren } : {}),
          ...(data.applySolidarity !== undefined
            ? { applySolidarity: data.applySolidarity }
            : {}),
          ...(data.taxFreeBonusCentsPerHour !== undefined
            ? { taxFreeBonusCentsPerHour: data.taxFreeBonusCentsPerHour }
            : {}),
          ...(data.taxFreeBonusLabel !== undefined
            ? { taxFreeBonusLabel: data.taxFreeBonusLabel }
            : {}),
        },
      });
      await writeAuditLog(
        {
          organizationId: ctx.organization.id,
          actorUserId: ctx.user.id,
          action: 'member.earningsSettingsChanged',
          entityType: 'OrganizationMembership',
          entityId: ctx.membership.id,
          // Keine Geldwerte im Audit-Log; nur die bewusst geänderten Felder.
          metadata: {
            fields: [
              'hourlyWageCents',
              ...(updateCommission
                ? ['employeeCommissionCentsPerHour']
                : []),
            ],
          },
        },
        tx,
      );
    });

    revalidatePath('/settings');
    revalidatePath('/reports');
    return {
      hourlyWageCents: data.hourlyWageCents,
      employeeCommissionCentsPerHour: updateCommission
        ? data.employeeCommissionCentsPerHour!
        : ctx.membership.employeeCommissionCentsPerHour,
    };
  });
}
