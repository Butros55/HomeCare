import 'server-only';

import { fromDateInputValue } from '@/lib/dates';
import { centsForKilometers, centsForMinutes, computePersonalEarnings } from '@/lib/earnings';
import { computeNetPay, isCompensationProfileComplete } from '@/lib/net-pay';
import { db } from '@/server/db';
import { AppError } from '@/server/errors';
import {
  employeeScopeFilter,
  getManagedEmployeeIds,
  isLeadershipRole,
  requirePermission,
} from '@/server/permissions';

export interface PersonalEarningsFilters {
  from: string;
  to: string;
}

/**
 * Persönlicher Verdienst im gewählten Zeitraum.
 *
 * Eigene Stunden stammen ausschließlich aus abgeschlossenen eigenen Terminen.
 * Für die Ist-Zeit werden – analog zum übrigen Stundenmodell – freigegebene
 * TimeEntries bevorzugt, andernfalls zählt die Termindauer. Leitungs-Provision
 * zählt nur im Teammodus und nur für fremde, nicht-leitende Mitarbeiter im
 * eigenen Berechtigungs-Scope.
 */
export async function getPersonalEarningsData(filters: PersonalEarningsFilters) {
  const ctx = await requirePermission('reports.view');
  const fromDate = fromDateInputValue(filters.from);
  const toDate = fromDateInputValue(filters.to);
  if (!fromDate || !toDate || toDate < fromDate) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'Bitte einen gültigen Zeitraum wählen.',
    });
  }
  const period = {
    start: fromDate,
    end: new Date(toDate.getTime() + 24 * 60 * 60 * 1000),
  };

  const ownEmployeeId = ctx.employee?.id ?? null;
  const showCommission =
    isLeadershipRole(ctx.membership.role) && !ctx.organization.soloMode;
  const scope = await getManagedEmployeeIds(ctx);

  const [commissionCandidates, leadershipMemberships] = showCommission
    ? await Promise.all([
        db.employee.findMany({
          where: {
            organizationId: ctx.organization.id,
            deletedAt: null,
            ...employeeScopeFilter(scope),
          },
          select: {
            id: true,
            userId: true,
            firstName: true,
            lastName: true,
          },
        }),
        db.organizationMembership.findMany({
          where: {
            organizationId: ctx.organization.id,
            role: { not: 'EMPLOYEE' },
          },
          select: { userId: true },
        }),
      ])
    : [[], []];

  const leadershipUserIds = new Set(
    leadershipMemberships.map((membership) => membership.userId),
  );
  const commissionEmployees = commissionCandidates.filter(
    (employee) =>
      employee.id !== ownEmployeeId &&
      (!employee.userId || !leadershipUserIds.has(employee.userId)),
  );
  const commissionEmployeeIds = new Set(
    commissionEmployees.map((employee) => employee.id),
  );
  const relevantEmployeeIds = [
    ...(ownEmployeeId ? [ownEmployeeId] : []),
    ...commissionEmployeeIds,
  ];

  const appointments =
    relevantEmployeeIds.length === 0
      ? []
      : await db.appointment.findMany({
          where: {
            organizationId: ctx.organization.id,
            deletedAt: null,
            status: 'COMPLETED',
            startAt: { gte: period.start, lt: period.end },
            assignedEmployeeId: { in: relevantEmployeeIds },
          },
          select: {
            id: true,
            assignedEmployeeId: true,
            durationMinutes: true,
            timeEntries: {
              where: { status: 'APPROVED' },
              select: { workedMinutes: true },
            },
          },
        });

  const employeeMinutes = new Map<string, number>();
  const employeeAppointmentCounts = new Map<string, number>();
  let ownCompletedMinutes = 0;
  let ownAppointmentCount = 0;

  for (const appointment of appointments) {
    const completedMinutes =
      appointment.timeEntries.length > 0
        ? appointment.timeEntries.reduce(
            (sum, entry) => sum + entry.workedMinutes,
            0,
          )
        : appointment.durationMinutes;

    if (appointment.assignedEmployeeId === ownEmployeeId) {
      ownCompletedMinutes += completedMinutes;
      ownAppointmentCount += 1;
      continue;
    }
    if (
      appointment.assignedEmployeeId &&
      commissionEmployeeIds.has(appointment.assignedEmployeeId)
    ) {
      employeeMinutes.set(
        appointment.assignedEmployeeId,
        (employeeMinutes.get(appointment.assignedEmployeeId) ?? 0) +
          completedMinutes,
      );
      employeeAppointmentCounts.set(
        appointment.assignedEmployeeId,
        (employeeAppointmentCounts.get(appointment.assignedEmployeeId) ?? 0) +
          1,
      );
    }
  }

  const employeeCompletedMinutes = [...employeeMinutes.values()].reduce(
    (sum, minutes) => sum + minutes,
    0,
  );
  const calculated = computePersonalEarnings({
    ownCompletedMinutes,
    hourlyWageCents: ctx.membership.hourlyWageCents,
    employeeCompletedMinutes,
    employeeCommissionCentsPerHour:
      ctx.membership.employeeCommissionCentsPerHour,
  });

  const employeeRows = commissionEmployees
    .map((employee) => {
      const completedMinutes = employeeMinutes.get(employee.id) ?? 0;
      return {
        id: employee.id,
        name: `${employee.firstName} ${employee.lastName}`,
        completedMinutes,
        appointmentCount: employeeAppointmentCounts.get(employee.id) ?? 0,
        commissionCents: centsForMinutes(
          completedMinutes,
          ctx.membership.employeeCommissionCentsPerHour,
        ),
      };
    })
    .filter((row) => row.completedMinutes > 0)
    .sort(
      (left, right) =>
        right.completedMinutes - left.completedMinutes ||
        left.name.localeCompare(right.name, 'de'),
    );

  // Kilometergeld: gefahrene Strecke der EIGENEN gespeicherten Tagesrouten im
  // Zeitraum × persönlicher Satz. Steuerfrei (Kilometerpauschale) und bewusst
  // nur für eigene Fahrten – Mitarbeiter-Routen zählen nicht.
  // `?? 0`: robust, falls der (Dev-)Prisma-Client das Feld noch nicht kennt.
  const mileageRatePerKmCents = ctx.membership.mileageRatePerKmCents ?? 0;
  const ownRoutePlans =
    ownEmployeeId && mileageRatePerKmCents > 0
      ? await db.routePlan.findMany({
          where: {
            organizationId: ctx.organization.id,
            employeeId: ownEmployeeId,
            routeDate: { gte: period.start, lt: period.end },
          },
          select: { totalDistanceMeters: true },
        })
      : [];
  const ownDrivenMeters = ownRoutePlans.reduce(
    (sum, plan) => sum + plan.totalDistanceMeters,
    0,
  );
  const mileageCents = centsForKilometers(ownDrivenMeters, mileageRatePerKmCents);

  // Brutto → Netto: nur schätzen, wenn das Vergütungsprofil vollständig ist.
  // Der steuerfreie Zuschlag (z. B. Werbepauschale) hängt an den eigenen
  // geleisteten Stunden, nicht an der Provision.
  const membership = ctx.membership;
  const taxFreeBonusCents = centsForMinutes(
    ownCompletedMinutes,
    membership.taxFreeBonusCentsPerHour,
  );
  const profile = {
    employmentType: membership.taxEmploymentType ?? undefined,
    incomeTaxRatePercent: membership.incomeTaxRatePercent ?? undefined,
    churchTaxRatePercent: membership.churchTaxRatePercent,
    healthInsuranceExtraRatePercent: membership.healthInsuranceExtraRatePercent,
    hasChildren: membership.hasChildren,
    applySolidarity: membership.applySolidarity,
  };
  const netPay = isCompensationProfileComplete(profile)
    ? computeNetPay({
        taxableGrossCents: calculated.totalEarningsCents,
        taxFreeCents: taxFreeBonusCents + mileageCents,
        profile,
      })
    : null;

  return {
    period: { from: filters.from, to: filters.to },
    showCommission,
    rates: {
      hourlyWageCents: ctx.membership.hourlyWageCents,
      employeeCommissionCentsPerHour:
        ctx.membership.employeeCommissionCentsPerHour,
      taxFreeBonusCentsPerHour: membership.taxFreeBonusCentsPerHour,
      taxFreeBonusLabel: membership.taxFreeBonusLabel,
      mileageRatePerKmCents,
    },
    /** Steuerfreier Zuschlag im Zeitraum (0, wenn keiner hinterlegt ist). */
    taxFreeBonusCents,
    /** Kilometergeld: eigene Routen-Kilometer im Zeitraum × Satz (steuerfrei). */
    mileage: {
      drivenMeters: ownDrivenMeters,
      cents: mileageCents,
    },
    /**
     * Netto-Schätzung – `null`, solange die Angaben in den Einstellungen
     * fehlen. Dann zeigt der Bericht bewusst nur Brutto.
     */
    netPay,
    employmentType: membership.taxEmploymentType,
    own: {
      completedMinutes: ownCompletedMinutes,
      appointmentCount: ownAppointmentCount,
      earningsCents: calculated.ownEarningsCents,
    },
    commission: {
      completedMinutes: employeeCompletedMinutes,
      appointmentCount: [...employeeAppointmentCounts.values()].reduce(
        (sum, count) => sum + count,
        0,
      ),
      employeeCount: employeeRows.length,
      earningsCents: calculated.commissionEarningsCents,
      employeeRows,
    },
    totalEarningsCents: calculated.totalEarningsCents,
  };
}

export type PersonalEarningsData = Awaited<
  ReturnType<typeof getPersonalEarningsData>
>;
