/**
 * Seed-Daten: eine realistische Demo-Organisation rund um Münster (Westf.)
 * plus eine Fremd-Organisation für Mandantentrennungs-Tests.
 *
 * Nur für Entwicklung/Tests gedacht – der Seed leert zuerst alle Tabellen!
 * Demo-Zugangsdaten: siehe README.md (Abschnitt "Demo-Benutzer").
 *
 * Termine werden relativ zu "heute" erzeugt, damit Dashboard, Kalender und
 * Routenplanung immer aktuelle Daten zeigen. Wandzeiten sind Europe/Berlin.
 */
import { hash } from '@node-rs/argon2';
import { PrismaClient } from '@prisma/client';
import { addDays } from 'date-fns';

import { zonedWallTimeToUtc } from '../src/lib/dates';

const db = new PrismaClient();

const TZ = 'Europe/Berlin';
const DEMO_PASSWORD = 'Demo1234!';

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

/** UTC-Zeitpunkt für heute+offset um "HH:mm" (Wandzeit Europe/Berlin). */
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

async function main() {
  console.info('Seed: Datenbank wird geleert …');
  // Reihenfolge egal – CASCADE-Beziehungen; explizit für Klarheit:
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
  await db.customerHourBudget.deleteMany();
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
  await db.user.deleteMany();
  await db.organization.deleteMany();

  const passwordHash = await hash(DEMO_PASSWORD, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
  });

  console.info('Seed: Organisation & Benutzer …');
  const org = await db.organization.create({
    data: {
      name: 'Blitzblank Hauswirtschaft GmbH',
      slug: 'blitzblank-hauswirtschaft',
      timezone: TZ,
      locale: 'de-DE',
      defaultStartLocation: {
        label: 'Büro',
        street: 'Servatiiplatz',
        houseNumber: '9',
        postalCode: '48143',
        city: 'Münster',
        countryCode: 'DE',
        latitude: 51.9602,
        longitude: 7.6335,
      },
      defaultEndLocation: {
        label: 'Büro',
        street: 'Servatiiplatz',
        houseNumber: '9',
        postalCode: '48143',
        city: 'Münster',
        countryCode: 'DE',
        latitude: 51.9602,
        longitude: 7.6335,
      },
    },
  });

  async function createUser(email: string, firstName: string, lastName: string, phone?: string) {
    return db.user.create({
      data: { email, passwordHash, firstName, lastName, phone },
    });
  }

  const ownerUser = await createUser('owner@demo.example', 'Katrin', 'Sommer', '+49 251 555001');
  const dispatcherUser = await createUser('dispo@demo.example', 'David', 'Krüger', '+49 251 555002');
  const mariaUser = await createUser('maria@demo.example', 'Maria', 'Weber', '+49 251 555003');
  const thomasUser = await createUser('thomas@demo.example', 'Thomas', 'Brandt', '+49 251 555004');
  const annaUser = await createUser('anna@demo.example', 'Anna', 'Berg', '+49 251 555005');

  const roleOf: Record<string, 'ORGANIZATION_OWNER' | 'ADMIN' | 'DISPATCHER' | 'TEAM_MANAGER' | 'EMPLOYEE'> = {
    [ownerUser.id]: 'ORGANIZATION_OWNER',
    [dispatcherUser.id]: 'DISPATCHER',
    [mariaUser.id]: 'TEAM_MANAGER',
    [thomasUser.id]: 'TEAM_MANAGER',
    [annaUser.id]: 'EMPLOYEE',
  };
  for (const [userId, role] of Object.entries(roleOf)) {
    await db.organizationMembership.create({
      data: { organizationId: org.id, userId, role, status: 'ACTIVE' },
    });
  }

  console.info('Seed: Mitarbeiterhierarchie …');
  // Hierarchie: Katrin (Inhaberin)
  //  ├─ Maria (Team-Managerin) ── Anna ── Lena  (zweistufig!)
  //  │                         └─ Jonas
  //  └─ Thomas (Team-Manager)  ── Erik
  //                            └─ Sofia
  const katrin = await db.employee.create({
    data: {
      organizationId: org.id,
      userId: ownerUser.id,
      firstName: 'Katrin',
      lastName: 'Sommer',
      email: 'owner@demo.example',
      phone: '+49 251 555001',
      employmentType: 'FULL_TIME',
      canRecruitEmployees: true,
      canReceiveHours: true,
      targetMinutesPerWeek: 600, // 10 h eigene Einsätze
    },
  });
  const maria = await db.employee.create({
    data: {
      organizationId: org.id,
      userId: mariaUser.id,
      managerEmployeeId: katrin.id,
      personnelNumber: 'MA-001',
      firstName: 'Maria',
      lastName: 'Weber',
      email: 'maria@demo.example',
      phone: '+49 251 555003',
      employmentType: 'FULL_TIME',
      canRecruitEmployees: true,
      canReceiveHours: true,
      targetMinutesPerWeek: 1800, // 30 h
      maximumMinutesPerDay: 480,
    },
  });
  const thomas = await db.employee.create({
    data: {
      organizationId: org.id,
      userId: thomasUser.id,
      managerEmployeeId: katrin.id,
      personnelNumber: 'MA-002',
      firstName: 'Thomas',
      lastName: 'Brandt',
      email: 'thomas@demo.example',
      phone: '+49 251 555004',
      employmentType: 'PART_TIME',
      canRecruitEmployees: true,
      canReceiveHours: true,
      targetMinutesPerWeek: 1200, // 20 h
      maximumMinutesPerDay: 360,
    },
  });
  const anna = await db.employee.create({
    data: {
      organizationId: org.id,
      userId: annaUser.id,
      managerEmployeeId: maria.id,
      personnelNumber: 'MA-003',
      firstName: 'Anna',
      lastName: 'Berg',
      email: 'anna@demo.example',
      phone: '+49 251 555005',
      employmentType: 'PART_TIME',
      canRecruitEmployees: true,
      canReceiveHours: true,
      targetMinutesPerWeek: 1200, // 20 h – bekommt weniger → „fehlende Stunden“
      maximumMinutesPerDay: 300,
      startLocation: {
        label: 'Zuhause',
        street: 'Bremer Straße',
        houseNumber: '18',
        postalCode: '48155',
        city: 'Münster',
        countryCode: 'DE',
        latitude: 51.9535,
        longitude: 7.652,
      },
    },
  });
  const jonas = await db.employee.create({
    data: {
      organizationId: org.id,
      managerEmployeeId: maria.id,
      personnelNumber: 'MA-004',
      firstName: 'Jonas',
      lastName: 'Kleine',
      email: 'jonas@demo.example',
      employmentType: 'MINI_JOB',
      canReceiveHours: true,
      targetMinutesPerMonth: 2400, // 40 h/Monat
    },
  });
  const lena = await db.employee.create({
    data: {
      organizationId: org.id,
      managerEmployeeId: anna.id, // zweite Stufe unter Maria
      personnelNumber: 'MA-005',
      firstName: 'Lena',
      lastName: 'Fischer',
      email: 'lena@demo.example',
      employmentType: 'MINI_JOB',
      canReceiveHours: true,
      targetMinutesPerWeek: 480, // 8 h
    },
  });
  const erik = await db.employee.create({
    data: {
      organizationId: org.id,
      managerEmployeeId: thomas.id,
      personnelNumber: 'MA-006',
      firstName: 'Erik',
      lastName: 'Wolf',
      email: 'erik@demo.example',
      employmentType: 'PART_TIME',
      canReceiveHours: true,
      targetMinutesPerWeek: 900, // 15 h
    },
  });
  const sofia = await db.employee.create({
    data: {
      organizationId: org.id,
      managerEmployeeId: thomas.id,
      personnelNumber: 'MA-007',
      firstName: 'Sofia',
      lastName: 'Lorenz',
      email: 'sofia@demo.example',
      employmentType: 'MINI_JOB',
      canReceiveHours: true,
      targetMinutesPerWeek: 600, // 10 h
    },
  });

  console.info('Seed: Verfügbarkeiten & Abwesenheit …');
  const availabilityStart = dayParts(-60).dateUtc;
  // Anna: Mo–Fr 8–14 Uhr; Erik: Mo/Mi/Fr 9–15; Jonas: Di+Do 8–12
  for (const weekday of [1, 2, 3, 4, 5]) {
    await db.employeeAvailability.create({
      data: { employeeId: anna.id, weekday, startTime: '08:00', endTime: '14:00', validFrom: availabilityStart },
    });
  }
  for (const weekday of [1, 3, 5]) {
    await db.employeeAvailability.create({
      data: { employeeId: erik.id, weekday, startTime: '09:00', endTime: '15:00', validFrom: availabilityStart },
    });
  }
  for (const weekday of [2, 4]) {
    await db.employeeAvailability.create({
      data: { employeeId: jonas.id, weekday, startTime: '08:00', endTime: '12:00', validFrom: availabilityStart },
    });
  }
  // Jonas ist kommende Woche im Urlaub (kollidiert mit einem Serientermin).
  await db.employeeAbsence.create({
    data: {
      employeeId: jonas.id,
      startAt: at(5, '00:00'),
      endAt: at(12, '00:00'),
      type: 'VACATION',
      status: 'APPROVED',
      note: 'Jahresurlaub',
    },
  });

  console.info('Seed: Kunden & Adressen …');
  const customerData: Array<{
    number: string;
    salutation?: string;
    firstName: string;
    lastName: string;
    phone: string;
    email?: string;
    street: string;
    houseNumber: string;
    postalCode: string;
    city: string;
    lat: number;
    lng: number;
    color: string;
    preferredEmployeeId?: string;
    access?: string;
    cleaning?: string;
    routeNotes?: string;
  }> = [
    { number: 'K-1001', salutation: 'Frau', firstName: 'Helga', lastName: 'Brinkmann', phone: '+49 251 481101', email: 'h.brinkmann@example.org', street: 'Prinzipalmarkt', houseNumber: '22', postalCode: '48143', city: 'Münster', lat: 51.9625, lng: 7.6281, color: '#6c5ce7', preferredEmployeeId: anna.id, access: 'Schlüssel im Tresor am Hintereingang, Code beim Büro erfragen.', cleaning: 'Parkettboden nur nebelfeucht wischen. Katze nicht rauslassen!' },
    { number: 'K-1002', salutation: 'Herr', firstName: 'Werner', lastName: 'Austermann', phone: '+49 251 481102', street: 'Warendorfer Straße', houseNumber: '85', postalCode: '48145', city: 'Münster', lat: 51.9646, lng: 7.6489, color: '#10b981', preferredEmployeeId: anna.id, cleaning: 'Fenster monatlich, Allergiker-Haushalt: keine Duftreiniger.' },
    { number: 'K-1003', salutation: 'Frau', firstName: 'Ingrid', lastName: 'Schulze-Blasum', phone: '+49 251 481103', street: 'Hammer Straße', houseNumber: '142', postalCode: '48153', city: 'Münster', lat: 51.9421, lng: 7.6247, color: '#f59e0b', access: 'Klingel „Schulze“, 2. OG links.' },
    { number: 'K-1004', salutation: 'Herr', firstName: 'Karl-Heinz', lastName: 'Terhart', phone: '+49 251 481104', street: 'Wolbecker Straße', houseNumber: '65', postalCode: '48155', city: 'Münster', lat: 51.9558, lng: 7.6468, color: '#a855f7', preferredEmployeeId: erik.id },
    { number: 'K-1005', salutation: 'Frau', firstName: 'Margarete', lastName: 'Averbeck', phone: '+49 251 481105', street: 'Grevener Straße', houseNumber: '120', postalCode: '48159', city: 'Münster', lat: 51.9773, lng: 7.6152, color: '#f43f5e', routeNotes: 'Parken nur in der Seitenstraße möglich.' },
    { number: 'K-1006', salutation: 'Frau', firstName: 'Roswitha', lastName: 'Elvering', phone: '+49 251 481106', street: 'Weseler Straße', houseNumber: '230', postalCode: '48151', city: 'Münster', lat: 51.9409, lng: 7.6063, color: '#06b6d4' },
    { number: 'K-1007', salutation: 'Herr', firstName: 'Heinrich', lastName: 'Uhlenbrock', phone: '+49 251 481107', street: 'Steinfurter Straße', houseNumber: '60', postalCode: '48149', city: 'Münster', lat: 51.9701, lng: 7.6048, color: '#ec4899', cleaning: 'Treppenhaus gehört mit zum Auftrag (EG bis 1. OG).' },
    { number: 'K-1008', salutation: 'Frau', firstName: 'Anneliese', lastName: 'Pöttker', phone: '+49 251 481108', street: 'Albersloher Weg', houseNumber: '44', postalCode: '48155', city: 'Münster', lat: 51.9478, lng: 7.6412, color: '#84cc16', preferredEmployeeId: sofia.id },
    { number: 'K-1009', salutation: 'Herr', firstName: 'Dieter', lastName: 'Wesselmann', phone: '+49 251 481109', street: 'Kanalstraße', houseNumber: '33', postalCode: '48147', city: 'Münster', lat: 51.9707, lng: 7.6328, color: '#3e6de0' },
    { number: 'K-1010', salutation: 'Frau', firstName: 'Elfriede', lastName: 'Sandmann', phone: '+49 251 481110', street: 'Hafenweg', houseNumber: '14', postalCode: '48155', city: 'Münster', lat: 51.9503, lng: 7.6352, color: '#d98324' },
  ];

  const customers: Record<string, { id: string; addressId: string }> = {};
  for (const c of customerData) {
    const customer = await db.customer.create({
      data: {
        organizationId: org.id,
        customerNumber: c.number,
        salutation: c.salutation,
        firstName: c.firstName,
        lastName: c.lastName,
        phone: c.phone,
        email: c.email,
        color: c.color,
        preferredEmployeeId: c.preferredEmployeeId,
        accessInstructions: c.access,
        cleaningInstructions: c.cleaning,
        routeNotes: c.routeNotes,
        privateNotes:
          c.number === 'K-1001'
            ? 'Rechnung geht an die Tochter (Kontakt im Büro hinterlegt).'
            : undefined,
      },
    });
    const address = await db.address.create({
      data: {
        organizationId: org.id,
        customerId: customer.id,
        label: 'Hauptadresse',
        street: c.street,
        houseNumber: c.houseNumber,
        postalCode: c.postalCode,
        city: c.city,
        countryCode: 'DE',
        latitude: c.lat,
        longitude: c.lng,
        geocodingProvider: 'seed',
        geocodingQuality: 'exact',
        geocodedAt: new Date(),
      },
    });
    customers[c.number] = { id: customer.id, addressId: address.id };
  }

  console.info('Seed: Stundenbudgets & Zuweisungen …');
  const monthStart = dayParts(0);
  const periodStart = new Date(Date.UTC(monthStart.y, monthStart.m - 1, 1));
  const periodEnd = new Date(Date.UTC(monthStart.y, monthStart.m, 0)); // letzter Tag des Monats

  const budgetMinutesByCustomer: Record<string, number> = {
    'K-1001': 720, // 12 h
    'K-1002': 1200, // 20 h
    'K-1003': 480, // 8 h – komplett offen
    'K-1004': 600, // 10 h
    'K-1005': 480, // 8 h
    'K-1006': 360, // 6 h
    'K-1007': 960, // 16 h
    'K-1008': 480, // 8 h
    'K-1009': 240, // 4 h
    'K-1010': 600, // 10 h – Budget endet bald (Periodenende!)
  };

  const budgets: Record<string, string> = {};
  for (const [number, minutes] of Object.entries(budgetMinutesByCustomer)) {
    const budget = await db.customerHourBudget.create({
      data: {
        organizationId: org.id,
        customerId: customers[number]!.id,
        periodStart,
        periodEnd,
        budgetMinutes: minutes,
        sourceType: number === 'K-1002' ? 'INSURANCE' : 'CONTRACT',
        note: number === 'K-1002' ? 'Entlastungsbetrag §45b SGB XI' : undefined,
      },
    });
    budgets[number] = budget.id;
  }

  // Korrekturbuchung: K-1007 wurde um 2 h aufgestockt.
  await db.customerHourAdjustment.create({
    data: {
      customerHourBudgetId: budgets['K-1007']!,
      adjustmentMinutes: 120,
      reason: 'Zusätzlicher Bedarf nach Krankenhausaufenthalt',
      createdByUserId: ownerUser.id,
    },
  });

  const allocation = (
    budgetNumber: string,
    toEmployeeId: string,
    minutes: number,
    byEmployeeId: string | null = null,
  ) =>
    db.hourAllocation.create({
      data: {
        organizationId: org.id,
        customerId: customers[budgetNumber]!.id,
        budgetId: budgets[budgetNumber]!,
        allocatedByEmployeeId: byEmployeeId,
        allocatedToEmployeeId: toEmployeeId,
        allocatedMinutes: minutes,
        validFrom: periodStart,
        validUntil: periodEnd,
        status: 'ACTIVE',
      },
    });

  // K-1001 (12 h): 8 h → Maria (Org-Pool), Maria reicht 4 h an Anna weiter.
  await allocation('K-1001', maria.id, 480);
  await allocation('K-1001', anna.id, 240, maria.id);
  // K-1002 (20 h): 10 h → Anna, 5 h → Erik, 5 h offen.
  await allocation('K-1002', anna.id, 600);
  await allocation('K-1002', erik.id, 300);
  // K-1004 (10 h): komplett → Thomas, der 5 h an Erik weitergibt.
  await allocation('K-1004', thomas.id, 600);
  await allocation('K-1004', erik.id, 300, thomas.id);
  // K-1005 (8 h): 4 h → Sofia, Rest offen.
  await allocation('K-1005', sofia.id, 240);
  // K-1006 (6 h): 6 h → Lena.
  await allocation('K-1006', lena.id, 360);
  // K-1007 (16 h + 2 h Korrektur): 8 h → Jonas, Rest offen.
  await allocation('K-1007', jonas.id, 480);
  // K-1008 (8 h): 4 h → Sofia.
  await allocation('K-1008', sofia.id, 240);
  // K-1003, K-1009, K-1010: keine Zuweisungen → offene Kundenstunden.

  console.info('Seed: Serientermine …');
  // Serie 1: wöchentlich, Anna bei Brinkmann (K-1001), nächster passender Tag.
  const series1Weekday = weekdayOf(1); // morgen als Ankertag
  const byday = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'][series1Weekday - 1];
  const series1 = await db.appointmentSeries.create({
    data: {
      organizationId: org.id,
      customerId: customers['K-1001']!.id,
      defaultEmployeeId: anna.id,
      title: 'Wöchentliche Grundreinigung',
      recurrenceRule: `FREQ=WEEKLY;INTERVAL=1;BYDAY=${byday}`,
      recurrenceTimezone: TZ,
      startDate: dayParts(1).dateUtc,
      defaultStartTime: '09:00',
      defaultDurationMinutes: 120,
      status: 'ACTIVE',
      materializedUntil: dayParts(120).dateUtc,
    },
  });
  for (let week = 0; week < 17; week += 1) {
    const offset = 1 + week * 7;
    await db.appointment.create({
      data: {
        organizationId: org.id,
        customerId: customers['K-1001']!.id,
        seriesId: series1.id,
        occurrenceDate: dayParts(offset).dateUtc,
        assignedEmployeeId: anna.id,
        title: 'Wöchentliche Grundreinigung',
        startAt: at(offset, '09:00'),
        endAt: at(offset, '11:00'),
        durationMinutes: 120,
        status: 'PLANNED',
        assignmentStatus: 'ACCEPTED',
        locationAddressId: customers['K-1001']!.addressId,
      },
    });
  }

  // Serie 2: 14-tägig, Jonas bei Uhlenbrock (K-1007) – kollidiert mit Urlaub!
  const series2Weekday = weekdayOf(6);
  const byday2 = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'][series2Weekday - 1];
  const series2 = await db.appointmentSeries.create({
    data: {
      organizationId: org.id,
      customerId: customers['K-1007']!.id,
      defaultEmployeeId: jonas.id,
      title: 'Treppenhaus & Wohnung',
      recurrenceRule: `FREQ=WEEKLY;INTERVAL=2;BYDAY=${byday2}`,
      recurrenceTimezone: TZ,
      startDate: dayParts(6).dateUtc,
      defaultStartTime: '10:00',
      defaultDurationMinutes: 180,
      status: 'ACTIVE',
      materializedUntil: dayParts(120).dateUtc,
    },
  });
  for (let cycle = 0; cycle < 8; cycle += 1) {
    const offset = 6 + cycle * 14;
    await db.appointment.create({
      data: {
        organizationId: org.id,
        customerId: customers['K-1007']!.id,
        seriesId: series2.id,
        occurrenceDate: dayParts(offset).dateUtc,
        assignedEmployeeId: jonas.id,
        title: 'Treppenhaus & Wohnung',
        startAt: at(offset, '10:00'),
        endAt: at(offset, '13:00'),
        durationMinutes: 180,
        status: 'PLANNED',
        assignmentStatus: 'ASSIGNED',
        locationAddressId: customers['K-1007']!.addressId,
      },
    });
  }

  console.info('Seed: Einzeltermine …');
  const single = (data: {
    customer: string;
    employeeId?: string | null;
    title: string;
    offset: number;
    start: string;
    minutes: number;
    status?: 'PLANNED' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
    assignment?: 'UNASSIGNED' | 'ASSIGNED' | 'ACCEPTED' | 'DECLINED';
    flexible?: boolean;
    earliest?: string;
    latest?: string;
    notes?: string;
  }) => {
    const endMinutes =
      Number(data.start.slice(0, 2)) * 60 + Number(data.start.slice(3, 5)) + data.minutes;
    const endTime = `${Math.floor(endMinutes / 60)
      .toString()
      .padStart(2, '0')}:${(endMinutes % 60).toString().padStart(2, '0')}`;
    return db.appointment.create({
      data: {
        organizationId: org.id,
        customerId: customers[data.customer]!.id,
        assignedEmployeeId: data.employeeId ?? null,
        title: data.title,
        startAt: at(data.offset, data.start),
        endAt: at(data.offset, endTime),
        durationMinutes: data.minutes,
        status: data.status ?? 'PLANNED',
        assignmentStatus: data.assignment ?? (data.employeeId ? 'ASSIGNED' : 'UNASSIGNED'),
        isFlexible: data.flexible ?? false,
        earliestStartAt: data.earliest ? at(data.offset, data.earliest) : null,
        latestEndAt: data.latest ? at(data.offset, data.latest) : null,
        locationAddressId: customers[data.customer]!.addressId,
        internalNotes: data.notes,
        completedAt: data.status === 'COMPLETED' ? at(data.offset, endTime) : null,
      },
    });
  };

  // Heute: Annas Tag (inkl. Fahrzeitkonflikt am Nachmittag).
  const todayAnna1 = await single({ customer: 'K-1002', employeeId: anna.id, title: 'Reinigung & Wäsche', offset: 0, start: '08:30', minutes: 120, status: 'CONFIRMED', assignment: 'ACCEPTED' });
  const todayAnna2 = await single({ customer: 'K-1009', employeeId: anna.id, title: 'Kurzreinigung', offset: 0, start: '11:00', minutes: 60, assignment: 'ACCEPTED' });
  // Fahrzeitkonflikt: Averbeck (Norden) endet 14:00, Elvering (Süden) beginnt 14:05.
  const todayAnna3 = await single({ customer: 'K-1005', employeeId: anna.id, title: 'Einkauf & Reinigung', offset: 0, start: '13:00', minutes: 60, assignment: 'ACCEPTED' });
  const todayAnna4 = await single({ customer: 'K-1006', employeeId: anna.id, title: 'Grundreinigung Bad', offset: 0, start: '14:05', minutes: 60, assignment: 'ASSIGNED', notes: 'Knappe Taktung – Fahrzeit prüfen!' });

  // Heute: Erik.
  await single({ customer: 'K-1004', employeeId: erik.id, title: 'Wohnungsreinigung', offset: 0, start: '09:30', minutes: 120, status: 'CONFIRMED', assignment: 'ACCEPTED' });

  // Kommende Tage.
  await single({ customer: 'K-1008', employeeId: sofia.id, title: 'Reinigung', offset: 1, start: '14:00', minutes: 120 });
  await single({ customer: 'K-1005', employeeId: erik.id, title: 'Fensterputz', offset: 2, start: '10:00', minutes: 90 });
  await single({ customer: 'K-1010', employeeId: null, title: 'Erstreinigung nach Renovierung', offset: 2, start: '09:00', minutes: 180, assignment: 'UNASSIGNED', flexible: true, earliest: '08:00', latest: '16:00' });
  await single({ customer: 'K-1003', employeeId: null, title: 'Wohnungsreinigung', offset: 3, start: '10:00', minutes: 120, assignment: 'UNASSIGNED' });
  await single({ customer: 'K-1009', employeeId: null, title: 'Kurzreinigung', offset: 4, start: '11:00', minutes: 60, assignment: 'UNASSIGNED', flexible: true, earliest: '09:00', latest: '17:00' });
  // Abgelehnte Zuweisung → Handlungsbedarf.
  await single({ customer: 'K-1006', employeeId: lena.id, title: 'Bügeln & Reinigung', offset: 3, start: '13:00', minutes: 120, assignment: 'DECLINED', notes: 'Lena hat abgelehnt: Terminüberschneidung privat.' });

  // Vergangene Woche: abgeschlossene Termine mit Zeiterfassung (für Auswertungen).
  const done1 = await single({ customer: 'K-1001', employeeId: anna.id, title: 'Grundreinigung', offset: -6, start: '09:00', minutes: 120, status: 'COMPLETED', assignment: 'ACCEPTED' });
  const done2 = await single({ customer: 'K-1002', employeeId: anna.id, title: 'Reinigung & Wäsche', offset: -5, start: '08:30', minutes: 120, status: 'COMPLETED', assignment: 'ACCEPTED' });
  const done3 = await single({ customer: 'K-1004', employeeId: erik.id, title: 'Wohnungsreinigung', offset: -4, start: '09:30', minutes: 120, status: 'COMPLETED', assignment: 'ACCEPTED' });
  const cancelled = await single({ customer: 'K-1003', employeeId: jonas.id, title: 'Reinigung', offset: -3, start: '10:00', minutes: 120, status: 'CANCELLED', assignment: 'ASSIGNED' });
  await db.appointment.update({
    where: { id: cancelled.id },
    data: { cancellationReason: 'Kundin kurzfristig im Krankenhaus' },
  });

  for (const [appt, employeeId, worked, travel] of [
    [done1, anna.id, 118, 14],
    [done2, anna.id, 125, 12],
    [done3, erik.id, 115, 18],
  ] as const) {
    await db.timeEntry.create({
      data: {
        organizationId: org.id,
        appointmentId: appt.id,
        employeeId,
        startedAt: appt.startAt,
        endedAt: appt.endAt,
        workedMinutes: worked,
        breakMinutes: 0,
        travelMinutes: travel,
        status: 'APPROVED',
        approvedByUserId: ownerUser.id,
        approvedAt: appt.endAt,
      },
    });
  }

  console.info('Seed: Beispielroute (Anna, heute) …');
  const officeStart = {
    label: 'Büro',
    street: 'Servatiiplatz',
    houseNumber: '9',
    postalCode: '48143',
    city: 'Münster',
    countryCode: 'DE',
    latitude: 51.9602,
    longitude: 7.6335,
  };
  const routePlan = await db.routePlan.create({
    data: {
      organizationId: org.id,
      employeeId: anna.id,
      routeDate: dayParts(0).dateUtc,
      startAddress: officeStart,
      endAddress: officeStart,
      provider: 'mock',
      totalDistanceMeters: 14800,
      totalTravelSeconds: 2960,
      totalServiceMinutes: 300,
      plannedDepartureAt: at(0, '08:15'),
      plannedReturnAt: at(0, '15:25'),
      status: 'PUBLISHED',
    },
  });
  const stops = [
    { appt: todayAnna1, travel: 540, dist: 2700 },
    { appt: todayAnna2, travel: 660, dist: 3300 },
    { appt: todayAnna3, travel: 780, dist: 3900 },
    { appt: todayAnna4, travel: 980, dist: 4900, warning: 'Fahrzeit reicht nicht: Ankunft nach geplantem Beginn.' },
  ];
  let sequence = 1;
  for (const stop of stops) {
    const arrival = new Date(stop.appt.startAt.getTime() - 5 * 60 * 1000);
    await db.routeStop.create({
      data: {
        routePlanId: routePlan.id,
        appointmentId: stop.appt.id,
        sequence,
        arrivalAt: arrival,
        serviceStartAt: stop.appt.startAt,
        serviceEndAt: stop.appt.endAt,
        departureAt: stop.appt.endAt,
        travelSecondsFromPrevious: stop.travel,
        distanceMetersFromPrevious: stop.dist,
        warning: stop.warning,
      },
    });
    sequence += 1;
  }

  console.info('Seed: Benachrichtigungen & Audit …');
  await db.notification.create({
    data: {
      organizationId: org.id,
      userId: annaUser.id,
      type: 'APPOINTMENT_ASSIGNED',
      title: 'Neuer Termin zugewiesen',
      message: 'Grundreinigung Bad bei Roswitha Elvering, heute 14:05.',
      targetUrl: '/calendar',
    },
  });
  await db.notification.create({
    data: {
      organizationId: org.id,
      userId: ownerUser.id,
      type: 'ASSIGNMENT_DECLINED',
      title: 'Zuweisung abgelehnt',
      message: 'Lena Fischer hat „Bügeln & Reinigung“ bei Roswitha Elvering abgelehnt.',
      targetUrl: '/calendar',
    },
  });
  await db.notification.create({
    data: {
      organizationId: org.id,
      userId: ownerUser.id,
      type: 'CUSTOMER_OPEN_HOURS',
      title: 'Offene Kundenstunden',
      message: 'Ingrid Schulze-Blasum hat noch 8 offene Stunden in diesem Monat.',
      targetUrl: '/customers',
    },
  });

  await db.auditLog.create({
    data: {
      organizationId: org.id,
      actorUserId: ownerUser.id,
      action: 'organization.created',
      entityType: 'Organization',
      entityId: org.id,
      metadata: { name: org.name, seeded: true },
    },
  });

  console.info('Seed: Fremdorganisation (Mandantentrennung) …');
  const otherOrg = await db.organization.create({
    data: { name: 'Fremde Reinigungs GmbH', slug: 'fremde-reinigung', timezone: TZ },
  });
  const otherUser = await db.user.create({
    data: {
      email: 'fremd@demo.example',
      passwordHash,
      firstName: 'Frida',
      lastName: 'Fremd',
    },
  });
  await db.organizationMembership.create({
    data: { organizationId: otherOrg.id, userId: otherUser.id, role: 'ORGANIZATION_OWNER', status: 'ACTIVE' },
  });
  const otherEmployee = await db.employee.create({
    data: {
      organizationId: otherOrg.id,
      userId: otherUser.id,
      firstName: 'Frida',
      lastName: 'Fremd',
      canReceiveHours: true,
    },
  });
  const otherCustomer = await db.customer.create({
    data: {
      organizationId: otherOrg.id,
      customerNumber: 'F-0001',
      firstName: 'Otto',
      lastName: 'Outsider',
      phone: '+49 30 000000',
      color: '#64748b',
    },
  });
  const otherAddress = await db.address.create({
    data: {
      organizationId: otherOrg.id,
      customerId: otherCustomer.id,
      street: 'Beispielweg',
      houseNumber: '1',
      postalCode: '10115',
      city: 'Berlin',
      latitude: 52.5321,
      longitude: 13.3849,
      geocodingProvider: 'seed',
      geocodingQuality: 'exact',
      geocodedAt: new Date(),
    },
  });
  await db.appointment.create({
    data: {
      organizationId: otherOrg.id,
      customerId: otherCustomer.id,
      assignedEmployeeId: otherEmployee.id,
      title: 'Fremder Termin',
      startAt: at(1, '10:00'),
      endAt: at(1, '11:00'),
      durationMinutes: 60,
      status: 'PLANNED',
      assignmentStatus: 'ASSIGNED',
      locationAddressId: otherAddress.id,
    },
  });

  console.info('Seed abgeschlossen.');
  console.info('Demo-Logins (Passwort jeweils "Demo1234!"):');
  console.info('  owner@demo.example  – Inhaberin Katrin Sommer');
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
