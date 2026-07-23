import 'server-only';

import { addDays } from 'date-fns';

import type { Conflict } from '@/lib/conflicts';
import { resolveDayOverlaps, type ResolverAppointment } from '@/lib/conflict-resolver';
import { calendarDayInZone, dayPeriodInZone, formatTime } from '@/lib/dates';
import { estimateTravelSeconds } from '@/lib/geo';
import { db } from '@/server/db';
import { AppError } from '@/server/errors';
import {
  assertSameOrg,
  employeeScopeFilter,
  getManagedEmployeeIds,
  hasPermission,
  requireOrganizationMembership,
  scopeContains,
  type OrgContext,
} from '@/server/permissions';
import { collectConflicts, rescheduleAppointment } from '@/server/services/appointment-service';

/**
 * Konflikt-Assistent: konkrete Konflikte je Termin anzeigen, organisationsweit
 * auflisten (Benachrichtigungen) und – wo möglich – automatisch auflösen, indem
 * flexible Termine effizient umgeplant werden (fixe Termine bleiben fix).
 */

const RESERVING_STATUSES = ['PLANNED', 'CONFIRMED', 'IN_PROGRESS'] as const;

export interface SerializedConflict {
  type: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  message: string;
  relatedAppointmentId?: string;
}

/** Konflikte eines bestehenden Termins (für den Drawer). */
export async function getAppointmentConflicts(
  appointmentId: string,
): Promise<{ conflicts: SerializedConflict[]; canResolve: boolean }> {
  const ctx = await requireOrganizationMembership();
  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      organizationId: true,
      customerId: true,
      assignedEmployeeId: true,
      startAt: true,
      endAt: true,
      durationMinutes: true,
      routeRelevant: true,
      isFlexible: true,
      earliestStartAt: true,
      latestEndAt: true,
      locationAddressId: true,
      status: true,
      deletedAt: true,
    },
  });
  assertSameOrg(ctx, appointment);
  if (appointment.deletedAt || !(RESERVING_STATUSES as readonly string[]).includes(appointment.status)) {
    return { conflicts: [], canResolve: false };
  }

  const conflicts = await collectConflicts(ctx, {
    id: appointment.id,
    customerId: appointment.customerId,
    assignedEmployeeId: appointment.assignedEmployeeId,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    durationMinutes: appointment.durationMinutes,
    routeRelevant: appointment.routeRelevant,
    isFlexible: appointment.isFlexible,
    earliestStartAt: appointment.earliestStartAt,
    latestEndAt: appointment.latestEndAt,
    locationAddressId: appointment.locationAddressId,
  });

  const scheduleConflicts = conflicts.filter(
    (conflict) =>
      conflict.type === 'OVERLAP' ||
      conflict.type === 'INSUFFICIENT_TRAVEL_TIME' ||
      conflict.type === 'ABSENCE',
  );
  // Auflösbar, wenn es einen planbaren Konflikt gibt und die Leitung planen darf.
  const canResolve =
    scheduleConflicts.length > 0 &&
    appointment.assignedEmployeeId != null &&
    hasPermission(ctx, 'appointments.manage');

  return { conflicts: conflicts.map(serialize), canResolve };
}

function serialize(conflict: Conflict): SerializedConflict {
  return {
    type: conflict.type,
    severity: conflict.severity,
    message: conflict.message,
    ...(conflict.relatedAppointmentId ? { relatedAppointmentId: conflict.relatedAppointmentId } : {}),
  };
}

// ---------------------------------------------------------------------------
// Automatische Auflösung (Vorschlag + Anwenden)
// ---------------------------------------------------------------------------

export interface ResolutionMoveDto {
  appointmentId: string;
  title: string;
  customerName: string;
  fromLabel: string;
  toLabel: string;
  newStartIso: string;
  newEndIso: string;
}

export interface ResolutionUnresolvedDto {
  appointmentId: string;
  title: string;
  reason: string;
}

export interface ResolutionProposal {
  employeeId: string;
  date: string;
  hadOverlap: boolean;
  moves: ResolutionMoveDto[];
  unresolved: ResolutionUnresolvedDto[];
}

