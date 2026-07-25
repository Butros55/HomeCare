import 'server-only';

import type { Prisma } from '@prisma/client';
import { addDays } from 'date-fns';

import { SERIES_MATERIALIZATION_DAYS } from '@/lib/app-config';
import {
  checkAccountConflicts,
  checkAppointmentConflicts,
  hasErrors,
  hasWarnings,
  type Conflict,
} from '@/lib/conflicts';
import {
  calendarDayInZone,
  dayPeriodInZone,
  toUtcDateOnly,
  utcDate,
  zonedWallTimeToUtc,
} from '@/lib/dates';
import { estimateTravelSeconds } from '@/lib/geo';
import {
  buildRecurrenceRule,
  expandOccurrenceDates,
  isValidRecurrenceRule,
  occurrenceTimes,
  parseRuleToForm,
  type RecurrenceOptions,
} from '@/lib/recurrence';
import { isAppointmentCompletableStatus } from '@/lib/status-maps';
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
import { computeRouteMatrixCached } from '@/server/providers/routing';
import { getPlannableMinutesForDate } from '@/server/services/account-service';
import { detachAppointmentsFromRoutePlans } from '@/server/services/route-service';
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

/** Bestehende RRULE in Recurrence-Optionen zurückübersetzen (für Serien-Umbau). */
function recurrenceOptionsFromRule(rule: string): RecurrenceOptions {
  const form = parseRuleToForm(rule);
  if (!form) return { frequency: 'WEEKLY' };
  return {
    frequency: form.frequency,
    weekdays: form.weekdays.length > 0 ? form.weekdays : undefined,
    endDate: form.endMode === 'date' && form.endDate ? new Date(`${form.endDate}T00:00:00Z`) : null,
    count: form.endMode === 'count' ? form.count : null,
  };
}

function requiredSoloEmployeeId(ctx: OrgContext): string {
  if (!ctx.employee) {
    throw new AppError('VALIDATION_FAILED', {
      message:
        'Für den Alleine-Modus fehlt dein eigenes Mitarbeiterprofil. Bitte den Modus in den Einstellungen erneut speichern.',
    });
  }
  return ctx.employee.id;
}

