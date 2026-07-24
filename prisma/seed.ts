/**
 * Seed-Daten: zwei realistische Demo-Organisationen plus eine Fremd-Organisation
 * für Mandantentrennungs-Tests.
 *
 *  1. „Blitzblank Hauswirtschaft GmbH" – LEITUNG: Team mit Hierarchie, mehreren
 *     Konten, Zuweisungen und ~1,5 Jahren Historie (Osnabrück/Münster).
 *  2. „Klarputz – Ariane Vogt" – ALLEIN (soloMode): eine Person organisiert nur
 *     sich selbst, ebenfalls mit langer Historie. So lassen sich beide UI-Modi
 *     (Verwaltung vs. „Mein Tag") mit echten Daten erleben.
 *
 * Nur für Entwicklung/Tests gedacht – der Seed leert zuerst alle Tabellen!
 * Demo-Zugangsdaten: siehe README.md (Abschnitt „Demo-Benutzer").
 *
 * Termine werden relativ zu „heute" erzeugt, damit Dashboard, Kalender und
 * Routenplanung immer aktuelle Daten zeigen. Der Zeitraum (Historie/Zukunft)
 * ist über HISTORY_MONTHS/FUTURE_WEEKS einstellbar – für „x Jahre" einfach
 * HISTORY_MONTHS erhöhen. Wandzeiten sind Europe/Berlin.
 */
import { hash } from '@node-rs/argon2';
import { Prisma, PrismaClient } from '@prisma/client';
import { addDays } from 'date-fns';

import { zonedWallTimeToUtc } from '../src/lib/dates';

const db = new PrismaClient();

const TZ = 'Europe/Berlin';
const DEMO_PASSWORD = 'Demo1234!';

/** Wie viel Vergangenheit die Historie abdeckt (Monate). Höher = „mehr Jahre". */
const HISTORY_MONTHS = 18;
/** Wie weit Termine in die Zukunft vorgeplant sind (Wochen). */
const FUTURE_WEEKS = 6;

const HISTORY_START_OFFSET = -Math.round(HISTORY_MONTHS * 30.44);
const FUTURE_END_OFFSET = FUTURE_WEEKS * 7;

/**
 * Kleiner, deterministischer Zufallsgenerator (LCG). Bewusst mit festem Startwert:
 * so ist die Demo bei jedem Seed identisch (stabile Tests/Screenshots), aber
 * dennoch „streuend" (leicht schwankende Ist-Zeiten, Fahrzeiten, Ausfälle).
 */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/** Kalenderdatum (J/M/T) von heute+offset in der Demo-Zeitzone. */
function dayParts(offsetDays: number): { y: number; m: number; d: number; dateUtc: Date } {
  const ref = addDays(new Date(), offsetDays);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ref);
  const [y, m, d] = fmt.split('-').map(Number);
  return { y: y!, m: m!, d: d!, dateUtc: new Date(Date.UTC(y!, m! - 1, d!)) };
}

/** UTC-Zeitpunkt für heute+offset um „HH:mm" (Wandzeit Europe/Berlin). */
function at(offsetDays: number, time: string): Date {
  const { y, m, d } = dayParts(offsetDays);
  return zonedWallTimeToUtc(y, m, d, time, TZ);
}

/** ISO-Wochentag (1=Mo…7=So) von heute+offset. */
function weekdayOf(offsetDays: number): number {
  const { y, m, d } = dayParts(offsetDays);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return ((day + 6) % 7) + 1;
}

/** UTC-Mitternacht des Monatsersten von (aktueller Monat + offsetMonths). */
function firstOfMonthUtc(offsetMonths: number): Date {
  const today = dayParts(0);
  return new Date(Date.UTC(today.y, today.m - 1 + offsetMonths, 1));
}

