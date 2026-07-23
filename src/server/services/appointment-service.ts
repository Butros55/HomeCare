import 'server-only';

import { addDays } from 'date-fns';

import { SERIES_MATERIALIZATION_DAYS } from '@/lib/app-config';
import {
  checkAppointmentConflicts,
  checkBudgetConflicts,
  hasErrors,
  hasWarnings,
  type Conflict,
} from '@/lib/conflicts';
import {
  calendarDayInZone,
  dayPeriodInZone,
  monthPeriodInZone,
  toUtcDateOnly,
  utcDate,
  zonedWallTimeToUtc,
} from '@/lib/dates';
import { getCustomerBudgetMinutes, PLANNED_STATUSES } from '@/lib/hours';
import { estimateTravelSeconds } from '@/lib/geo';
import {
  buildRecurrenceRule,
  expandOccurrenceDates,
  isValidRecurrenceRule,
  occurrenceTimes,
  type RecurrenceOptions,
} from '@/lib/recurrence';
import { writeAuditLog } from '@/server/audit';
import { db } from '@/server/db';
import { AppError } from '@/server/errors';
import {
  assertSameOrg,
  canAccessCustomer,
  getManagedEmployeeIds,
  hasPermission,
  requireOrganizationMembership,
  scopeContains,
  type OrgContext,
} from '@/server/permissions';
import {
  createNotification,
  createNotificationsForUsers,
  getPlannerUserIds,
} from '@/server/services/notification-service';

/**
 * Termin- und Serienverwaltung (Anforderung 12).
 *
 * Serien: RRULE am AppointmentSeries-Datensatz; Vorkommen werden bis zu einem
 * Horizont (120 Tage) als Appointment-Zeilen materialisiert und bei Bedarf
 * erweitert. Einzeländerungen erzeugen AppointmentSeriesException (MODIFIED/
 * CANCELLED) – Regenerierungen überschreiben solche Vorkommen nie.
 */

export interface AppointmentInput {
  customerId: string;
  assignedEmployeeId?: string | null;
  title: string;
  description?: string;
  /** "YYYY-MM-DD" + "HH:mm" in der Organisations-Zeitzone. */
  date: string;
  startTime: string;
  durationMinutes: number;
  status?: 'DRAFT' | 'PLANNED' | 'CONFIRMED';
  isFlexible?: boolean;
  earliestTime?: string | null;
  latestTime?: string | null;
  routeRelevant?: boolean;
  internalNotes?: string;
  recurrence?: (RecurrenceOptions & { enabled: boolean }) | null;
}

export type ConflictOutcome =
  | { requiresConfirmation: true; conflicts: Conflict[] }
  | { requiresConfirmation: false; appointmentId?: string; seriesId?: string };

function parseDateInput(value: string): { y: number; m: number; d: number } {
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) throw new AppError('VALIDATION_FAILED', { message: 'Ungültiges Datum.' });
  return { y, m, d };
}

async function requireAppointmentManage(ctx: OrgContext, assignedEmployeeId?: string | null) {
  if (!hasPermission(ctx, 'appointments.manage')) throw new AppError('ACCESS_DENIED');
  // Mitarbeiter-Konten (mit erteilter Berechtigung) planen ausschließlich für
  // sich selbst – Fremdzuweisung und „ohne Zuordnung“ bleiben der Leitung.
  if (ctx.membership.role === 'EMPLOYEE') {
    if (!ctx.employee || assignedEmployeeId !== ctx.employee.id) {
      throw new AppError('ACCESS_DENIED', {
        message: 'Termine können nur für dich selbst geplant werden.',
      });
    }
  }
  if (ctx.membership.role === 'TEAM_MANAGER' && assignedEmployeeId) {
    const scope = await getManagedEmployeeIds(ctx);
    if (!scopeContains(scope, assignedEmployeeId)) {
      throw new AppError('ACCESS_DENIED', {
        message: 'Termine können nur für Mitarbeiter des eigenen Bereichs geplant werden.',
      });
    }
  }
}

/**
 * Leitung informieren, wenn ein Mitarbeiter selbst plant (Anfrage Juli 2026):
 * Die Verwaltung bleibt bei der Leitung – sie sieht jede Eigenplanung sofort.
 */