function effectiveAssignedEmployeeId(
  ctx: OrgContext,
  requestedEmployeeId: string | null | undefined,
): string | null {
  return ctx.organization.soloMode
    ? requiredSoloEmployeeId(ctx)
    : (requestedEmployeeId ?? null);
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

/**
 * Fahrzeiten zu den direkten Nachbarn eines Termins – als Abschnittszeiten,
 * nicht als Tagessumme.
 *
 * Reihenfolge der Quellen:
 *  1. Bereits geplante Route des Tages (gespeicherte Abschnittszeiten) – so
 *     sagen Kalender-Hinweise exakt das, was der Routenplaner berechnet hat.
 *  2. Der konfigurierte Routing-Anbieter (eine gecachte Matrix-Abfrage für
 *     Vorgänger → Termin → Nachfolger).
 *  3. Luftlinien-Schätzung, falls kein Dienst antwortet.
 */
async function resolveNeighbourTravelSeconds(input: {
  employeeId: string;
  /** Kalendertag als UTC-Mitternacht – so speichert der Routenplaner ihn. */
  routeDate: Date;
  here: { latitude: number; longitude: number };
  previous: { id: string; point: { latitude: number; longitude: number } | null } | null;
  next: { id: string; point: { latitude: number; longitude: number } | null } | null;
  candidateId?: string;
}): Promise<{ fromPreviousSeconds: number | null; toNextSeconds: number | null }> {
  let fromPreviousSeconds: number | null = null;
  let toNextSeconds: number | null = null;

  // 1) Gespeicherte Route des Tages.
  const plan = await db.routePlan.findUnique({
    where: {
      employeeId_routeDate: { employeeId: input.employeeId, routeDate: input.routeDate },
    },
    include: { stops: { orderBy: { sequence: 'asc' } } },
  });
  if (plan) {
    const stops = plan.stops;
    const indexOf = (appointmentId: string) =>
      stops.findIndex((stop) => stop.appointmentId === appointmentId);
    const candidateIndex = input.candidateId ? indexOf(input.candidateId) : -1;
    if (candidateIndex > 0 && input.previous && stops[candidateIndex - 1]?.appointmentId === input.previous.id) {
      fromPreviousSeconds = stops[candidateIndex]!.travelSecondsFromPrevious;
    }
    if (
      candidateIndex >= 0 &&
      input.next &&
      stops[candidateIndex + 1]?.appointmentId === input.next.id
    ) {
      toNextSeconds = stops[candidateIndex + 1]!.travelSecondsFromPrevious;
    }
  }

  const needsPrevious = fromPreviousSeconds == null && Boolean(input.previous?.point);
  const needsNext = toNextSeconds == null && Boolean(input.next?.point);
  if (!needsPrevious && !needsNext) return { fromPreviousSeconds, toNextSeconds };

  // 2) Echte Fahrzeiten vom Routing-Anbieter (eine gecachte Abfrage).
  const points = [
    ...(needsPrevious ? [input.previous!.point!] : []),
    input.here,
    ...(needsNext ? [input.next!.point!] : []),
  ];
  const hereIndex = needsPrevious ? 1 : 0;
  try {
    const matrix = await computeRouteMatrixCached(points);
    if (needsPrevious) fromPreviousSeconds = matrix[0]?.[hereIndex]?.travelSeconds ?? null;
    if (needsNext) toNextSeconds = matrix[hereIndex]?.[hereIndex + 1]?.travelSeconds ?? null;
  } catch {
    // 3) Anbieter nicht erreichbar – Schätzung, damit die Prüfung nie ausfällt.
  }
  if (needsPrevious && fromPreviousSeconds == null) {
    fromPreviousSeconds = estimateTravelSeconds(input.previous!.point!, input.here);
  }
  if (needsNext && toNextSeconds == null) {
    toNextSeconds = estimateTravelSeconds(input.here, input.next!.point!);
  }

  return { fromPreviousSeconds, toNextSeconds };
}

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

    // Fahrzeit zu den unmittelbaren Nachbarterminen – bewusst nur AM SELBEN
    // TAG. Ein Termin vom Vortag ist kein Vorgänger einer Tagesfahrt, und die
    // Zeiten müssen Abschnittszeiten (Kunde → Kunde) sein, keine Tagessummen.
    if (address?.latitude != null && address?.longitude != null) {
      const here = { latitude: address.latitude, longitude: address.longitude };
      const sameDay = appointments.filter(
        (a) => a.routeRelevant && a.startAt >= day.start && a.startAt < day.end,
      );
      const previous = sameDay.filter((a) => a.endAt <= candidate.startAt).at(-1);
      const next = sameDay.find((a) => a.startAt >= candidate.endAt);

      const previousPoint =
        previous?.locationAddress?.latitude != null && previous.locationAddress.longitude != null
          ? {
              latitude: previous.locationAddress.latitude,
              longitude: previous.locationAddress.longitude,
            }
          : null;
      const nextPoint =
        next?.locationAddress?.latitude != null && next.locationAddress.longitude != null
          ? { latitude: next.locationAddress.latitude, longitude: next.locationAddress.longitude }
          : null;

      // Echte Fahrzeiten vom konfigurierten Routing-Anbieter – dieselbe Quelle
      // wie im Routenplaner. Vorrang haben bereits geplante Abschnitte.
      const candidateDayParts = calendarDayInZone(candidate.startAt, timezone);
      const legs = await resolveNeighbourTravelSeconds({
        employeeId: candidate.assignedEmployeeId,
        routeDate: utcDate(
          candidateDayParts.year,
          candidateDayParts.month,
          candidateDayParts.day,
        ),
        here,
        previous: previous ? { id: previous.id, point: previousPoint } : null,
        next: next ? { id: next.id, point: nextPoint } : null,
        candidateId: candidate.id,
      });

      travel = {};
      if (previous && legs.fromPreviousSeconds != null) {
        travel.fromPreviousSeconds = legs.fromPreviousSeconds;
        travel.previousEndAt = previous.endAt;
      }
      if (next && legs.toNextSeconds != null) {
        travel.toNextSeconds = legs.toNextSeconds;
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

  // Kopplung Termin ↔ Stundenkonto: warnt, wenn der Termin ohne Konto bzw.
  // über dem verplanbaren Guthaben zum Termindatum liegt (Konto-Modell).
  // Nur relevant, solange Stundenkonten organisationsweit aktiv sind.
  if (ctx.organization.hourBudgetsEnabled) {
    const dayParts = calendarDayInZone(candidate.startAt, timezone);
    const candidateDay = utcDate(dayParts.year, dayParts.month, dayParts.day);
    const plannableByCustomer = await getPlannableMinutesForDate(
      ctx.organization.id,
      timezone,
      candidateDay,
      {
        customerIds: [candidate.customerId],
        ...(candidate.id ? { excludeAppointmentId: candidate.id } : {}),
      },
    );
    const account = plannableByCustomer.get(candidate.customerId);
    conflicts.push(
      ...checkAccountConflicts({
        plannableMinutes: account?.hasAccount ? account.plannableMinutes : null,
        candidateMinutes: candidate.durationMinutes,
      }),
    );
  }

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
  const assignedEmployeeId = effectiveAssignedEmployeeId(ctx, input.assignedEmployeeId);
  await requireAppointmentManage(ctx, assignedEmployeeId);

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
  if (assignedEmployeeId) {
    const employee = await db.employee.findUnique({ where: { id: assignedEmployeeId } });
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
    assignedEmployeeId,
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
  if (hasWarnings(conflicts) && !options.confirmed && !ctx.organization.soloMode) {
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
          defaultEmployeeId: assignedEmployeeId,
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
    await notifyAssignment(ctx, assignedEmployeeId, input.customerId, startAt, true);
    if (assignedEmployeeId) {
      await notifyAppointmentConflict(ctx, assignedEmployeeId, input.customerId, startAt, conflicts);
    }
    return { requiresConfirmation: false, seriesId };
  }

  // ----- Einzeltermin -----
  const appointment = await db.$transaction(async (tx) => {
    const created = await tx.appointment.create({
      data: {
        organizationId: ctx.organization.id,
        customerId: input.customerId,
        assignedEmployeeId,
        title: input.title,
        description: input.description,
        startAt,
        endAt,
        durationMinutes: input.durationMinutes,
        status: ctx.organization.soloMode ? 'PLANNED' : (input.status ?? 'PLANNED'),
        assignmentStatus: assignedEmployeeId
          ? ctx.organization.soloMode
            ? 'ACCEPTED'
            : 'ASSIGNED'
          : 'UNASSIGNED',
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

  await notifyAssignment(ctx, assignedEmployeeId, input.customerId, startAt, false);
  if (assignedEmployeeId) {
    await notifyAppointmentConflict(ctx, assignedEmployeeId, input.customerId, startAt, conflicts);
  }
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

/**
 * Auslöser a): Beim Speichern eines Termins mit (bewusst bestätigtem) Warn-
 * Konflikt den zugewiesenen Mitarbeiter über sein Konto benachrichtigen. Wirkt
 * nur, wenn der Mitarbeiter ein Benutzerkonto hat und nicht selbst gespeichert hat.
 */
async function notifyAppointmentConflict(
  ctx: OrgContext,
  employeeId: string,
  customerId: string,
  startAt: Date,
  conflicts: Conflict[],
): Promise<void> {
  const warnings = conflicts.filter((conflict) => conflict.severity === 'WARNING');
  if (warnings.length === 0) return;
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: { userId: true },
  });
  if (!employee?.userId || employee.userId === ctx.user.id) return;
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { firstName: true, lastName: true },
  });
  const when = new Intl.DateTimeFormat('de-DE', {
    timeZone: ctx.organization.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(startAt);
  await createNotification({
    organizationId: ctx.organization.id,
    userId: employee.userId,
    type: 'APPOINTMENT_CONFLICT',
    title: 'Terminkonflikt – bitte prüfen',
    message: `${customer?.firstName ?? ''} ${customer?.lastName ?? ''}, ${when}: ${warnings[0]!.message}${
      warnings.length > 1 ? ` (+${warnings.length - 1})` : ''
    }`,
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
      organization: { select: { soloMode: true } },
    },
  });
  if (!series || series.status !== 'ACTIVE') return 0;
  // Kaputte Wiederholungsregel (z. B. aus einem Alt-Zustand) NIE weiterreichen –
  // sonst wirft das RRule-Parsen und reißt den ganzen Kalender-Feed mit.
  if (!isValidRecurrenceRule(series.recurrenceRule)) {
    console.error(
      `[materializeSeries] Ungültige Wiederholungsregel – Serie ${seriesId} übersprungen: "${series.recurrenceRule}"`,
    );
    return 0;
  }

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
  const assignmentStatus = series.defaultEmployeeId
    ? series.organization.soloMode
      ? ('ACCEPTED' as const)
      : ('ASSIGNED' as const)
    : ('UNASSIGNED' as const);

  // Gebündelt anlegen (ein createMany statt N Einzel-Inserts) – deutlich
  // schneller und schonender bei weit vormaterialisierten Serien.
  const rows = occurrenceDates
    .filter((occurrenceDate) => !skip.has(occurrenceDate.toISOString().slice(0, 10)))
    .map((occurrenceDate) => {
      const { startAt, endAt } = occurrenceTimes(
        occurrenceDate,
        series.defaultStartTime,
        series.defaultDurationMinutes,
        series.recurrenceTimezone,
      );
      return {
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
        status: 'PLANNED' as const,
        assignmentStatus,
        locationAddressId,
        routeRelevant: true,
      };
    });
  if (rows.length > 0) {
    await db.appointment.createMany({ data: rows });
  }

  await db.appointmentSeries.update({
    where: { id: series.id },
    data: { materializedUntil: rangeEnd },
  });
  return rows.length;
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
    try {
      await materializeSeries(entry.id, capped);
    } catch (error) {
      // Robust: eine einzelne fehlerhafte Serie darf niemals den gesamten
      // Kalender-Feed (oder Routen-/Vorschlagsflüsse) zum Absturz bringen.
      console.error(`[ensureMaterializedUntil] Serie ${entry.id} übersprungen:`, error);
    }
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
  /** Nur bei scope 'all': geänderter Wiederholungs-Rhythmus der Serie. */
  recurrence?: RecurrenceOptions | null;
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
  const requestedEmployeeId =
    input.assignedEmployeeId !== undefined
      ? input.assignedEmployeeId
      : appointment.assignedEmployeeId;
  const assignedEmployeeId = effectiveAssignedEmployeeId(ctx, requestedEmployeeId);
  // Mitarbeiter bearbeiten ausschließlich Termine, die ihnen zugewiesen sind.
  if (ctx.membership.role === 'EMPLOYEE' && appointment.assignedEmployeeId !== ctx.employee?.id) {
    throw new AppError('ACCESS_DENIED', {
      message: 'Nur eigene Termine können bearbeitet werden.',
    });
  }
  await requireAppointmentManage(ctx, assignedEmployeeId);

  // Abgesagte Termine sind erst nach Wiederherstellung wieder bearbeitbar.
  if (appointment.status === 'CANCELLED' || appointment.status === 'NO_SHOW') {
    throw new AppError('VALIDATION_FAILED', {
      message: 'Abgesagte Termine müssen zuerst wiederhergestellt werden, bevor sie bearbeitet werden können.',
    });
  }

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
  if (hasWarnings(conflicts) && !options.confirmed && !ctx.organization.soloMode) {
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
            ? ctx.organization.soloMode
              ? 'ACCEPTED'
              : employeeChanged
                ? 'ASSIGNED'
                : appointment.assignmentStatus === 'UNASSIGNED'
                  ? 'ASSIGNED'
                  : appointment.assignmentStatus
            : 'UNASSIGNED',
          startAt,
          endAt,
          durationMinutes,
          status: ctx.organization.soloMode ? appointment.status : (input.status ?? appointment.status),
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
    // 'following' | 'all': Serie anpassen. Regeln:
    //  - Ohne Datumsänderung: nur Zeit/Rhythmus; künftige (nicht einzeln
    //    geänderte, nicht abgeschlossene) Vorkommen ab dem Bezugstag neu erzeugen.
    //  - „Ganze Serie" mit neuem Datum: verschiebt den Serienstart – der ganze
    //    künftige Rhythmus wandert auf das neue Datum (Wochentag folgt).
    //  - „Dieser und folgende" mit neuem Datum: splittet am gewählten Tag – davor
    //    bleibt alles unverändert, ab dem Tag entsteht eine neue Serie.
    //  Abgeschlossene Vorkommen bleiben immer als Historie erhalten.
    //  Transaktions-Timeout großzügig: weit vormaterialisierte Serien + Routen-
    //  Stopp-Cascades sprengen sonst den Prisma-Default (5 s → P2028).
    const series = appointment.series;
    const today = toUtcDateOnly(new Date());
    const oldOccurrenceDate = appointment.occurrenceDate ?? toUtcDateOnly(appointment.startAt);
    const seriesStart = toUtcDateOnly(series.startDate);
    // Bezugsdatum: „Ganze Serie" bezieht sich auf den Serienstart, „Folgende" auf
    // das gewählte Vorkommen. Das Formular belegt das Datumsfeld entsprechend vor.
    const oldReference = options.scope === 'all' ? seriesStart : oldOccurrenceDate;
    // Ohne mitgeschicktes Datum wird NICHT verschoben (nur Zeit/Rhythmus).
    const newDate = input.date ? utcDate(dateParts.y, dateParts.m, dateParts.d) : oldReference;
    const dateChanged = newDate.getTime() !== oldReference.getTime();
    if (dateChanged && newDate.getTime() < today.getTime()) {
      throw new AppError('VALIDATION_FAILED', {
        message: 'Der neue Serienstart darf nicht in der Vergangenheit liegen.',
      });
    }

    const baseOptions: RecurrenceOptions = input.recurrence
      ? input.recurrence
      : recurrenceOptionsFromRule(series.recurrenceRule);
    const commonData = {
      title: input.title ?? series.title,
      description: input.description !== undefined ? input.description : series.description,
      defaultEmployeeId: assignedEmployeeId,
      defaultStartTime: startTime,
      defaultDurationMinutes: durationMinutes,
    };
    // Bei Datumsverschiebung wird der Rhythmus am NEUEN Datum verankert (Wochentag
    // aus dem neuen Startdatum) – so landet das erste Vorkommen genau dort.
    const shiftedRule = buildRecurrenceRule({ ...baseOptions, weekdays: undefined }, newDate);

    const removeRegenerable = async (tx: Prisma.TransactionClient, from: Date | null) => {
      const modified = await tx.appointmentSeriesException.findMany({
        where: { seriesId: series.id },
        select: { occurrenceDate: true },
      });
      const modifiedKeys = new Set(modified.map((e) => e.occurrenceDate.toISOString()));
      const rows = await tx.appointment.findMany({
        where: {
          seriesId: series.id,
          ...(from ? { occurrenceDate: { gte: from } } : {}),
          status: { in: ['PLANNED', 'CONFIRMED', 'DRAFT'] },
        },
        select: { id: true, occurrenceDate: true },
      });
      const ids = rows
        .filter((a) => a.occurrenceDate && !modifiedKeys.has(a.occurrenceDate.toISOString()))
        .map((a) => a.id);
      if (ids.length > 0) await tx.appointment.deleteMany({ where: { id: { in: ids } } });
    };

    const isSplit =
      options.scope === 'following' &&
      dateChanged &&
      oldOccurrenceDate.getTime() > seriesStart.getTime();

    if (isSplit) {
      // Alte Serie vor dem bearbeiteten Tag beenden, neue Serie ab dem neuen Datum.
      if (!isValidRecurrenceRule(shiftedRule)) {
        throw new AppError('VALIDATION_FAILED', {
          message: 'Die Wiederholungsregel ist ungültig – bitte den Rhythmus prüfen.',
        });
      }
      let newSeriesId = '';
      await db.$transaction(
        async (tx) => {
          await tx.appointmentSeries.update({
            where: { id: series.id },
            data: { endDate: addDays(oldOccurrenceDate, -1), materializedUntil: null },
          });
          await removeRegenerable(tx, oldOccurrenceDate);
          const created = await tx.appointmentSeries.create({
            data: {
              organizationId: series.organizationId,
              customerId: series.customerId,
              ...commonData,
              recurrenceRule: shiftedRule,
              recurrenceTimezone: series.recurrenceTimezone,
              startDate: newDate,
              endDate: baseOptions.endDate ?? series.endDate ?? null,
              materializedUntil: null,
            },
          });
          newSeriesId = created.id;
          await writeAuditLog(
            {
              organizationId: ctx.organization.id,
              actorUserId: ctx.user.id,
              action: 'series.updated',
              entityType: 'AppointmentSeries',
              entityId: series.id,
              metadata: {
                scope: 'following',
                split: true,
                newSeriesId,
                newStart: newDate.toISOString().slice(0, 10),
              },
            },
            tx,
          );
        },
        { timeout: 30_000, maxWait: 8_000 },
      );
      await materializeSeries(series.id);
      await materializeSeries(newSeriesId);
    } else {
      // Eine Serie: ganze Serie verschieben ODER nur Zeit/Rhythmus ab dem Bezugstag.
      const newStartDate = dateChanged ? newDate : series.startDate;
      const rule = dateChanged
        ? shiftedRule
        : input.recurrence
          ? buildRecurrenceRule(input.recurrence, series.startDate)
          : series.recurrenceRule;
      // Nur selbst gebaute Regeln streng prüfen – eine bereits gespeicherte
      // (evtl. kaputte) Regel darf man weiterhin bearbeiten/reparieren.
      if ((dateChanged || input.recurrence) && !isValidRecurrenceRule(rule)) {
        throw new AppError('VALIDATION_FAILED', {
          message: 'Die Wiederholungsregel ist ungültig – bitte den Rhythmus prüfen.',
        });
      }
      // Verschiebung: Vergangenes bleibt auf dem alten Rhythmus stehen (Historie);
      // ab heute neu. Ohne Verschiebung wie bisher (ganze Serie ab heute,
      // „folgende" ab dem gewählten Vorkommen).
      const fromDate = dateChanged
        ? today
        : options.scope === 'all'
          ? today
          : oldOccurrenceDate;
      await db.$transaction(
        async (tx) => {
          await tx.appointmentSeries.update({
            where: { id: series.id },
            data: {
              ...commonData,
              startDate: newStartDate,
              recurrenceRule: rule,
              endDate: input.recurrence ? (input.recurrence.endDate ?? null) : series.endDate,
              materializedUntil: null,
            },
          });
          await removeRegenerable(tx, fromDate);
          await writeAuditLog(
            {
              organizationId: ctx.organization.id,
              actorUserId: ctx.user.id,
              action: 'series.updated',
              entityType: 'AppointmentSeries',
              entityId: series.id,
              metadata: {
                scope: options.scope,
                shifted: dateChanged,
                fromDate: fromDate.toISOString().slice(0, 10),
              },
            },
            tx,
          );
        },
        { timeout: 30_000, maxWait: 8_000 },
      );
      await materializeSeries(series.id);
    }
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
  if (assignedEmployeeId) {
    await notifyAppointmentConflict(ctx, assignedEmployeeId, appointment.customerId, startAt, conflicts);
  }

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
  if (hasWarnings(conflicts) && !options.confirmed && !ctx.organization.soloMode) {
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
      // Abgesagte Termine werden nicht angefahren – aus der Tagesroute nehmen.
      await detachAppointmentsFromRoutePlans(tx, [id]);
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
      await detachAppointmentsFromRoutePlans(
        tx,
        future.map((a) => a.id),
      );
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

/**
 * Termin(e) vollständig löschen (Soft-Delete über deletedAt) – im Gegensatz zum
 * Absagen verschwinden sie komplett aus dem Kalender. Für Serien wird die
 * Wiederholung so angepasst, dass gelöschte Vorkommen nicht neu entstehen.
 */
export async function deleteAppointment(
  appointmentId: string,
  options: { scope: EditScope },
): Promise<{ deletedIds: string[] }> {
  const ctx = await requireOrganizationMembership();
  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: { series: true },
  });
  assertSameOrg(ctx, appointment);
  await requireAppointmentManage(ctx, appointment.assignedEmployeeId);

  const now = new Date();

  if (options.scope === 'single' || !appointment.seriesId) {
    await db.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id: appointment.id },
        data: { deletedAt: now },
      });
      // Aus gespeicherten Tagesrouten entfernen (Soft-Delete löst kein Cascade aus).
      await detachAppointmentsFromRoutePlans(tx, [appointment.id]);
      // Einzelnes Serien-Vorkommen: als abgesagte Ausnahme markieren, damit es
      // bei einer Neu-Materialisierung nicht wieder auftaucht.
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
            exceptionType: 'CANCELLED',
          },
          update: { exceptionType: 'CANCELLED', replacementAppointmentId: null },
        });
      }
      await writeAuditLog(
        {
          organizationId: ctx.organization.id,
          actorUserId: ctx.user.id,
          action: 'appointment.deleted',
          entityType: 'Appointment',
          entityId: appointment.id,
          metadata: { scope: 'single' },
        },
        tx,
      );
    });
    return { deletedIds: [appointment.id] };
  }

  // Serie: „ganze Serie" oder „dieser und folgende" – künftige Vorkommen löschen.
  const fromDate =
    options.scope === 'all'
      ? null
      : (appointment.occurrenceDate ?? toUtcDateOnly(appointment.startAt));

    // Löscht man von einem bereits abgesagten Termin aus, betrifft es NUR die
    // abgesagten Vorkommen der Serie. Von einem aktiven Termin aus werden die
    // geplanten UND abgesagten gelöscht – Abgeschlossene bleiben immer erhalten.
    const triggerCancelled =
      appointment.status === 'CANCELLED' || appointment.status === 'NO_SHOW';
    const deletableStatuses = triggerCancelled
      ? (['CANCELLED', 'NO_SHOW'] as const)
      : (['DRAFT', 'PLANNED', 'CONFIRMED', 'IN_PROGRESS', 'CANCELLED', 'NO_SHOW'] as const);

  let deletedIds: string[] = [];
  await db.$transaction(async (tx) => {
    const targets = await tx.appointment.findMany({
      where: {
        seriesId: appointment.seriesId!,
        deletedAt: null,
        status: { in: [...deletableStatuses] },
        ...(fromDate ? { occurrenceDate: { gte: fromDate } } : {}),
      },
      select: { id: true },
    });
    deletedIds = targets.map((a) => a.id);
    await tx.appointment.updateMany({
      where: { id: { in: deletedIds } },
      data: { deletedAt: now },
    });
    await detachAppointmentsFromRoutePlans(tx, deletedIds);
    await tx.appointmentSeries.update({
      where: { id: appointment.seriesId! },
      data:
        options.scope === 'all'
          ? { status: 'ENDED', materializedUntil: null }
          : { endDate: addDays(fromDate!, -1), materializedUntil: addDays(fromDate!, -1) },
    });
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: 'series.deleted',
        entityType: 'AppointmentSeries',
        entityId: appointment.seriesId!,
        metadata: { scope: options.scope, deletedCount: deletedIds.length },
      },
      tx,
    );
  });
  return { deletedIds };
}

