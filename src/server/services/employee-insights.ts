import 'server-only';

import { calendarDayInZone, type Period } from '@/lib/dates';
import { overlaps } from '@/lib/dates';
import { db } from '@/server/db';

/**
 * Warnhinweise je Mitarbeiter (Anforderung 10): Kollisionen, Abwesenheits-
 * konflikte, fehlende Verfügbarkeit, Tageslimit. Bulk-Berechnung für Listen
 * (keine N+1-Abfragen). Die Termin-Konfliktprüfung beim Speichern übernimmt
 * der Konfliktservice (src/lib/conflicts.ts).
 */

export interface EmployeeWarnings {
  overlappingAppointments: number;
  absenceCollisions: number;
  noAvailability: boolean;
  dayMaxExceeded: boolean;
}

export async function computeEmployeeWarningsBulk(
  employees: Array<{ id: string; maximumMinutesPerDay: number | null }>,
  period: Period,
  timezone: string,
): Promise<Map<string, EmployeeWarnings>> {
  const result = new Map<string, EmployeeWarnings>();
  if (employees.length === 0) return result;
  const ids = employees.map((e) => e.id);

  const [appointments, absences, availabilities] = await Promise.all([
    db.appointment.findMany({
      where: {
        assignedEmployeeId: { in: ids },
        deletedAt: null,
        status: { in: ['PLANNED', 'CONFIRMED', 'IN_PROGRESS'] },
        startAt: { lt: period.end },
        endAt: { gt: period.start },
      },
      select: {
        assignedEmployeeId: true,
        startAt: true,
        endAt: true,
        durationMinutes: true,
      },
      orderBy: { startAt: 'asc' },
    }),
    db.employeeAbsence.findMany({
      where: {
        employeeId: { in: ids },
        status: 'APPROVED',
        startAt: { lt: period.end },
        endAt: { gt: period.start },
      },
      select: { employeeId: true, startAt: true, endAt: true },
    }),
    db.employeeAvailability.findMany({
      where: { employeeId: { in: ids } },
      select: { employeeId: true },
    }),
  ]);

  const hasAvailability = new Set(availabilities.map((a) => a.employeeId));

  for (const employee of employees) {
    const own = appointments.filter((a) => a.assignedEmployeeId === employee.id);
    const ownAbsences = absences.filter((a) => a.employeeId === employee.id);

    let overlapping = 0;
    for (let i = 0; i < own.length; i += 1) {
      for (let j = i + 1; j < own.length; j += 1) {
        if (overlaps(own[i]!.startAt, own[i]!.endAt, own[j]!.startAt, own[j]!.endAt)) {
          overlapping += 1;
        }
      }
    }

    let absenceCollisions = 0;
    for (const appointment of own) {
      if (
        ownAbsences.some((absence) =>
          overlaps(appointment.startAt, appointment.endAt, absence.startAt, absence.endAt),
        )
      ) {
        absenceCollisions += 1;
      }
    }

    let dayMaxExceeded = false;
    if (employee.maximumMinutesPerDay) {
      const byDay = new Map<string, number>();
      for (const appointment of own) {
        const day = calendarDayInZone(appointment.startAt, timezone);
        const key = `${day.year}-${day.month}-${day.day}`;
        byDay.set(key, (byDay.get(key) ?? 0) + appointment.durationMinutes);
      }
      dayMaxExceeded = [...byDay.values()].some(
        (minutes) => minutes > employee.maximumMinutesPerDay!,
      );
    }

    result.set(employee.id, {
      overlappingAppointments: overlapping,
      absenceCollisions,
      noAvailability: !hasAvailability.has(employee.id),
      dayMaxExceeded,
    });
  }
  return result;
}

export function warningLabels(warnings: EmployeeWarnings): string[] {
  const labels: string[] = [];
  if (warnings.overlappingAppointments > 0) {
    labels.push(
      warnings.overlappingAppointments === 1
        ? '1 Terminüberschneidung'
        : `${warnings.overlappingAppointments} Terminüberschneidungen`,
    );
  }
  if (warnings.absenceCollisions > 0) {
    labels.push(
      warnings.absenceCollisions === 1
        ? '1 Termin während Abwesenheit'
        : `${warnings.absenceCollisions} Termine während Abwesenheit`,
    );
  }
  if (warnings.dayMaxExceeded) labels.push('Tageshöchstarbeitszeit überschritten');
  if (warnings.noAvailability) labels.push('Keine Verfügbarkeit hinterlegt');
  return labels;
}
