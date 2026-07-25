import 'server-only';

import { addDays } from 'date-fns';

import { isOutsideAvailabilityWindows, type Conflict } from '@/lib/conflicts';
import { resolveDayOverlaps, type ResolverAppointment } from '@/lib/conflict-resolver';
import {
  calendarDayInZone,
  dayPeriodInZone,
  formatTime,
  isoWeekdayInZone,
} from '@/lib/dates';
import { estimateTravelSeconds, haversineMeters } from '@/lib/geo';
import { writeAuditLog } from '@/server/audit';
import { computeRouteMatrixCached } from '@/server/providers/routing';
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
import {
  createNotificationsForUsers,
  getPlannerUserIds,
} from '@/server/services/notification-service';

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
// Umweisungs-Vorschlag: freie + nächstgelegene Mitarbeiter
// ---------------------------------------------------------------------------

export interface ReplacementCandidateDto {
  employeeId: string;
  name: string;
  /** Verfügbar = im Zeitfenster, nicht abwesend, keine Überschneidung. */
  available: boolean;
  outsideAvailability: boolean;
  absent: boolean;
  hasOverlap: boolean;
  /** Luftlinie Zuhause → Kundenort (m); null ohne Koordinaten. */
  distanceMeters: number | null;
}

export interface ReplacementSuggestion {
  appointmentId: string;
  candidates: ReplacementCandidateDto[];
}

