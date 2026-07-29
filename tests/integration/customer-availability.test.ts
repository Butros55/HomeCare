import type { OrgContext } from '@/server/permissions';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({ ctx: null as OrgContext | null }));

vi.mock('@/server/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/permissions')>();
  return {
    ...actual,
    requireOrganizationMembership: async () => {
      if (!authState.ctx) throw new Error('Test-Kontext fehlt');
      return authState.ctx;
    },
    requirePermission: async () => {
      if (!authState.ctx) throw new Error('Test-Kontext fehlt');
      return authState.ctx;
    },
  };
});

import { db } from '@/server/db';
import { collectConflicts } from '@/server/services/appointment-service';
import { replaceCustomerAvailability, updateCustomer } from '@/server/services/customer-service';
import { customerFormSchema } from '@/server/validation/customer';

import { buildContext, createEmployee, createOrg, createUserWithMembership, resetDatabase } from './helpers';

/**
 * Kundenverfügbarkeit hat einen eigenen Bereich (Reiter am Kunden). Sie darf
 * daher weder vom Kundenformular überschrieben werden noch unbemerkt bleiben,
 * wenn ein Termin außerhalb der Zeitfenster liegt.
 */
describe('Kunden-Verfügbarkeit (eigener Bereich)', () => {
  let customerId: string;
  let employeeId: string;

  beforeAll(async () => {
    await resetDatabase();
    const organization = await createOrg('CustAvail');
    const owner = await createUserWithMembership(organization.id, 'ORGANIZATION_OWNER', 'AvailOwner');
    const employee = await createEmployee(organization.id, 'AvailMa', { userId: owner.user.id });
    employeeId = employee.id;
    authState.ctx = buildContext(owner.user, owner.membership, organization, employee);

    const customer = await db.customer.create({
      data: {
        organizationId: organization.id,
        customerNumber: 'CA-1',
        firstName: 'Tim',
        lastName: 'Bojer',
      },
    });
    customerId = customer.id;
    await db.address.create({
      data: {
        organizationId: organization.id,
        customerId: customer.id,
        street: 'Bienenweg',
        houseNumber: '3',
        postalCode: '49811',
        city: 'Lingen',
      },
    });
  });

  afterAll(async () => {
    authState.ctx = null;
    await resetDatabase();
    await db.$disconnect();
  });

  it('speichert und ersetzt die Zeitfenster', async () => {
    await replaceCustomerAvailability({
      customerId,
      slots: [
        { weekday: 1, startTime: '08:00', endTime: '12:00' },
        { weekday: 3, startTime: '14:00', endTime: '18:00' },
      ],
    });
    expect(await db.customerAvailability.count({ where: { customerId } })).toBe(2);

    await replaceCustomerAvailability({
      customerId,
      slots: [{ weekday: 1, startTime: '08:00', endTime: '12:00' }],
    });
    const rows = await db.customerAvailability.findMany({ where: { customerId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.weekday).toBe(1);
  });

  it('bleibt beim Speichern der Kundenstammdaten erhalten', async () => {
    // Vorher: das Formular schickte die Zeitfenster mit – wer sie nicht im
    // Formular pflegte, löschte sie beim Speichern versehentlich.
    const before = await db.customerAvailability.count({ where: { customerId } });
    expect(before).toBeGreaterThan(0);

    const data = customerFormSchema.parse({
      firstName: 'Tim',
      lastName: 'Bojer',
      address: { street: 'Bienenweg', houseNumber: '3', postalCode: '49811', city: 'Lingen' },
    });
    await updateCustomer(customerId, data);

    expect(await db.customerAvailability.count({ where: { customerId } })).toBe(before);
  });

  it('warnt konkret, wenn ein Termin außerhalb der Kundenzeitfenster liegt', async () => {
    await replaceCustomerAvailability({
      customerId,
      slots: [{ weekday: 1, startTime: '08:00', endTime: '12:00' }],
    });

    // Montag, 10.08.2026, 14:00–16:00 Berlin → außerhalb von Mo 08:00–12:00.
    const conflicts = await collectConflicts(authState.ctx!, {
      customerId,
      assignedEmployeeId: employeeId,
      startAt: new Date('2026-08-10T12:00:00.000Z'),
      endAt: new Date('2026-08-10T14:00:00.000Z'),
      durationMinutes: 120,
      routeRelevant: true,
      isFlexible: false,
    });
    const outside = conflicts.find((c) => c.type === 'OUTSIDE_CUSTOMER_AVAILABILITY');
    expect(outside).toBeDefined();
    expect(outside!.message).toContain('Tim Bojer');
    expect(outside!.message).toContain('Montag nur 08:00–12:00');
    expect(outside!.message).toContain('14:00–16:00');
  });

  it('ohne Zeitfenster gibt es keine Kunden-Warnung', async () => {
    await replaceCustomerAvailability({ customerId, slots: [] });
    const conflicts = await collectConflicts(authState.ctx!, {
      customerId,
      assignedEmployeeId: employeeId,
      startAt: new Date('2026-08-10T12:00:00.000Z'),
      endAt: new Date('2026-08-10T14:00:00.000Z'),
      durationMinutes: 120,
      routeRelevant: true,
      isFlexible: false,
    });
    expect(conflicts.some((c) => c.type === 'OUTSIDE_CUSTOMER_AVAILABILITY')).toBe(false);
  });
});
