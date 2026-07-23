import 'server-only';

import type { Prisma } from '@prisma/client';

import type { SearchResultItem } from '@/components/layout/command-palette';
import { formatDateTime } from '@/lib/dates';
import { customerScopeWhere, getManagedEmployeeIds, hasPermission, requireOrganizationMembership } from '@/server/permissions';
import { db } from '@/server/db';
import { employeeScopeFilter } from '@/server/permissions';

const CUSTOMER_LIMIT = 8;
const EMPLOYEE_LIMIT = 8;
const APPOINTMENT_LIMIT = 8;

/**
 * Namenssuche inkl. "Vorname Nachname"-Eingaben: bei mehreren Begriffen
 * werden beide Reihenfolgen (Vor-/Nachname und umgekehrt) geprüft.
 */
function personNameClauses(q: string): Prisma.CustomerWhereInput[] {
  const clauses: Prisma.CustomerWhereInput[] = [
    { firstName: { contains: q, mode: 'insensitive' } },
    { lastName: { contains: q, mode: 'insensitive' } },
  ];
  const terms = q.split(/\s+/).filter(Boolean);
  if (terms.length >= 2) {
    const [first, ...rest] = terms;
    const restJoined = rest.join(' ');
    clauses.push(
      {
        AND: [
          { firstName: { contains: first!, mode: 'insensitive' } },
          { lastName: { contains: restJoined, mode: 'insensitive' } },
        ],
      },
      {
        AND: [
          { lastName: { contains: first!, mode: 'insensitive' } },
          { firstName: { contains: restJoined, mode: 'insensitive' } },
        ],
      },
    );
  }
  return clauses;
}

/**
 * Globale Suche (Anforderung 19): organisationsgebunden, rollen-gescoped,
 * gruppiert nach Kunden / Mitarbeitern / Terminen. Notizen werden nur mit
 * entsprechender Berechtigung durchsucht.
 */
export async function globalSearch(query: string): Promise<SearchResultItem[]> {
  const ctx = await requireOrganizationMembership();
  const q = query.trim();
  if (q.length < 2) return [];

  const orgId = ctx.organization.id;
  const results: SearchResultItem[] = [];
  const canSearchNotes = hasPermission(ctx, 'customers.manage');
  const nameClauses = personNameClauses(q);

  // Kunden (inkl. Telefonnummern, Orte, Kundennummern, optional Notizen).
  if (hasPermission(ctx, 'customers.read')) {
    const scopeWhere = await customerScopeWhere(ctx);
    const customers = await db.customer.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        ...scopeWhere,
        OR: [
          ...nameClauses,
          { companyName: { contains: q, mode: 'insensitive' } },
          { customerNumber: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
          { secondaryPhone: { contains: q } },
          { email: { contains: q, mode: 'insensitive' } },
          {
            addresses: {
              some: {
                OR: [
                  { street: { contains: q, mode: 'insensitive' } },
                  { city: { contains: q, mode: 'insensitive' } },
                  { postalCode: { contains: q } },
                ],
              },
            },
          },
          ...(canSearchNotes
            ? [
                { accessInstructions: { contains: q, mode: 'insensitive' as const } },
                { cleaningInstructions: { contains: q, mode: 'insensitive' as const } },
                { routeNotes: { contains: q, mode: 'insensitive' as const } },
              ]
            : []),
        ],
      },
      include: { addresses: { take: 1 } },
      take: CUSTOMER_LIMIT,
      orderBy: [{ lastName: 'asc' }],
    });
    for (const customer of customers) {
      results.push({
        id: customer.id,
        group: 'Kunden',
        title: `${customer.firstName} ${customer.lastName}`,
        subtitle: [
          customer.customerNumber,
          customer.addresses[0] ? `${customer.addresses[0].postalCode} ${customer.addresses[0].city}` : null,
          customer.phone,
        ]
          .filter(Boolean)
          .join(' · '),
        href: `/customers/${customer.id}`,
        color: customer.color,
      });
    }
  }

  // Mitarbeiter.
  if (hasPermission(ctx, 'employees.read')) {
    const scope = await getManagedEmployeeIds(ctx);
    const employees = await db.employee.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        ...employeeScopeFilter(scope),
        OR: [
          ...(nameClauses as Prisma.EmployeeWhereInput[]),
          { personnelNumber: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
        ],
      },
      take: EMPLOYEE_LIMIT,
      orderBy: [{ lastName: 'asc' }],
    });
    for (const employee of employees) {
      results.push({
        id: employee.id,
        group: 'Mitarbeiter',
        title: `${employee.firstName} ${employee.lastName}`,
        subtitle: employee.personnelNumber ?? employee.email ?? undefined,
        href: `/employees/${employee.id}`,
      });
    }
  }

  // Termine (Titel, Kunde, interne Notizen mit Berechtigung) –
  // kommende zuerst, danach die jüngste Vergangenheit.
  {
    const scope = await getManagedEmployeeIds(ctx);
    const isPlanner = hasPermission(ctx, 'appointments.viewAll');
    const appointmentWhere: Prisma.AppointmentWhereInput = {
      organizationId: orgId,
      deletedAt: null,
      ...(isPlanner
        ? {}
        : scope === 'ALL'
          ? {}
          : { assignedEmployeeId: { in: scope.length > 0 ? scope : ['-'] } }),
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { customer: { OR: personNameClauses(q) } },
        ...(canSearchNotes
          ? [{ internalNotes: { contains: q, mode: 'insensitive' as const } }]
          : []),
      ],
    };
    const now = new Date();
    const include = {
      customer: { select: { firstName: true, lastName: true, color: true } },
    } satisfies Prisma.AppointmentInclude;
    const upcoming = await db.appointment.findMany({
      where: { ...appointmentWhere, startAt: { gte: now } },
      include,
      orderBy: { startAt: 'asc' },
      take: APPOINTMENT_LIMIT,
    });
    const past =
      upcoming.length < APPOINTMENT_LIMIT
        ? await db.appointment.findMany({
            where: { ...appointmentWhere, startAt: { lt: now } },
            include,
            orderBy: { startAt: 'desc' },
            take: APPOINTMENT_LIMIT - upcoming.length,
          })
        : [];
    for (const appointment of [...upcoming, ...past]) {
      results.push({
        id: appointment.id,
        group: 'Termine',
        title: `${appointment.customer.firstName} ${appointment.customer.lastName} · ${appointment.title}`,
        subtitle: formatDateTime(appointment.startAt, ctx.organization.timezone),
        href: `/calendar?termin=${appointment.id}`,
        color: appointment.customer.color,
      });
    }
  }

  return results;
}