async function notifyLeadershipAboutEmployeePlanning(
  ctx: OrgContext,
  appointmentId: string,
  customerId: string,
  startAt: Date,
  verb: 'angelegt' | 'geändert',
) {
  if (ctx.membership.role !== 'EMPLOYEE') return;
  const [planners, customer] = await Promise.all([
    getPlannerUserIds(ctx.organization.id),
    db.customer.findUnique({
      where: { id: customerId },
      select: { firstName: true, lastName: true },
    }),
  ]);
  const recipients = planners.filter((userId) => userId !== ctx.user.id);
  if (recipients.length === 0) return;
  const when = new Intl.DateTimeFormat('de-DE', {
    timeZone: ctx.organization.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(startAt);
  await createNotificationsForUsers(recipients, {
    organizationId: ctx.organization.id,
    type: 'GENERAL',
    title: `Termin von Mitarbeiter ${verb}`,
    message: `${ctx.user.firstName} ${ctx.user.lastName} hat einen Termin für ${customer?.firstName ?? ''} ${customer?.lastName ?? ''} am ${when} ${verb}.`,
    targetUrl: `/calendar?termin=${appointmentId}`,
  });
}

// ---------------------------------------------------------------------------
// Konfliktprüfung (lädt Kontextdaten und delegiert an src/lib/conflicts)
// ---------------------------------------------------------------------------

export async function collectConflicts(
  ctx: OrgContext,
  candidate: {
    id?: string;
    customerId: string;
    assignedEmployeeId: string | null;
    startAt: Date;
    endAt: Date;
    durationMinutes: number;
    routeRelevant: boolean;
    isFlexible: boolean;
    earliestStartAt?: Date | null;
    latestEndAt?: Date | null;
    locationAddressId?: string | null;
  },
): Promise<Conflict[]> {
  const timezone = ctx.organization.timezone;

  const address = candidate.locationAddressId
    ? await db.address.findUnique({
        where: { id: candidate.locationAddressId },
        select: { latitude: true, longitude: true },
      })
    : await db.address.findFirst({
        where: { customerId: candidate.customerId },
        select: { latitude: true, longitude: true },
      });

  let existingAppointments: Awaited<ReturnType<typeof db.appointment.findMany>> = [];
  let absences: { startAt: Date; endAt: Date }[] = [];
  let availabilities: { weekday: number; startTime: string; endTime: string }[] = [];
  let maximumMinutesPerDay: number | null = null;
  let plannedMinutesSameDay = 0;
  let travel: Parameters<typeof checkAppointmentConflicts>[0]['travel'];

  if (candidate.assignedEmployeeId) {
    const day = dayPeriodInZone(candidate.startAt, timezone);
    const windowStart = addDays(day.start, -1);
    const windowEnd = addDays(day.end, 1);

    const [employee, appointments, absenceRows, availabilityRows] = await Promise.all([
      db.employee.findUnique({
        where: { id: candidate.assignedEmployeeId },
        select: { maximumMinutesPerDay: true },
      }),
      db.appointment.findMany({
        where: {
          assignedEmployeeId: candidate.assignedEmployeeId,
          deletedAt: null,
          status: { in: ['PLANNED', 'CONFIRMED', 'IN_PROGRESS'] },
          startAt: { lt: windowEnd },
          endAt: { gt: windowStart },
          ...(candidate.id ? { id: { not: candidate.id } } : {}),
        },
        include: {
          locationAddress: { select: { latitude: true, longitude: true } },
        },
        orderBy: { startAt: 'asc' },
      }),
      db.employeeAbsence.findMany({
        where: {
          employeeId: candidate.assignedEmployeeId,
          status: 'APPROVED',
          startAt: { lt: windowEnd },
          endAt: { gt: windowStart },
        },
        select: { startAt: true, endAt: true },
      }),
      db.employeeAvailability.findMany({
        where: {
          employeeId: candidate.assignedEmployeeId,
          // Nur am Termintag gültige Zeitfenster berücksichtigen.
          validFrom: { lt: day.end },
          OR: [{ validUntil: null }, { validUntil: { gte: day.start } }],
        },
        select: { weekday: true, startTime: true, endTime: true },
      }),
    ]);

    existingAppointments = appointments;
    absences = absenceRows;
    availabilities = availabilityRows;
    maximumMinutesPerDay = employee?.maximumMinutesPerDay ?? null;
    plannedMinutesSameDay = appointments
      .filter((a) => a.startAt >= day.start && a.startAt < day.end)
      .reduce((sum, a) => sum + a.durationMinutes, 0);

    // Fahrzeit zu unmittelbaren Nachbarterminen (deterministische Schätzung).
    if (address?.latitude != null && address?.longitude != null) {
      const here = { latitude: address.latitude, longitude: address.longitude };
      const previous = appointments
        .filter((a) => a.endAt <= candidate.startAt && a.routeRelevant)
        .at(-1);
      const next = appointments.find(
        (a) => a.startAt >= candidate.endAt && a.routeRelevant,
      );
      travel = {};
      if (
        previous?.locationAddress?.latitude != null &&
        previous.locationAddress.longitude != null
      ) {
        travel.fromPreviousSeconds = estimateTravelSeconds(
          { latitude: previous.locationAddress.latitude, longitude: previous.locationAddress.longitude },
          here,
        );
        travel.previousEndAt = previous.endAt;
      }
      if (next?.locationAddress?.latitude != null && next.locationAddress.longitude != null) {
        travel.toNextSeconds = estimateTravelSeconds(here, {
          latitude: next.locationAddress.latitude,
          longitude: next.locationAddress.longitude,
        });
        travel.nextStartAt = next.startAt;
      }
    }
  }

  const conflicts = checkAppointmentConflicts({
    candidate: {
      id: candidate.id,
      assignedEmployeeId: candidate.assignedEmployeeId,
      startAt: candidate.startAt,
      endAt: candidate.endAt,
      durationMinutes: candidate.durationMinutes,
      routeRelevant: candidate.routeRelevant,
      locationHasCoordinates: address?.latitude != null && address?.longitude != null,
      isFlexible: candidate.isFlexible,
      earliestStartAt: candidate.earliestStartAt,
      latestEndAt: candidate.latestEndAt,
    },
    existingAppointments: existingAppointments.map((a) => ({
      id: a.id,
      startAt: a.startAt,
      endAt: a.endAt,
      durationMinutes: a.durationMinutes,
      title: a.title,
    })),
    absences,
    availabilities,
    maximumMinutesPerDay,
    plannedMinutesSameDay,
    travel,
    timezone,
  });

  // Kopplung Termin ↔ Kundenbudget: warnt, wenn der Termin ohne bzw. über dem
  // gebuchten Kontingent des Monats liegt (Zeitraum-Semantik wie hours-service).
  const month = monthPeriodInZone(candidate.startAt, timezone);
  const [budgets, plannedAppointments] = await Promise.all([
    db.customerHourBudget.findMany({
      where: {
        customerId: candidate.customerId,
        periodStart: { lt: month.end },
        periodEnd: { gte: month.start },
      },
      include: { adjustments: true },
    }),
    db.appointment.findMany({
      where: {
        customerId: candidate.customerId,
        deletedAt: null,
        status: { in: [...PLANNED_STATUSES] },
        startAt: { gte: month.start, lt: month.end },
        ...(candidate.id ? { id: { not: candidate.id } } : {}),
      },
      select: { durationMinutes: true },
    }),
  ]);
  conflicts.push(
    ...checkBudgetConflicts({
      budgetMinutes:
        budgets.length === 0
          ? null
          : getCustomerBudgetMinutes(budgets, budgets.flatMap((b) => b.adjustments)),
      plannedMinutesExcludingCandidate: plannedAppointments.reduce(
        (sum, a) => sum + a.durationMinutes,
        0,
      ),
      candidateMinutes: candidate.durationMinutes,
    }),
  );

  return conflicts;
}

// ---------------------------------------------------------------------------
// Anlegen (Einzel + Serie)
// ---------------------------------------------------------------------------

export async function createAppointment(
  input: AppointmentInput,
  options: { confirmed: boolean },
): Promise<ConflictOutcome> {
  const ctx = await requireOrganizationMembership();
  await requireAppointmentManage(ctx, input.assignedEmployeeId);

  const customer = await db.customer.findUnique({
    where: { id: input.customerId },
    include: { addresses: { take: 1, orderBy: { label: 'asc' } } },
  });
  assertSameOrg(ctx, customer);
  // Mitarbeiter planen nur für Kunden aus dem eigenen Bereich (Datenminimierung).
  if (ctx.membership.role === 'EMPLOYEE' && !(await canAccessCustomer(ctx, input.customerId, 'read'))) {
    throw new AppError('ACCESS_DENIED', {
      message: 'Termine können nur für eigene Kunden geplant werden.',
    });
  }
  if (input.assignedEmployeeId) {
    const employee = await db.employee.findUnique({ where: { id: input.assignedEmployeeId } });
    assertSameOrg(ctx, employee);
    if (employee.status !== 'ACTIVE') throw new AppError('RECIPIENT_INACTIVE');
  }

  const timezone = ctx.organization.timezone;
  const { y, m, d } = parseDateInput(input.date);
  const startAt = zonedWallTimeToUtc(y, m, d, input.startTime, timezone);
  const endAt = new Date(startAt.getTime() + input.durationMinutes * 60_000);
  const earliestStartAt = input.earliestTime
    ? zonedWallTimeToUtc(y, m, d, input.earliestTime, timezone)
    : null;
  const latestEndAt = input.latestTime
    ? zonedWallTimeToUtc(y, m, d, input.latestTime, timezone)
    : null;

  const locationAddressId = customer.addresses[0]?.id ?? null;

  const conflicts = await collectConflicts(ctx, {
    customerId: input.customerId,
    assignedEmployeeId: input.assignedEmployeeId ?? null,
    startAt,
    endAt,
    durationMinutes: input.durationMinutes,
    routeRelevant: input.routeRelevant ?? true,
    isFlexible: input.isFlexible ?? false,
    earliestStartAt,
    latestEndAt,
    locationAddressId,
  });
  if (hasErrors(conflicts)) {
    throw new AppError('APPOINTMENT_CONFLICT', { details: { conflicts } });
  }
  if (hasWarnings(conflicts) && !options.confirmed) {
    return { requiresConfirmation: true, conflicts };
  }

  // ----- Serie -----
  if (input.recurrence?.enabled) {
    const startDate = utcDate(y, m, d);
    const rule = buildRecurrenceRule(input.recurrence, startDate);
    if (!isValidRecurrenceRule(rule)) throw new AppError('SERIES_INVALID_RULE');

    const seriesId = await db.$transaction(async (tx) => {
      const series = await tx.appointmentSeries.create({
        data: {
          organizationId: ctx.organization.id,
          customerId: input.customerId,
          defaultEmployeeId: input.assignedEmployeeId ?? null,
          title: input.title,
          description: input.description,
          recurrenceRule: rule,
          recurrenceTimezone: timezone,
          startDate,
          endDate: input.recurrence?.endDate ? toUtcDateOnly(input.recurrence.endDate) : null,
          defaultStartTime: input.startTime,
          defaultDurationMinutes: input.durationMinutes,
          status: 'ACTIVE',
        },
      });
      await writeAuditLog(
        {
          organizationId: ctx.organization.id,
          actorUserId: ctx.user.id,
          action: 'series.created',
          entityType: 'AppointmentSeries',
          entityId: series.id,
          metadata: { customerId: input.customerId, rule },
        },
        tx,
      );
      return series.id;
    });

    await materializeSeries(seriesId);
    await notifyAssignment(ctx, input.assignedEmployeeId ?? null, input.customerId, startAt, true);
    return { requiresConfirmation: false, seriesId };
  }

  // ----- Einzeltermin -----
  const appointment = await db.$transaction(async (tx) => {
    const created = await tx.appointment.create({
      data: {
        organizationId: ctx.organization.id,
        customerId: input.customerId,
        assignedEmployeeId: input.assignedEmployeeId ?? null,
        title: input.title,
        description: input.description,
        startAt,
        endAt,
        durationMinutes: input.durationMinutes,
        status: input.status ?? 'PLANNED',
        assignmentStatus: input.assignedEmployeeId ? 'ASSIGNED' : 'UNASSIGNED',
        isFlexible: input.isFlexible ?? false,
        earliestStartAt,
        latestEndAt,
        locationAddressId,
        routeRelevant: input.routeRelevant ?? true,
        internalNotes: input.internalNotes,
      },
    });
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: 'appointment.created',
        entityType: 'Appointment',
        entityId: created.id,
        metadata: { customerId: input.customerId, startAt: startAt.toISOString() },
      },
      tx,
    );
    return created;
  });

  await notifyAssignment(ctx, input.assignedEmployeeId ?? null, input.customerId, startAt, false);
  await notifyLeadershipAboutEmployeePlanning(ctx, appointment.id, input.customerId, startAt, 'angelegt');
  return { requiresConfirmation: false, appointmentId: appointment.id };
}

