'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { runAction, type ActionResult } from '@/server/errors';
import {
  applyConflictResolution,
  applyResolutionForAppointment,
  getAppointmentConflicts,
  listScopeConflicts,
  reportScopeConflicts,
  suggestReplacementEmployees,
  suggestResolutionForAppointment,
  type OrgConflictDto,
  type ReplacementSuggestion,
  type ReportConflictsResult,
  type ResolutionProposal,
  type SerializedConflict,
} from '@/server/services/conflict-service';

export async function getAppointmentConflictsAction(
  appointmentId: string,
): Promise<ActionResult<{ conflicts: SerializedConflict[]; canResolve: boolean }>> {
  return runAction(() => getAppointmentConflicts(appointmentId));
}

export async function suggestResolutionForAppointmentAction(
  appointmentId: string,
): Promise<ActionResult<ResolutionProposal>> {
  return runAction(() => suggestResolutionForAppointment(appointmentId));
}

/** Passende Ersatz-Mitarbeiter (frei + nächstgelegen) für die Umweisung. */
export async function suggestReplacementEmployeesAction(
  appointmentId: string,
): Promise<ActionResult<ReplacementSuggestion>> {
  return runAction(() => suggestReplacementEmployees(appointmentId));
}

export async function applyResolutionForAppointmentAction(
  appointmentId: string,
): Promise<ActionResult<{ appliedCount: number; unresolvedCount: number }>> {
  return runAction(async () => {
    const result = await applyResolutionForAppointment(appointmentId);
    revalidatePath('/calendar');
    revalidatePath('/dashboard');
    revalidatePath('/notifications');
    return result;
  });
}

export async function applyConflictResolutionAction(
  employeeId: string,
  dateIso: string,
): Promise<ActionResult<{ appliedCount: number; unresolvedCount: number }>> {
  return runAction(async () => {
    const result = await applyConflictResolution(employeeId, dateIso);
    revalidatePath('/calendar');
    revalidatePath('/dashboard');
    revalidatePath('/notifications');
    return result;
  });
}

export async function listScopeConflictsAction(): Promise<ActionResult<OrgConflictDto[]>> {
  return runAction(() => listScopeConflicts());
}

const reportSelectionSchema = z
  .array(
    z.object({
      employeeId: z.string().min(1),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
  )
  .max(200)
  .optional();

/**
 * Leitungs-Sammelaktion „Konflikte melden": benachrichtigt die betroffenen
 * Mitarbeiter/Disposition über offene Terminkonflikte. `selection` beschränkt
 * optional auf bestimmte Gruppen; ohne Auswahl werden alle im Scope gemeldet.
 */
export async function reportScopeConflictsAction(
  selection?: { employeeId: string; date: string }[],
): Promise<ActionResult<ReportConflictsResult>> {
  return runAction(async () => {
    const parsed = reportSelectionSchema.parse(selection);
    const result = await reportScopeConflicts(parsed);
    revalidatePath('/notifications');
    revalidatePath('/dashboard');
    return result;
  });
}