function homePoint(value: unknown): { latitude: number; longitude: number } | null {
  if (!value || typeof value !== 'object') return null;
  const loc = value as { latitude?: unknown; longitude?: unknown };
  if (typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') return null;
  return { latitude: loc.latitude, longitude: loc.longitude };
}

/**
 * Bei einem Termin (typisch mit Konflikt „außerhalb Verfügbarkeit") passende
 * Ersatz-Mitarbeiter vorschlagen: zuerst die FREIEN (im Zeitfenster verfügbar,
 * nicht abwesend, ohne Überschneidung), darunter nach Nähe zum Kundenort. So
 * lässt sich der Termin mit einem Klick sinnvoll umweisen.
 */
export async function suggestReplacementEmployees(
  appointmentId: string,
): Promise<ReplacementSuggestion> {
  const ctx = await requireOrganizationMembership();
  if (!hasPermission(ctx, 'appointments.manage')) throw new AppError('ACCESS_DENIED');

  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      organizationId: true,
      assignedEmployeeId: true,
      customerId: true,
      startAt: true,
      endAt: true,
      durationMinutes: true,
      locationAddress: { select: { latitude: true, longitude: true } },
    },
  });
  assertSameOrg(ctx, appointment);

  const timezone = ctx.organization.timezone;
  const weekday = isoWeekdayInZone(appointment.startAt, timezone);

  // Kundenort: Termin-Adresse, ersatzweise erste geokodierte Kundenadresse.
  let customerPoint =
    appointment.locationAddress?.latitude != null && appointment.locationAddress.longitude != null
      ? { latitude: appointment.locationAddress.latitude, longitude: appointment.locationAddress.longitude }
      : null;
  if (!customerPoint) {
    const address = await db.address.findFirst({
      where: { customerId: appointment.customerId, latitude: { not: null }, longitude: { not: null } },
      select: { latitude: true, longitude: true },
    });
    if (address?.latitude != null && address.longitude != null) {
      customerPoint = { latitude: address.latitude, longitude: address.longitude };
    }
  }

  const scope = await getManagedEmployeeIds(ctx);
  const employees = await db.employee.findMany({
    where: {
      organizationId: ctx.organization.id,
      deletedAt: null,
      status: 'ACTIVE',
      ...employeeScopeFilter(scope),
      ...(appointment.assignedEmployeeId ? { id: { not: appointment.assignedEmployeeId } } : {}),
    },
    select: { id: true, firstName: true, lastName: true, startLocation: true },
  });
  if (employees.length === 0) return { appointmentId, candidates: [] };
  const employeeIds = employees.map((employee) => employee.id);

  const [availabilities, absences, overlapping] = await Promise.all([
    db.employeeAvailability.findMany({
      where: {
        employeeId: { in: employeeIds },
        weekday,
        validFrom: { lte: appointment.startAt },
        OR: [{ validUntil: null }, { validUntil: { gte: appointment.startAt } }],
      },
      select: { employeeId: true, startTime: true, endTime: true, validFrom: true, validUntil: true },
    }),
    db.employeeAbsence.findMany({
      where: {
        employeeId: { in: employeeIds },
        status: 'APPROVED',
        startAt: { lt: appointment.endAt },
        endAt: { gt: appointment.startAt },
      },
      select: { employeeId: true },
    }),
    db.appointment.findMany({
      where: {
        assignedEmployeeId: { in: employeeIds },
        deletedAt: null,
        status: { in: [...RESERVING_STATUSES] },
        startAt: { lt: appointment.endAt },
        endAt: { gt: appointment.startAt },
        id: { not: appointment.id },
      },
      select: { assignedEmployeeId: true },
    }),
  ]);

  const availByEmployee = new Map<string, { weekday: number; startTime: string; endTime: string }[]>();
  for (const slot of availabilities) {
    const list = availByEmployee.get(slot.employeeId) ?? [];
    list.push({ weekday, startTime: slot.startTime, endTime: slot.endTime });
    availByEmployee.set(slot.employeeId, list);
  }
  const absentIds = new Set(absences.map((absence) => absence.employeeId));
  const overlapIds = new Set(
    overlapping.map((row) => row.assignedEmployeeId).filter((id): id is string => Boolean(id)),
  );

  const candidates: ReplacementCandidateDto[] = employees.map((employee) => {
    const slots = availByEmployee.get(employee.id) ?? [];
    // Ohne gepflegte Fenster gilt „immer verfügbar" (App-Konvention).
    const outsideAvailability =
      slots.length > 0 &&
      isOutsideAvailabilityWindows(
        appointment.startAt,
        appointment.durationMinutes,
        slots,
        timezone,
      );
    const absent = absentIds.has(employee.id);
    const hasOverlap = overlapIds.has(employee.id);
    const home = homePoint(employee.startLocation);
    const distanceMeters =
      home && customerPoint ? Math.round(haversineMeters(home, customerPoint)) : null;
    return {
      employeeId: employee.id,
      name: `${employee.firstName} ${employee.lastName}`,
      available: !outsideAvailability && !absent && !hasOverlap,
      outsideAvailability,
      absent,
      hasOverlap,
      distanceMeters,
    };
  });

  // Freie zuerst, darunter nach Nähe (ohne Koordinaten ans Ende), dann Name.
  candidates.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    const da = a.distanceMeters ?? Number.POSITIVE_INFINITY;
    const db2 = b.distanceMeters ?? Number.POSITIVE_INFINITY;
    if (da !== db2) return da - db2;
    return a.name.localeCompare(b.name);
  });

  return { appointmentId, candidates };
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
  const bufferMinutes = await estimateTravelBufferMinutes(
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

  const customerOf = (a: (typeof appointments)[number]) =>
    `${a.customer.firstName} ${a.customer.lastName}`;
  const timeOverlaps = (
    a: { startAt: Date; endAt: Date },
    b: { startAt: Date; endAt: Date },
  ): boolean => a.startAt < b.endAt && b.startAt < a.endAt;

  const unresolved: ResolutionUnresolvedDto[] = result.unresolved.map((id) => {
    const appointment = byId.get(id)!;
    // Konkret benennen, WOMIT sich der Termin überschneidet (Kunde + Zeit), damit
    // die Meldung erklärt „weshalb und wer betroffen ist" statt nur „geht nicht".
    const clashing = appointments.filter(
      (other) => other.id !== id && timeOverlaps(appointment, other),
    );
    const clashLabel = clashing
      .map((o) => `„${o.title}" (${customerOf(o)}, ${label(o.startAt, o.endAt)})`)
      .join(' und ');
    let reason: string;
    if (appointment.isFlexible) {
      reason = clashLabel
        ? `Kein freies Zeitfenster – überschneidet sich mit ${clashLabel}. Bitte das Zeitfenster des Kunden erweitern oder manuell umplanen.`
        : 'Kein freies Zeitfenster – bitte das Zeitfenster erweitern oder manuell umplanen.';
    } else {
      reason = clashLabel
        ? `Fest terminiert (${label(appointment.startAt, appointment.endAt)}) und überschneidet sich mit ${clashLabel} – beide Termine sind fest. Bitte einen davon verschieben oder über „Freie Mitarbeiter in der Nähe" neu zuweisen.`
        : 'Fest terminiert und nicht automatisch verschiebbar – bitte manuell anpassen.';
    }
    return { appointmentId: id, title: appointment.title, reason };
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
/**
 * Puffer zwischen zwei Terminen: mittlere Fahrzeit eines Abschnitts (Kunde →
 * Kunde), nicht die Summe des Tages. Zeiten kommen vom konfigurierten
 * Routing-Anbieter, damit Auflösungsvorschläge dieselbe Grundlage haben wie
 * der Routenplaner; fällt der Dienst aus, wird geschätzt.
 */
async function estimateTravelBufferMinutes(
  points: { latitude: number; longitude: number }[],
): Promise<number> {
  if (points.length < 2) return 5;

  let total = 0;
  let count = 0;
  try {
    const matrix = await computeRouteMatrixCached(points);
    for (let i = 1; i < points.length; i += 1) {
      const seconds = matrix[i - 1]?.[i]?.travelSeconds;
      if (seconds != null) {
        total += seconds;
        count += 1;
      }
    }
  } catch {
    // Anbieter nicht erreichbar – unten auf die Schätzung zurückfallen.
  }
  if (count === 0) {
    for (let i = 1; i < points.length; i += 1) {
      total += estimateTravelSeconds(points[i - 1]!, points[i]!);
      count += 1;
    }
  }

  const averageMinutes = count > 0 ? Math.round(total / count / 60) : 5;
  return Math.min(30, Math.max(5, averageMinutes));
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

// ---------------------------------------------------------------------------
// Konflikte melden (Leitungs-Sammelaktion)
// ---------------------------------------------------------------------------

export interface ReportConflictsResult {
  /** Gemeldete Konfliktgruppen (je Mitarbeiter+Tag eine Meldung). */
  reported: number;
  /** Gruppen, deren Mitarbeiter (noch) kein Benutzerkonto hat – nicht meldbar. */
  skippedNoAccount: number;
  /** Gruppen, die kürzlich bereits gemeldet wurden (Duplikatschutz). */
  alreadyReported: number;
  /** Insgesamt betrachtete Konfliktgruppen im Scope. */
  total: number;
}

/** Fenster, in dem dieselbe Meldung nicht erneut erzeugt wird (Duplikatschutz). */
const REPORT_DEDUP_HOURS = 12;

/**
 * Leitungs-Sammelaktion „Konflikte melden": benachrichtigt die betroffenen
 * Mitarbeiter (und bei Abwesenheits-Konflikten zusätzlich die Disposition) über
 * ihre offenen Terminkonflikte.
 *
 * Grundsätze:
 *  - Nur berechtigte Leitung (`appointments.manage`) – identisch zur Auflösung.
 *  - Es wird DIESELBE zentrale Konfliktliste wie Kalender/Dashboard genutzt
 *    (`listScopeConflicts`) – nur tatsächlich offene, scope-relevante Konflikte.
 *  - Zusammenfassung je Mitarbeiter+Tag (eine Meldung, nicht je Termin).
 *  - Duplikatschutz: dieselbe Gruppe wird binnen `REPORT_DEDUP_HOURS` nicht erneut
 *    an dieselben Empfänger gemeldet.
 *  - Jede Meldung enthält den Grund und einen Deep-Link zum Termin und erzeugt
 *    einen Audit-Eintrag (`conflict.reported`).
 *
 * `selection` (optional) beschränkt auf bestimmte Gruppen (employeeId+date);
 * ohne Auswahl werden alle offenen Konflikte im Scope gemeldet.
 */
export async function reportScopeConflicts(
  selection?: { employeeId: string; date: string }[],
): Promise<ReportConflictsResult> {
  const ctx = await requireOrganizationMembership();
  if (!hasPermission(ctx, 'appointments.manage')) throw new AppError('ACCESS_DENIED');

  const allConflicts = await listScopeConflicts();
  const selectionSet =
    selection && selection.length > 0
      ? new Set(selection.map((entry) => `${entry.employeeId}|${entry.date}`))
      : null;
  const conflicts = selectionSet
    ? allConflicts.filter((conflict) => selectionSet.has(`${conflict.employeeId}|${conflict.date}`))
    : allConflicts;

  const result: ReportConflictsResult = {
    reported: 0,
    skippedNoAccount: 0,
    alreadyReported: 0,
    total: conflicts.length,
  };
  if (conflicts.length === 0) return result;

  // Benutzerkonten der betroffenen Mitarbeiter (Meldung an sie selbst).
  const employeeIds = [...new Set(conflicts.map((conflict) => conflict.employeeId))];
  const employees = await db.employee.findMany({
    where: { id: { in: employeeIds }, organizationId: ctx.organization.id },
    select: { id: true, userId: true },
  });
  const userIdByEmployee = new Map(employees.map((employee) => [employee.id, employee.userId]));

  // Disposition (für Abwesenheits-Konflikte, die der Mitarbeiter nicht selbst
  // umplanen kann).
  const plannerUserIds = await getPlannerUserIds(ctx.organization.id);
  const dedupSince = new Date(Date.now() - REPORT_DEDUP_HOURS * 60 * 60 * 1000);

  for (const conflict of conflicts) {
    const firstAppointmentId = conflict.appointments[0]?.id;
    if (!firstAppointmentId) continue;
    const targetUrl = `/calendar?termin=${firstAppointmentId}`;

    const employeeUserId = userIdByEmployee.get(conflict.employeeId) ?? null;
    // Empfänger: der betroffene Mitarbeiter; bei Abwesenheit zusätzlich die
    // Disposition. Der auslösende Nutzer erhält nie eine Meldung an sich selbst.
    const recipientIds = new Set<string>();
    if (employeeUserId && employeeUserId !== ctx.user.id) recipientIds.add(employeeUserId);
    if (conflict.kind === 'ABSENCE') {
      for (const planner of plannerUserIds) {
        if (planner !== ctx.user.id) recipientIds.add(planner);
      }
    }

    if (recipientIds.size === 0) {
      // Kein erreichbarer Empfänger (kein Konto und keine passende Disposition).
      if (!employeeUserId) result.skippedNoAccount += 1;
      continue;
    }

    // Duplikatschutz je Empfänger: wer dieselbe Gruppe (gleicher Ziel-Link)
    // kürzlich schon gemeldet bekam, wird übersprungen. So entstehen weder
    // Duplikate noch fehlt eine Meldung, wenn nur ein Teil kürzlich informiert war.
    const recent = await db.notification.findMany({
      where: {
        organizationId: ctx.organization.id,
        userId: { in: [...recipientIds] },
        type: 'APPOINTMENT_CONFLICT',
        targetUrl,
        createdAt: { gte: dedupSince },
      },
      select: { userId: true },
    });
    const alreadyNotified = new Set(recent.map((row) => row.userId));
    const freshRecipients = [...recipientIds].filter((id) => !alreadyNotified.has(id));
    if (freshRecipients.length === 0) {
      result.alreadyReported += 1;
      continue;
    }

    const kindLabel =
      conflict.kind === 'OVERLAP' ? 'Terminüberschneidung' : 'Termin während Abwesenheit';
    const first = conflict.appointments[0]!;
    const extra =
      conflict.appointments.length > 1 ? ` (+${conflict.appointments.length - 1})` : '';
    const message = `${kindLabel} am ${conflict.dateLabel}: ${first.customerName}, ${first.timeLabel}${extra}`;

    await createNotificationsForUsers(freshRecipients, {
      organizationId: ctx.organization.id,
      type: 'APPOINTMENT_CONFLICT',
      title: 'Terminkonflikt – bitte prüfen',
      message,
      targetUrl,
    });

    await writeAuditLog({
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: 'conflict.reported',
      entityType: 'Appointment',
      entityId: firstAppointmentId,
      metadata: {
        employeeId: conflict.employeeId,
        kind: conflict.kind,
        date: conflict.date,
        appointmentIds: conflict.appointments.map((appointment) => appointment.id),
        recipients: recipientIds.size,
      },
    });

    result.reported += 1;
  }

  return result;
}
