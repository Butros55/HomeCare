'use server';

import { revalidatePath } from 'next/cache';

import { runAction, type ActionResult } from '@/server/errors';
import {
  createAbsence,
  createEmployee,
  deleteAbsence,
  inviteEmployee,
  replaceAvailability,
  setEmployeeStatus,
  updateEmployee,
  updateOwnHomeLocation,
} from '@/server/services/employee-service';
import {
  absenceFormSchema,
  availabilityFormSchema,
  employeeFormSchema,
  homeLocationSchema,
  inviteEmployeeSchema,
  type AbsenceFormInput,
  type AvailabilityFormInput,
  type EmployeeFormInput,
  type HomeLocationInput,
  type InviteEmployeeInput,
} from '@/server/validation/employee';

export async function createEmployeeAction(
  input: EmployeeFormInput,
): Promise<ActionResult<{ employeeId: string }>> {
  return runAction(async () => {
    const data = employeeFormSchema.parse(input);
    const result = await createEmployee(data);
    revalidatePath('/employees');
    return result;
  });
}

export async function updateEmployeeAction(
  employeeId: string,
  input: EmployeeFormInput,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    const data = employeeFormSchema.parse(input);
    await updateEmployee(employeeId, data);
    revalidatePath('/employees');
    revalidatePath(`/employees/${employeeId}`);
    return { done: true as const };
  });
}

export async function setEmployeeStatusAction(
  employeeId: string,
  status: 'ACTIVE' | 'INACTIVE',
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    await setEmployeeStatus(employeeId, status);
    revalidatePath('/employees');
    revalidatePath(`/employees/${employeeId}`);
    return { done: true as const };
  });
}

export async function replaceAvailabilityAction(
  input: AvailabilityFormInput,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    const data = availabilityFormSchema.parse(input);
    await replaceAvailability(data);
    revalidatePath(`/employees/${data.employeeId}`);
    return { done: true as const };
  });
}

export async function updateOwnHomeLocationAction(
  input: HomeLocationInput,
): Promise<ActionResult<{ geocoded: boolean }>> {
  return runAction(async () => {
    const data = homeLocationSchema.parse(input);
    const result = await updateOwnHomeLocation(data ?? null);
    revalidatePath('/settings');
    revalidatePath('/routes');
    return result;
  });
}

export async function createAbsenceAction(
  input: AbsenceFormInput,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    const data = absenceFormSchema.parse(input);
    await createAbsence({
      employeeId: data.employeeId,
      startDate: data.startDate,
      endDate: data.endDate,
      type: data.type,
      note: data.note,
    });
    revalidatePath(`/employees/${data.employeeId}`);
    return { done: true as const };
  });
}

export async function deleteAbsenceAction(
  absenceId: string,
  employeeId: string,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    await deleteAbsence(absenceId);
    revalidatePath(`/employees/${employeeId}`);
    return { done: true as const };
  });
}

export async function inviteEmployeeAction(
  input: InviteEmployeeInput,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    const data = inviteEmployeeSchema.parse(input);
    await inviteEmployee(data);
    revalidatePath(`/employees/${data.employeeId}`);
    return { done: true as const };
  });
}