async function notifyAssignment(
  ctx: OrgContext,
  employeeId: string | null,
  customerId: string,
  startAt: Date,
  isSeries: boolean,
) {
  if (!employeeId) return;
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: { userId: true },
  });
  if (!employee?.userId || employee.userId === ctx.user.id) return;
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { firstName: true, lastName: true },
  });
  await createNotification({
    organizationId: ctx.organization.id,
    userId: employee.userId,
    type: 'APPOINTMENT_ASSIGNED',
    title: isSeries ? 'Neue Terminserie zugewiesen' : 'Neuer Termin zugewiesen',
    message: `${customer?.firstName ?? ''} ${customer?.lastName ?? ''}, ab ${new Intl.DateTimeFormat(
      'de-DE',
      { timeZone: ctx.organization.timezone, dateStyle: 'medium', timeStyle: 'short' },
    ).format(startAt)}`,
    targetUrl: '/calendar',
  });
}

// ---------------------------------------------------------------------------
// Serien-Materialisierung
// ---------------------------------------------------------------------------

export async function materializeSeries(seriesId: string, until?: Date): Promise<number> {
  const series = await db.appointmentSeries.findUnique({
    where: { id: seriesId },
    include: {
      customer: { include: { addresses: { take: 1, orderBy: { label: 'asc' } } } },
      exceptions: true,
    },
  });
  if (!series || series.status !== 'ACTIVE') return 0;

  const horizon = until ?? addDays(new Date(), SERIES_MATERIALIZATION_DAYS);
  const rangeEnd = series.endDate && series.endDate < horizon ? series.endDate : horizon;
  const rangeStart = series.startDate;
  if (rangeEnd < rangeStart) return 0;

  const occurrenceDates = expandOccurrenceDates(
    series.recurrenceRule,
    series.startDate,
    rangeStart,
    rangeEnd,
  );

  const existing = await db.appointment.findMany({
    where: { seriesId: series.id },
    select: { occurrenceDate: true },
  });
  const skip = new Set<string>([
    ...existing
      .map((a) => a.occurrenceDate?.toISOString().slice(0, 10))
      .filter((v): v is string => Boolean(v)),
    ...series.exceptions.map((e) => e.occurrenceDate.toISOString().slice(0, 10)),
  ]);

  const locationAddressId = series.customer.addresses[0]?.id ?? null;
  let created = 0;
  for (const occurrenceDate of occurrenceDates) {
    const key = occurrenceDate.toISOString().slice(0, 10);
    if (skip.has(key)) continue;
    const { startAt, endAt } = occurrenceTimes(
      occurrenceDate,
      series.defaultStartTime,
      series.defaultDurationMinutes,
      series.recurrenceTimezone,
    );
    await db.appointment.create({
      data: {
        organizationId: series.organizationId,
        customerId: series.customerId,
        seriesId: series.id,
        occurrenceDate,
        assignedEmployeeId: series.defaultEmployeeId,
        title: series.title,
        description: series.description,
        startAt,
        endAt,
        durationMinutes: series.defaultDurationMinutes,
        status: 'PLANNED',
        assignmentStatus: series.defaultEmployeeId ? 'ASSIGNED' : 'UNASSIGNED',
        locationAddressId,
        routeRelevant: true,
      },
    });
    created += 1;
  }

  await db.appointmentSeries.update({
    where: { id: series.id },
    data: { materializedUntil: rangeEnd },
  });
  return created;
}

