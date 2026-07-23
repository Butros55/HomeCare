import { describe, expect, it } from 'vitest';

import {
  computeCustomerHourStats,
  computeEmployeeHourStats,
  getCustomerAllocatedMinutes,
  getCustomerBudgetMinutes,
  getCustomerCompletedMinutes,
  getCustomerPlannedMinutes,
  getCustomerUnallocatedMinutes,
  getCustomerUnplannedMinutes,
  getEmployeeAllocatedMinutes,
  getEmployeeMissingTargetMinutes,
  getEmployeePlannedMinutes,
  getManagerSelfObligationMinutes,
  validateManagerPoolAllocation,
  validateOrgPoolAllocation,
  type AllocationLike,
  type AppointmentLike,
} from './hours';

const budgets = [
  { id: 'b1', budgetMinutes: 720 },
  { id: 'b2', budgetMinutes: 480 },
];
const adjustments = [
  { customerHourBudgetId: 'b1', adjustmentMinutes: 120 },
  { customerHourBudgetId: 'b1', adjustmentMinutes: -60 },
  { customerHourBudgetId: 'other', adjustmentMinutes: 999 }, // fremdes Budget – ignorieren
];

function alloc(
  id: string,
  to: string,
  minutes: number,
  by: string | null = null,
  status: 'ACTIVE' | 'REVOKED' = 'ACTIVE',
): AllocationLike & { id: string } {
  return {
    id,
    budgetId: 'b1',
    allocatedByEmployeeId: by,
    allocatedToEmployeeId: to,
    allocatedMinutes: minutes,
    status,
  };
}

function appt(
  employee: string | null,
  minutes: number,
  status: AppointmentLike['status'] = 'PLANNED',
  workedMinutes?: number,
): AppointmentLike {
  return { assignedEmployeeId: employee, durationMinutes: minutes, status, workedMinutes };
}

describe('Kundenbudget', () => {
  it('summiert Budgets plus zugehörige Korrekturen', () => {
    expect(getCustomerBudgetMinutes(budgets, adjustments)).toBe(720 + 480 + 120 - 60);
  });

  it('ohne Budgets ist alles 0', () => {
    expect(getCustomerBudgetMinutes([], adjustments)).toBe(0);
  });
});

describe('Kundenzuweisungen', () => {
  it('zählt nur aktive Org-Pool-Zuweisungen', () => {
    const allocations = [
      alloc('a1', 'maria', 480),
      alloc('a2', 'anna', 240, 'maria'), // Weitergabe – zählt NICHT gegen das Kundenbudget
      alloc('a3', 'erik', 120, null, 'REVOKED'),
    ];
    expect(getCustomerAllocatedMinutes(allocations)).toBe(480);
  });

  it('unallocated = Budget − Org-Zuweisungen', () => {
    const allocations = [alloc('a1', 'maria', 480)];
    expect(getCustomerUnallocatedMinutes(budgets, adjustments, allocations)).toBe(1260 - 480);
  });
});

describe('Kundenplanung & Ist-Zeit', () => {
  const appointments = [
    appt('anna', 120, 'PLANNED'),
    appt('anna', 60, 'CONFIRMED'),
    appt('erik', 90, 'IN_PROGRESS'),
    appt('anna', 120, 'COMPLETED', 115),
    appt('anna', 45, 'CANCELLED'),
    appt(null, 60, 'DRAFT'),
    appt('erik', 30, 'NO_SHOW'),
  ];

  it('geplant = PLANNED/CONFIRMED/IN_PROGRESS/COMPLETED', () => {
    expect(getCustomerPlannedMinutes(appointments)).toBe(120 + 60 + 90 + 120);
  });

  it('geleistet = COMPLETED mit Ist-Zeit vor Plan-Dauer', () => {
    expect(getCustomerCompletedMinutes(appointments)).toBe(115);
  });

  it('unplanned = Budget − geplant', () => {
    expect(getCustomerUnplannedMinutes(budgets, adjustments, appointments)).toBe(1260 - 390);
  });

  it('computeCustomerHourStats liefert alle Kennzahlen konsistent', () => {
    const stats = computeCustomerHourStats({
      budgets,
      adjustments,
      allocations: [alloc('a1', 'maria', 480)],
      appointments,
    });
    expect(stats).toEqual({
      budgetMinutes: 1260,
      allocatedMinutes: 480,
      plannedMinutes: 390,
      completedMinutes: 115,
      unallocatedMinutes: 780,
      unplannedMinutes: 870,
    });
  });
});

