'use server';

import { revalidatePath } from 'next/cache';

import { runAction, type ActionResult } from '@/server/errors';
import {
  applyConflictResolution,
  applyResolutionForAppointment,
  getAppointmentConflicts,
  listScopeConflicts,
  suggestResolutionForAppointment,
  type OrgConflictDto,
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
