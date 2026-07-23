/**
 * Reine Stundenberechnungen (Kernlogik, Anforderung 6).
 *
 * Alle Werte sind ganzzahlige Minuten. Diese Funktionen sind bewusst frei von
 * Datenbankzugriff: Die Services (src/server/services/hours-service.ts) laden
 * die Datensätze und delegieren hierher – dadurch sind sämtliche Regeln und
 * Grenzfälle unit-testbar (src/lib/hours.test.ts).
 *
 * Begriffsmodell (strikt getrennt, niemals vermischt):
 *  - Budget:       vom Kunden gebuchte Minuten (+ Korrekturen)
 *  - Zuweisung:    an Mitarbeiter übertragene Minuten (HourAllocation)
 *  - Planung:      in aktiven Terminen verplante Minuten (Appointment)
 *  - Ist-Zeit:     tatsächlich geleistete Minuten (COMPLETED/TimeEntry)
 *
 * Pool-Modell (IMPLEMENTATION_PLAN A4):
 *  - allocatedByEmployeeId = null  → Zuweisung aus dem Org-Budget
 *    (verbraucht das Kundenbudget).
 *  - allocatedByEmployeeId = M     → Weitergabe aus dem Pool von M
 *    (verbraucht M's erhaltene Stunden, NICHT erneut das Kundenbudget).
 */

export interface BudgetLike {
  id: string;
  budgetMinutes: number;
}

export interface AdjustmentLike {
  customerHourBudgetId: string;
  adjustmentMinutes: number;
}

export interface AllocationLike {
  /** Konto-Modell: neue Zuweisungen haben keinen Budget-Bezug mehr (null). */
  budgetId: string | null;
  allocatedByEmployeeId: string | null;
  allocatedToEmployeeId: string;
  allocatedMinutes: number;
  status: 'ACTIVE' | 'REVOKED';
}

export interface AppointmentLike {
  assignedEmployeeId: string | null;
  durationMinutes: number;
  status:
    | 'DRAFT'
    | 'PLANNED'
    | 'CONFIRMED'
    | 'IN_PROGRESS'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'NO_SHOW';
  /** Ist-Minuten aus einer (freigegebenen) Zeiterfassung, falls vorhanden. */
  workedMinutes?: number | null;
}

