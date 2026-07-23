'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/server/db';
import { AppError, runAction, type ActionResult } from '@/server/errors';
import { requireOrganizationMembership } from '@/server/permissions';
import {
  assignEmployee,
  cancelAppointment,
  completeAppointment,
  createAppointment,
  deleteAppointment,
  rescheduleAppointment,
  respondToAssignment,
  updateAppointment,
  updateAppointmentStatus,
  type ConflictOutcome,
} from '@/server/services/appointment-service';

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const recurrenceSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY_DATE', 'MONTHLY_WEEKDAY']),
  weekdays: z.array(z.number().int().min(1).max(7)).optional(),
  endMode: z.enum(['never', 'date', 'count']).default('never'),
  endDate: z.string().regex(dateRegex).optional(),
  count: z.number().int().min(1).max(500).optional(),
});

const appointmentSchema = z.object({
  customerId: z.string().min(1, 'Bitte einen Kunden wählen.'),
  assignedEmployeeId: z.string().optional().or(z.literal('')),
  title: z.string().trim().min(1, 'Titel ist erforderlich.').max(150),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  date: z.string().regex(dateRegex, 'Bitte ein Datum wählen.'),
  startTime: z.string().regex(timeRegex, 'Bitte eine Startzeit wählen.'),
  durationMinutes: z.number().int().min(5, 'Mindestens 5 Minuten.').max(1440),
  status: z.enum(['DRAFT', 'PLANNED', 'CONFIRMED']).default('PLANNED'),
  isFlexible: z.boolean().default(false),
  earliestTime: z.string().regex(timeRegex).optional().or(z.literal('')),
  latestTime: z.string().regex(timeRegex).optional().or(z.literal('')),
  routeRelevant: z.boolean().default(true),
  internalNotes: z.string().trim().max(2000).optional().or(z.literal('')),
  recurrence: recurrenceSchema.optional(),
});
export type AppointmentFormValues = z.input<typeof appointmentSchema>;

function toServiceInput(data: z.output<typeof appointmentSchema>) {
  return {
    customerId: data.customerId,
    assignedEmployeeId: data.assignedEmployeeId || null,
    title: data.title,
    description: data.description || undefined,
    date: data.date,
    startTime: data.startTime,
    durationMinutes: data.durationMinutes,
    status: data.status,
    isFlexible: data.isFlexible,
    earliestTime: data.isFlexible && data.earliestTime ? data.earliestTime : null,
    latestTime: data.isFlexible && data.latestTime ? data.latestTime : null,
    routeRelevant: data.routeRelevant,
    internalNotes: data.internalNotes || undefined,
    recurrence: data.recurrence?.enabled
      ? {
          enabled: true,
          frequency: data.recurrence.frequency,
          weekdays: data.recurrence.weekdays,
          endDate:
            data.recurrence.endMode === 'date' && data.recurrence.endDate
              ? new Date(`${data.recurrence.endDate}T00:00:00Z`)
              : null,
          count:
            data.recurrence.endMode === 'count' && data.recurrence.count
              ? data.recurrence.count
              : null,
        }
      : null,
  };
}

function revalidateCalendarPaths(customerId?: string) {
  revalidatePath('/calendar');
  revalidatePath('/dashboard');
  revalidatePath('/reports');
  if (customerId) revalidatePath(`/customers/${customerId}`);
}

export async function createAppointmentAction(
  input: AppointmentFormValues,
  confirmed: boolean,
): Promise<ActionResult<ConflictOutcome>> {
  return runAction(async () => {
    const data = appointmentSchema.parse(input);
    const result = await createAppointment(toServiceInput(data), { confirmed });
    if (!result.requiresConfirmation) revalidateCalendarPaths(data.customerId);
    return result;
  });
}