/**
 * Abgesagten Termin wieder aktivieren (Status → geplant). Erst danach ist er
 * wieder bearbeitbar. Für Serien-Vorkommen wird die „abgesagt"-Ausnahme
 * entfernt, damit es als reguläres Vorkommen weiterläuft.
 */
export async function restoreAppointment(appointmentId: string): Promise<void> {
  const ctx = await requireOrganizationMembership();
  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: { series: true },
  });
  assertSameOrg(ctx, appointment);
  await requireAppointmentManage(ctx, appointment.assignedEmployeeId);
  if (appointment.deletedAt) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'Gelöschte Termine können nicht wiederhergestellt werden.',
    });
  }
  if (appointment.status !== 'CANCELLED' && appointment.status !== 'NO_SHOW') return;

  await db.$transaction(async (tx) => {
    await tx.appointment.update({
      where: { id: appointmentId },
      data: {
        status: 'PLANNED',
        cancellationReason: null,
        assignmentStatus: appointment.assignedEmployeeId
          ? ctx.organization.soloMode
            ? 'ACCEPTED'
            : 'ASSIGNED'
          : 'UNASSIGNED',
      },
    });
    if (appointment.seriesId && appointment.occurrenceDate) {
      await tx.appointmentSeriesException.deleteMany({
        where: {
          seriesId: appointment.seriesId,
          occurrenceDate: appointment.occurrenceDate,
          exceptionType: 'CANCELLED',
        },
      });
    }
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: 'appointment.restored',
        entityType: 'Appointment',
        entityId: appointmentId,
      },
      tx,
    );
  });
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

