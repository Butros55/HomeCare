import 'server-only';

import type { Prisma } from '@prisma/client';

import { parseCsv } from '@/lib/csv';
import { calendarDayInZone, monthPeriodInZone, utcDate } from '@/lib/dates';
import {
  CUSTOMER_CSV_COLUMNS,
  matchCsvHeaders,
  parseCustomerStatus,
  parseDecimal,
} from '@/features/customers/csv-schema';
import { writeAuditLog } from '@/server/audit';
import { db } from '@/server/db';
import { AppError } from '@/server/errors';
import {
  assertSameOrg,
  canAccessCustomer,
  customerScopeWhere,
  hasPermission,
  requirePermission,
  requireOrganizationMembership,
  type OrgContext,
} from '@/server/permissions';
import { geocodeAddressCached, getGeocodingProvider } from '@/server/providers/geocoding';
import { getCustomerAccountStatsBulk } from '@/server/services/hours-service';
import {
  customerFormSchema,
  type CustomerFormData,
  type CustomerListParams,
} from '@/server/validation/customer';

const PAGE_SIZE = 25;

/** Nächste Kundennummer im Format K-1001 (fortlaufend je Organisation). */
async function nextCustomerNumber(organizationId: string): Promise<string> {
  const last = await db.customer.findFirst({
    where: { organizationId, customerNumber: { startsWith: 'K-' } },
    orderBy: { customerNumber: 'desc' },
    select: { customerNumber: true },
  });
  const lastNumber = last ? Number(last.customerNumber.replace(/\D/g, '')) : 1000;
  return `K-${(Number.isFinite(lastNumber) ? lastNumber : 1000) + 1}`;
}

// ---------------------------------------------------------------------------
// Liste
// ---------------------------------------------------------------------------