/** Horizont für alle aktiven Serien der Organisation sicherstellen (Kalender-Feed). */
export async function ensureMaterializedUntil(organizationId: string, until: Date): Promise<void> {
  const capped =
    until > addDays(new Date(), 400) ? addDays(new Date(), 400) : until; // Schutzgrenze
  const series = await db.appointmentSeries.findMany({
    where: {
      organizationId,
      status: 'ACTIVE',
      OR: [{ materializedUntil: null }, { materializedUntil: { lt: capped } }],
    },
    select: { id: true },
  });
  for (const entry of series) {
    await materializeSeries(entry.id, capped);
  }
}

// ---------------------------------------------------------------------------
// Bearbeiten / Verschieben
// ---------------------------------------------------------------------------

export interface UpdateAppointmentInput {
  title?: string;
  description?: string | null;
  assignedEmployeeId?: string | null;
  date?: string;
  startTime?: string;
  durationMinutes?: number;
  status?: 'DRAFT' | 'PLANNED' | 'CONFIRMED';
  isFlexible?: boolean;
  earliestTime?: string | null;
  latestTime?: string | null;
  routeRelevant?: boolean;
  internalNotes?: string | null;
}

export type EditScope = 'single' | 'following' | 'all';

export async function updateAppointment(
  appointmentId: string,
  input: UpdateAppointmentInput,
  options: { scope: EditScope; confirmed: boolean },
): Promise<ConflictOutcome> {
  const ctx = await requireOrganizationMembership();
  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: { series: true },
  });
  assertSameOrg(ctx, appointment);
  // Mitarbeiter bearbeiten ausschließlich Termine, die ihnen zugewiesen sind.
  if (ctx.membership.role === 'EMPLOYEE' && appointment.assignedEmployeeId !== ctx.employee?.id) {
    throw new AppError('ACCESS_DENIED', {
      message: 'Nur eigene Termine können bearbeitet werden.',
    });
  }
  await requireAppointmentManage(
    ctx,
    input.assignedEmployeeId !== undefined
      ? input.assignedEmployeeId
      : appointment.assignedEmployeeId,
  );

  const timezone = ctx.organization.timezone;

  // Zielzeiten berechnen.
  const currentDay = calendarDayInZone(appointment.startAt, timezone);
  const dateParts = input.date ? parseDateInput(input.date) : { y: currentDay.year, m: currentDay.month, d: currentDay.day };
  const startTime =
    input.startTime ??
    new Intl.DateTimeFormat('de-DE', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(appointment.startAt);
  const durationMinutes = input.durationMinutes ?? appointment.durationMinutes;
  const startAt = zonedWallTimeToUtc(dateParts.y, dateParts.m, dateParts.d, startTime, timezone);
  const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);
  const assignedEmployeeId =
    input.assignedEmployeeId !== undefined
      ? input.assignedEmployeeId
      : appointment.assignedEmployeeId;

  if (assignedEmployeeId) {
    const employee = await db.employee.findUnique({ where: { id: assignedEmployeeId } });
    assertSameOrg(ctx, employee);
  }

  const earliestStartAt =
    input.earliestTime !== undefined
      ? input.earliestTime
        ? zonedWallTimeToUtc(dateParts.y, dateParts.m, dateParts.d, input.earliestTime, timezone)
        : null
      : appointment.earliestStartAt;
  const latestEndAt =
    input.latestTime !== undefined
      ? input.latestTime
        ? zonedWallTimeToUtc(dateParts.y, dateParts.m, dateParts.d, input.latestTime, timezone)
        : null
      : appointment.latestEndAt;

  const conflicts = await collectConflicts(ctx, {
    id: appointment.id,
    customerId: appointment.customerId,
    assignedEmployeeId,
    startAt,
    endAt,
    durationMinutes,
    routeRelevant: input.routeRelevant ?? appointment.routeRelevant,
    isFlexible: input.isFlexible ?? appointment.isFlexible,
    earliestStartAt,
    latestEndAt,
    locationAddressId: appointment.locationAddressId,
  });
  if (hasErrors(conflicts)) {
    throw new AppError('APPOINTMENT_CONFLICT', { details: { conflicts } });
  }
  if (hasWarnings(conflicts) && !options.confirmed) {
    return { requiresConfirmation: true, conflicts };
  }

  const employeeChanged = assignedEmployeeId !== appointment.assignedEmployeeId;
  const timeChanged =
    startAt.getTime() !== appointment.startAt.getTime() ||
    durationMinutes !== appointment.durationMinutes;

  const applySingle = async () => {
    await db.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id: appointment.id },
        data: {
          title: input.title ?? appointment.title,
          description: input.description !== undefined ? input.description : appointment.description,
          assignedEmployeeId,
          assignmentStatus: assignedEmployeeId
            ? employeeChanged
              ? 'ASSIGNED'
              : appointment.assignmentStatus === 'UNASSIGNED'
                ? 'ASSIGNED'
                : appointment.assignmentStatus
            : 'UNASSIGNED',
          startAt,
          endAt,
          durationMinutes,
          status: input.status ?? appointment.status,
          isFlexible: input.isFlexible ?? appointment.isFlexible,
          earliestStartAt,
          latestEndAt,
          routeRelevant: input.routeRelevant ?? appointment.routeRelevant,
          internalNotes:
            input.internalNotes !== undefined ? input.internalNotes : appointment.internalNotes,
        },
      });
      // Einzeländerung an Serienterminen als Ausnahme fixieren.
      if (appointment.seriesId && appointment.occurrenceDate) {
        await tx.appointmentSeriesException.upsert({
          where: {
            seriesId_occurrenceDate: {
              seriesId: appointment.seriesId,
              occurrenceDate: appointment.occurrenceDate,
            },
          },
          create: {
            seriesId: appointment.seriesId,
            occurrenceDate: appointment.occurrenceDate,
            exceptionType: 'MODIFIED',
            replacementAppointmentId: appointment.id,
          },
          update: { exceptionType: 'MODIFIED', replacementAppointmentId: appointment.id },
        });
      }
      await writeAuditLog(
        {
          organizationId: ctx.organization.id,
          actorUserId: ctx.user.id,
          action: timeChanged ? 'appointment.rescheduled' : 'appointment.updated',
          entityType: 'Appointment',
          entityId: appointment.id,
          metadata: {
            startAt: startAt.toISOString(),
            employeeChanged,
            scope: 'single',
          },
        },
        tx,
      );
    });
  };

  if (options.scope === 'single' || !appointment.seriesId || !appointment.series) {
    await applySingle();
  } else {
    // 'following' | 'all': Serie anpassen und zukünftige, unveränderte Vorkommen neu erzeugen.
    const series = appointment.series;
    const fromDate =
      options.scope === 'all'
        ? toUtcDateOnly(new Date())
        : (appointment.occurrenceDate ?? toUtcDateOnly(appointment.startAt));

    await db.$transaction(async (tx) => {
      await tx.appointmentSeries.update({
        where: { id: series.id },
        data: {
          title: input.title ?? series.title,
          description: input.description !== undefined ? input.description : series.description,
          defaultEmployeeId: assignedEmployeeId,
          defaultStartTime: startTime,
          defaultDurationMinutes: durationMinutes,
          materializedUntil: null,
        },
      });
      // Zukünftige, NICHT einzeln geänderte Vorkommen entfernen (werden regeneriert).
      const modified = await tx.appointmentSeriesException.findMany({
        where: { seriesId: series.id },
        select: { occurrenceDate: true },
      });
      const modifiedKeys = new Set(modified.map((e) => e.occurrenceDate.toISOString()));
      const toDelete = await tx.appointment.findMany({
        where: {
          seriesId: series.id,
          occurrenceDate: { gte: fromDate },
          status: { in: ['PLANNED', 'CONFIRMED', 'DRAFT'] },
        },
        select: { id: true, occurrenceDate: true },
      });
      const deleteIds = toDelete
        .filter((a) => a.occurrenceDate && !modifiedKeys.has(a.occurrenceDate.toISOString()))
        .map((a) => a.id);
      await tx.appointment.deleteMany({ where: { id: { in: deleteIds } } });
      await writeAuditLog(
        {
          organizationId: ctx.organization.id,
          actorUserId: ctx.user.id,
          action: 'series.updated',
          entityType: 'AppointmentSeries',
          entityId: series.id,
          metadata: { scope: options.scope, fromDate: fromDate.toISOString().slice(0, 10) },
        },
        tx,
      );
    });
    await materializeSeries(series.id);
  }

  // Benachrichtigungen.
  if (employeeChanged && assignedEmployeeId) {
    await notifyAssignment(ctx, assignedEmployeeId, appointment.customerId, startAt, false);
  } else if (timeChanged && assignedEmployeeId) {
    const employee = await db.employee.findUnique({
      where: { id: assignedEmployeeId },
      select: { userId: true },
    });
    if (employee?.userId && employee.userId !== ctx.user.id) {
      await createNotification({
        organizationId: ctx.organization.id,
        userId: employee.userId,
        type: 'APPOINTMENT_CHANGED',
        title: 'Termin geändert',
        message: `${appointment.title}: neuer Beginn ${new Intl.DateTimeFormat('de-DE', {
          timeZone: timezone,
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(startAt)}`,
        targetUrl: '/calendar',
      });
    }
  }
  await notifyLeadershipAboutEmployeePlanning(
    ctx,
    appointment.id,
    appointment.customerId,
    startAt,
    'geändert',
  );

  return { requiresConfirmation: false, appointmentId: appointment.id };
}

