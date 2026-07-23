import 'server-only';

import type { Prisma } from '@prisma/client';

import { monthPeriodInZone } from '@/lib/dates';
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
import { getCustomerHourStatsBulk } from '@/server/services/hours-service';
import type { CustomerFormData, CustomerListParams } from '@/server/validation/customer';

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
    getCustomerHourStatsBulk(ids, period),
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
      budgetMinutes: 0,
      allocatedMinutes: 0,
      plannedMinutes: 0,
      completedMinutes: 0,
      unallocatedMinutes: 0,
      unplannedMinutes: 0,
    },
    nextAppointmentAt: nextByCustomer.get(customer.id) ?? null,
  }));

  if (params.openHours) {
    rows = rows.filter((row) => row.stats.unallocatedMinutes > 0);
  }
  if (params.sort === 'openMinutes') {
    rows.sort((a, b) =>
      params.dir === 'asc'
        ? a.stats.unallocatedMinutes - b.stats.unallocatedMinutes
        : b.stats.unallocatedMinutes - a.stats.unallocatedMinutes,
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
      },
    });
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
      },
    });

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