const editRecurrenceSchema = z.object({
  frequency: z.enum(['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY_DATE', 'MONTHLY_WEEKDAY']),
  weekdays: z.array(z.number().int().min(1).max(7)).optional(),
  endMode: z.enum(['never', 'date', 'count']).default('never'),
  endDate: z.string().regex(dateRegex).optional(),
  count: z.number().int().min(1).max(500).optional(),
});

const updateSchema = appointmentSchema
  .omit({ customerId: true, recurrence: true })
  .partial()
  .extend({ recurrence: editRecurrenceSchema.optional() });

export async function updateAppointmentAction(
  appointmentId: string,
  input: z.input<typeof updateSchema>,
  scope: 'single' | 'following' | 'all',
  confirmed: boolean,
): Promise<ActionResult<ConflictOutcome>> {
  return runAction(async () => {
    const data = updateSchema.parse(input);
    const result = await updateAppointment(
      appointmentId,
      {
        title: data.title,
        description: data.description !== undefined ? data.description || null : undefined,
        assignedEmployeeId:
          data.assignedEmployeeId !== undefined ? data.assignedEmployeeId || null : undefined,
        date: data.date,
        startTime: data.startTime,
        durationMinutes: data.durationMinutes,
        status: data.status,
        isFlexible: data.isFlexible,
        earliestTime: data.earliestTime !== undefined ? data.earliestTime || null : undefined,
        latestTime: data.latestTime !== undefined ? data.latestTime || null : undefined,
        routeRelevant: data.routeRelevant,
        internalNotes: data.internalNotes !== undefined ? data.internalNotes || null : undefined,
        recurrence: data.recurrence
          ? {
              frequency: data.recurrence.frequency,
              weekdays: data.recurrence.weekdays,
              endDate:
                data.recurrence.endMode === 'date' && data.recurrence.endDate
                  ? new Date(`${data.recurrence.endDate}T00:00:00Z`)
                  : null,
              count:
                data.recurrence.endMode === 'count' && data.recurrence.count
                  ? data.recurrence.count
                  : null,
            }
          : undefined,
      },
      { scope, confirmed },
    );
    if (!result.requiresConfirmation) revalidateCalendarPaths();
    return result;
  });
}

export async function rescheduleAppointmentAction(
  appointmentId: string,
  startAtIso: string,
  endAtIso: string,
  confirmed: boolean,
): Promise<ActionResult<ConflictOutcome>> {
  return runAction(async () => {
    const result = await rescheduleAppointment(appointmentId, startAtIso, endAtIso, { confirmed });
    if (!result.requiresConfirmation) revalidateCalendarPaths();
    return result;
  });
}

export async function assignEmployeeAction(
  appointmentId: string,
  employeeId: string | null,
  confirmed: boolean,
): Promise<ActionResult<ConflictOutcome>> {
  return runAction(async () => {
    const result = await assignEmployee(appointmentId, employeeId, { confirmed });
    if (!result.requiresConfirmation) revalidateCalendarPaths();
    return result;
  });
}

export async function updateAppointmentStatusAction(
  appointmentId: string,
  status: 'DRAFT' | 'PLANNED' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW',
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    await updateAppointmentStatus(appointmentId, status);
    revalidateCalendarPaths();
    return { done: true as const };
  });
}

export async function completeAppointmentAction(
  appointmentId: string,
): Promise<ActionResult<{ done: true; alreadyCompleted: boolean }>> {
  return runAction(async () => {
    const result = await completeAppointment(appointmentId);
    revalidateCalendarPaths(result.customerId);
    return {
      done: true as const,
      alreadyCompleted: result.alreadyCompleted,
    };
  });
}

export async function cancelAppointmentAction(
  appointmentId: string,
  scope: 'single' | 'following' | 'all',
  reason?: string,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    await cancelAppointment(appointmentId, { scope, reason });
    revalidateCalendarPaths();
    return { done: true as const };
  });
}