/** Drag-and-drop/Resize: reine Zeitänderung mit Konfliktprüfung. */
export async function rescheduleAppointment(
  appointmentId: string,
  startAtIso: string,
  endAtIso: string,
  options: { confirmed: boolean },
): Promise<ConflictOutcome> {
  const ctx = await requireOrganizationMembership();
  const appointment = await db.appointment.findUnique({ where: { id: appointmentId } });
  assertSameOrg(ctx, appointment);
  // Mitarbeiter verschieben nur eigene Termine.
  if (ctx.membership.role === 'EMPLOYEE' && appointment.assignedEmployeeId !== ctx.employee?.id) {
    throw new AppError('ACCESS_DENIED', { message: 'Nur eigene Termine können verschoben werden.' });
  }
  await requireAppointmentManage(ctx, appointment.assignedEmployeeId);

  const startAt = new Date(startAtIso);
  const endAt = new Date(endAtIso);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    throw new AppError('VALIDATION_FAILED');
  }
  const durationMinutes = Math.round((endAt.getTime() - startAt.getTime()) / 60_000);

  const conflicts = await collectConflicts(ctx, {
    id: appointment.id,
    customerId: appointment.customerId,
    assignedEmployeeId: appointment.assignedEmployeeId,
    startAt,
    endAt,
    durationMinutes,
    routeRelevant: appointment.routeRelevant,
    isFlexible: appointment.isFlexible,
    earliestStartAt: appointment.earliestStartAt,
    latestEndAt: appointment.latestEndAt,
    locationAddressId: appointment.locationAddressId,
  });
  if (hasErrors(conflicts)) {
    throw new AppError('APPOINTMENT_CONFLICT', { details: { conflicts } });
  }
  if (hasWarnings(conflicts) && !options.confirmed) {
    return { requiresConfirmation: true, conflicts };
  }

  await db.$transaction(async (tx) => {
    await tx.appointment.update({
      where: { id: appointment.id },
      data: { startAt, endAt, durationMinutes },
    });
    if (appointment.seriesId && appointment.occurrenceDate) {
      await tx.appointmentSeriesException.upsert({
        where: {
          seriesId_occurrenceDate: {
            seriesId: appointment.seriesId,
            occurrenceDate: appointment.occurrenceDate,
          },
        },
        create: {
          seriesId: appointment.seriesId,
          occurrenceDate: appointment.occurrenceDate,
          exceptionType: 'MODIFIED',
          replacementAppointmentId: appointment.id,
        },
        update: { exceptionType: 'MODIFIED', replacementAppointmentId: appointment.id },
      });
    }
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: 'appointment.rescheduled',
        entityType: 'Appointment',
        entityId: appointment.id,
        metadata: { startAt: startAt.toISOString(), via: 'dragdrop' },
      },
      tx,
    );
  });

  return { requiresConfirmation: false, appointmentId: appointment.id };
}