export async function listCustomers(params: CustomerListParams) {
  const ctx = await requirePermission('customers.read');
  const orgId = ctx.organization.id;

  const scopeWhere = await customerScopeWhere(ctx);
  const where: Prisma.CustomerWhereInput = {
    organizationId: orgId,
    ...(params.status === 'ALL'
      ? { deletedAt: null }
      : params.status === 'ARCHIVED'
        ? { OR: [{ status: 'ARCHIVED' }, { deletedAt: { not: null } }] }
        : { status: params.status, deletedAt: null }),
    ...scopeWhere,
  };

  if (params.q) {
    where.AND = [
      {
        OR: [
          { firstName: { contains: params.q, mode: 'insensitive' } },
          { lastName: { contains: params.q, mode: 'insensitive' } },
          { companyName: { contains: params.q, mode: 'insensitive' } },
          { customerNumber: { contains: params.q, mode: 'insensitive' } },
          { phone: { contains: params.q } },
          { email: { contains: params.q, mode: 'insensitive' } },
          { addresses: { some: { OR: [
            { street: { contains: params.q, mode: 'insensitive' } },
            { city: { contains: params.q, mode: 'insensitive' } },
            { postalCode: { contains: params.q } },
          ] } } },
        ],
      },
    ];
  }
  if (params.city) {
    where.addresses = { some: { city: { equals: params.city, mode: 'insensitive' } } };
  }
  if (params.employeeId) {
    where.OR = [
      { preferredEmployeeId: params.employeeId },
      { allocations: { some: { status: 'ACTIVE', allocatedToEmployeeId: params.employeeId } } },
      { appointments: { some: { deletedAt: null, assignedEmployeeId: params.employeeId } } },
    ];
  }

  const total = await db.customer.count({ where });
  const customers = await db.customer.findMany({
    where,
    include: {
      addresses: { take: 1, orderBy: { label: 'asc' } },
      preferredEmployee: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy:
      params.sort === 'city'
        ? [{ lastName: params.dir }]
        : [{ lastName: params.dir }, { firstName: params.dir }],
    skip: (params.page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  const now = new Date();
  const period = monthPeriodInZone(now, ctx.organization.timezone);
  const ids = customers.map((c) => c.id);
  const [statsMap, nextAppointments] = await Promise.all([
    getCustomerAccountStatsBulk(ctx.organization.id, ctx.organization.timezone, ids),
    db.appointment.groupBy({
      by: ['customerId'],
      where: {
        customerId: { in: ids },
        deletedAt: null,
        startAt: { gte: now },
        status: { in: ['PLANNED', 'CONFIRMED'] },
      },
      _min: { startAt: true },
    }),
  ]);
  const nextByCustomer = new Map(nextAppointments.map((n) => [n.customerId, n._min.startAt]));

  let rows = customers.map((customer) => ({
    customer,
    address: customer.addresses[0] ?? null,
    stats: statsMap.get(customer.id) ?? {
      creditedMinutes: 0,
      completedMinutes: 0,
      reservedMinutes: 0,
      balanceMinutes: 0,
      plannableMinutes: 0,
      allocatedMinutes: 0,
      hasAccount: false,
    },
    nextAppointmentAt: nextByCustomer.get(customer.id) ?? null,
  }));

  // „Offen" = Guthaben, das noch keinem Mitarbeiter zugewiesen ist.
  const openOf = (stats: { balanceMinutes: number; allocatedMinutes: number }) =>
    stats.balanceMinutes - stats.allocatedMinutes;

  if (params.openHours) {
    rows = rows.filter((row) => openOf(row.stats) > 0);
  }
  if (params.sort === 'openMinutes') {
    rows.sort((a, b) =>
      params.dir === 'asc'
        ? openOf(a.stats) - openOf(b.stats)
        : openOf(b.stats) - openOf(a.stats),
    );
  } else if (params.sort === 'nextAppointment') {
    const value = (d: Date | null) => (d ? d.getTime() : Number.POSITIVE_INFINITY);
    rows.sort((a, b) =>
      params.dir === 'asc'
        ? value(a.nextAppointmentAt) - value(b.nextAppointmentAt)
        : value(b.nextAppointmentAt) - value(a.nextAppointmentAt),
    );
  } else if (params.sort === 'city') {
    rows.sort((a, b) => {
      const cityA = a.address?.city ?? '';
      const cityB = b.address?.city ?? '';
      return params.dir === 'asc' ? cityA.localeCompare(cityB) : cityB.localeCompare(cityA);
    });
  }

  return {
    rows,
    total,
    page: params.page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    period,
    canManage: hasPermission(ctx, 'customers.manage'),
  };
}

/** Ortsliste für den Filter. */
export async function listCustomerCities(): Promise<string[]> {
  const ctx = await requirePermission('customers.read');
  const cities = await db.address.findMany({
    where: { organizationId: ctx.organization.id, customerId: { not: null } },
    select: { city: true },
    distinct: ['city'],
    orderBy: { city: 'asc' },
  });
  return cities.map((c) => c.city);
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export async function getCustomerDetail(customerId: string) {
  const ctx = await requireOrganizationMembership();
  if (!(await canAccessCustomer(ctx, customerId, 'read'))) {
    throw new AppError('CUSTOMER_NOT_FOUND', { status: 404 });
  }

  const customer = await db.customer.findUnique({
    where: { id: customerId },
    include: {
      addresses: { orderBy: { label: 'asc' } },
      preferredEmployee: { select: { id: true, firstName: true, lastName: true, status: true } },
    },
  });
  assertSameOrg(ctx, customer);

  const canSeePrivateNotes = hasPermission(ctx, 'customers.privateNotes');
  return {
    ctx,
    customer: canSeePrivateNotes ? customer : { ...customer, privateNotes: null },
    canManage: hasPermission(ctx, 'customers.manage'),
    canAllocate:
      hasPermission(ctx, 'hours.allocateOrg') || hasPermission(ctx, 'hours.allocateOwnPool'),
    canSeePrivateNotes,
  };
}

// ---------------------------------------------------------------------------
// Geocoding beim Speichern
// ---------------------------------------------------------------------------

async function resolveCoordinates(data: CustomerFormData): Promise<{
  latitude: number | null;
  longitude: number | null;
  quality: string | null;
  provider: string | null;
  geocodedAt: Date | null;
}> {
  if (data.confirmedCoordinate) {
    return {
      latitude: data.confirmedCoordinate.latitude,
      longitude: data.confirmedCoordinate.longitude,
      quality: data.confirmedCoordinate.quality,
      provider: getGeocodingProvider().name,
      geocodedAt: new Date(),
    };
  }

  const candidates = await geocodeAddressCached({
    street: data.address.street,
    houseNumber: data.address.houseNumber,
    postalCode: data.address.postalCode,
    city: data.address.city,
    countryCode: data.address.countryCode,
  });

  if (candidates.length === 0) {
    // Kein Treffer: Adresse trotzdem speichern, Koordinate offen lassen –
    // routenrelevante Termine melden das später als Konflikt (ADDRESS_MISSING).
    return { latitude: null, longitude: null, quality: 'failed', provider: null, geocodedAt: new Date() };
  }
  if (candidates.length > 1) {
    throw new AppError('GEOCODING_AMBIGUOUS', { details: { candidates } });
  }
  const [best] = candidates;
  return {
    latitude: best!.latitude,
    longitude: best!.longitude,
    quality: best!.quality,
    provider: process.env.GEOCODING_PROVIDER ?? 'mock',
    geocodedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Mutationen
// ---------------------------------------------------------------------------

export async function createCustomer(data: CustomerFormData): Promise<{ customerId: string }> {
  const ctx = await requirePermission('customers.manage');
  const orgId = ctx.organization.id;

  await assertPreferredEmployee(ctx, data.preferredEmployeeId);
  const coords = await resolveCoordinates(data);
  const customerNumber = data.customerNumber ?? (await nextCustomerNumber(orgId));

  const existing = await db.customer.findUnique({
    where: { organizationId_customerNumber: { organizationId: orgId, customerNumber } },
  });
  if (existing) {
    throw new AppError('CONFLICT', { message: `Kundennummer ${customerNumber} ist bereits vergeben.` });
  }

  const customer = await db.$transaction(async (tx) => {
    const created = await tx.customer.create({
      data: {
        organizationId: orgId,
        customerNumber,
        salutation: data.salutation,
        firstName: data.firstName,
        lastName: data.lastName,
        companyName: data.companyName,
        email: data.email,
        phone: data.phone,
        secondaryPhone: data.secondaryPhone,
        status: data.status,
        preferredEmployeeId: data.preferredEmployeeId || null,
        color: data.color,
        accessInstructions: data.accessInstructions,
        cleaningInstructions: data.cleaningInstructions,
        privateNotes: data.privateNotes,
        routeNotes: data.routeNotes,
        defaultAppointmentDurationMinutes: data.defaultAppointmentDurationMinutes,
      },
    });
    if (data.availability.length > 0) {
      await tx.customerAvailability.createMany({
        data: data.availability.map((slot) => ({
          customerId: created.id,
          weekday: slot.weekday,
          startTime: slot.startTime,
          endTime: slot.endTime,
        })),
      });
    }
    await tx.address.create({
      data: {
        organizationId: orgId,
        customerId: created.id,
        label: 'Hauptadresse',
        street: data.address.street,
        houseNumber: data.address.houseNumber,
        addressAddition: data.address.addressAddition,
        postalCode: data.address.postalCode,
        city: data.address.city,
        countryCode: data.address.countryCode,
        latitude: coords.latitude,
        longitude: coords.longitude,
        geocodingProvider: coords.provider,
        geocodingQuality: coords.quality,
        geocodedAt: coords.geocodedAt,
      },
    });
    await writeAuditLog(
      {
        organizationId: orgId,
        actorUserId: ctx.user.id,
        action: 'customer.created',
        entityType: 'Customer',
        entityId: created.id,
        metadata: { customerNumber, name: `${data.firstName} ${data.lastName}` },
      },
      tx,
    );
    return created;
  });

  return { customerId: customer.id };
}

export async function updateCustomer(
  customerId: string,
  data: CustomerFormData,
): Promise<void> {
  const ctx = await requirePermission('customers.manage');
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    include: { addresses: { take: 1, orderBy: { label: 'asc' } } },
  });
  assertSameOrg(ctx, customer);
  await assertPreferredEmployee(ctx, data.preferredEmployeeId);

  const address = customer.addresses[0] ?? null;
  const addressChanged =
    !address ||
    address.street !== data.address.street ||
    address.houseNumber !== data.address.houseNumber ||
    address.postalCode !== data.address.postalCode ||
    address.city !== data.address.city ||
    address.countryCode !== data.address.countryCode;

  // Nur bei geänderter Adresse neu geocoden – nie bei jedem Speichern.
  const coords = addressChanged || data.confirmedCoordinate ? await resolveCoordinates(data) : null;

  const changedFields = diffFields(customer, {
    salutation: data.salutation ?? null,
    firstName: data.firstName,
    lastName: data.lastName,
    companyName: data.companyName ?? null,
    email: data.email ?? null,
    phone: data.phone ?? null,
    secondaryPhone: data.secondaryPhone ?? null,
    status: data.status,
    preferredEmployeeId: data.preferredEmployeeId || null,
    color: data.color,
    accessInstructions: data.accessInstructions ?? null,
    cleaningInstructions: data.cleaningInstructions ?? null,
    routeNotes: data.routeNotes ?? null,
  });

  await db.$transaction(async (tx) => {
    await tx.customer.update({
      where: { id: customerId },
      data: {
        salutation: data.salutation ?? null,
        firstName: data.firstName,
        lastName: data.lastName,
        companyName: data.companyName ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        secondaryPhone: data.secondaryPhone ?? null,
        status: data.status,
        preferredEmployeeId: data.preferredEmployeeId || null,
        color: data.color,
        accessInstructions: data.accessInstructions ?? null,
        cleaningInstructions: data.cleaningInstructions ?? null,
        // privateNotes nur ändern, wenn die Berechtigung besteht.
        ...(hasPermission(ctx, 'customers.privateNotes')
          ? { privateNotes: data.privateNotes ?? null }
          : {}),
        routeNotes: data.routeNotes ?? null,
        defaultAppointmentDurationMinutes: data.defaultAppointmentDurationMinutes,
      },
    });

    // Verfügbarkeits-Zeitfenster vollständig ersetzen (leer = uneingeschränkt).
    await tx.customerAvailability.deleteMany({ where: { customerId } });
    if (data.availability.length > 0) {
      await tx.customerAvailability.createMany({
        data: data.availability.map((slot) => ({
          customerId,
          weekday: slot.weekday,
          startTime: slot.startTime,
          endTime: slot.endTime,
        })),
      });
    }

    if (address) {
      await tx.address.update({
        where: { id: address.id },
        data: {
          street: data.address.street,
          houseNumber: data.address.houseNumber,
          addressAddition: data.address.addressAddition ?? null,
          postalCode: data.address.postalCode,
          city: data.address.city,
          countryCode: data.address.countryCode,
          ...(coords
            ? {
                latitude: coords.latitude,
                longitude: coords.longitude,
                geocodingProvider: coords.provider,
                geocodingQuality: coords.quality,
                geocodedAt: coords.geocodedAt,
              }
            : {}),
        },
      });
    } else {
      await tx.address.create({
        data: {
          organizationId: ctx.organization.id,
          customerId,
          label: 'Hauptadresse',
          street: data.address.street,
          houseNumber: data.address.houseNumber,
          addressAddition: data.address.addressAddition,
          postalCode: data.address.postalCode,
          city: data.address.city,
          countryCode: data.address.countryCode,
          latitude: coords?.latitude ?? null,
          longitude: coords?.longitude ?? null,
          geocodingProvider: coords?.provider ?? null,
          geocodingQuality: coords?.quality ?? null,
          geocodedAt: coords?.geocodedAt ?? null,
        },
      });
    }

    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: 'customer.updated',
        entityType: 'Customer',
        entityId: customerId,
        metadata: { changedFields, addressChanged },
      },
      tx,
    );
  });
}

/** Archivieren statt löschen; harte Löschung gibt es bewusst nicht (Soft Delete). */
export async function archiveCustomer(customerId: string): Promise<void> {
  const ctx = await requirePermission('customers.manage');
  const customer = await db.customer.findUnique({ where: { id: customerId } });
  assertSameOrg(ctx, customer);

  await db.$transaction(async (tx) => {
    await tx.customer.update({
      where: { id: customerId },
      data: { status: 'ARCHIVED', deletedAt: new Date() },
    });
    // Zukünftige Termine des Kunden absagen (Vergangenheit bleibt Historie).
    await tx.appointment.updateMany({
      where: {
        customerId,
        deletedAt: null,
        startAt: { gte: new Date() },
        status: { in: ['DRAFT', 'PLANNED', 'CONFIRMED'] },
      },
      data: { status: 'CANCELLED', cancellationReason: 'Kunde archiviert' },
    });
    await tx.appointmentSeries.updateMany({
      where: { customerId, status: 'ACTIVE' },
      data: { status: 'ENDED' },
    });
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: 'customer.archived',
        entityType: 'Customer',
        entityId: customerId,
      },
      tx,
    );
  });
}

export async function restoreCustomer(customerId: string): Promise<void> {
  const ctx = await requirePermission('customers.manage');
  const customer = await db.customer.findUnique({ where: { id: customerId } });
  assertSameOrg(ctx, customer);

  await db.$transaction(async (tx) => {
    await tx.customer.update({
      where: { id: customerId },
      data: { status: 'ACTIVE', deletedAt: null },
    });
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: 'customer.restored',
        entityType: 'Customer',
        entityId: customerId,
      },
      tx,
    );
  });
}