async function computeResolution(
  ctx: OrgContext,
  employeeId: string,
  date: Date,
): Promise<ResolutionProposal> {
  const timezone = ctx.organization.timezone;
  const day = dayPeriodInZone(date, timezone);

  const [appointments, absences] = await Promise.all([
    db.appointment.findMany({
      where: {
        organizationId: ctx.organization.id,
        assignedEmployeeId: employeeId,
        deletedAt: null,
        status: { in: [...RESERVING_STATUSES] },
        startAt: { gte: day.start, lt: day.end },
      },
      select: {
        id: true,
        title: true,
        startAt: true,
        endAt: true,
        durationMinutes: true,
        isFlexible: true,
        earliestStartAt: true,
        latestEndAt: true,
        routeRelevant: true,
        locationAddress: { select: { latitude: true, longitude: true } },
        customer: { select: { firstName: true, lastName: true } },
      },
      orderBy: { startAt: 'asc' },
    }),
    // Genehmigte Abwesenheiten am Tag → unverrückbare Sperrfenster.
    db.employeeAbsence.findMany({
      where: {
        employeeId,
        status: 'APPROVED',
        startAt: { lt: day.end },
        endAt: { gt: day.start },
      },
      select: { startAt: true, endAt: true },
    }),
  ]);

  const resolverInput: ResolverAppointment[] = appointments.map((appointment) => ({
    id: appointment.id,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    durationMinutes: appointment.durationMinutes,
    isFlexible: appointment.isFlexible,
    earliestStartAt: appointment.earliestStartAt,
    latestEndAt: appointment.latestEndAt,
  }));

  // Fahrzeit-Puffer: aus den tatsächlichen Distanzen der Tagesstopps abgeleitet,
  // damit zwischen Terminen genug Zeit zum Fahren bleibt (nicht nur 0-Overlap).
  const bufferMinutes = estimateTravelBufferMinutes(
    appointments
      .filter((a) => a.routeRelevant && a.locationAddress?.latitude != null && a.locationAddress?.longitude != null)
      .map((a) => ({ latitude: a.locationAddress!.latitude!, longitude: a.locationAddress!.longitude! })),
  );

  const result = resolveDayOverlaps(resolverInput, {
    dayStart: day.start,
    dayEnd: day.end,
    bufferMinutes,
    blockedIntervals: absences.map((absence) => ({ start: absence.startAt, end: absence.endAt })),
  });

  const byId = new Map(appointments.map((appointment) => [appointment.id, appointment]));
  const label = (start: Date, end: Date) => `${formatTime(start, timezone)}–${formatTime(end, timezone)}`;

  const moves: ResolutionMoveDto[] = result.moves.map((move) => {
    const appointment = byId.get(move.id)!;
    return {
      appointmentId: move.id,
      title: appointment.title,
      customerName: `${appointment.customer.firstName} ${appointment.customer.lastName}`,
      fromLabel: label(appointment.startAt, appointment.endAt),
      toLabel: label(move.newStart, move.newEnd),
      newStartIso: move.newStart.toISOString(),
      newEndIso: move.newEnd.toISOString(),
    };
  });

  const unresolved: ResolutionUnresolvedDto[] = result.unresolved.map((id) => {
    const appointment = byId.get(id)!;
    return {
      appointmentId: id,
      title: appointment.title,
      reason: appointment.isFlexible
        ? 'Kein freies Zeitfenster – bitte manuell anpassen.'
        : 'Fixer Termin überschneidet sich mit einem anderen fixen Termin.',
    };
  });

  return {
    employeeId,
    date: calendarDayInZoneIso(date, timezone),
    hadOverlap: result.hadOverlap,
    moves,
    unresolved,
  };
}

