import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/server/db';
import {
  canAccessCustomer,
  canAccessEmployee,
  customerScopeWhere,
  getManagedEmployeeIds,
} from '@/server/permissions';

import {
  buildContext,
  createEmployee,
  createOrg,
  createUserWithMembership,
  resetDatabase,
} from './helpers';

/**
 * Mandantentrennung & Hierarchie-Scope gegen die echte Datenbank:
 * Ein Benutzer darf niemals Daten einer fremden Organisation lesen oder
 * bearbeiten; Team-Manager sehen nur ihren Unterbaum.
 */
describe('Berechtigungs-Scope (Integration)', () => {
  let ctxOwnerA: Awaited<ReturnType<typeof buildFixtures>>['ctxOwnerA'];
  let ctxManagerA: Awaited<ReturnType<typeof buildFixtures>>['ctxManagerA'];
  let ctxEmployeeA: Awaited<ReturnType<typeof buildFixtures>>['ctxEmployeeA'];
  let ctxOwnerB: Awaited<ReturnType<typeof buildFixtures>>['ctxOwnerB'];
  let ids: Awaited<ReturnType<typeof buildFixtures>>['ids'];

  async function buildFixtures() {
    const orgA = await createOrg('OrgA');
    const orgB = await createOrg('OrgB');

    const ownerA = await createUserWithMembership(orgA.id, 'ORGANIZATION_OWNER', 'OwnerA');
    const managerA = await createUserWithMembership(orgA.id, 'TEAM_MANAGER', 'ManagerA');
    const workerA = await createUserWithMembership(orgA.id, 'EMPLOYEE', 'WorkerA');
    const ownerB = await createUserWithMembership(orgB.id, 'ORGANIZATION_OWNER', 'OwnerB');

    const ownerEmpA = await createEmployee(orgA.id, 'OwnerEmpA', { userId: ownerA.user.id });
    const managerEmpA = await createEmployee(orgA.id, 'ManagerEmpA', {
      userId: managerA.user.id,
      managerEmployeeId: ownerEmpA.id,
    });
    const subEmpA = await createEmployee(orgA.id, 'SubEmpA', {
      userId: workerA.user.id,
      managerEmployeeId: managerEmpA.id,
    });
    const subSubEmpA = await createEmployee(orgA.id, 'SubSubEmpA', {
      managerEmployeeId: subEmpA.id,
    });
    const otherEmpA = await createEmployee(orgA.id, 'OtherEmpA', {
      managerEmployeeId: ownerEmpA.id,
    });
    const empB = await createEmployee(orgB.id, 'EmpB');

    const customerA = await db.customer.create({
      data: { organizationId: orgA.id, customerNumber: 'K-1', firstName: 'Kunde', lastName: 'A' },
    });
    const customerA2 = await db.customer.create({
      data: { organizationId: orgA.id, customerNumber: 'K-2', firstName: 'Kunde', lastName: 'A2' },
    });
    const customerB = await db.customer.create({
      data: { organizationId: orgB.id, customerNumber: 'K-1', firstName: 'Kunde', lastName: 'B' },
    });

    // Kunde A ist dem Unterbaum des Managers zugeordnet (Zuweisung an subEmpA).
    // Konto-Modell: Zuweisung ohne Budget-Bezug.
    await db.hourAllocation.create({
      data: {
        organizationId: orgA.id,
        customerId: customerA.id,
        budgetId: null,
        allocatedToEmployeeId: subEmpA.id,
        allocatedMinutes: 300,
        validFrom: new Date('2026-07-01'),
        validUntil: new Date('2026-07-31'),
      },
    });

    return {
      ctxOwnerA: buildContext(ownerA.user, ownerA.membership, orgA, ownerEmpA),
      ctxManagerA: buildContext(managerA.user, managerA.membership, orgA, managerEmpA),
      ctxEmployeeA: buildContext(workerA.user, workerA.membership, orgA, subEmpA),
      ctxOwnerB: buildContext(ownerB.user, ownerB.membership, orgB, null),
      ids: {
        managerEmpA: managerEmpA.id,
        subEmpA: subEmpA.id,
        subSubEmpA: subSubEmpA.id,
        otherEmpA: otherEmpA.id,
        empB: empB.id,
        customerA: customerA.id,
        customerA2: customerA2.id,
        customerB: customerB.id,
      },
    };
  }

  beforeAll(async () => {
    await resetDatabase();
    const fixtures = await buildFixtures();
    ctxOwnerA = fixtures.ctxOwnerA;
    ctxManagerA = fixtures.ctxManagerA;
    ctxEmployeeA = fixtures.ctxEmployeeA;
    ctxOwnerB = fixtures.ctxOwnerB;
    ids = fixtures.ids;
  });

  afterAll(async () => {
    await resetDatabase();
    await db.$disconnect();
  });

  it('Owner sieht alle Mitarbeiter der eigenen Organisation (ALL)', async () => {
    expect(await getManagedEmployeeIds(ctxOwnerA)).toBe('ALL');
  });

  it('Team-Manager sieht genau den eigenen Unterbaum (rekursiv, zweistufig)', async () => {
    const scope = await getManagedEmployeeIds(ctxManagerA);
    expect(scope).not.toBe('ALL');
    expect([...(scope as string[])].sort()).toEqual(
      [ids.managerEmpA, ids.subEmpA, ids.subSubEmpA].sort(),
    );
  });

  it('Mitarbeiter sieht nur sich selbst', async () => {
    expect(await getManagedEmployeeIds(ctxEmployeeA)).toEqual([ids.subEmpA]);
  });

  it('organisationsfremde Mitarbeiter sind unsichtbar (IDOR-Schutz)', async () => {
    expect(await canAccessEmployee(ctxOwnerA, ids.empB, 'read')).toBe(false);
    expect(await canAccessEmployee(ctxOwnerB, ids.subEmpA, 'read')).toBe(false);
  });

  it('Team-Manager kann Unterbaum verwalten, fremde Kollegen nicht', async () => {
    expect(await canAccessEmployee(ctxManagerA, ids.subSubEmpA, 'manage')).toBe(true);
    expect(await canAccessEmployee(ctxManagerA, ids.otherEmpA, 'read')).toBe(false);
    expect(await canAccessEmployee(ctxManagerA, ids.otherEmpA, 'manage')).toBe(false);
  });

  it('organisationsfremde Kunden sind unsichtbar', async () => {
    expect(await canAccessCustomer(ctxOwnerA, ids.customerB, 'read')).toBe(false);
    expect(await canAccessCustomer(ctxOwnerB, ids.customerA, 'read')).toBe(false);
  });

  it('Team-Manager sieht nur Kunden mit Bezug zum eigenen Bereich', async () => {
    expect(await canAccessCustomer(ctxManagerA, ids.customerA, 'read')).toBe(true);
    expect(await canAccessCustomer(ctxManagerA, ids.customerA2, 'read')).toBe(false);
    // verwalten darf er Kunden grundsätzlich nicht
    expect(await canAccessCustomer(ctxManagerA, ids.customerA, 'manage')).toBe(false);
  });

  it('customerScopeWhere filtert die Kundenliste des Managers korrekt', async () => {
    const where = await customerScopeWhere(ctxManagerA);
    const customers = await db.customer.findMany({
      where: { organizationId: ctxManagerA.organization.id, ...where },
      select: { id: true },
    });
    expect(customers.map((c) => c.id)).toEqual([ids.customerA]);
  });
});
