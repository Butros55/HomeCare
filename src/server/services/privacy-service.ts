import 'server-only';

import { writeAuditLog } from '@/server/audit';
import { db } from '@/server/db';
import { AppError } from '@/server/errors';
import { assertSameOrg, requirePermission } from '@/server/permissions';

/**
 * DSGVO-Werkzeuge (Anforderung 22):
 *  - Export personenbezogener Kunden-/Mitarbeiterdaten (Art. 15/20)
 *  - Anonymisierung statt Löschung, wenn Historie (Termine/Zeiten) existiert –
 *    Aggregate bleiben konsistent, Personenbezug wird entfernt.
 * Entscheidungen und Begründungen: docs/privacy.md
 */

export async function exportCustomerData(customerId: string) {
  const ctx = await requirePermission('privacy.export');
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    include: {
      addresses: true,
      hourBudgets: { include: { adjustments: true } },
      allocations: true,
      appointments: {
        select: {
          id: true,
          title: true,
          startAt: true,
          endAt: true,
          durationMinutes: true,
          status: true,
          internalNotes: true,
        },
      },
    },
  });
  assertSameOrg(ctx, customer);

  await writeAuditLog({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    action: 'customer.exported',
    entityType: 'Customer',
    entityId: customerId,
  });

  return {
    exportedAt: new Date().toISOString(),
    type: 'customer',
    data: customer,
  };
}

export async function exportEmployeeData(employeeId: string) {
  const ctx = await requirePermission('privacy.export');
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    include: {
      availabilities: true,
      absences: true,
      allocationsReceived: true,
      timeEntries: true,
      appointments: {
        select: {
          id: true,
          title: true,
          startAt: true,
          endAt: true,
          durationMinutes: true,
          status: true,
        },
      },
      user: { select: { email: true, firstName: true, lastName: true, phone: true, lastLoginAt: true } },
    },
  });
  assertSameOrg(ctx, employee);

  await writeAuditLog({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    action: 'employee.exported',
    entityType: 'Employee',
    entityId: employeeId,
  });

  return {
    exportedAt: new Date().toISOString(),
    type: 'employee',
    data: employee,
  };
}

/**
 * Kunde anonymisieren: Personenbezug entfernen, Historie (Termine, Stunden)
 * bleibt für Auswertungen erhalten. Unumkehrbar – nur mit Bestätigung aufrufen.
 */
export async function anonymizeCustomer(customerId: string): Promise<void> {
  const ctx = await requirePermission('privacy.export');
  const customer = await db.customer.findUnique({ where: { id: customerId } });
  assertSameOrg(ctx, customer);
  if (!customer.deletedAt) {
    throw new AppError('CONFLICT', {
      message: 'Bitte den Kunden zuerst archivieren, dann anonymisieren.',
    });
  }

  const pseudonym = `Anonymisiert-${customerId.slice(-6)}`;
  await db.$transaction(async (tx) => {
    await tx.customer.update({
      where: { id: customerId },
      data: {
        firstName: pseudonym,
        lastName: '',
        salutation: null,
        companyName: null,
        email: null,
        phone: null,
        secondaryPhone: null,
        accessInstructions: null,
        cleaningInstructions: null,
        privateNotes: null,
        routeNotes: null,
      },
    });
    await tx.address.updateMany({
      where: { customerId },
      data: {
        street: 'Entfernt',
        houseNumber: '',
        addressAddition: null,
        latitude: null,
        longitude: null,
        geocodingProvider: null,
        geocodingQuality: null,
      },
    });
    // Terminnotizen können Personenbezug enthalten.
    await tx.appointment.updateMany({
      where: { customerId },
      data: { description: null, internalNotes: null },
    });
    await writeAuditLog(
      {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: 'customer.anonymized',
        entityType: 'Customer',
        entityId: customerId,
      },
      tx,
    );
  });
}