export interface CompleteAppointmentResult {
  alreadyCompleted: boolean;
  customerId: string;
}

/**
 * Ein-Klick-Abschluss für „Mein Tag“ und den vereinfachten Solo-Drawer.
 *
 * Die Mutation ist idempotent: ein bereits abgeschlossener Termin bleibt
 * unverändert (insbesondere completedAt). Legacy-Solo-Termine ohne Zuordnung
 * werden im selben Schritt dem eigenen Profil zugeordnet, damit geleistete
 * Minuten und daraus abgeleiteter Verdienst eindeutig beim Benutzer landen.
 */
export async function completeAppointment(
  appointmentId: string,
): Promise<CompleteAppointmentResult> {
  const ctx = await requireOrganizationMembership();
  const appointment = await db.appointment.findUnique({ where: { id: appointmentId } });
  assertSameOrg(ctx, appointment);

  const ownEmployeeId = ctx.employee?.id ?? null;
  const isOwn = Boolean(ownEmployeeId && appointment.assignedEmployeeId === ownEmployeeId);
  const canManage = hasPermission(ctx, 'appointments.manage');

  if (ctx.organization.soloMode) {
    const soloEmployeeId = requiredSoloEmployeeId(ctx);
    if (
      appointment.assignedEmployeeId !== null &&
      appointment.assignedEmployeeId !== soloEmployeeId
    ) {
      throw new AppError('ACCESS_DENIED');
    }
    if (canManage) await requireAppointmentManage(ctx, soloEmployeeId);
    else if (!isOwn) throw new AppError('ACCESS_DENIED');
  } else if (canManage) {
    // Beachtet insbesondere den Unterbaum eines Team-Managers.
    await requireAppointmentManage(ctx, appointment.assignedEmployeeId);
  } else if (!isOwn) {
    throw new AppError('ACCESS_DENIED');
  }

  if (appointment.status === 'COMPLETED') {
    return { alreadyCompleted: true, customerId: appointment.customerId };
  }
  if (!isAppointmentCompletableStatus(appointment.status)) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'Abgesagte Termine können nicht abgeschlossen werden.',
    });
  }

  const completedAt = new Date();
  const result = await db.$transaction(async (tx) => {
    const updated = await tx.appointment.updateMany({
      where: {
        id: appointmentId,
        status: { in: ['DRAFT', 'PLANNED', 'CONFIRMED', 'IN_PROGRESS'] },
        ...(ctx.organization.soloMode
          ? {
              OR: [
                { assignedEmployeeId: requiredSoloEmployeeId(ctx) },
                { assignedEmployeeId: null },
              ],
            }
          : {}),
      },
      data: {
        status: 'COMPLETED',
        completedAt,
        ...(ctx.organization.soloMode
          ? {
              assignedEmployeeId: requiredSoloEmployeeId(ctx),
              assignmentStatus: 'ACCEPTED' as const,
            }
          : {}),
      },
    });
    if (updated.count === 0) return false;

    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: 'appointment.statusChanged',
        entityType: 'Appointment',
        entityId: appointmentId,
        metadata: { status: 'COMPLETED', via: 'quickComplete' },
      },
      tx,
    );
    return true;
  });

  if (!result) {
    const current = await db.appointment.findUnique({
      where: { id: appointmentId },
      select: { status: true },
    });
    if (current?.status === 'COMPLETED') {
      return { alreadyCompleted: true, customerId: appointment.customerId };
    }
    throw new AppError('VALIDATION_FAILED', {
      message: 'Der Termin wurde zwischenzeitlich geändert und konnte nicht abgeschlossen werden.',
    });
  }

  return { alreadyCompleted: false, customerId: appointment.customerId };
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