function calendarDayInZoneIso(date: Date, timezone: string): string {
  const { year, month, day } = calendarDayInZone(date, timezone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Repräsentativer Fahrzeit-Puffer (Minuten) aus den Tagesstopps: mittlere
 * geschätzte Fahrzeit zwischen benachbarten Koordinaten, gedeckelt auf 5..30.
 */
function estimateTravelBufferMinutes(points: { latitude: number; longitude: number }[]): number {
  if (points.length < 2) return 5;
  let total = 0;
  let count = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += estimateTravelSeconds(points[i - 1]!, points[i]!);
    count += 1;
  }
  const avgMinutes = count > 0 ? Math.round(total / count / 60) : 5;
  return Math.min(30, Math.max(5, avgMinutes));
}

async function requireEmployeeInScope(ctx: OrgContext, employeeId: string) {
  if (!hasPermission(ctx, 'appointments.manage')) throw new AppError('ACCESS_DENIED');
  const scope = await getManagedEmployeeIds(ctx);
  if (!scopeContains(scope, employeeId)) {
    throw new AppError('ACCESS_DENIED', { message: 'Der Mitarbeiter liegt außerhalb deines Bereichs.' });
  }
  const employee = await db.employee.findUnique({ where: { id: employeeId } });
  assertSameOrg(ctx, employee);
}

/** Vorschlag zur Konfliktauflösung (Vorschau, ändert nichts). */
export async function suggestConflictResolution(
  employeeId: string,
  dateIso: string,
): Promise<ResolutionProposal> {
  const ctx = await requireOrganizationMembership();
  await requireEmployeeInScope(ctx, employeeId);
  const date = parseDate(dateIso);
  return computeResolution(ctx, employeeId, date);
}

/**
 * Wendet die Auflösung an: rechnet serverseitig neu und verschiebt die
 * flexiblen Termine (confirmed, da überschneidungsfrei geplant).
 */
export async function applyConflictResolution(
  employeeId: string,
  dateIso: string,
): Promise<{ appliedCount: number; unresolvedCount: number }> {
  const ctx = await requireOrganizationMembership();
  await requireEmployeeInScope(ctx, employeeId);
  const date = parseDate(dateIso);
  const proposal = await computeResolution(ctx, employeeId, date);

  let appliedCount = 0;
  for (const move of proposal.moves) {
    const result = await rescheduleAppointment(move.appointmentId, move.newStartIso, move.newEndIso, {
      confirmed: true,
    });
    if (!result.requiresConfirmation) appliedCount += 1;
  }
  return { appliedCount, unresolvedCount: proposal.unresolved.length };
}

function parseDate(dateIso: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  if (!match) throw new AppError('VALIDATION_FAILED', { message: 'Ungültiges Datum.' });
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
}

async function loadAppointmentEmployeeDay(ctx: OrgContext, appointmentId: string) {
  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    select: { organizationId: true, assignedEmployeeId: true, startAt: true },
  });
  assertSameOrg(ctx, appointment);
  if (!appointment.assignedEmployeeId) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'Ohne zugewiesenen Mitarbeiter gibt es keine Terminüberschneidung zum Auflösen.',
    });
  }
  await requireEmployeeInScope(ctx, appointment.assignedEmployeeId);
  return { employeeId: appointment.assignedEmployeeId, date: appointment.startAt };
}

/** Auflösungs-Vorschlag für den Tag eines konkreten Termins (Drawer). */
export async function suggestResolutionForAppointment(
  appointmentId: string,
): Promise<ResolutionProposal> {
  const ctx = await requireOrganizationMembership();
  const { employeeId, date } = await loadAppointmentEmployeeDay(ctx, appointmentId);
  return computeResolution(ctx, employeeId, date);
}

/** Auflösung für den Tag eines konkreten Termins anwenden (Drawer). */
export async function applyResolutionForAppointment(
  appointmentId: string,
): Promise<{ appliedCount: number; unresolvedCount: number }> {
  const ctx = await requireOrganizationMembership();
  const { employeeId, date } = await loadAppointmentEmployeeDay(ctx, appointmentId);
  const proposal = await computeResolution(ctx, employeeId, date);
  let appliedCount = 0;
  for (const move of proposal.moves) {
    const result = await rescheduleAppointment(move.appointmentId, move.newStartIso, move.newEndIso, {
      confirmed: true,
    });
    if (!result.requiresConfirmation) appliedCount += 1;
  }
  return { appliedCount, unresolvedCount: proposal.unresolved.length };
}

// ---------------------------------------------------------------------------
// Organisationsweite Konfliktliste (Benachrichtigungen)
// ---------------------------------------------------------------------------

export interface OrgConflictDto {
  employeeId: string;
  employeeName: string;
  date: string;
  dateLabel: string;
  /** Beteiligte Termine (Überschneidung/Abwesenheit). */
  appointments: Array<{ id: string; title: string; customerName: string; timeLabel: string }>;
  kind: 'OVERLAP' | 'ABSENCE';
  canResolve: boolean;
}

/**
 * Aktuelle Terminkonflikte im Sichtbereich (kommende `days` Tage): Überschneidungen
 * desselben Mitarbeiters und Termine während genehmigter Abwesenheiten.
 */
