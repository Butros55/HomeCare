import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  calendarDayInZone,
  dayPeriodInZone,
  fromDateInputValue,
  isoWeekdayInZone,
  minutesOfDayInZone,
  zonedWallTimeToUtc,
} from '@/lib/dates';
import { computeRouteEarnings } from '@/lib/earnings';
import { haversineMeters } from '@/lib/geo';
import { plannableMinutesAt } from '@/lib/hour-account';
import {
  buildDayVariants,
  type DayPlanCandidate,
  type DayVariantObjective,
} from '@/lib/day-route-planner';
import type { Matrix, RouteStopInput } from '@/lib/route-optimizer';
import {
  candidateWindows,
  intersectWindows,
  minutesToTime,
  planRouteWithAutoDeparture,
  slotsToWindows,
  suggestionDurationMinutes,
  type MinuteWindow,
} from '@/lib/route-suggestions';
import { writeAuditLog } from '@/server/audit';
import { db } from '@/server/db';
import { AppError } from '@/server/errors';
import {
  assertSameOrg,
  getManagedEmployeeIds,
  hasPermission,
  requireOrganizationMembership,
  scopeContains,
} from '@/server/permissions';
import { computeRouteMatrixCached } from '@/server/providers/routing';
import { ensureRecurringTopupsMaterialized } from '@/server/services/account-service';
import { createNotification } from '@/server/services/notification-service';
import {
  loadCustomersWithAnyAvailability,
  loadOpenDemand,
  type DemandCandidate,
} from '@/server/services/route-suggestion-service';
import {
  resolveRouteOrigin,
  type GpsCoordinate,
  type RouteOriginType,
} from '@/server/services/route-service';

/**
 * Tagesrouten-Generator (Anforderung 17, Aufbau auf den Einzel-Vorschlägen).
 *
 * `generateDayRoutes` baut aus festen Terminen (bleiben fix), flexiblen Terminen
 * (werden umgeplant) und offenem Kundenbedarf eine KOMPLETTE Tagesroute – in
 * mehreren Varianten (wenig Fahrt / volle Auslastung / früh zu Hause). Optionale
 * Vorgaben (Zielstunden, Abfahrt, späteste Rückkehr) schränken die Auswahl ein.
 *
 * `acceptDayRoute` übernimmt eine gewählte Variante: die neuen Kundeneinsätze
 * werden – nach vollständiger Re-Validierung in einer serialisierbaren
 * Transaktion – als Termine angelegt und der Routenplan gespeichert.
 */

// ---------------------------------------------------------------------------
// Signierte Annahme-Tokens (eine komplette Route je Token)
// ---------------------------------------------------------------------------

const DAY_TOKEN_TTL_MS = 15 * 60 * 1000;
/** Suchbereich, wenn weder Kunde noch Mitarbeiter Zeitfenster gepflegt haben. */
const DEFAULT_PLANNING_WINDOW: MinuteWindow = { startMinute: 6 * 60, endMinute: 22 * 60 };
const MAX_CANDIDATES = 14;

interface DayRouteVisit {
  cust: string;
  start: string; // ISO
  dur: number; // Minuten
  lat: number;
  lng: number;
}

interface DayRouteTokenPayload {
  v: 1;
  org: string;
  emp: string;
  date: string; // YYYY-MM-DD
  originType: RouteOriginType;
  oLat: number;
  oLng: number;
  oLabel: string;
  buffer: number;
  ret: boolean;
  /** Frühestmögliche Abfahrt (Wandzeit-Minuten) – für die identische Re-Planung. */
  earlyMin: number | null;
  /** Neue Kundeneinsätze dieser Variante (bestehende Termine kommen frisch aus der DB). */
  visits: DayRouteVisit[];
  exp: number;
}

function tokenSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new AppError('INTERNAL_ERROR', { message: 'AUTH_SECRET fehlt.' });
  return secret;
}

function signPayload(encoded: string): string {
  return createHmac('sha256', tokenSecret()).update(encoded).digest('base64url');
}