// ---------------------------------------------------------------------------
// CSV-Import
// ---------------------------------------------------------------------------

export type CustomerImportIssue = { line: number; message: string };
export type CustomerImportResult = {
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: CustomerImportIssue[];
  warnings: CustomerImportIssue[];
};

const IMPORT_MAX_ROWS = 500;

type ImportRow = {
  line: number;
  data: CustomerFormData;
  customerNumber: string | null;
  preferredEmployeeNumber: string | null;
  monthlyHours: number | null;
};

/**
 * CSV-Import von Kunden: validiert zeilenweise (Teilimport – gültige Zeilen
 * werden übernommen, fehlerhafte mit Zeilennummer gemeldet), erkennt
 * Duplikate über die Kundennummer und geocodiert Adressen best-effort
 * (mitgelieferte Koordinaten aus einem Export werden direkt übernommen).
 */
export async function importCustomersCsv(input: {
  csvText: string;
  updateExisting: boolean;
}): Promise<CustomerImportResult> {
  const ctx = await requirePermission('customers.manage');
  const orgId = ctx.organization.id;
  const canPrivateNotes = hasPermission(ctx, 'customers.privateNotes');
  const canBudgets = hasPermission(ctx, 'budgets.manage');

  const parsed = parseCsv(input.csvText);
  if (parsed.records.length === 0) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'Die Datei enthält keine Datenzeilen (nur Kopfzeile oder leer).',
    });
  }
  if (parsed.records.length > IMPORT_MAX_ROWS) {
    throw new AppError('VALIDATION_FAILED', {
      message: `Höchstens ${IMPORT_MAX_ROWS} Zeilen pro Import – die Datei hat ${parsed.records.length}. Bitte aufteilen.`,
    });
  }

  const { mapping, unknown, missingRequired } = matchCsvHeaders(parsed.header);
  if (missingRequired.length > 0) {
    throw new AppError('VALIDATION_FAILED', {
      message: `Pflichtspalten fehlen: ${missingRequired.join(', ')}. Bitte die Vorlage verwenden.`,
    });
  }

  const errors: CustomerImportIssue[] = [];
  const warnings: CustomerImportIssue[] = [];
  if (unknown.length > 0) {
    warnings.push({
      line: parsed.headerLine,
      message: `Unbekannte Spalten werden ignoriert: ${unknown.join(', ')}.`,
    });
  }

  const labelByKey = new Map(CUSTOMER_CSV_COLUMNS.map((c) => [c.key, c.label] as const));

  // Nachschlagen: Personalnummer → Mitarbeiter, Kundennummer → Bestand (mit Adresse).
  const employees = await db.employee.findMany({
    where: { organizationId: orgId, deletedAt: null, personnelNumber: { not: null } },
    select: { id: true, personnelNumber: true },
  });
  const employeeByNumber = new Map(
    employees.map((e) => [e.personnelNumber!.trim().toLowerCase(), e.id] as const),
  );
  const existingCustomers = await db.customer.findMany({
    where: { organizationId: orgId },
    select: {
      id: true,
      customerNumber: true,
      deletedAt: true,
      addresses: { take: 1, orderBy: { label: 'asc' } },
    },
  });
  const existingByNumber = new Map(
    existingCustomers.map((c) => [c.customerNumber.trim().toLowerCase(), c] as const),
  );

  // ---- Zeilen einlesen & validieren -----------------------------------------
  const rows: ImportRow[] = [];
  const seenNumbers = new Set<string>();
  let budgetPermissionWarned = false;

  for (const record of parsed.records) {
    const value = (key: (typeof CUSTOMER_CSV_COLUMNS)[number]['key']): string => {
      const index = mapping.indexOf(key);
      return index >= 0 ? (record.fields[index] ?? '').trim() : '';
    };

    const status = parseCustomerStatus(value('status'));
    if (!status) {
      errors.push({
        line: record.line,
        message: `Unbekannter Status „${value('status')}“ – erlaubt sind Aktiv, Pausiert, Archiviert.`,
      });
      continue;
    }

    const monthlyHoursRaw = value('monthlyHours');
    const monthlyHours = monthlyHoursRaw === '' ? null : parseDecimal(monthlyHoursRaw);
    if (monthlyHoursRaw !== '' && (monthlyHours === null || monthlyHours < 0 || monthlyHours > 1000)) {
      errors.push({
        line: record.line,
        message: `„Stunden pro Monat“: ungültiger Wert „${monthlyHoursRaw}“ (Zahl wie „12“ oder „12,5“ erwartet).`,
      });
      continue;
    }

    const latRaw = value('latitude');
    const lngRaw = value('longitude');
    let coordinate: { latitude: number; longitude: number } | undefined;
    if (latRaw !== '' || lngRaw !== '') {
      const lat = parseDecimal(latRaw);
      const lng = parseDecimal(lngRaw);
      if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        warnings.push({
          line: record.line,
          message: 'Breiten-/Längengrad unvollständig oder ungültig – Adresse wird stattdessen geocodiert.',
        });
      } else {
        coordinate = { latitude: lat, longitude: lng };
      }
    }

    const parsedRow = customerFormSchema.safeParse({
      salutation: value('salutation'),
      firstName: value('firstName'),
      lastName: value('lastName'),
      companyName: value('companyName'),
      customerNumber: value('customerNumber'),
      email: value('email'),
      phone: value('phone'),
      secondaryPhone: value('secondaryPhone'),
      status,
      preferredEmployeeId: '',
      color: value('color') || '#6c5ce7',
      accessInstructions: value('accessInstructions'),
      cleaningInstructions: value('cleaningInstructions'),
      privateNotes: canPrivateNotes ? value('privateNotes') : '',
      routeNotes: value('routeNotes'),
      address: {
        street: value('street'),
        houseNumber: value('houseNumber'),
        addressAddition: value('addressAddition'),
        postalCode: value('postalCode'),
        city: value('city'),
        countryCode: value('countryCode') || 'DE',
      },
      confirmedCoordinate: coordinate ? { ...coordinate, quality: 'imported' } : undefined,
    });
    if (!parsedRow.success) {
      const issue = parsedRow.error.issues[0]!;
      const key = String(issue.path[issue.path.length - 1] ?? '');
      const label = labelByKey.get(key as never);
      errors.push({
        line: record.line,
        message: `${label ? `${label}: ` : ''}${issue.message}`,
      });
      continue;
    }

    const customerNumber = parsedRow.data.customerNumber ?? null;
    if (customerNumber) {
      const normalized = customerNumber.toLowerCase();
      if (seenNumbers.has(normalized)) {
        errors.push({
          line: record.line,
          message: `Kundennummer ${customerNumber} kommt in der Datei mehrfach vor – Zeile übersprungen.`,
        });
        continue;
      }
      seenNumbers.add(normalized);
    }

    if (!canPrivateNotes && value('privateNotes') !== '') {
      warnings.push({
        line: record.line,
        message: '„Private Notizen“ übersprungen (keine Berechtigung).',
      });
    }

    rows.push({
      line: record.line,
      data: parsedRow.data,
      customerNumber,
      preferredEmployeeNumber: value('preferredEmployeeNumber') || null,
      monthlyHours,
    });
  }

  // ---- Schreiben (pro Zeile eine kleine Transaktion) ------------------------
  let created = 0;
  let updated = 0;
  let skipped = 0;

  // Fortlaufende Auto-Nummern ohne DB-Roundtrip je Zeile.
  let autoCounter: number | null = null;
  const takenNumbers = new Set(existingByNumber.keys());
  const nextAutoNumber = async (): Promise<string> => {
    if (autoCounter === null) {
      const first = await nextCustomerNumber(orgId);
      autoCounter = Number(first.replace(/\D/g, ''));
    }
    let candidate: string;
    do {
      candidate = `K-${autoCounter}`;
      autoCounter += 1;
    } while (takenNumbers.has(candidate.toLowerCase()));
    takenNumbers.add(candidate.toLowerCase());
    return candidate;
  };

  const today = calendarDayInZone(new Date(), ctx.organization.timezone);
  const monthStart = utcDate(today.year, today.month, 1);

  for (const row of rows) {
    const existing = row.customerNumber
      ? existingByNumber.get(row.customerNumber.toLowerCase())
      : undefined;

    if (existing && !input.updateExisting) {
      skipped += 1;
      continue;
    }

    // Zuständigen Mitarbeiter auflösen (Warnung statt Fehler bei Unbekannt).
    let preferredEmployeeId: string | null = null;
    if (row.preferredEmployeeNumber) {
      preferredEmployeeId =
        employeeByNumber.get(row.preferredEmployeeNumber.toLowerCase()) ?? null;
      if (!preferredEmployeeId) {
        warnings.push({
          line: row.line,
          message: `Personalnummer „${row.preferredEmployeeNumber}“ nicht gefunden – „Zuständig“ bleibt leer.`,
        });
      }
    }

    // Koordinaten: mitgeliefert > Geocoding (nur wenn nötig) > offen.
    const address = row.data.address;
    const existingAddress = existing?.addresses[0] ?? null;
    const addressChanged =
      !existingAddress ||
      existingAddress.street !== address.street ||
      existingAddress.houseNumber !== address.houseNumber ||
      existingAddress.postalCode !== address.postalCode ||
      existingAddress.city !== address.city ||
      existingAddress.countryCode !== address.countryCode;

    let coords: {
      latitude: number | null;
      longitude: number | null;
      quality: string | null;
      provider: string | null;
      geocodedAt: Date | null;
    } | null = null;
    if (row.data.confirmedCoordinate) {
      coords = {
        latitude: row.data.confirmedCoordinate.latitude,
        longitude: row.data.confirmedCoordinate.longitude,
        quality: 'imported',
        provider: 'import',
        geocodedAt: new Date(),
      };
    } else if (!existing || addressChanged) {
      try {
        const candidates = await geocodeAddressCached({
          street: address.street,
          houseNumber: address.houseNumber,
          postalCode: address.postalCode,
          city: address.city,
          countryCode: address.countryCode,
        });
        const best = candidates[0] ?? null;
        coords = best
          ? {
              latitude: best.latitude,
              longitude: best.longitude,
              quality: best.quality,
              provider: getGeocodingProvider().name,
              geocodedAt: new Date(),
            }
          : { latitude: null, longitude: null, quality: 'failed', provider: null, geocodedAt: new Date() };
        if (!best) {
          warnings.push({
            line: row.line,
            message: `Adresse „${address.street} ${address.houseNumber}, ${address.postalCode} ${address.city}“ wurde nicht gefunden – Kunde ohne Koordinate gespeichert (Routen melden das als Konflikt).`,
          });
        }
      } catch {
        coords = { latitude: null, longitude: null, quality: 'failed', provider: null, geocodedAt: new Date() };
        warnings.push({ line: row.line, message: 'Geocoding vorübergehend nicht verfügbar – Koordinate bleibt offen.' });
      }
    }

    try {
      if (existing) {
        await db.$transaction(async (tx) => {
          await tx.customer.update({
            where: { id: existing.id },
            data: {
              salutation: row.data.salutation ?? null,
              firstName: row.data.firstName,
              lastName: row.data.lastName,
              companyName: row.data.companyName ?? null,
              email: row.data.email ?? null,
              phone: row.data.phone ?? null,
              secondaryPhone: row.data.secondaryPhone ?? null,
              status: row.data.status,
              preferredEmployeeId,
              color: row.data.color,
              accessInstructions: row.data.accessInstructions ?? null,
              cleaningInstructions: row.data.cleaningInstructions ?? null,
              ...(canPrivateNotes ? { privateNotes: row.data.privateNotes ?? null } : {}),
              routeNotes: row.data.routeNotes ?? null,
              // Import reaktiviert keine archivierten Kunden versehentlich:
              // Status kommt aus der Datei, deletedAt folgt dem Status.
              deletedAt: row.data.status === 'ARCHIVED' ? (existing.deletedAt ?? new Date()) : null,
            },
          });
          const addressData = {
            street: address.street,
            houseNumber: address.houseNumber,
            addressAddition: address.addressAddition ?? null,
            postalCode: address.postalCode,
            city: address.city,
            countryCode: address.countryCode,
            ...(coords
              ? {
                  latitude: coords.latitude,
                  longitude: coords.longitude,
                  geocodingProvider: coords.provider,
                  geocodingQuality: coords.quality,
                  geocodedAt: coords.geocodedAt,
                }
              : {}),
          };
          if (existingAddress) {
            await tx.address.update({ where: { id: existingAddress.id }, data: addressData });
          } else {
            await tx.address.create({
              data: { organizationId: orgId, customerId: existing.id, label: 'Hauptadresse', ...addressData },
            });
          }
          await writeAuditLog(
            {
              organizationId: orgId,
              actorUserId: ctx.user.id,
              action: 'customer.updated',
              entityType: 'Customer',
              entityId: existing.id,
              metadata: { source: 'csv-import', line: row.line },
            },
            tx,
          );
        });
        updated += 1;
      } else {
        const customerNumber = row.customerNumber ?? (await nextAutoNumber());
        const customerId = await db.$transaction(async (tx) => {
          const createdCustomer = await tx.customer.create({
            data: {
              organizationId: orgId,
              customerNumber,
              salutation: row.data.salutation,
              firstName: row.data.firstName,
              lastName: row.data.lastName,
              companyName: row.data.companyName,
              email: row.data.email,
              phone: row.data.phone,
              secondaryPhone: row.data.secondaryPhone,
              status: row.data.status,
              deletedAt: row.data.status === 'ARCHIVED' ? new Date() : null,
              preferredEmployeeId,
              color: row.data.color,
              accessInstructions: row.data.accessInstructions,
              cleaningInstructions: row.data.cleaningInstructions,
              privateNotes: row.data.privateNotes,
              routeNotes: row.data.routeNotes,
            },
          });
          await tx.address.create({
            data: {
              organizationId: orgId,
              customerId: createdCustomer.id,
              label: 'Hauptadresse',
              street: address.street,
              houseNumber: address.houseNumber,
              addressAddition: address.addressAddition,
              postalCode: address.postalCode,
              city: address.city,
              countryCode: address.countryCode,
              latitude: coords?.latitude ?? null,
              longitude: coords?.longitude ?? null,
              geocodingProvider: coords?.provider ?? null,
              geocodingQuality: coords?.quality ?? null,
              geocodedAt: coords?.geocodedAt ?? null,
            },
          });
          if (row.monthlyHours && row.monthlyHours > 0) {
            if (canBudgets) {
              // Konto-Modell: „Stunden pro Monat" → monatlich wiederkehrende
              // Aufladung ab Monatsanfang (füllt das Stundenkonto automatisch).
              await tx.customerRecurringHourGrant.create({
                data: {
                  organizationId: orgId,
                  customerId: createdCustomer.id,
                  minutes: Math.round(row.monthlyHours * 60),
                  intervalUnit: 'MONTH',
                  intervalCount: 1,
                  startDate: monthStart,
                  note: 'CSV-Import',
                  createdByUserId: ctx.user.id,
                },
              });
            } else if (!budgetPermissionWarned) {
              budgetPermissionWarned = true;
              warnings.push({
                line: row.line,
                message: '„Stunden pro Monat“ übersprungen – dafür fehlt die Berechtigung „Stundenbudgets verwalten“.',
              });
            }
          }
          await writeAuditLog(
            {
              organizationId: orgId,
              actorUserId: ctx.user.id,
              action: 'customer.created',
              entityType: 'Customer',
              entityId: createdCustomer.id,
              metadata: {
                customerNumber,
                name: `${row.data.firstName} ${row.data.lastName}`,
                source: 'csv-import',
              },
            },
            tx,
          );
          return createdCustomer.id;
        });
        // Neu angelegte Nummern für Folgezeilen als vergeben markieren.
        existingByNumber.set(customerNumber.toLowerCase(), {
          id: customerId,
          customerNumber,
          deletedAt: null,
          addresses: [],
        } as (typeof existingCustomers)[number]);
        created += 1;
      }
    } catch (error) {
      console.error('[customer-import] Zeile fehlgeschlagen:', error);
      errors.push({
        line: row.line,
        message: 'Zeile konnte nicht gespeichert werden (unerwarteter Fehler).',
      });
    }
  }

  await writeAuditLog({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    action: 'customer.csvImported',
    entityType: 'Customer',
    entityId: 'bulk',
    metadata: { totalRows: parsed.records.length, created, updated, skipped, errorCount: errors.length },
  });

  return { totalRows: parsed.records.length, created, updated, skipped, errors, warnings };
}

// ---------------------------------------------------------------------------

async function assertPreferredEmployee(ctx: OrgContext, employeeId: string | undefined) {
  if (!employeeId) return;
  const employee = await db.employee.findUnique({ where: { id: employeeId } });
  assertSameOrg(ctx, employee);
}

function diffFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys(after).filter((key) => {
    const a = before[key] ?? null;
    const b = after[key] ?? null;
    return a !== b;
  });
}