export async function deleteAppointmentAction(
  appointmentId: string,
  scope: 'single' | 'following' | 'all',
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    await deleteAppointment(appointmentId, { scope });
    revalidateCalendarPaths();
    return { done: true as const };
  });
}

export async function respondToAssignmentAction(
  appointmentId: string,
  response: 'ACCEPTED' | 'DECLINED',
  note?: string,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    await respondToAssignment(appointmentId, response, note);
    revalidateCalendarPaths();
    return { done: true as const };
  });
}

/** Duplizieren: legt eine Kopie am Folgetag (oder gleichen Tag) als Entwurf an. */
export async function duplicateAppointmentAction(
  appointmentId: string,
): Promise<ActionResult<{ appointmentId: string }>> {
  return runAction(async () => {
    const ctx = await requireOrganizationMembership();
    const source = await db.appointment.findUnique({ where: { id: appointmentId } });
    if (!source || source.organizationId !== ctx.organization.id) {
      throw new Error('not found');
    }
    const timezone = ctx.organization.timezone;
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const timeFmt = new Intl.DateTimeFormat('de-DE', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const nextDay = new Date(source.startAt.getTime() + 24 * 3600 * 1000);
    const result = await createAppointment(
      {
        customerId: source.customerId,
        assignedEmployeeId: source.assignedEmployeeId,
        title: source.title,
        description: source.description ?? undefined,
        date: fmt.format(nextDay),
        startTime: timeFmt.format(source.startAt),
        durationMinutes: source.durationMinutes,
        status: 'DRAFT',
        isFlexible: source.isFlexible,
        routeRelevant: source.routeRelevant,
        internalNotes: source.internalNotes ?? undefined,
      },
      { confirmed: true },
    );
    revalidateCalendarPaths(source.customerId);
    if (result.requiresConfirmation || !result.appointmentId) {
      throw new Error('Duplizieren fehlgeschlagen.');
    }
    return { appointmentId: result.appointmentId };
  });
}

/** Details für den Termin-Drawer. */
export async function getAppointmentDetailAction(appointmentId: string) {
  return runAction(async () => {
    const ctx = await requireOrganizationMembership();
    const appointment = await db.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            color: true,
            phone: true,
            accessInstructions: true,
          },
        },
        assignedEmployee: { select: { id: true, firstName: true, lastName: true } },
        locationAddress: true,
        series: { select: { id: true, recurrenceRule: true, defaultStartTime: true } },
      },
    });
    if (!appointment || appointment.organizationId !== ctx.organization.id) {
      throw new Error('not found');
    }
    if (
      ctx.organization.soloMode &&
      appointment.assignedEmployeeId !== null &&
      appointment.assignedEmployeeId !== ctx.employee?.id
    ) {
      throw new AppError('ACCESS_DENIED');
    }
    return {
      id: appointment.id,
      title: appointment.title,
      description: appointment.description,
      startAt: appointment.startAt.toISOString(),
      endAt: appointment.endAt.toISOString(),
      durationMinutes: appointment.durationMinutes,
      status: appointment.status,
      assignmentStatus: appointment.assignmentStatus,
      isFlexible: appointment.isFlexible,
      routeRelevant: appointment.routeRelevant,
      internalNotes: appointment.internalNotes,
      cancellationReason: appointment.cancellationReason,
      customer: appointment.customer,
      employee: appointment.assignedEmployee,
      address: appointment.locationAddress
        ? {
            line: `${appointment.locationAddress.street} ${appointment.locationAddress.houseNumber}, ${appointment.locationAddress.postalCode} ${appointment.locationAddress.city}`,
            latitude: appointment.locationAddress.latitude,
            longitude: appointment.locationAddress.longitude,
          }
        : null,
      series: appointment.series
        ? { id: appointment.series.id, rule: appointment.series.recurrenceRule }
        : null,
      isOwn: Boolean(ctx.employee && appointment.assignedEmployeeId === ctx.employee.id),
    };
  });
}