function createDayRouteToken(payload: DayRouteTokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${signPayload(encoded)}`;
}

function verifyDayRouteToken(token: string): DayRouteTokenPayload {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) throw new AppError('SUGGESTION_STALE');
  const expected = signPayload(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AppError('SUGGESTION_STALE');
  let payload: DayRouteTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new AppError('SUGGESTION_STALE');
  }
  if (payload.v !== 1 || typeof payload.exp !== 'number' || payload.exp < Date.now()) {
    throw new AppError('SUGGESTION_STALE');
  }
  return payload;
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface DayRouteStopDto {
  kind: 'existing' | 'new';
  customerName: string;
  customerColor: string;
  addressLine: string | null;
  latitude: number;
  longitude: number;
  sequence: number;
  serviceStartAt: string;
  serviceEndAt: string;
  isFlexible: boolean;
}

export interface DayRouteEarningsDto {
  wageCents: number;
  mileageCents: number;
  totalCents: number;
}

export interface DayRouteVariantDto {
  token: string;
  objective: DayVariantObjective;
  label: string;
  feasible: boolean;
  warnings: string[];
  departureAt: string;
  returnArrivalAt: string | null;
  totalTravelSeconds: number;
  totalDistanceMeters: number;
  totalServiceMinutes: number;
  totalWaitSeconds: number;
  workdaySeconds: number;
  /** Neue Kundeneinsätze (werden bei Annahme angelegt). */
  newVisitCount: number;
  /** Bereits bestehende Termine, die eingeplant bleiben. */
  keptCount: number;
  earnings: DayRouteEarningsDto | null;
  stops: DayRouteStopDto[];
}

export interface GenerateDayRoutesResult {
  origin: { latitude: number; longitude: number; label: string };
  originType: RouteOriginType;
  variants: DayRouteVariantDto[];
  /** Wie viele offene Kunden für den Tag überhaupt in Frage kamen. */
  candidateCount: number;
  /** Bestehende (bereits zugewiesene) Termine des Tages. */
  baseCount: number;
  message: string | null;
}

export interface GenerateDayRoutesInput {
  employeeId: string;
  date: string;
  originType?: RouteOriginType;
  gps?: GpsCoordinate;
  bufferMinutes: number;
  returnToStart: boolean;
  /** Zielarbeitszeit (Kundenzeit) in Minuten für den Tag. */
  targetWorkMinutes?: number | null;
  /** Frühestmögliche Abfahrt (Wandzeit-Minuten seit Mitternacht). */
  earliestDepartureMinute?: number | null;
  /** Späteste Rückkehr (Wandzeit-Minuten seit Mitternacht). */
  latestReturnMinute?: number | null;
}

const OBJECTIVE_LABELS: Record<DayVariantObjective, string> = {
  compact: 'Wenig Fahrt',
  full: 'Volle Auslastung',
  early: 'Früh zu Hause',
};

// ---------------------------------------------------------------------------
// Generieren
// ---------------------------------------------------------------------------

export async function generateDayRoutes(
  input: GenerateDayRoutesInput,
): Promise<GenerateDayRoutesResult> {
  const ctx = await requireOrganizationMembership();
  const isOwn = ctx.employee?.id === input.employeeId;
  if (!hasPermission(ctx, 'routes.manage') && !isOwn) throw new AppError('ACCESS_DENIED');

  const date = fromDateInputValue(input.date);
  if (!date) throw new AppError('VALIDATION_FAILED', { message: 'Ungültiges Datum.' });

  const employee = await db.employee.findUnique({ where: { id: input.employeeId } });
  assertSameOrg(ctx, employee);
  if (employee.status !== 'ACTIVE' || employee.deletedAt) {
    throw new AppError('EMPLOYEE_NOT_FOUND', { message: 'Mitarbeiter nicht verfügbar.' });
  }

  const timezone = ctx.organization.timezone;
  const day = dayPeriodInZone(date, timezone);
  const weekday = isoWeekdayInZone(day.start, timezone);
  const dayParts = calendarDayInZone(day.start, timezone);
  const minuteToUtc = (minute: number): Date =>
    zonedWallTimeToUtc(dayParts.year, dayParts.month, dayParts.day, minutesToTime(minute), timezone);
  const timeFormatter = new Intl.DateTimeFormat('de-DE', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  });
  const formatTime = (value: Date) => timeFormatter.format(value);

  const originType = input.originType ?? 'office';
  const origin = resolveRouteOrigin(ctx, employee, originType, input.gps);

  // ---- Bestehende Termine des Tages (Basisroute) --------------------------
  const dayAppointments = await db.appointment.findMany({
    where: {
      organizationId: ctx.organization.id,
      deletedAt: null,
      assignedEmployeeId: employee.id,
      routeRelevant: true,
      status: { in: ['PLANNED', 'CONFIRMED', 'IN_PROGRESS'] },
      startAt: { gte: day.start, lt: day.end },
    },
    include: {
      locationAddress: true,
      customer: { select: { firstName: true, lastName: true, color: true } },
    },
    orderBy: { startAt: 'asc' },
  });
  const routable = dayAppointments.filter(
    (a) => a.locationAddress?.latitude != null && a.locationAddress?.longitude != null,
  );
  const baseStops: RouteStopInput[] = routable.map((appointment) => ({
    id: appointment.id,
    latitude: appointment.locationAddress!.latitude!,
    longitude: appointment.locationAddress!.longitude!,
    serviceMinutes: appointment.durationMinutes,
    fixedStartAt: appointment.isFlexible ? null : appointment.startAt,
    earliestStartAt: appointment.isFlexible
      ? (appointment.earliestStartAt ?? appointment.startAt)
      : null,
    latestEndAt: appointment.isFlexible ? appointment.latestEndAt : null,
  }));
  const baseServiceMinutes = dayAppointments.reduce((sum, a) => sum + a.durationMinutes, 0);
  const baseInfo = new Map(
    routable.map((a) => [
      a.id,
      {
        customerName: `${a.customer.firstName} ${a.customer.lastName}`,
        customerColor: a.customer.color,
        addressLine: a.locationAddress
          ? `${a.locationAddress.street} ${a.locationAddress.houseNumber}, ${a.locationAddress.postalCode} ${a.locationAddress.city}`
          : null,
        latitude: a.locationAddress!.latitude!,
        longitude: a.locationAddress!.longitude!,
        isFlexible: a.isFlexible,
      },
    ]),
  );

  // ---- Abwesenheiten + Verfügbarkeiten des Mitarbeiters -------------------
  const [absences, availabilityRows] = await Promise.all([
    db.employeeAbsence.findMany({
      where: {
        employeeId: employee.id,
        status: 'APPROVED',
        startAt: { lt: day.end },
        endAt: { gt: day.start },
      },
      select: { startAt: true, endAt: true },
    }),
    db.employeeAvailability.findMany({
      where: {
        employeeId: employee.id,
        weekday,
        validFrom: { lt: day.end },
        OR: [{ validUntil: null }, { validUntil: { gte: day.start } }],
      },
      select: { weekday: true, startTime: true, endTime: true },
    }),
  ]);
  const blockedWindows: MinuteWindow[] = absences.map((absence) => ({
    startMinute: absence.startAt <= day.start ? 0 : minutesOfDayInZone(absence.startAt, timezone),
    endMinute: absence.endAt >= day.end ? 24 * 60 : minutesOfDayInZone(absence.endAt, timezone),
  }));
  const fullDayAbsent = blockedWindows.some((w) => w.startMinute <= 0 && w.endMinute >= 24 * 60);

  // ---- Offener Kundenbedarf → Kandidaten ----------------------------------
  const demand = fullDayAbsent ? [] : await loadOpenDemand(ctx, date);
  const customersWithAvailability = await loadCustomersWithAnyAvailability(
    demand.map((d) => d.customerId),
  );

  interface CandidateEntry {
    demand: DemandCandidate;
    duration: number;
    windows: MinuteWindow[];
    distance: number;
  }
  const filtered: CandidateEntry[] = demand
    .filter((candidate) => {
      if (candidate.preferredEmployeeId && candidate.preferredEmployeeId !== employee.id) {
        return false;
      }
      if (
        customersWithAvailability.has(candidate.customerId) &&
        candidate.availabilitySlots.length === 0
      ) {
        return false;
      }
      return true;
    })
    .map((candidate): CandidateEntry | null => {
      const rawWindows = candidateWindows({
        customerSlots: candidate.availabilitySlots,
        employeeSlots: availabilityRows,
        blockedWindows,
      });
      const unconstrained =
        candidate.availabilitySlots.length === 0 && availabilityRows.length === 0;
      const windows = unconstrained
        ? intersectWindows(rawWindows, [DEFAULT_PLANNING_WINDOW])
        : rawWindows;
      const duration = suggestionDurationMinutes({
        defaultDurationMinutes: candidate.defaultDurationMinutes,
        openMinutes: candidate.openMinutes,
        windows,
      });
      if (duration === null || windows.length === 0) return null;
      if (
        employee.maximumMinutesPerDay &&
        baseServiceMinutes + duration > employee.maximumMinutesPerDay
      ) {
        return null;
      }
      const distance = Math.min(
        haversineMeters(
          { latitude: origin.latitude, longitude: origin.longitude },
          { latitude: candidate.latitude, longitude: candidate.longitude },
        ),
        ...baseStops.map((s) =>
          haversineMeters(
            { latitude: s.latitude, longitude: s.longitude },
            { latitude: candidate.latitude, longitude: candidate.longitude },
          ),
        ),
      );
      return { demand: candidate, duration, windows, distance };
    })
    .filter((entry): entry is CandidateEntry => entry !== null)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_CANDIDATES);

  // Zuweisungen für die Priorisierung (Wunschmitarbeiter kommt aus der Demand).
  const allocations = filtered.length
    ? await db.hourAllocation.findMany({
        where: {
          organizationId: ctx.organization.id,
          allocatedToEmployeeId: employee.id,
          status: 'ACTIVE',
          customerId: { in: filtered.map((entry) => entry.demand.customerId) },
          validFrom: { lt: day.end },
          validUntil: { gte: day.start },
        },
        select: { customerId: true },
      })
    : [];
  const allocatedCustomerIds = new Set(allocations.map((a) => a.customerId));

  // Kandidaten in die reine Planer-Form bringen (breitestes Fenster als UTC).
  const candidateById = new Map<string, CandidateEntry>();
  const planCandidates: DayPlanCandidate[] = filtered.map((entry) => {
    const id = `cust:${entry.demand.customerId}`;
    candidateById.set(id, entry);
    const widest = entry.windows.reduce((best, w) =>
      w.endMinute - w.startMinute > best.endMinute - best.startMinute ? w : best,
    );
    return {
      id,
      latitude: entry.demand.latitude,
      longitude: entry.demand.longitude,
      serviceMinutes: entry.duration,
      earliestStartAt: minuteToUtc(widest.startMinute),
      latestEndAt: minuteToUtc(widest.endMinute),
      isPreferred: entry.demand.preferredEmployeeId === employee.id,
      hasAllocation: allocatedCustomerIds.has(entry.demand.customerId),
    };
  });

  if (baseStops.length === 0 && planCandidates.length === 0) {
    return {
      origin,
      originType,
      variants: [],
      candidateCount: 0,
      baseCount: dayAppointments.length,
      message: fullDayAbsent
        ? 'Für diesen Tag ist eine ganztägige Abwesenheit eingetragen.'
        : 'Keine offenen Kundenstunden und keine bestehenden Termine für diesen Tag.',
    };
  }

  // ---- Fahrzeitmatrix (ein Aufruf) ----------------------------------------
  const points = [
    { latitude: origin.latitude, longitude: origin.longitude },
    ...baseStops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
    ...planCandidates.map((c) => ({ latitude: c.latitude, longitude: c.longitude })),
    { latitude: origin.latitude, longitude: origin.longitude },
  ];
  const legs = await computeRouteMatrixCached(points);
  const fullMatrix: Matrix = {
    travelSeconds: legs.map((row) => row.map((leg) => leg.travelSeconds)),
    distanceMeters: legs.map((row) => row.map((leg) => leg.distanceMeters)),
  };

  const earliestDepartureAt =
    input.earliestDepartureMinute != null ? minuteToUtc(input.earliestDepartureMinute) : day.start;
  const latestReturnAt =
    input.latestReturnMinute != null ? minuteToUtc(input.latestReturnMinute) : null;

  const variants = buildDayVariants({
    baseStops,
    candidates: planCandidates,
    fullMatrix,
    options: {
      bufferMinutes: input.bufferMinutes,
      returnToEnd: input.returnToStart,
      earliestDepartureAt,
      latestReturnAt,
      targetWorkMinutes: input.targetWorkMinutes ?? null,
      maxTotalServiceMinutes: employee.maximumMinutesPerDay ?? null,
      formatTime,
    },
  });

  // ---- Verdienst-Kennzahl (nur eigene Route + hinterlegter Stundenlohn;
  // Kilometergeld zählt ausschließlich für eigene Fahrten) ------------------
  const wageCents = isOwn ? ctx.membership.hourlyWageCents : 0;
  // `?? 0`: robust, falls der (Dev-)Prisma-Client das Feld noch nicht kennt.
  const mileageRatePerKmCents = isOwn ? (ctx.membership.mileageRatePerKmCents ?? 0) : 0;
  const showEarnings = isOwn && wageCents > 0;

  const dtoVariants: DayRouteVariantDto[] = variants
    .filter((variant) => variant.route.stops.length > 0)
    .map((variant) => {
      const route = variant.route;
      const stops: DayRouteStopDto[] = route.stops.map((stop) => {
        if (stop.id.startsWith('cust:')) {
          const entry = candidateById.get(stop.id)!;
          return {
            kind: 'new',
            customerName: entry.demand.customerName,
            customerColor: entry.demand.customerColor,
            addressLine: entry.demand.addressLine,
            latitude: entry.demand.latitude,
            longitude: entry.demand.longitude,
            sequence: stop.sequence,
            serviceStartAt: stop.serviceStartAt.toISOString(),
            serviceEndAt: stop.serviceEndAt.toISOString(),
            isFlexible: true,
          };
        }
        const info = baseInfo.get(stop.id)!;
        return {
          kind: 'existing',
          customerName: info.customerName,
          customerColor: info.customerColor,
          addressLine: info.addressLine,
          latitude: info.latitude,
          longitude: info.longitude,
          sequence: stop.sequence,
          serviceStartAt: stop.serviceStartAt.toISOString(),
          serviceEndAt: stop.serviceEndAt.toISOString(),
          isFlexible: info.isFlexible,
        };
      });

      const visits: DayRouteVisit[] = variant.selectedCandidateIds.map((id) => {
        const entry = candidateById.get(id)!;
        const scheduled = route.stops.find((s) => s.id === id)!;
        return {
          cust: entry.demand.customerId,
          start: scheduled.serviceStartAt.toISOString(),
          dur: entry.duration,
          lat: entry.demand.latitude,
          lng: entry.demand.longitude,
        };
      });

      const token = createDayRouteToken({
        v: 1,
        org: ctx.organization.id,
        emp: employee.id,
        date: input.date,
        originType,
        oLat: origin.latitude,
        oLng: origin.longitude,
        oLabel: origin.label,
        buffer: input.bufferMinutes,
        ret: input.returnToStart,
        earlyMin: input.earliestDepartureMinute ?? null,
        visits,
        exp: Date.now() + DAY_TOKEN_TTL_MS,
      });

      const earnings = showEarnings
        ? computeRouteEarnings({
            serviceMinutes: route.totalServiceMinutes,
            distanceMeters: route.totalDistanceMeters,
            hourlyWageCents: wageCents,
            mileageRatePerKmCents,
          })
        : null;

      return {
        token,
        objective: variant.objective,
        label: OBJECTIVE_LABELS[variant.objective],
        feasible: route.feasible,
        warnings: route.warnings,
        departureAt: route.latestDepartureAt.toISOString(),
        returnArrivalAt: route.returnArrivalAt?.toISOString() ?? null,
        totalTravelSeconds: route.totalTravelSeconds,
        totalDistanceMeters: route.totalDistanceMeters,
        totalServiceMinutes: route.totalServiceMinutes,
        totalWaitSeconds: route.totalWaitSeconds,
        workdaySeconds: route.workdaySeconds,
        newVisitCount: visits.length,
        keptCount: stops.length - visits.length,
        earnings,
        stops,
      };
    });

  return {
    origin,
    originType,
    variants: dtoVariants,
    candidateCount: planCandidates.length,
    baseCount: dayAppointments.length,
    message:
      dtoVariants.length === 0
        ? 'Es ließ sich keine zulässige Route bilden – bitte Vorgaben lockern.'
        : null,
  };
}

// ---------------------------------------------------------------------------
// Annehmen
// ---------------------------------------------------------------------------

export interface AcceptDayRouteResult {
  routePlanId: string;
  appointmentIds: string[];
}

export async function acceptDayRoute(input: {
  token: string;
  publish: boolean;
}): Promise<AcceptDayRouteResult> {
  const ctx = await requireOrganizationMembership();
  const payload = verifyDayRouteToken(input.token);

  if (payload.org !== ctx.organization.id) throw new AppError('SUGGESTION_STALE');
  if (ctx.membership.role === 'EMPLOYEE') {
    throw new AppError('ACCESS_DENIED', {
      message: 'Generierte Routen kann nur die Leitung übernehmen.',
    });
  }
  const scope = await getManagedEmployeeIds(ctx);
  if (!scopeContains(scope, payload.emp)) {
    throw new AppError('ACCESS_DENIED', {
      message: 'Der Mitarbeiter liegt außerhalb deines Verwaltungsbereichs.',
    });
  }

  const date = fromDateInputValue(payload.date);
  if (!date) throw new AppError('SUGGESTION_STALE');
  const timezone = ctx.organization.timezone;
  const day = dayPeriodInZone(date, timezone);
  const weekday = isoWeekdayInZone(day.start, timezone);

  const employee = await db.employee.findUnique({ where: { id: payload.emp } });
  assertSameOrg(ctx, employee);
  if (employee.status !== 'ACTIVE' || employee.deletedAt) throw new AppError('SUGGESTION_STALE');

  await ensureRecurringTopupsMaterialized(ctx.organization.id, timezone);

  // ---- Neue Einsätze normalisieren + Kunden laden -------------------------
  const visits = payload.visits.map((visit) => {
    const startAt = new Date(visit.start);
    return { ...visit, startAt, endAt: new Date(startAt.getTime() + visit.dur * 60_000) };
  });
  for (const visit of visits) {
    if (Number.isNaN(visit.startAt.getTime()) || visit.startAt < day.start || visit.endAt > day.end) {
      throw new AppError('SUGGESTION_STALE');
    }
  }
  const customers = visits.length
    ? await db.customer.findMany({
        where: { id: { in: visits.map((v) => v.cust) }, organizationId: ctx.organization.id },
        include: { addresses: { take: 1, orderBy: { label: 'asc' } }, availabilities: true },
      })
    : [];
  const customerById = new Map(customers.map((c) => [c.id, c]));
  for (const visit of visits) {
    const customer = customerById.get(visit.cust);
    if (!customer || customer.status !== 'ACTIVE' || customer.deletedAt) {
      throw new AppError('SUGGESTION_STALE');
    }
    const address = customer.addresses[0];
    if (!address || address.latitude == null || address.longitude == null) {
      throw new AppError('SUGGESTION_STALE');
    }
  }

  // ---- Bestehende Termine + Routenschema (Matrix vor der Transaktion) ------
  const baseAppointments = await db.appointment.findMany({
    where: {
      organizationId: ctx.organization.id,
      deletedAt: null,
      assignedEmployeeId: payload.emp,
      routeRelevant: true,
      status: { in: ['PLANNED', 'CONFIRMED', 'IN_PROGRESS'] },
      startAt: { gte: day.start, lt: day.end },
    },
    include: { locationAddress: true },
    orderBy: { startAt: 'asc' },
  });
  const routable = baseAppointments.filter(
    (a) => a.locationAddress?.latitude != null && a.locationAddress?.longitude != null,
  );
  const baseStops: RouteStopInput[] = routable.map((appointment) => ({
    id: appointment.id,
    latitude: appointment.locationAddress!.latitude!,
    longitude: appointment.locationAddress!.longitude!,
    serviceMinutes: appointment.durationMinutes,
    fixedStartAt: appointment.isFlexible ? null : appointment.startAt,
    earliestStartAt: appointment.isFlexible
      ? (appointment.earliestStartAt ?? appointment.startAt)
      : null,
    latestEndAt: appointment.isFlexible ? appointment.latestEndAt : null,
  }));
  const visitStops: RouteStopInput[] = visits.map((visit) => ({
    id: `cust:${visit.cust}`,
    latitude: visit.lat,
    longitude: visit.lng,
    serviceMinutes: visit.dur,
    // Angenommene Einsätze werden zeitlich fixiert – die Route bleibt wie gezeigt.
    fixedStartAt: visit.startAt,
  }));
  if (baseStops.length === 0 && visitStops.length === 0) throw new AppError('SUGGESTION_STALE');

  const points = [
    { latitude: payload.oLat, longitude: payload.oLng },
    ...baseStops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
    ...visitStops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
    { latitude: payload.oLat, longitude: payload.oLng },
  ];
  const legs = await computeRouteMatrixCached(points);
  const matrix: Matrix = {
    travelSeconds: legs.map((row) => row.map((leg) => leg.travelSeconds)),
    distanceMeters: legs.map((row) => row.map((leg) => leg.distanceMeters)),
  };
  const dayParts = calendarDayInZone(day.start, timezone);
  const timeFormatter = new Intl.DateTimeFormat('de-DE', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  });
  const earliestDepartureAt =
    payload.earlyMin != null
      ? zonedWallTimeToUtc(
          dayParts.year,
          dayParts.month,
          dayParts.day,
          minutesToTime(payload.earlyMin),
          timezone,
        )
      : day.start;
  const planned = planRouteWithAutoDeparture({
    stops: [...baseStops, ...visitStops],
    matrix,
    bufferMinutes: payload.buffer,
    returnToEnd: payload.ret,
    earliestDepartureAt,
    formatTime: (value) => timeFormatter.format(value),
  });
  if (!planned.feasible) {
    throw new AppError('SUGGESTION_STALE', {
      message: 'Die Route ist nicht mehr zulässig – bitte neu generieren.',
    });
  }

  // ---- Serialisierbare Transaktion: prüfen, anlegen, speichern ------------
  const result = await db.$transaction(
    async (tx) => {
      // Tageshöchstarbeitszeit einmal prüfen (Basislast + alle neuen Einsätze).
      if (employee.maximumMinutesPerDay) {
        const dayLoad = await tx.appointment.aggregate({
          where: {
            organizationId: ctx.organization.id,
            deletedAt: null,
            assignedEmployeeId: payload.emp,
            status: { in: ['DRAFT', 'PLANNED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] },
            startAt: { gte: day.start, lt: day.end },
          },
          _sum: { durationMinutes: true },
        });
        const total =
          (dayLoad._sum.durationMinutes ?? 0) + visits.reduce((sum, v) => sum + v.dur, 0);
        if (total > employee.maximumMinutesPerDay) {
          throw new AppError('SUGGESTION_STALE', { message: 'Tageshöchstarbeitszeit überschritten.' });
        }
      }

      const createdByCustomer = new Map<string, string>();
      for (const visit of visits) {
        const customer = customerById.get(visit.cust)!;
        const address = customer.addresses[0]!;
        const startMinute = minutesOfDayInZone(visit.startAt, timezone);
        const endMinute = startMinute + visit.dur;

        // Terminkollision (auch gegen bereits in dieser Schleife angelegte Einsätze).
        const overlapping = await tx.appointment.findFirst({
          where: {
            organizationId: ctx.organization.id,
            deletedAt: null,
            assignedEmployeeId: payload.emp,
            status: { in: ['DRAFT', 'PLANNED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] },
            startAt: { lt: visit.endAt },
            endAt: { gt: visit.startAt },
          },
          select: { id: true },
        });
        if (overlapping) throw new AppError('SUGGESTION_STALE');

        // Kunde hat inzwischen einen Termin am Planungstag.
        const customerDayAppointment = await tx.appointment.findFirst({
          where: {
            customerId: visit.cust,
            deletedAt: null,
            status: { in: ['DRAFT', 'PLANNED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] },
            startAt: { gte: day.start, lt: day.end },
          },
          select: { id: true },
        });
        if (customerDayAppointment) throw new AppError('SUGGESTION_STALE');

        // Abwesenheit.
        const absence = await tx.employeeAbsence.findFirst({
          where: {
            employeeId: payload.emp,
            status: 'APPROVED',
            startAt: { lt: visit.endAt },
            endAt: { gt: visit.startAt },
          },
          select: { id: true },
        });
        if (absence) throw new AppError('SUGGESTION_STALE');

        // Verfügbarkeiten (Mitarbeiter + Kunde).
        const availability = await tx.employeeAvailability.findMany({
          where: {
            employeeId: payload.emp,
            weekday,
            validFrom: { lt: day.end },
            OR: [{ validUntil: null }, { validUntil: { gte: day.start } }],
          },
          select: { startTime: true, endTime: true },
        });
        const withinWindows = (slots: { startTime: string; endTime: string }[]): boolean => {
          if (slots.length === 0) return true;
          return slotsToWindows(slots).some(
            (w) => startMinute >= w.startMinute && endMinute <= w.endMinute,
          );
        };
        if (!withinWindows(availability)) throw new AppError('SUGGESTION_STALE');
        const customerSlots = customer.availabilities.filter((slot) => slot.weekday === weekday);
        if (customer.availabilities.length > 0 && !withinWindows(customerSlots)) {
          throw new AppError('SUGGESTION_STALE');
        }

        // Stundenguthaben (Konto-Modell).
        const [topupRows, grantRows, accountAppointments] = await Promise.all([
          tx.customerHourTopup.findMany({
            where: { customerId: visit.cust },
            select: { minutes: true, effectiveOn: true },
          }),
          tx.customerRecurringHourGrant.findMany({
            where: { customerId: visit.cust, active: true },
          }),
          tx.appointment.findMany({
            where: { customerId: visit.cust, deletedAt: null },
            select: {
              startAt: true,
              durationMinutes: true,
              status: true,
              timeEntries: { where: { status: 'APPROVED' }, select: { workedMinutes: true } },
            },
          }),
        ]);
        const plannable = plannableMinutesAt({
          topups: topupRows,
          grants: grantRows,
          appointments: accountAppointments.map((a) => ({
            durationMinutes: a.durationMinutes,
            status: a.status,
            startAt: a.startAt,
            workedMinutes:
              a.timeEntries.length > 0
                ? a.timeEntries.reduce((sum, t) => sum + t.workedMinutes, 0)
                : null,
          })),
          date,
          reservedBefore: day.end,
        });
        if (plannable < visit.dur) {
          throw new AppError('SUGGESTION_STALE', {
            message: `Das Stundenguthaben von ${customer.firstName} ${customer.lastName} reicht nicht mehr.`,
          });
        }

        const appointment = await tx.appointment.create({
          data: {
            organizationId: ctx.organization.id,
            customerId: visit.cust,
            assignedEmployeeId: payload.emp,
            title: 'Einsatz (Tagesplanung)',
            startAt: visit.startAt,
            endAt: visit.endAt,
            durationMinutes: visit.dur,
            status: 'PLANNED',
            assignmentStatus: 'ASSIGNED',
            locationAddressId: address.id,
            routeRelevant: true,
            internalNotes: 'Automatisch aus der Tagesplanung übernommen.',
          },
        });
        createdByCustomer.set(visit.cust, appointment.id);
      }

      await tx.routePlan.deleteMany({ where: { employeeId: payload.emp, routeDate: date } });
      const routePlan = await tx.routePlan.create({
        data: {
          organizationId: ctx.organization.id,
          employeeId: payload.emp,
          routeDate: date,
          startAddress: { latitude: payload.oLat, longitude: payload.oLng, label: payload.oLabel },
          endAddress: { latitude: payload.oLat, longitude: payload.oLng, label: payload.oLabel },
          originType: payload.originType,
          bufferMinutes: payload.buffer,
          returnToStart: payload.ret,
          provider: 'day-generator',
          totalDistanceMeters: planned.totalDistanceMeters,
          totalTravelSeconds: planned.totalTravelSeconds,
          totalServiceMinutes: planned.totalServiceMinutes,
          totalWaitSeconds: planned.totalWaitSeconds,
          plannedDepartureAt: planned.latestDepartureAt,
          plannedReturnAt: planned.returnArrivalAt,
          status: input.publish ? 'PUBLISHED' : 'DRAFT',
        },
      });
      for (const stop of planned.stops) {
        const appointmentId = stop.id.startsWith('cust:')
          ? createdByCustomer.get(stop.id.slice('cust:'.length))!
          : stop.id;
        await tx.routeStop.create({
          data: {
            routePlanId: routePlan.id,
            appointmentId,
            sequence: stop.sequence,
            arrivalAt: stop.arrivalAt,
            serviceStartAt: stop.serviceStartAt,
            serviceEndAt: stop.serviceEndAt,
            departureAt: stop.serviceEndAt,
            travelSecondsFromPrevious: stop.travelSecondsFromPrevious,
            distanceMetersFromPrevious: stop.distanceMetersFromPrevious,
            warning: stop.warning,
          },
        });
      }

      await writeAuditLog(
        {
          organizationId: ctx.organization.id,
          actorUserId: ctx.user.id,
          action: input.publish ? 'route.dayPublished' : 'route.dayGenerated',
          entityType: 'RoutePlan',
          entityId: routePlan.id,
          metadata: {
            employeeId: payload.emp,
            date: payload.date,
            newVisits: visits.length,
            stops: planned.stops.length,
          },
        },
        tx,
      );

      return {
        routePlanId: routePlan.id,
        appointmentIds: [...createdByCustomer.values()],
      };
    },
    { isolationLevel: 'Serializable' },
  );

  if (input.publish && employee.userId && employee.userId !== ctx.user.id) {
    await createNotification({
      organizationId: ctx.organization.id,
      userId: employee.userId,
      type: 'ROUTE_PROBLEM',
      title: 'Tagesroute freigegeben',
      message: `Deine automatisch geplante Route für ${new Intl.DateTimeFormat('de-DE', { timeZone: timezone }).format(date)} mit ${planned.stops.length} Stopps ist verfügbar.`,
      targetUrl: `/routes?mitarbeiter=${payload.emp}&datum=${payload.date}`,
    });
  }

  return result;
}