export async function listScopeConflicts(days = 21): Promise<OrgConflictDto[]> {
  const ctx = await requireOrganizationMembership();
  const timezone = ctx.organization.timezone;
  const now = new Date();
  const today = dayPeriodInZone(now, timezone);
  const horizon = addDays(today.start, days);

  const scope = await getManagedEmployeeIds(ctx);
  const isPlanner = hasPermission(ctx, 'appointments.viewAll');
  const canManage = hasPermission(ctx, 'appointments.manage');

  const appointments = await db.appointment.findMany({
    where: {
      organizationId: ctx.organization.id,
      deletedAt: null,
      assignedEmployeeId: { not: null },
      status: { in: [...RESERVING_STATUSES] },
      startAt: { gte: today.start, lt: horizon },
      ...(isPlanner
        ? {}
        : scope === 'ALL'
          ? {}
          : { assignedEmployeeId: { in: scope.length > 0 ? scope : ['-'] } }),
    },
    select: {
      id: true,
      title: true,
      startAt: true,
      endAt: true,
      assignedEmployeeId: true,
      isFlexible: true,
      assignedEmployee: { select: { firstName: true, lastName: true } },
      customer: { select: { firstName: true, lastName: true } },
    },
    orderBy: { startAt: 'asc' },
  });

  const absences = await db.employeeAbsence.findMany({
    where: {
      employee: { organizationId: ctx.organization.id, ...employeeScopeFilter(scope) },
      status: 'APPROVED',
      startAt: { lt: horizon },
      endAt: { gt: today.start },
    },
    select: { employeeId: true, startAt: true, endAt: true },
  });

  const dayKey = (date: Date) => calendarDayInZoneIso(date, timezone);
  const timeLabel = (start: Date, end: Date) =>
    `${formatTime(start, timezone)}–${formatTime(end, timezone)}`;

  // Gruppieren je Mitarbeiter + Kalendertag.
  const groups = new Map<string, typeof appointments>();
  for (const appointment of appointments) {
    const key = `${appointment.assignedEmployeeId}|${dayKey(appointment.startAt)}`;
    const list = groups.get(key) ?? [];
    list.push(appointment);
    groups.set(key, list);
  }

  const conflicts: OrgConflictDto[] = [];
  for (const [key, list] of groups) {
    const [employeeId, date] = key.split('|') as [string, string];
    const sorted = [...list].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    const conflictingIds = new Set<string>();
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        if (sorted[j]!.startAt >= sorted[i]!.endAt) break;
        conflictingIds.add(sorted[i]!.id);
        conflictingIds.add(sorted[j]!.id);
      }
    }
    if (conflictingIds.size > 0) {
      const involved = sorted.filter((appointment) => conflictingIds.has(appointment.id));
      conflicts.push({
        employeeId,
        date,
        dateLabel: new Intl.DateTimeFormat('de-DE', {
          timeZone: timezone,
          weekday: 'short',
          day: '2-digit',
          month: '2-digit',
        }).format(involved[0]!.startAt),
        employeeName: `${involved[0]!.assignedEmployee!.firstName} ${involved[0]!.assignedEmployee!.lastName}`,
        appointments: involved.map((appointment) => ({
          id: appointment.id,
          title: appointment.title,
          customerName: `${appointment.customer.firstName} ${appointment.customer.lastName}`,
          timeLabel: timeLabel(appointment.startAt, appointment.endAt),
        })),
        kind: 'OVERLAP',
        // Auflösbar, wenn mindestens ein beteiligter Termin flexibel ist.
        canResolve: canManage && involved.some((appointment) => appointment.isFlexible),
      });
    }
  }

  // Termine während einer Abwesenheit.
  for (const appointment of appointments) {
    const absent = absences.find(
      (absence) =>
        absence.employeeId === appointment.assignedEmployeeId &&
        appointment.startAt < absence.endAt &&
        absence.startAt < appointment.endAt,
    );
    if (absent) {
      conflicts.push({
        employeeId: appointment.assignedEmployeeId!,
        date: dayKey(appointment.startAt),
        dateLabel: new Intl.DateTimeFormat('de-DE', {
          timeZone: timezone,
          weekday: 'short',
          day: '2-digit',
          month: '2-digit',
        }).format(appointment.startAt),
        employeeName: `${appointment.assignedEmployee!.firstName} ${appointment.assignedEmployee!.lastName}`,
        appointments: [
          {
            id: appointment.id,
            title: appointment.title,
            customerName: `${appointment.customer.firstName} ${appointment.customer.lastName}`,
            timeLabel: timeLabel(appointment.startAt, appointment.endAt),
          },
        ],
        kind: 'ABSENCE',
        canResolve: false,
      });
    }
  }

  return conflicts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