/** Termin-Status, die als "geplant" zählen (A5). */
export const PLANNED_STATUSES = ['PLANNED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] as const;

function isPlanned(appointment: AppointmentLike): boolean {
  return (PLANNED_STATUSES as readonly string[]).includes(appointment.status);
}

function activeAllocations(allocations: AllocationLike[]): AllocationLike[] {
  return allocations.filter((a) => a.status === 'ACTIVE');
}

// ---------------------------------------------------------------------------
// Kundensicht
// ---------------------------------------------------------------------------

/** Budget + Korrekturen ("korrigierte Kundenstunden"). */
export function getCustomerBudgetMinutes(
  budgets: BudgetLike[],
  adjustments: AdjustmentLike[],
): number {
  const budgetSum = budgets.reduce((sum, b) => sum + b.budgetMinutes, 0);
  const budgetIds = new Set(budgets.map((b) => b.id));
  const adjustmentSum = adjustments
    .filter((a) => budgetIds.has(a.customerHourBudgetId))
    .reduce((sum, a) => sum + a.adjustmentMinutes, 0);
  return budgetSum + adjustmentSum;
}

/**
 * An Mitarbeiter übertragene Minuten aus Kundensicht.
 * Nur Org-Pool-Zuweisungen zählen – Weitergaben innerhalb der Hierarchie
 * würden das Budget doppelt belasten.
 */
export function getCustomerAllocatedMinutes(allocations: AllocationLike[]): number {
  return activeAllocations(allocations)
    .filter((a) => a.allocatedByEmployeeId === null)
    .reduce((sum, a) => sum + a.allocatedMinutes, 0);
}

/** In aktiven Terminen geplante Minuten. */
export function getCustomerPlannedMinutes(appointments: AppointmentLike[]): number {
  return appointments.filter(isPlanned).reduce((sum, a) => sum + a.durationMinutes, 0);
}

/** Tatsächlich geleistete Minuten (COMPLETED; Ist-Zeit vor Plan-Dauer). */
export function getCustomerCompletedMinutes(appointments: AppointmentLike[]): number {
  return appointments
    .filter((a) => a.status === 'COMPLETED')
    .reduce((sum, a) => sum + (a.workedMinutes ?? a.durationMinutes), 0);
}

/** Kundenbudget minus zugewiesene Mitarbeiterstunden ("noch nicht weitergegeben"). */
export function getCustomerUnallocatedMinutes(
  budgets: BudgetLike[],
  adjustments: AdjustmentLike[],
  allocations: AllocationLike[],
): number {
  return getCustomerBudgetMinutes(budgets, adjustments) - getCustomerAllocatedMinutes(allocations);
}

/** Kundenbudget minus geplante Termine ("noch nicht verplant"). */
export function getCustomerUnplannedMinutes(
  budgets: BudgetLike[],
  adjustments: AdjustmentLike[],
  appointments: AppointmentLike[],
): number {
  return (
    getCustomerBudgetMinutes(budgets, adjustments) - getCustomerPlannedMinutes(appointments)
  );
}

export interface CustomerHourStats {
  budgetMinutes: number;
  allocatedMinutes: number;
  plannedMinutes: number;
  completedMinutes: number;
  unallocatedMinutes: number;
  unplannedMinutes: number;
}

export function computeCustomerHourStats(input: {
  budgets: BudgetLike[];
  adjustments: AdjustmentLike[];
  allocations: AllocationLike[];
  appointments: AppointmentLike[];
}): CustomerHourStats {
  const budgetMinutes = getCustomerBudgetMinutes(input.budgets, input.adjustments);
  const allocatedMinutes = getCustomerAllocatedMinutes(input.allocations);
  const plannedMinutes = getCustomerPlannedMinutes(input.appointments);
  const completedMinutes = getCustomerCompletedMinutes(input.appointments);
  return {
    budgetMinutes,
    allocatedMinutes,
    plannedMinutes,
    completedMinutes,
    unallocatedMinutes: budgetMinutes - allocatedMinutes,
    unplannedMinutes: budgetMinutes - plannedMinutes,
  };
}

// ---------------------------------------------------------------------------
// Mitarbeitersicht
// ---------------------------------------------------------------------------

/** Dem Mitarbeiter übertragene Minuten (brutto erhalten). */
export function getEmployeeAllocatedMinutes(
  allocations: AllocationLike[],
  employeeId: string,
): number {
  return activeAllocations(allocations)
    .filter((a) => a.allocatedToEmployeeId === employeeId)
    .reduce((sum, a) => sum + a.allocatedMinutes, 0);
}

/** Vom Mitarbeiter aus dem eigenen Pool weitergegebene Minuten. */
export function getEmployeeForwardedMinutes(
  allocations: AllocationLike[],
  employeeId: string,
): number {
  return activeAllocations(allocations)
    .filter((a) => a.allocatedByEmployeeId === employeeId)
    .reduce((sum, a) => sum + a.allocatedMinutes, 0);
}

/**
 * Eigenverpflichtung eines (Team-)Managers: erhalten minus weitergegeben.
 * "Stunden im eigenen Bereich, die nicht an Untergebene übertragen wurden."
 */
export function getManagerSelfObligationMinutes(
  allocations: AllocationLike[],
  managerEmployeeId: string,
): number {
  return (
    getEmployeeAllocatedMinutes(allocations, managerEmployeeId) -
    getEmployeeForwardedMinutes(allocations, managerEmployeeId)
  );
}

/** Dem Mitarbeiter zugewiesene Terminminuten (geplant). */
export function getEmployeePlannedMinutes(
  appointments: AppointmentLike[],
  employeeId: string,
): number {
  return appointments
    .filter((a) => a.assignedEmployeeId === employeeId && isPlanned(a))
    .reduce((sum, a) => sum + a.durationMinutes, 0);
}

/** Geleistete Minuten des Mitarbeiters. */
export function getEmployeeCompletedMinutes(
  appointments: AppointmentLike[],
  employeeId: string,
): number {
  return appointments
    .filter((a) => a.assignedEmployeeId === employeeId && a.status === 'COMPLETED')
    .reduce((sum, a) => sum + (a.workedMinutes ?? a.durationMinutes), 0);
}

/**
 * Fehlende Zielstunden: Ziel minus erhaltene bzw. geplante Minuten – je nach
 * gewählter Kennzahl. Nie negativ (Überdeckung ist keine "fehlende" Stunde).
 */
export function getEmployeeMissingTargetMinutes(
  targetMinutes: number | null | undefined,
  comparisonMinutes: number,
): number {
  if (!targetMinutes || targetMinutes <= 0) return 0;
  return Math.max(0, targetMinutes - comparisonMinutes);
}

export interface EmployeeHourStats {
  targetMinutes: number | null;
  allocatedMinutes: number;
  forwardedMinutes: number;
  selfObligationMinutes: number;
  plannedMinutes: number;
  completedMinutes: number;
  missingByAllocation: number;
  missingByPlanning: number;
}

export function computeEmployeeHourStats(input: {
  employeeId: string;
  targetMinutes: number | null;
  allocations: AllocationLike[];
  appointments: AppointmentLike[];
}): EmployeeHourStats {
  const allocated = getEmployeeAllocatedMinutes(input.allocations, input.employeeId);
  const forwarded = getEmployeeForwardedMinutes(input.allocations, input.employeeId);
  const planned = getEmployeePlannedMinutes(input.appointments, input.employeeId);
  const completed = getEmployeeCompletedMinutes(input.appointments, input.employeeId);
  return {
    targetMinutes: input.targetMinutes,
    allocatedMinutes: allocated,
    forwardedMinutes: forwarded,
    selfObligationMinutes: allocated - forwarded,
    plannedMinutes: planned,
    completedMinutes: completed,
    missingByAllocation: getEmployeeMissingTargetMinutes(input.targetMinutes, allocated),
    missingByPlanning: getEmployeeMissingTargetMinutes(input.targetMinutes, planned),
  };
}

// ---------------------------------------------------------------------------
// Validierungen für Zuweisungen
// ---------------------------------------------------------------------------

export type AllocationValidation =
  | { ok: true }
  | { ok: false; code: 'HOUR_BUDGET_EXCEEDED' | 'ALLOCATION_POOL_EXCEEDED'; availableMinutes: number };

/**
 * Prüft eine neue/geänderte Zuweisung aus dem Org-Budget gegen das verfügbare
 * Kundenbudget. `ignoreAllocationId` erlaubt das Bearbeiten einer bestehenden
 * Zuweisung, ohne dass sie sich selbst blockiert.
 */
export function validateOrgPoolAllocation(input: {
  budgets: BudgetLike[];
  adjustments: AdjustmentLike[];
  allocations: (AllocationLike & { id: string })[];
  requestedMinutes: number;
  ignoreAllocationId?: string;
}): AllocationValidation {
  const remaining = getCustomerUnallocatedMinutes(
    input.budgets,
    input.adjustments,
    input.allocations.filter((a) => a.id !== input.ignoreAllocationId),
  );
  if (input.requestedMinutes > remaining) {
    return { ok: false, code: 'HOUR_BUDGET_EXCEEDED', availableMinutes: Math.max(0, remaining) };
  }
  return { ok: true };
}

/** Prüft eine Weitergabe gegen den Pool des weitergebenden Managers. */
export function validateManagerPoolAllocation(input: {
  allocations: (AllocationLike & { id: string })[];
  managerEmployeeId: string;
  requestedMinutes: number;
  ignoreAllocationId?: string;
}): AllocationValidation {
  const relevant = input.allocations.filter((a) => a.id !== input.ignoreAllocationId);
  const pool = getManagerSelfObligationMinutes(relevant, input.managerEmployeeId);
  if (input.requestedMinutes > pool) {
    return { ok: false, code: 'ALLOCATION_POOL_EXCEEDED', availableMinutes: Math.max(0, pool) };
  }
  return { ok: true };
}
