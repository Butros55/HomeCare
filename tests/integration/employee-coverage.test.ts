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
import { updateEmployeeCoverage } from '@/server/services/employee-service';

import { buildContext, createEmployee, createOrg, createUserWithMembership, resetDatabase } from './helpers';

describe('Zuständigkeitsgebiet speichern (updateEmployeeCoverage)', () => {
  let employeeId: string;

  beforeAll(async () => {
    await resetDatabase();
    const organization = await createOrg('CoverageOrg');
    const owner = await createUserWithMembership(organization.id, 'ORGANIZATION_OWNER', 'CoverageOwner');
    const ownEmployee = await createEmployee(organization.id, 'CoverageOwner', { userId: owner.user.id });
    authState.ctx = buildContext(owner.user, owner.membership, organization, ownEmployee);
    const employee = await createEmployee(organization.id, 'Gebiet');
    employeeId = employee.id;
  });

  afterAll(async () => {
    authState.ctx = null;
    await resetDatabase();
    await db.$disconnect();
  });

  it('speichert Umkreis + Zuhause-Zentrum ohne manuelle Adresse', async () => {
    await updateEmployeeCoverage({ employeeId, radiusKm: 20, useHome: true, center: null });
    const employee = await db.employee.findUnique({ where: { id: employeeId } });
    expect(employee?.coverageRadiusKm).toBe(20);
    expect(employee?.coverageUseHome).toBe(true);
    expect(employee?.coverageCenter).toBeNull();
  });

  it('geokodiert und speichert ein manuelles Zentrum', async () => {
    const result = await updateEmployeeCoverage({
      employeeId,
      radiusKm: 15,
      useHome: false,
      center: { street: 'Domplatz', houseNumber: '1', postalCode: '48143', city: 'Münster' },
    });
    expect(result.geocoded).toBe(true); // Mock-Geocoder liefert immer Koordinaten
    const employee = await db.employee.findUnique({ where: { id: employeeId } });
    expect(employee?.coverageUseHome).toBe(false);
    expect(employee?.coverageCenter).toMatchObject({ city: 'Münster', label: 'Zuhause' });
    const center = employee?.coverageCenter as { latitude: number; longitude: number };
    expect(typeof center.latitude).toBe('number');
  });

  it('entfernt den Umkreis wieder (unbeschränkt)', async () => {
    await updateEmployeeCoverage({ employeeId, radiusKm: null, useHome: false, center: null });
    const employee = await db.employee.findUnique({ where: { id: employeeId } });
    expect(employee?.coverageRadiusKm).toBeNull();
  });
});
