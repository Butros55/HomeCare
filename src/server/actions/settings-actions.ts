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

/** Zustände, in denen ein Termin noch „lebendig“ ist und umgezogen werden darf. */
const REASSIGNABLE_STATUSES = ['DRAFT', 'PLANNED', 'CONFIRMED'] as const;

/**
 * UI-Modus der Organisation umstellen – inklusive Daten-Umzug:
 *
 *  Leitung → Alleine: Alle künftigen Termine der Mitarbeiter wandern auf das
 *  eigene Profil; der ursprüngliche Mitarbeiter wird als Marker gespeichert
 *  (soloReassignedFromEmployeeId). Mitarbeiter, Kunden usw. bleiben erhalten.
 *
 *  Alleine → Leitung: Die Marker stellen die alten Zuordnungen wieder her
 *  (nur künftige, noch nicht abgeschlossene Termine – Historie bleibt wahr).
 *
 * Wichtig: Der schnelle Ansichtswechsel in der Topbar macht das NICHT –
 * er ist eine reine UI-Umschaltung. Nur dieser Einstellungs-Wechsel zieht um.
 */
export async function updateSoloModeAction(
  soloMode: boolean,
): Promise<ActionResult<{ done: true; movedCount: number }>> {
  return runAction(async () => {
    const ctx = await requirePermission('settings.manage');
    const next = Boolean(soloMode);
    const orgId = ctx.organization.id;
    const now = new Date();
    let movedCount = 0;

    if (next === ctx.organization.soloMode) {
      return { done: true as const, movedCount: 0 };
    }

    await db.$transaction(async (tx) => {
      if (next) {
        // ---- Leitung → Alleine: Termine der Mitarbeiter auf sich selbst ----
        // Eigenes Mitarbeiterprofil sicherstellen (Ziel des Umzugs).
        let ownEmployee = await tx.employee.findFirst({
          where: { organizationId: orgId, userId: ctx.user.id, deletedAt: null },
          select: { id: true },
        });
        if (!ownEmployee) {
          ownEmployee = await tx.employee.create({
            data: {
              organizationId: orgId,
              userId: ctx.user.id,
              firstName: ctx.user.firstName,
              lastName: ctx.user.lastName,
              email: ctx.user.email,
              employmentType: 'FULL_TIME',
              canReceiveHours: true,
              canRecruitEmployees: true,
            },
            select: { id: true },
          });
        }

        // Betroffene Mitarbeiter ermitteln (alle außer dem eigenen Profil).
        const grouped = await tx.appointment.groupBy({
          by: ['assignedEmployeeId'],
          where: {
            organizationId: orgId,
            deletedAt: null,
            startAt: { gte: now },
            status: { in: [...REASSIGNABLE_STATUSES] },
            assignedEmployeeId: { not: null },
          },
          _count: { _all: true },
        });
        for (const group of grouped) {
          const fromId = group.assignedEmployeeId;
          if (!fromId || fromId === ownEmployee.id) continue;
          const result = await tx.appointment.updateMany({
            where: {
              organizationId: orgId,
              deletedAt: null,
              startAt: { gte: now },
              status: { in: [...REASSIGNABLE_STATUSES] },
              assignedEmployeeId: fromId,
            },
            data: {
              assignedEmployeeId: ownEmployee.id,
              soloReassignedFromEmployeeId: fromId,
              assignmentStatus: 'ACCEPTED',
            },
          });
          movedCount += result.count;
        }

        // Bereits eigene und bisher unzugewiesene offene Termine brauchen im
        // Alleine-Modus keinerlei Annahmeschritt. Unzugewiesene Termine werden
        // dauerhaft dem eigenen Profil zugerechnet; beim späteren Team-Wechsel
        // dürfen sie dort bleiben.
        const unassigned = await tx.appointment.updateMany({
          where: {
            organizationId: orgId,
            deletedAt: null,
            startAt: { gte: now },
            status: { in: [...REASSIGNABLE_STATUSES] },
            assignedEmployeeId: null,
          },
          data: {
            assignedEmployeeId: ownEmployee.id,
            assignmentStatus: 'ACCEPTED',
          },
        });
        movedCount += unassigned.count;
        await tx.appointment.updateMany({
          where: {
            organizationId: orgId,
            deletedAt: null,
            startAt: { gte: now },
            status: { in: [...REASSIGNABLE_STATUSES] },
            assignedEmployeeId: ownEmployee.id,
          },
          data: { assignmentStatus: 'ACCEPTED' },
        });

        // Serien: Standard-Mitarbeiter ebenfalls umziehen (für künftige Vorkommen).
        const seriesRows = await tx.appointmentSeries.findMany({
          where: {
            organizationId: orgId,
            status: 'ACTIVE',
            defaultEmployeeId: { not: null },
          },
          select: { id: true, defaultEmployeeId: true },
        });
        for (const series of seriesRows) {
          if (!series.defaultEmployeeId || series.defaultEmployeeId === ownEmployee.id) continue;
          await tx.appointmentSeries.update({
            where: { id: series.id },
            data: {
              defaultEmployeeId: ownEmployee.id,
              soloReassignedFromEmployeeId: series.defaultEmployeeId,
            },
          });
        }
        await tx.appointmentSeries.updateMany({
          where: {
            organizationId: orgId,
            status: 'ACTIVE',
            defaultEmployeeId: null,
          },
          data: { defaultEmployeeId: ownEmployee.id },
        });
      } else {
        // ---- Alleine → Leitung: alte Zuordnungen wiederherstellen ----
        const marked = await tx.appointment.groupBy({
          by: ['soloReassignedFromEmployeeId'],
          where: {
            organizationId: orgId,
            deletedAt: null,
            soloReassignedFromEmployeeId: { not: null },
          },
          _count: { _all: true },
        });
        const originalIds = marked
          .map((group) => group.soloReassignedFromEmployeeId)
          .filter((id): id is string => Boolean(id));
        const stillActive = new Set(
          (
            await tx.employee.findMany({
              where: { id: { in: originalIds }, deletedAt: null, status: 'ACTIVE' },
              select: { id: true },
            })
          ).map((employee) => employee.id),
        );

        for (const originalId of originalIds) {
          if (stillActive.has(originalId)) {
            // Künftige, noch offene Termine zurück zum ursprünglichen Mitarbeiter.
            const result = await tx.appointment.updateMany({
              where: {
                organizationId: orgId,
                deletedAt: null,
                soloReassignedFromEmployeeId: originalId,
                startAt: { gte: now },
                status: { in: [...REASSIGNABLE_STATUSES] },
              },
              data: {
                assignedEmployeeId: originalId,
                soloReassignedFromEmployeeId: null,
                assignmentStatus: 'ASSIGNED',
              },
            });
            movedCount += result.count;
          }
          // Restliche Marker aufräumen (vergangene/abgeschlossene oder
          // Mitarbeiter inzwischen inaktiv → Termine bleiben bei der Leitung).
          await tx.appointment.updateMany({
            where: { organizationId: orgId, soloReassignedFromEmployeeId: originalId },
            data: { soloReassignedFromEmployeeId: null },
          });
        }

        // Serien-Zuordnungen wiederherstellen.
        const markedSeries = await tx.appointmentSeries.findMany({
          where: { organizationId: orgId, soloReassignedFromEmployeeId: { not: null } },
          select: { id: true, soloReassignedFromEmployeeId: true },
        });
        for (const series of markedSeries) {
          const originalId = series.soloReassignedFromEmployeeId!;
          await tx.appointmentSeries.update({
            where: { id: series.id },
            data: {
              defaultEmployeeId: stillActive.has(originalId) ? originalId : undefined,
              soloReassignedFromEmployeeId: null,
            },
          });
        }
      }

      await tx.organization.update({
        where: { id: orgId },
        data: { soloMode: next },
      });
      await writeAuditLog(
        {
          organizationId: orgId,
          actorUserId: ctx.user.id,
          action: 'organization.updated',
          entityType: 'Organization',
          entityId: orgId,
          metadata: { soloMode: next, movedAppointments: movedCount },
        },
        tx,
      );
    });

    // Modus verändert Navigation, Dashboards, Kalender und Routen überall.
    revalidatePath('/', 'layout');
    return { done: true as const, movedCount };
  });
}

/**
 * Kunden-Stundenkonten org-weit ein-/ausschalten. „Aus" blendet alle
 * Konto-Ansichten/-Kennzahlen aus und schaltet die Deckungsprüfung ab
 * (vorhandene Aufladungen/Gutschriften bleiben erhalten). Betrifft Kunden-,
 * Report-, Dashboard-, Routen- und Einstellungs-Seiten → Layout revalidieren.
 */
export async function setHourBudgetsEnabledAction(
  enabled: boolean,
): Promise<ActionResult<{ enabled: boolean }>> {
  return runAction(async () => {
    const ctx = await requirePermission('settings.manage');
    const next = Boolean(enabled);
    if (next !== ctx.organization.hourBudgetsEnabled) {
      await db.organization.update({
        where: { id: ctx.organization.id },
        data: { hourBudgetsEnabled: next },
      });
      await writeAuditLog({
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: 'organization.updated',
        entityType: 'Organization',
        entityId: ctx.organization.id,
        metadata: { hourBudgetsEnabled: next },
      });
    }
    revalidatePath('/', 'layout');
    return { enabled: next };
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