describe('Mitarbeiterstunden & Manager-Pool', () => {
  const allocations = [
    alloc('a1', 'maria', 480), // Org → Maria
    alloc('a2', 'anna', 240, 'maria'), // Maria → Anna
    alloc('a3', 'anna', 600), // Org → Anna
    alloc('a4', 'lena', 60, 'anna'), // Anna → Lena
  ];

  it('brutto erhaltene Minuten', () => {
    expect(getEmployeeAllocatedMinutes(allocations, 'maria')).toBe(480);
    expect(getEmployeeAllocatedMinutes(allocations, 'anna')).toBe(840);
  });

  it('Eigenverpflichtung = erhalten − weitergegeben', () => {
    expect(getManagerSelfObligationMinutes(allocations, 'maria')).toBe(480 - 240);
    expect(getManagerSelfObligationMinutes(allocations, 'anna')).toBe(840 - 60);
    expect(getManagerSelfObligationMinutes(allocations, 'lena')).toBe(60);
  });

  it('geplante Minuten je Mitarbeiter', () => {
    const appointments = [
      appt('anna', 120),
      appt('anna', 60, 'COMPLETED'),
      appt('anna', 45, 'CANCELLED'),
      appt('erik', 90),
    ];
    expect(getEmployeePlannedMinutes(appointments, 'anna')).toBe(180);
  });

  it('fehlende Zielstunden nie negativ, ohne Ziel 0', () => {
    expect(getEmployeeMissingTargetMinutes(1200, 800)).toBe(400);
    expect(getEmployeeMissingTargetMinutes(1200, 1500)).toBe(0);
    expect(getEmployeeMissingTargetMinutes(null, 500)).toBe(0);
    expect(getEmployeeMissingTargetMinutes(0, 500)).toBe(0);
  });

  it('computeEmployeeHourStats konsistent', () => {
    const stats = computeEmployeeHourStats({
      employeeId: 'anna',
      targetMinutes: 1200,
      allocations,
      appointments: [appt('anna', 120), appt('anna', 60, 'COMPLETED', 55)],
    });
    expect(stats.allocatedMinutes).toBe(840);
    expect(stats.forwardedMinutes).toBe(60);
    expect(stats.selfObligationMinutes).toBe(780);
    expect(stats.plannedMinutes).toBe(180);
    expect(stats.completedMinutes).toBe(55);
    expect(stats.missingByAllocation).toBe(360);
    expect(stats.missingByPlanning).toBe(1020);
  });
});

describe('Zuweisungsvalidierung', () => {
  const allocations = [alloc('a1', 'maria', 480), alloc('a2', 'anna', 600)];

  it('Org-Pool: blockiert Überziehung', () => {
    const result = validateOrgPoolAllocation({
      budgets,
      adjustments,
      allocations,
      requestedMinutes: 300,
    });
    // verfügbar: 1260 − 1080 = 180
    expect(result).toEqual({ ok: false, code: 'HOUR_BUDGET_EXCEEDED', availableMinutes: 180 });
  });

  it('Org-Pool: erlaubt innerhalb des Budgets', () => {
    expect(
      validateOrgPoolAllocation({ budgets, adjustments, allocations, requestedMinutes: 180 }),
    ).toEqual({ ok: true });
  });

  it('Org-Pool: Bearbeitung ignoriert die eigene bestehende Zuweisung', () => {
    expect(
      validateOrgPoolAllocation({
        budgets,
        adjustments,
        allocations,
        requestedMinutes: 700,
        ignoreAllocationId: 'a2',
      }),
    ).toEqual({ ok: true });
  });

  it('Manager-Pool: blockiert Weitergabe über den eigenen Pool hinaus', () => {
    const withForwarding = [...allocations, alloc('a3', 'lena', 400, 'maria')];
    const result = validateManagerPoolAllocation({
      allocations: withForwarding,
      managerEmployeeId: 'maria',
      requestedMinutes: 120,
    });
    // Pool: 480 − 400 = 80
    expect(result).toEqual({ ok: false, code: 'ALLOCATION_POOL_EXCEEDED', availableMinutes: 80 });
  });

  it('Manager-Pool: erlaubt innerhalb des Pools', () => {
    expect(
      validateManagerPoolAllocation({
        allocations,
        managerEmployeeId: 'maria',
        requestedMinutes: 480,
      }),
    ).toEqual({ ok: true });
  });

  it('Negativbudget: Korrektur unter 0 ergibt 0 verfügbare Minuten', () => {
    const result = validateOrgPoolAllocation({
      budgets: [{ id: 'b1', budgetMinutes: 60 }],
      adjustments: [{ customerHourBudgetId: 'b1', adjustmentMinutes: -120 }],
      allocations: [],
      requestedMinutes: 1,
    });
    expect(result).toEqual({ ok: false, code: 'HOUR_BUDGET_EXCEEDED', availableMinutes: 0 });
  });
});