// ---------------------------------------------------------------------------
// Absagen / Serien beenden
// ---------------------------------------------------------------------------

export async function cancelAppointment(
  appointmentId: string,
  options: { scope: EditScope; reason?: string },
): Promise<void> {
  const ctx = await requireOrganizationMembership();
  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: { series: true },
  });
  assertSameOrg(ctx, appointment);
  await requireAppointmentManage(ctx, appointment.assignedEmployeeId);

  const cancelOne = async (id: string, seriesId: string | null, occurrenceDate: Date | null) => {
    await db.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id },
        data: { status: 'CANCELLED', cancellationReason: options.reason ?? null },
      });
      if (seriesId && occurrenceDate) {
        await tx.appointmentSeriesException.upsert({
          where: { seriesId_occurrenceDate: { seriesId, occurrenceDate } },
          create: { seriesId, occurrenceDate, exceptionType: 'CANCELLED' },
          update: { exceptionType: 'CANCELLED', replacementAppointmentId: null },
        });
      }
      await writeAuditLog(
        {
          organizationId: ctx.organization.id,
          actorUserId: ctx.user.id,
          action: 'appointment.cancelled',
          entityType: 'Appointment',
          entityId: id,
          metadata: { reason: options.reason },
        },
        tx,
      );
    });
  };

  if (options.scope === 'single' || !appointment.seriesId) {
    await cancelOne(appointment.id, appointment.seriesId, appointment.occurrenceDate);
  } else {
    const fromDate =
      options.scope === 'all'
        ? null
        : (appointment.occurrenceDate ?? toUtcDateOnly(appointment.startAt));

    await db.$transaction(async (tx) => {
      const future = await tx.appointment.findMany({
        where: {
          seriesId: appointment.seriesId!,
          status: { in: ['DRAFT', 'PLANNED', 'CONFIRMED'] },
          ...(fromDate ? { occurrenceDate: { gte: fromDate } } : { startAt: { gte: new Date() } }),
        },
        select: { id: true },
      });
      await tx.appointment.updateMany({
        where: { id: { in: future.map((a) => a.id) } },
        data: { status: 'CANCELLED', cancellationReason: options.reason ?? 'Serie beendet' },
      });
      await tx.appointmentSeries.update({
        where: { id: appointment.seriesId! },
        data:
          options.scope === 'all'
            ? { status: 'ENDED' }
            : {
                endDate: addDays(fromDate!, -1),
                materializedUntil: addDays(fromDate!, -1),
              },
      });
      await writeAuditLog(
        {
          organizationId: ctx.organization.id,
          actorUserId: ctx.user.id,
          action: 'series.ended',
          entityType: 'AppointmentSeries',
          entityId: appointment.seriesId!,
          metadata: { scope: options.scope, cancelledCount: future.length },
        },
        tx,
      );
    });
  }

  // Benachrichtigung an den zugewiesenen Mitarbeiter.
  if (appointment.assignedEmployeeId) {
    const employee = await db.employee.findUnique({
      where: { id: appointment.assignedEmployeeId },
      select: { userId: true },
    });
    if (employee?.userId && employee.userId !== ctx.user.id) {
      await createNotification({
        organizationId: ctx.organization.id,
        userId: employee.userId,
        type: 'APPOINTMENT_CANCELLED',
        title: 'Termin abgesagt',
        message: `${appointment.title} wurde abgesagt.`,
        targetUrl: '/calendar',
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Status & Zuweisungsantwort
// ---------------------------------------------------------------------------

const EMPLOYEE_ALLOWED_STATUS = ['IN_PROGRESS', 'COMPLETED', 'NO_SHOW'] as const;

export async function updateAppointmentStatus(
  appointmentId: string,
  status: 'DRAFT' | 'PLANNED' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW',
): Promise<void> {
  const ctx = await requireOrganizationMembership();
  const appointment = await db.appointment.findUnique({ where: { id: appointmentId } });
  assertSameOrg(ctx, appointment);

  const isOwn = ctx.employee && appointment.assignedEmployeeId === ctx.employee.id;
  const canManage = hasPermission(ctx, 'appointments.manage');
  if (!canManage) {
    // Mitarbeiter dürfen den Status eigener Termine aktualisieren.
    if (!isOwn || !(EMPLOYEE_ALLOWED_STATUS as readonly string[]).includes(status)) {
      throw new AppError('ACCESS_DENIED');
    }
  }

  await db.$transaction(async (tx) => {
    await tx.appointment.update({
      where: { id: appointmentId },
      data: {
        status,
        completedAt: status === 'COMPLETED' ? new Date() : null,
      },
    });
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: 'appointment.statusChanged',
        entityType: 'Appointment',
        entityId: appointmentId,
        metadata: { status },
      },
      tx,
    );
  });
}

export async function assignEmployee(
  appointmentId: string,
  employeeId: string | null,
  options: { confirmed: boolean },
): Promise<ConflictOutcome> {
  return updateAppointment(appointmentId, { assignedEmployeeId: employeeId }, {
    scope: 'single',
    confirmed: options.confirmed,
  });
}

/** Mitarbeiter nimmt eine Zuweisung an oder lehnt sie ab. */
export async function respondToAssignment(
  appointmentId: string,
  response: 'ACCEPTED' | 'DECLINED',
  note?: string,
): Promise<void> {
  const ctx = await requireOrganizationMembership();
  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: { customer: { select: { firstName: true, lastName: true } } },
  });
  assertSameOrg(ctx, appointment);
  if (!ctx.employee || appointment.assignedEmployeeId !== ctx.employee.id) {
    throw new AppError('ACCESS_DENIED');
  }

  await db.$transaction(async (tx) => {
    await tx.appointment.update({
      where: { id: appointmentId },
      data: {
        assignmentStatus: response,
        internalNotes:
          response === 'DECLINED' && note
            ? `${appointment.internalNotes ? `${appointment.internalNotes}\n` : ''}Abgelehnt: ${note}`
            : appointment.internalNotes,
      },
    });
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: 'appointment.assigned',
        entityType: 'Appointment',
        entityId: appointmentId,
        metadata: { response },
      },
      tx,
    );
  });

  if (response === 'DECLINED') {
    const planners = await getPlannerUserIds(ctx.organization.id);
    await Promise.all(
      planners
        .filter((userId) => userId !== ctx.user.id)
        .map((userId) =>
          createNotification({
            organizationId: ctx.organization.id,
            userId,
            type: 'ASSIGNMENT_DECLINED',
            title: 'Zuweisung abgelehnt',
            message: `${ctx.user.firstName} ${ctx.user.lastName} hat „${appointment.title}“ bei ${appointment.customer.firstName} ${appointment.customer.lastName} abgelehnt.`,
            targetUrl: '/calendar',
          }),
        ),
    );
  }
}