/** „HH:mm" + Minuten → „HH:mm". */
function addMinutesToTime(time: string, minutes: number): string {
  const total = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + minutes;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

/**
 * Alle Tages-Offsets, an denen ein Serientermin liegt: auf `weekday`, alle
 * `cadenceWeeks` Wochen, im Fenster [startOffset, endOffset].
 */
function occurrenceOffsets(weekday: number, cadenceWeeks: number, startOffset: number, endOffset: number): number[] {
  let off = startOffset;
  while (weekdayOf(off) !== weekday) off += 1;
  const result: number[] = [];
  for (; off <= endOffset; off += cadenceWeeks * 7) result.push(off);
  return result;
}

// ---------------------------------------------------------------------------

async function clearDatabase(): Promise<void> {
  console.info('Seed: Datenbank wird geleert …');
  await db.auditLog.deleteMany();
  await db.notification.deleteMany();
  await db.routeStop.deleteMany();
  await db.routePlan.deleteMany();
  await db.timeEntry.deleteMany();
  await db.appointmentSeriesException.deleteMany();
  await db.appointment.deleteMany();
  await db.appointmentSeries.deleteMany();
  await db.hourAllocation.deleteMany();
  await db.customerHourAdjustment.deleteMany();
  await db.customerHourTopup.deleteMany();
  await db.customerRecurringHourGrant.deleteMany();
  await db.customerHourBudget.deleteMany();
  await db.customerAvailability.deleteMany();
  await db.address.deleteMany();
  await db.customer.deleteMany();
  await db.employeeAbsence.deleteMany();
  await db.employeeAvailability.deleteMany();
  await db.invitation.deleteMany();
  await db.employee.deleteMany();
  await db.organizationMembership.deleteMany();
  await db.passwordResetToken.deleteMany();
  await db.session.deleteMany();
  await db.userPreference.deleteMany();
  await db.handwrittenNote.deleteMany();
  await db.userTourProgress.deleteMany();
  await db.user.deleteMany();
  await db.organization.deleteMany();
}

// ---------------------------------------------------------------------------
// Gemeinsame Bausteine
// ---------------------------------------------------------------------------

const CLEANING_TITLES = [
  'Grundreinigung',
  'Reinigung & Wäsche',
  'Fensterputz',
  'Bad & Küche',
  'Bügeln & Aufräumen',
  'Wohnungsreinigung',
  'Einkauf & Reinigung',
];

interface ScheduledCustomer {
  number: string;
  customerId: string;
  addressId: string;
  employeeId: string;
  /** Serie: Wochentag (1–7), Startzeit, Dauer, Takt (Wochen). null = ohne Serie (nur offene Stunden). */
  series: { weekday: number; startTime: string; durationMinutes: number; cadenceWeeks: number; title: string } | null;
  monthlyGrantMinutes: number;
  grantNote: string;
}

/**
 * Monatliche Gutschrift ≈ Monatsverbrauch der Serie (auf 30 Min. gerundet).
 * Bewusst NICHT aufgerundet: über viele Monate würde sich sonst ein großes
 * Restguthaben anhäufen. So bleibt das „offene" Guthaben realistisch klein
 * (grob ein Monatspaket, das noch nicht verbraucht ist).
 */
function monthlyGrantFor(durationMinutes: number, cadenceWeeks: number): number {
  const monthlyConsumption = (durationMinutes * 4.345) / cadenceWeeks;
  return Math.max(180, Math.round(monthlyConsumption / 30) * 30);
}

/**
 * Erzeugt für eine Organisation die komplette Historie: wiederkehrende
 * Gutschriften + monatliche Topups, Serien, Termine (Vergangenheit abgeschlossen
 * mit Zeiterfassung, Zukunft geplant) und ein paar Beispielrouten.
 */
async function seedHistory(args: {
  orgId: string;
  approverUserId: string;
  createdByUserId: string;
  scheduled: ScheduledCustomer[];
  /** Mitarbeiter, für die heute (und ein paar Tage zuvor) eine Route erzeugt wird. */
  routeFor: { employeeId: string; office: Prisma.InputJsonValue }[];
  rngSeed: number;
}): Promise<{ appointmentsCreated: number; completed: number }> {
  const { orgId, approverUserId, createdByUserId, scheduled } = args;
  const rng = makeRng(args.rngSeed);
  const now = new Date();

  // ---- Stundenkonten: wiederkehrende Regel + monatliche Topups -----------
  // Serienkunden werden über die ganze Historie monatlich aufgeladen (Guthaben
  // ≈ Verbrauch, kleiner Rest). Kunden OHNE Serie (reiner offener Bedarf) hätten
  // sonst 18 Monate ungenutztes Guthaben angehäuft – sie bekommen daher erst ab
  // diesem Monat eine Aufladung (frisches Paket, das noch verplant werden will).
  const topups: Prisma.CustomerHourTopupCreateManyInput[] = [];
  for (const c of scheduled) {
    const startOffset = c.series ? -HISTORY_MONTHS : 0;
    const grant = await db.customerRecurringHourGrant.create({
      data: {
        organizationId: orgId,
        customerId: c.customerId,
        minutes: c.monthlyGrantMinutes,
        intervalUnit: 'MONTH',
        intervalCount: 1,
        startDate: firstOfMonthUtc(startOffset),
        materializedUntil: firstOfMonthUtc(0),
        note: c.grantNote,
        createdByUserId,
      },
    });
    for (let m = startOffset; m <= 0; m += 1) {
      topups.push({
        organizationId: orgId,
        customerId: c.customerId,
        kind: 'RECURRING',
        minutes: c.monthlyGrantMinutes,
        effectiveOn: firstOfMonthUtc(m),
        note: c.grantNote,
        recurringGrantId: grant.id,
      });
    }
  }
  // Ein paar manuelle Korrekturen für Realismus.
  if (scheduled[2]) {
    topups.push({
      organizationId: orgId,
      customerId: scheduled[2].customerId,
      kind: 'CORRECTION',
      minutes: 120,
      effectiveOn: firstOfMonthUtc(-2),
      note: 'Zusätzlicher Bedarf nach Krankenhausaufenthalt',
      createdByUserId,
    });
  }
  await db.customerHourTopup.createMany({ data: topups });

  // ---- Serien + Termine ---------------------------------------------------
  const appointments: Prisma.AppointmentCreateManyInput[] = [];
  for (const c of scheduled) {
    if (!c.series) continue;
    const s = c.series;
    const endTime = addMinutesToTime(s.startTime, s.durationMinutes);
    const anchor = occurrenceOffsets(s.weekday, s.cadenceWeeks, -14, FUTURE_END_OFFSET)[0] ?? 1;

    const series = await db.appointmentSeries.create({
      data: {
        organizationId: orgId,
        customerId: c.customerId,
        defaultEmployeeId: c.employeeId,
        title: s.title,
        recurrenceRule: `FREQ=WEEKLY;INTERVAL=${s.cadenceWeeks};BYDAY=${BYDAY[s.weekday - 1]}`,
        recurrenceTimezone: TZ,
        startDate: dayParts(HISTORY_START_OFFSET).dateUtc,
        defaultStartTime: s.startTime,
        defaultDurationMinutes: s.durationMinutes,
        status: 'ACTIVE',
        materializedUntil: dayParts(FUTURE_END_OFFSET).dateUtc,
      },
    });

    for (const off of occurrenceOffsets(s.weekday, s.cadenceWeeks, HISTORY_START_OFFSET, FUTURE_END_OFFSET)) {
      const startAt = at(off, s.startTime);
      const endAt = at(off, endTime);
      const isPast = startAt.getTime() < now.getTime();

      let status: Prisma.AppointmentCreateManyInput['status'] = 'PLANNED';
      let cancellationReason: string | undefined;
      if (isPast) {
        const roll = rng();
        if (off < -3 && roll < 0.05) status = 'CANCELLED';
        else if (off < -3 && roll < 0.07) status = 'NO_SHOW';
        else status = 'COMPLETED';
        if (status === 'CANCELLED') cancellationReason = 'Kurzfristig vom Kunden abgesagt';
      } else {
        status = off <= 14 ? 'CONFIRMED' : 'PLANNED';
      }

      appointments.push({
        organizationId: orgId,
        customerId: c.customerId,
        seriesId: series.id,
        occurrenceDate: dayParts(off).dateUtc,
        assignedEmployeeId: c.employeeId,
        title: s.title,
        startAt,
        endAt,
        durationMinutes: s.durationMinutes,
        status,
        assignmentStatus: isPast || status === 'CONFIRMED' ? 'ACCEPTED' : 'ASSIGNED',
        locationAddressId: c.addressId,
        completedAt: status === 'COMPLETED' ? endAt : null,
        cancellationReason,
      });
    }
  }

  await db.appointment.createMany({ data: appointments });

  // ---- Zeiterfassung für abgeschlossene Termine --------------------------
  const completed = await db.appointment.findMany({
    where: { organizationId: orgId, status: 'COMPLETED', assignedEmployeeId: { not: null } },
    select: { id: true, startAt: true, endAt: true, durationMinutes: true, assignedEmployeeId: true },
  });
  const timeEntries: Prisma.TimeEntryCreateManyInput[] = completed.map((appt) => {
    // Symmetrische Streuung (Ø 0), damit sich der Verbrauch über die Zeit nicht
    // systematisch vom Guthaben entfernt.
    const workedDelta = Math.round((rng() - 0.5) * 10); // −5 … +5 Min.
    const worked = Math.max(15, appt.durationMinutes + workedDelta);
    const travel = 8 + Math.round(rng() * 18);
    return {
      organizationId: orgId,
      appointmentId: appt.id,
      employeeId: appt.assignedEmployeeId!,
      startedAt: appt.startAt,
      endedAt: appt.endAt,
      workedMinutes: worked,
      breakMinutes: 0,
      travelMinutes: travel,
      status: 'APPROVED',
      approvedByUserId: approverUserId,
      approvedAt: appt.endAt,
    };
  });
  await db.timeEntry.createMany({ data: timeEntries });

  // ---- Beispielrouten (heute) --------------------------------------------
  for (const route of args.routeFor) {
    const todayStops = await db.appointment.findMany({
      where: {
        organizationId: orgId,
        assignedEmployeeId: route.employeeId,
        startAt: { gte: at(0, '00:00'), lt: at(1, '00:00') },
        status: { in: ['CONFIRMED', 'PLANNED', 'COMPLETED', 'IN_PROGRESS'] },
      },
      orderBy: { startAt: 'asc' },
      select: { id: true, startAt: true, endAt: true, durationMinutes: true },
    });
    if (todayStops.length === 0) continue;

    let totalTravel = 0;
    let totalDistance = 0;
    let totalService = 0;
    const plan = await db.routePlan.create({
      data: {
        organizationId: orgId,
        employeeId: route.employeeId,
        routeDate: dayParts(0).dateUtc,
        startAddress: route.office,
        endAddress: route.office,
        originType: 'office',
        provider: 'seed',
        totalDistanceMeters: 0,
        totalTravelSeconds: 0,
        totalServiceMinutes: 0,
        plannedDepartureAt: new Date(todayStops[0]!.startAt.getTime() - 15 * 60 * 1000),
        plannedReturnAt: new Date(todayStops[todayStops.length - 1]!.endAt.getTime() + 12 * 60 * 1000),
        status: 'PUBLISHED',
      },
    });
    let sequence = 1;
    for (const stop of todayStops) {
      const travel = 480 + Math.round(rng() * 720);
      const dist = travel * 8;
      totalTravel += travel;
      totalDistance += dist;
      totalService += stop.durationMinutes;
      await db.routeStop.create({
        data: {
          routePlanId: plan.id,
          appointmentId: stop.id,
          sequence,
          arrivalAt: new Date(stop.startAt.getTime() - 5 * 60 * 1000),
          serviceStartAt: stop.startAt,
          serviceEndAt: stop.endAt,
          departureAt: stop.endAt,
          travelSecondsFromPrevious: travel,
          distanceMetersFromPrevious: dist,
        },
      });
      sequence += 1;
    }
    await db.routePlan.update({
      where: { id: plan.id },
      data: {
        totalDistanceMeters: totalDistance,
        totalTravelSeconds: totalTravel,
        totalServiceMinutes: totalService,
      },
    });
  }

  return { appointmentsCreated: appointments.length, completed: completed.length };
}

// ---------------------------------------------------------------------------
// Organisation 1: LEITUNG (Team, Münster)
// ---------------------------------------------------------------------------

const MUENSTER_OFFICE: Prisma.InputJsonValue = {
  label: 'Büro',
  street: 'Servatiiplatz',
  houseNumber: '9',
  postalCode: '48143',
  city: 'Münster',
  countryCode: 'DE',
  latitude: 51.9602,
  longitude: 7.6335,
};

async function seedLeadershipOrg(passwordHash: string): Promise<void> {
  console.info('Seed: Leitungs-Organisation (Team) …');
  const org = await db.organization.create({
    data: {
      name: 'Blitzblank Hauswirtschaft GmbH',
      slug: 'blitzblank-hauswirtschaft',
      timezone: TZ,
      locale: 'de-DE',
      soloMode: false,
      defaultStartLocation: MUENSTER_OFFICE,
      defaultEndLocation: MUENSTER_OFFICE,
    },
  });

  const createUser = (email: string, firstName: string, lastName: string, phone?: string) =>
    db.user.create({ data: { email, passwordHash, firstName, lastName, phone } });

  const ownerUser = await createUser('owner@demo.example', 'Katrin', 'Sommer', '+49 251 555001');
  const dispatcherUser = await createUser('dispo@demo.example', 'David', 'Krüger', '+49 251 555002');
  const mariaUser = await createUser('maria@demo.example', 'Maria', 'Weber', '+49 251 555003');
  const thomasUser = await createUser('thomas@demo.example', 'Thomas', 'Brandt', '+49 251 555004');
  const annaUser = await createUser('anna@demo.example', 'Anna', 'Berg', '+49 251 555005');

  // Vergütungsprofile: so zeigen Dashboard & Bericht überall echte „Verdienst"-Zahlen.
  await db.organizationMembership.create({
    data: {
      organizationId: org.id,
      userId: ownerUser.id,
      role: 'ORGANIZATION_OWNER',
      status: 'ACTIVE',
      hourlyWageCents: 2800,
      employeeCommissionCentsPerHour: 250,
      taxEmploymentType: 'SELF_EMPLOYED',
      incomeTaxRatePercent: 30,
      taxFreeBonusCentsPerHour: 300,
      taxFreeBonusLabel: 'Werbepauschale',
      mileageRatePerKmCents: 30,
    },
  });
  await db.organizationMembership.create({
    data: { organizationId: org.id, userId: dispatcherUser.id, role: 'DISPATCHER', status: 'ACTIVE', hourlyWageCents: 2200 },
  });
  await db.organizationMembership.create({
    data: {
      organizationId: org.id,
      userId: mariaUser.id,
      role: 'TEAM_MANAGER',
      status: 'ACTIVE',
      hourlyWageCents: 2100,
      employeeCommissionCentsPerHour: 200,
      taxEmploymentType: 'EMPLOYED',
      incomeTaxRatePercent: 22,
      taxFreeBonusCentsPerHour: 250,
      mileageRatePerKmCents: 30,
    },
  });
  await db.organizationMembership.create({
    data: {
      organizationId: org.id,
      userId: thomasUser.id,
      role: 'TEAM_MANAGER',
      status: 'ACTIVE',
      hourlyWageCents: 2000,
      employeeCommissionCentsPerHour: 180,
      taxEmploymentType: 'EMPLOYED',
      incomeTaxRatePercent: 20,
      mileageRatePerKmCents: 30,
    },
  });
  await db.organizationMembership.create({
    data: {
      organizationId: org.id,
      userId: annaUser.id,
      role: 'EMPLOYEE',
      status: 'ACTIVE',
      hourlyWageCents: 1600,
      taxEmploymentType: 'MINIJOB',
      taxFreeBonusCentsPerHour: 200,
      mileageRatePerKmCents: 30,
    },
  });

  // Hierarchie: Katrin ├─ Maria ── Anna ── Lena / └─ Jonas; └─ Thomas ── Erik/Sofia
  const katrin = await db.employee.create({
    data: { organizationId: org.id, userId: ownerUser.id, firstName: 'Katrin', lastName: 'Sommer', email: 'owner@demo.example', phone: '+49 251 555001', employmentType: 'FULL_TIME', canRecruitEmployees: true, canReceiveHours: true, targetMinutesPerWeek: 600 },
  });
  const maria = await db.employee.create({
    data: { organizationId: org.id, userId: mariaUser.id, managerEmployeeId: katrin.id, personnelNumber: 'MA-001', firstName: 'Maria', lastName: 'Weber', email: 'maria@demo.example', phone: '+49 251 555003', employmentType: 'FULL_TIME', canRecruitEmployees: true, canReceiveHours: true, targetMinutesPerWeek: 1800, maximumMinutesPerDay: 480 },
  });
  const thomas = await db.employee.create({
    data: { organizationId: org.id, userId: thomasUser.id, managerEmployeeId: katrin.id, personnelNumber: 'MA-002', firstName: 'Thomas', lastName: 'Brandt', email: 'thomas@demo.example', phone: '+49 251 555004', employmentType: 'PART_TIME', canRecruitEmployees: true, canReceiveHours: true, targetMinutesPerWeek: 1200, maximumMinutesPerDay: 360 },
  });
  const anna = await db.employee.create({
    data: {
      organizationId: org.id, userId: annaUser.id, managerEmployeeId: maria.id, personnelNumber: 'MA-003', firstName: 'Anna', lastName: 'Berg', email: 'anna@demo.example', phone: '+49 251 555005', employmentType: 'PART_TIME', canRecruitEmployees: true, canReceiveHours: true, targetMinutesPerWeek: 1200, maximumMinutesPerDay: 300,
      startLocation: { label: 'Zuhause', street: 'Bremer Straße', houseNumber: '18', postalCode: '48155', city: 'Münster', countryCode: 'DE', latitude: 51.9535, longitude: 7.652 },
    },
  });
  const jonas = await db.employee.create({
    data: { organizationId: org.id, managerEmployeeId: maria.id, personnelNumber: 'MA-004', firstName: 'Jonas', lastName: 'Kleine', email: 'jonas@demo.example', employmentType: 'MINI_JOB', canReceiveHours: true, targetMinutesPerMonth: 2400 },
  });
  const lena = await db.employee.create({
    data: { organizationId: org.id, managerEmployeeId: anna.id, personnelNumber: 'MA-005', firstName: 'Lena', lastName: 'Fischer', email: 'lena@demo.example', employmentType: 'MINI_JOB', canReceiveHours: true, targetMinutesPerWeek: 480 },
  });
  const erik = await db.employee.create({
    data: { organizationId: org.id, managerEmployeeId: thomas.id, personnelNumber: 'MA-006', firstName: 'Erik', lastName: 'Wolf', email: 'erik@demo.example', employmentType: 'PART_TIME', canReceiveHours: true, targetMinutesPerWeek: 900 },
  });
  const sofia = await db.employee.create({
    data: { organizationId: org.id, managerEmployeeId: thomas.id, personnelNumber: 'MA-007', firstName: 'Sofia', lastName: 'Lorenz', email: 'sofia@demo.example', employmentType: 'MINI_JOB', canReceiveHours: true, targetMinutesPerWeek: 600 },
  });

  console.info('Seed: Verfügbarkeiten & Abwesenheiten …');
  const availFrom = dayParts(HISTORY_START_OFFSET).dateUtc;
  const availability: Prisma.EmployeeAvailabilityCreateManyInput[] = [];
  for (const weekday of [1, 2, 3, 4, 5]) availability.push({ employeeId: anna.id, weekday, startTime: '08:00', endTime: '14:00', validFrom: availFrom });
  for (const weekday of [1, 2, 3, 4, 5]) availability.push({ employeeId: maria.id, weekday, startTime: '08:00', endTime: '16:00', validFrom: availFrom });
  for (const weekday of [1, 3, 5]) availability.push({ employeeId: erik.id, weekday, startTime: '09:00', endTime: '15:00', validFrom: availFrom });
  for (const weekday of [2, 4]) availability.push({ employeeId: jonas.id, weekday, startTime: '08:00', endTime: '12:00', validFrom: availFrom });
  for (const weekday of [1, 2, 3]) availability.push({ employeeId: sofia.id, weekday, startTime: '09:00', endTime: '13:00', validFrom: availFrom });
  for (const weekday of [2, 3, 4]) availability.push({ employeeId: thomas.id, weekday, startTime: '08:00', endTime: '13:00', validFrom: availFrom });
  await db.employeeAvailability.createMany({ data: availability });

  await db.employeeAbsence.createMany({
    data: [
      { employeeId: jonas.id, startAt: at(5, '00:00'), endAt: at(12, '00:00'), type: 'VACATION', status: 'APPROVED', note: 'Jahresurlaub' },
      { employeeId: erik.id, startAt: at(-40, '00:00'), endAt: at(-37, '00:00'), type: 'SICK', status: 'APPROVED', note: 'Erkältung' },
      { employeeId: anna.id, startAt: at(-120, '00:00'), endAt: at(-106, '00:00'), type: 'VACATION', status: 'APPROVED', note: 'Sommerurlaub' },
    ],
  });

  console.info('Seed: Kunden, Adressen & Konten (Leitung) …');
  const customerData: Array<{
    number: string; salutation: string; firstName: string; lastName: string; phone: string; email?: string;
    street: string; houseNumber: string; postalCode: string; city: string; lat: number; lng: number; color: string;
    preferredEmployeeId?: string; status?: 'ACTIVE' | 'PAUSED'; access?: string; cleaning?: string; routeNotes?: string;
    availability?: { weekday: number; startTime: string; endTime: string }[];
    series: { weekday: number; startTime: string; durationMinutes: number; cadenceWeeks: number; title: string } | null;
    assignTo: string;
  }> = [
    { number: 'K-1001', salutation: 'Frau', firstName: 'Helga', lastName: 'Brinkmann', phone: '+49 251 481101', email: 'h.brinkmann@example.org', street: 'Prinzipalmarkt', houseNumber: '22', postalCode: '48143', city: 'Münster', lat: 51.9625, lng: 7.6281, color: '#6c5ce7', preferredEmployeeId: anna.id, access: 'Schlüssel im Tresor am Hintereingang, Code beim Büro erfragen.', cleaning: 'Parkettboden nur nebelfeucht wischen. Katze nicht rauslassen!', availability: [{ weekday: 2, startTime: '08:00', endTime: '12:00' }], series: { weekday: 2, startTime: '09:00', durationMinutes: 120, cadenceWeeks: 1, title: 'Wöchentliche Grundreinigung' }, assignTo: anna.id },
    { number: 'K-1002', salutation: 'Herr', firstName: 'Werner', lastName: 'Austermann', phone: '+49 251 481102', street: 'Warendorfer Straße', houseNumber: '85', postalCode: '48145', city: 'Münster', lat: 51.9646, lng: 7.6489, color: '#10b981', preferredEmployeeId: anna.id, cleaning: 'Fenster monatlich, Allergiker-Haushalt: keine Duftreiniger.', series: { weekday: 4, startTime: '08:30', durationMinutes: 120, cadenceWeeks: 1, title: 'Reinigung & Wäsche' }, assignTo: anna.id },
    { number: 'K-1003', salutation: 'Frau', firstName: 'Ingrid', lastName: 'Schulze-Blasum', phone: '+49 251 481103', street: 'Hammer Straße', houseNumber: '142', postalCode: '48153', city: 'Münster', lat: 51.9421, lng: 7.6247, color: '#f59e0b', access: 'Klingel „Schulze", 2. OG links.', series: { weekday: 3, startTime: '10:00', durationMinutes: 120, cadenceWeeks: 2, title: 'Wohnungsreinigung' }, assignTo: erik.id },
    { number: 'K-1004', salutation: 'Herr', firstName: 'Karl-Heinz', lastName: 'Terhart', phone: '+49 251 481104', street: 'Wolbecker Straße', houseNumber: '65', postalCode: '48155', city: 'Münster', lat: 51.9558, lng: 7.6468, color: '#a855f7', preferredEmployeeId: erik.id, series: { weekday: 1, startTime: '09:30', durationMinutes: 120, cadenceWeeks: 1, title: 'Wohnungsreinigung' }, assignTo: erik.id },
    { number: 'K-1005', salutation: 'Frau', firstName: 'Margarete', lastName: 'Averbeck', phone: '+49 251 481105', street: 'Grevener Straße', houseNumber: '120', postalCode: '48159', city: 'Münster', lat: 51.9773, lng: 7.6152, color: '#f43f5e', routeNotes: 'Parken nur in der Seitenstraße möglich.', series: { weekday: 5, startTime: '10:00', durationMinutes: 90, cadenceWeeks: 1, title: 'Einkauf & Reinigung' }, assignTo: sofia.id },
    { number: 'K-1006', salutation: 'Frau', firstName: 'Roswitha', lastName: 'Elvering', phone: '+49 251 481106', street: 'Weseler Straße', houseNumber: '230', postalCode: '48151', city: 'Münster', lat: 51.9409, lng: 7.6063, color: '#06b6d4', series: { weekday: 3, startTime: '14:00', durationMinutes: 60, cadenceWeeks: 1, title: 'Grundreinigung Bad' }, assignTo: lena.id },
    { number: 'K-1007', salutation: 'Herr', firstName: 'Heinrich', lastName: 'Uhlenbrock', phone: '+49 251 481107', street: 'Steinfurter Straße', houseNumber: '60', postalCode: '48149', city: 'Münster', lat: 51.9701, lng: 7.6048, color: '#ec4899', cleaning: 'Treppenhaus gehört mit zum Auftrag (EG bis 1. OG).', series: { weekday: 6, startTime: '10:00', durationMinutes: 180, cadenceWeeks: 2, title: 'Treppenhaus & Wohnung' }, assignTo: jonas.id },
    { number: 'K-1008', salutation: 'Frau', firstName: 'Anneliese', lastName: 'Pöttker', phone: '+49 251 481108', street: 'Albersloher Weg', houseNumber: '44', postalCode: '48155', city: 'Münster', lat: 51.9478, lng: 7.6412, color: '#84cc16', preferredEmployeeId: sofia.id, series: { weekday: 4, startTime: '14:00', durationMinutes: 120, cadenceWeeks: 1, title: 'Reinigung' }, assignTo: sofia.id },
    { number: 'K-1009', salutation: 'Herr', firstName: 'Dieter', lastName: 'Wesselmann', phone: '+49 251 481109', street: 'Kanalstraße', houseNumber: '33', postalCode: '48147', city: 'Münster', lat: 51.9707, lng: 7.6328, color: '#3e6de0', series: { weekday: 2, startTime: '11:00', durationMinutes: 60, cadenceWeeks: 1, title: 'Kurzreinigung' }, assignTo: anna.id },
    { number: 'K-1010', salutation: 'Frau', firstName: 'Elfriede', lastName: 'Sandmann', phone: '+49 251 481110', street: 'Hafenweg', houseNumber: '14', postalCode: '48155', city: 'Münster', lat: 51.9503, lng: 7.6352, color: '#d98324', series: { weekday: 4, startTime: '10:30', durationMinutes: 120, cadenceWeeks: 2, title: 'Wohnungsreinigung' }, assignTo: anna.id },
    { number: 'K-1011', salutation: 'Frau', firstName: 'Gudrun', lastName: 'Hövel', phone: '+49 251 481111', street: 'Aegidiistraße', houseNumber: '12', postalCode: '48143', city: 'Münster', lat: 51.9583, lng: 7.6252, color: '#0ea5e9', series: { weekday: 1, startTime: '11:00', durationMinutes: 90, cadenceWeeks: 1, title: 'Reinigung & Bügeln' }, assignTo: maria.id },
    { number: 'K-1012', salutation: 'Herr', firstName: 'Friedhelm', lastName: 'Nowak', phone: '+49 251 481112', street: 'Hüfferstraße', houseNumber: '27', postalCode: '48149', city: 'Münster', lat: 51.9622, lng: 7.6071, color: '#f97316', series: { weekday: 5, startTime: '13:00', durationMinutes: 120, cadenceWeeks: 2, title: 'Wohnungsreinigung' }, assignTo: erik.id },
    { number: 'K-1013', salutation: 'Frau', firstName: 'Waltraud', lastName: 'Kösters', phone: '+49 251 481113', street: 'Gartenstraße', houseNumber: '40', postalCode: '48147', city: 'Münster', lat: 51.9724, lng: 7.6289, color: '#14b8a6', series: { weekday: 3, startTime: '08:30', durationMinutes: 90, cadenceWeeks: 1, title: 'Grundreinigung' }, assignTo: maria.id },
    { number: 'K-1014', salutation: 'Herr', firstName: 'Bernd', lastName: 'Schilling', phone: '+49 251 481114', street: 'Bohlweg', houseNumber: '8', postalCode: '48147', city: 'Münster', lat: 51.9663, lng: 7.6351, color: '#8b5cf6', status: 'PAUSED', series: null, assignTo: anna.id },
    { number: 'K-1015', salutation: 'Frau', firstName: 'Hannelore', lastName: 'Vietmeyer', phone: '+49 251 481115', street: 'Ludgeriplatz', houseNumber: '3', postalCode: '48151', city: 'Münster', lat: 51.9551, lng: 7.6266, color: '#e11d48', availability: [{ weekday: 1, startTime: '09:00', endTime: '13:00' }, { weekday: 4, startTime: '09:00', endTime: '13:00' }], series: null, assignTo: sofia.id },
    { number: 'K-1016', salutation: 'Herr', firstName: 'Reinhard', lastName: 'Große-Kock', phone: '+49 251 481116', street: 'Kappenberger Damm', houseNumber: '90', postalCode: '48151', city: 'Münster', lat: 51.9381, lng: 7.6153, color: '#65a30d', series: null, assignTo: erik.id },
  ];

  const byNumber: Record<string, { id: string; addressId: string }> = {};
  const scheduled: ScheduledCustomer[] = [];
  for (const c of customerData) {
    const customer = await db.customer.create({
      data: {
        organizationId: org.id, customerNumber: c.number, salutation: c.salutation, firstName: c.firstName, lastName: c.lastName,
        phone: c.phone, email: c.email, color: c.color, status: c.status ?? 'ACTIVE', preferredEmployeeId: c.preferredEmployeeId,
        accessInstructions: c.access, cleaningInstructions: c.cleaning, routeNotes: c.routeNotes,
        defaultAppointmentDurationMinutes: c.series?.durationMinutes ?? 120,
        privateNotes: c.number === 'K-1001' ? 'Rechnung geht an die Tochter (Kontakt im Büro hinterlegt).' : undefined,
      },
    });
    const address = await db.address.create({
      data: { organizationId: org.id, customerId: customer.id, label: 'Hauptadresse', street: c.street, houseNumber: c.houseNumber, postalCode: c.postalCode, city: c.city, countryCode: 'DE', latitude: c.lat, longitude: c.lng, geocodingProvider: 'seed', geocodingQuality: 'exact', geocodedAt: new Date() },
    });
    if (c.availability?.length) {
      await db.customerAvailability.createMany({ data: c.availability.map((a) => ({ customerId: customer.id, ...a })) });
    }
    byNumber[c.number] = { id: customer.id, addressId: address.id };
    if (c.status !== 'PAUSED') {
      scheduled.push({
        number: c.number, customerId: customer.id, addressId: address.id, employeeId: c.assignTo,
        series: c.series, monthlyGrantMinutes: c.series ? monthlyGrantFor(c.series.durationMinutes, c.series.cadenceWeeks) : 600,
        grantNote: c.number === 'K-1002' ? 'Entlastungsbetrag §45b SGB XI' : 'Monatliche Aufladung',
      });
    }
  }

  console.info('Seed: Zuweisungen (Leitung) …');
  const periodStart = firstOfMonthUtc(0);
  const periodEnd = firstOfMonthUtc(1);
  const allocate = (number: string, toEmployeeId: string, minutes: number, byEmployeeId: string | null = null) =>
    db.hourAllocation.create({
      data: { organizationId: org.id, customerId: byNumber[number]!.id, allocatedByEmployeeId: byEmployeeId, allocatedToEmployeeId: toEmployeeId, allocatedMinutes: minutes, validFrom: periodStart, validUntil: periodEnd, status: 'ACTIVE' },
    });
  await allocate('K-1001', maria.id, 480);
  await allocate('K-1001', anna.id, 240, maria.id);
  await allocate('K-1002', anna.id, 600);
  await allocate('K-1004', thomas.id, 600);
  await allocate('K-1004', erik.id, 300, thomas.id);
  await allocate('K-1005', sofia.id, 240);
  await allocate('K-1006', lena.id, 360);
  await allocate('K-1007', jonas.id, 480);
  await allocate('K-1008', sofia.id, 240);

  console.info('Seed: Historie (Leitung) …');
  const result = await seedHistory({
    orgId: org.id,
    approverUserId: ownerUser.id,
    createdByUserId: ownerUser.id,
    scheduled,
    routeFor: [{ employeeId: anna.id, office: MUENSTER_OFFICE }],
    rngSeed: 12345,
  });
  console.info(`  → ${result.appointmentsCreated} Termine, davon ${result.completed} abgeschlossen.`);

  await db.notification.createMany({
    data: [
      { organizationId: org.id, userId: annaUser.id, type: 'APPOINTMENT_ASSIGNED', title: 'Neuer Termin zugewiesen', message: 'Grundreinigung Bad bei Roswitha Elvering.', targetUrl: '/calendar' },
      { organizationId: org.id, userId: ownerUser.id, type: 'CUSTOMER_OPEN_HOURS', title: 'Offene Kundenstunden', message: 'Reinhard Große-Kock hat offene Stunden ohne geplanten Einsatz.', targetUrl: '/customers' },
      { organizationId: org.id, userId: ownerUser.id, type: 'ROUTE_PROBLEM', title: 'Enge Taktung', message: 'In Annas Route heute ist die Fahrzeit zwischen zwei Terminen knapp.', targetUrl: '/routes' },
    ],
  });
  await db.auditLog.create({
    data: { organizationId: org.id, actorUserId: ownerUser.id, action: 'organization.created', entityType: 'Organization', entityId: org.id, metadata: { name: org.name, seeded: true } },
  });
}

// ---------------------------------------------------------------------------
// Organisation 2: ALLEIN (soloMode, Osnabrück)
// ---------------------------------------------------------------------------

const OSNA_OFFICE: Prisma.InputJsonValue = {
  label: 'Zuhause',
  street: 'Möserstraße',
  houseNumber: '2',
  postalCode: '49074',
  city: 'Osnabrück',
  countryCode: 'DE',
  latitude: 52.2735,
  longitude: 8.0505,
};

async function seedSoloOrg(passwordHash: string): Promise<void> {
  console.info('Seed: Allein-Organisation (soloMode) …');
  const org = await db.organization.create({
    data: {
      name: 'Klarputz – Ariane Vogt',
      slug: 'klarputz-vogt',
      timezone: TZ,
      locale: 'de-DE',
      soloMode: true,
      defaultStartLocation: OSNA_OFFICE,
      defaultEndLocation: OSNA_OFFICE,
    },
  });

  const soloUser = await db.user.create({
    data: { email: 'solo@demo.example', passwordHash, firstName: 'Ariane', lastName: 'Vogt', phone: '+49 541 700100' },
  });
  await db.organizationMembership.create({
    data: {
      organizationId: org.id, userId: soloUser.id, role: 'ORGANIZATION_OWNER', status: 'ACTIVE',
      hourlyWageCents: 2600, taxEmploymentType: 'SELF_EMPLOYED', incomeTaxRatePercent: 26,
      taxFreeBonusCentsPerHour: 300, taxFreeBonusLabel: 'Werbepauschale', mileageRatePerKmCents: 30,
    },
  });
  const ariane = await db.employee.create({
    data: {
      organizationId: org.id, userId: soloUser.id, firstName: 'Ariane', lastName: 'Vogt', email: 'solo@demo.example', phone: '+49 541 700100',
      employmentType: 'FULL_TIME', canReceiveHours: true, targetMinutesPerWeek: 1500, maximumMinutesPerDay: 420,
      startLocation: OSNA_OFFICE,
    },
  });
  // Persönliche Ansicht „Mein Tag" gleich aktiv – der Solo-Alltag.
  await db.userPreference.create({ data: { userId: soloUser.id, personalViewActive: true, lastActiveOrganizationId: org.id } });

  const availFrom = dayParts(HISTORY_START_OFFSET).dateUtc;
  await db.employeeAvailability.createMany({
    data: [1, 2, 3, 4, 5].map((weekday) => ({ employeeId: ariane.id, weekday, startTime: '08:00', endTime: '16:00', validFrom: availFrom })),
  });
  await db.employeeAbsence.create({
    data: { employeeId: ariane.id, startAt: at(-70, '00:00'), endAt: at(-63, '00:00'), type: 'VACATION', status: 'APPROVED', note: 'Kurzurlaub' },
  });

  console.info('Seed: Kunden, Adressen & Konten (Allein) …');
  const customerData: Array<{
    number: string; salutation: string; firstName: string; lastName: string; phone: string; email?: string;
    street: string; houseNumber: string; postalCode: string; city: string; lat: number; lng: number; color: string;
    access?: string; cleaning?: string;
    availability?: { weekday: number; startTime: string; endTime: string }[];
    series: { weekday: number; startTime: string; durationMinutes: number; cadenceWeeks: number; title: string } | null;
  }> = [
    { number: 'S-2001', salutation: 'Frau', firstName: 'Adelheid', lastName: 'Brägelmann', phone: '+49 541 700201', email: 'a.braegelmann@example.org', street: 'Möserstraße', houseNumber: '15', postalCode: '49074', city: 'Osnabrück', lat: 52.2725, lng: 8.0510, color: '#6c5ce7', access: 'Schlüssel bei der Nachbarin (Whg. rechts).', cleaning: 'Teppiche saugen, Parkett nur nebelfeucht.', availability: [{ weekday: 1, startTime: '08:00', endTime: '12:00' }], series: { weekday: 1, startTime: '08:30', durationMinutes: 120, cadenceWeeks: 1, title: 'Wöchentliche Grundreinigung' } },
    { number: 'S-2002', salutation: 'Herr', firstName: 'Wilhelm', lastName: 'Steinkamp', phone: '+49 541 700202', street: 'Wittekindstraße', houseNumber: '8', postalCode: '49074', city: 'Osnabrück', lat: 52.2760, lng: 8.0555, color: '#10b981', series: { weekday: 1, startTime: '11:00', durationMinutes: 90, cadenceWeeks: 1, title: 'Reinigung & Wäsche' } },
    { number: 'S-2003', salutation: 'Frau', firstName: 'Käthe', lastName: 'Lindemann', phone: '+49 541 700203', street: 'Johannisstraße', houseNumber: '44', postalCode: '49074', city: 'Osnabrück', lat: 52.2698, lng: 8.0470, color: '#f59e0b', cleaning: 'Fenster alle zwei Monate.', series: { weekday: 2, startTime: '09:00', durationMinutes: 120, cadenceWeeks: 1, title: 'Wohnungsreinigung' } },
    { number: 'S-2004', salutation: 'Herr', firstName: 'Gerhard', lastName: 'Aschendorf', phone: '+49 541 700204', street: 'Herderstraße', houseNumber: '3', postalCode: '49074', city: 'Osnabrück', lat: 52.2688, lng: 8.0602, color: '#a855f7', series: { weekday: 2, startTime: '13:00', durationMinutes: 90, cadenceWeeks: 2, title: 'Bad & Küche' } },
    { number: 'S-2005', salutation: 'Frau', firstName: 'Ruth', lastName: 'Niehaus', phone: '+49 541 700205', street: 'Bergstraße', houseNumber: '21', postalCode: '49076', city: 'Osnabrück', lat: 52.2822, lng: 8.0388, color: '#f43f5e', availability: [{ weekday: 3, startTime: '09:00', endTime: '14:00' }], series: { weekday: 3, startTime: '09:30', durationMinutes: 120, cadenceWeeks: 1, title: 'Grundreinigung' } },
    { number: 'S-2006', salutation: 'Herr', firstName: 'Otto', lastName: 'Kampmann', phone: '+49 541 700206', street: 'Lotter Straße', houseNumber: '90', postalCode: '49078', city: 'Osnabrück', lat: 52.2775, lng: 8.0225, color: '#06b6d4', series: { weekday: 4, startTime: '08:30', durationMinutes: 120, cadenceWeeks: 1, title: 'Wohnungsreinigung' } },
    { number: 'S-2007', salutation: 'Frau', firstName: 'Erna', lastName: 'Wehmeyer', phone: '+49 541 700207', street: 'Natruper Straße', houseNumber: '130', postalCode: '49090', city: 'Osnabrück', lat: 52.2905, lng: 8.0300, color: '#ec4899', series: { weekday: 4, startTime: '12:00', durationMinutes: 90, cadenceWeeks: 2, title: 'Reinigung & Bügeln' } },
    { number: 'S-2008', salutation: 'Herr', firstName: 'Heinz', lastName: 'Determann', phone: '+49 541 700208', street: 'Iburger Straße', houseNumber: '55', postalCode: '49082', city: 'Osnabrück', lat: 52.2560, lng: 8.0480, color: '#84cc16', series: { weekday: 5, startTime: '09:00', durationMinutes: 120, cadenceWeeks: 1, title: 'Grundreinigung' } },
    { number: 'S-2009', salutation: 'Frau', firstName: 'Liselotte', lastName: 'Focke', phone: '+49 541 700209', street: 'Meller Straße', houseNumber: '200', postalCode: '49084', city: 'Osnabrück', lat: 52.2760, lng: 8.0790, color: '#3e6de0', series: null },
    { number: 'S-2010', salutation: 'Herr', firstName: 'Paul', lastName: 'Große-Vehne', phone: '+49 541 700210', street: 'Hasestraße', houseNumber: '60', postalCode: '49074', city: 'Osnabrück', lat: 52.2760, lng: 8.0490, color: '#d98324', series: null },
  ];

  const scheduled: ScheduledCustomer[] = [];
  for (const c of customerData) {
    const customer = await db.customer.create({
      data: {
        organizationId: org.id, customerNumber: c.number, salutation: c.salutation, firstName: c.firstName, lastName: c.lastName,
        phone: c.phone, email: c.email, color: c.color, accessInstructions: c.access, cleaningInstructions: c.cleaning,
        defaultAppointmentDurationMinutes: c.series?.durationMinutes ?? 120,
      },
    });
    const address = await db.address.create({
      data: { organizationId: org.id, customerId: customer.id, label: 'Hauptadresse', street: c.street, houseNumber: c.houseNumber, postalCode: c.postalCode, city: c.city, countryCode: 'DE', latitude: c.lat, longitude: c.lng, geocodingProvider: 'seed', geocodingQuality: 'exact', geocodedAt: new Date() },
    });
    if (c.availability?.length) {
      await db.customerAvailability.createMany({ data: c.availability.map((a) => ({ customerId: customer.id, ...a })) });
    }
    scheduled.push({
      number: c.number, customerId: customer.id, addressId: address.id, employeeId: ariane.id,
      series: c.series, monthlyGrantMinutes: c.series ? monthlyGrantFor(c.series.durationMinutes, c.series.cadenceWeeks) : 480,
      grantNote: 'Monatliche Aufladung',
    });
  }

  console.info('Seed: Historie (Allein) …');
  const result = await seedHistory({
    orgId: org.id,
    approverUserId: soloUser.id,
    createdByUserId: soloUser.id,
    scheduled,
    routeFor: [{ employeeId: ariane.id, office: OSNA_OFFICE }],
    rngSeed: 98765,
  });
  console.info(`  → ${result.appointmentsCreated} Termine, davon ${result.completed} abgeschlossen.`);

  await db.notification.create({
    data: { organizationId: org.id, userId: soloUser.id, type: 'CUSTOMER_OPEN_HOURS', title: 'Offene Stunden', message: 'Liselotte Focke und Paul Große-Vehne haben noch offene Stunden – Einsätze einplanen?', targetUrl: '/customers' },
  });
  await db.auditLog.create({
    data: { organizationId: org.id, actorUserId: soloUser.id, action: 'organization.created', entityType: 'Organization', entityId: org.id, metadata: { name: org.name, soloMode: true, seeded: true } },
  });
}

// ---------------------------------------------------------------------------
// Organisation 3: Fremd (Mandantentrennung)
// ---------------------------------------------------------------------------

async function seedForeignOrg(passwordHash: string): Promise<void> {
  console.info('Seed: Fremdorganisation (Mandantentrennung) …');
  const otherOrg = await db.organization.create({
    data: { name: 'Fremde Reinigungs GmbH', slug: 'fremde-reinigung', timezone: TZ },
  });
  const otherUser = await db.user.create({
    data: { email: 'fremd@demo.example', passwordHash, firstName: 'Frida', lastName: 'Fremd' },
  });
  await db.organizationMembership.create({
    data: { organizationId: otherOrg.id, userId: otherUser.id, role: 'ORGANIZATION_OWNER', status: 'ACTIVE' },
  });
  const otherEmployee = await db.employee.create({
    data: { organizationId: otherOrg.id, userId: otherUser.id, firstName: 'Frida', lastName: 'Fremd', canReceiveHours: true },
  });
  const otherCustomer = await db.customer.create({
    data: { organizationId: otherOrg.id, customerNumber: 'F-0001', firstName: 'Otto', lastName: 'Outsider', phone: '+49 30 000000', color: '#64748b' },
  });
  const otherAddress = await db.address.create({
    data: { organizationId: otherOrg.id, customerId: otherCustomer.id, street: 'Beispielweg', houseNumber: '1', postalCode: '10115', city: 'Berlin', latitude: 52.5321, longitude: 13.3849, geocodingProvider: 'seed', geocodingQuality: 'exact', geocodedAt: new Date() },
  });
  await db.appointment.create({
    data: { organizationId: otherOrg.id, customerId: otherCustomer.id, assignedEmployeeId: otherEmployee.id, title: 'Fremder Termin', startAt: at(1, '10:00'), endAt: at(1, '11:00'), durationMinutes: 60, status: 'PLANNED', assignmentStatus: 'ASSIGNED', locationAddressId: otherAddress.id },
  });
}

// ---------------------------------------------------------------------------

async function main() {
  await clearDatabase();

  const passwordHash = await hash(DEMO_PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 });

  await seedLeadershipOrg(passwordHash);
  await seedSoloOrg(passwordHash);
  await seedForeignOrg(passwordHash);

  console.info('Seed abgeschlossen.');
  console.info(`Zeitraum: ~${HISTORY_MONTHS} Monate Historie + ${FUTURE_WEEKS} Wochen Vorplanung.`);
  console.info('Demo-Logins (Passwort jeweils "Demo1234!"):');
  console.info('  solo@demo.example   – ALLEIN-Modus: Ariane Vogt (Klarputz, Osnabrück)');
  console.info('  owner@demo.example  – LEITUNG: Inhaberin Katrin Sommer (Blitzblank, Münster)');
  console.info('  dispo@demo.example  – Disponent David Krüger');
  console.info('  maria@demo.example  – Team-Managerin Maria Weber');
  console.info('  thomas@demo.example – Team-Manager Thomas Brandt');
  console.info('  anna@demo.example   – Mitarbeiterin Anna Berg');
  console.info('  fremd@demo.example  – fremde Organisation (Isolationstests)');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
