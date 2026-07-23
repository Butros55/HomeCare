'use server';

import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { AppError, runAction, type ActionResult } from '@/server/errors';
import { requireOrganizationMembership } from '@/server/permissions';
import { computeRoutePathCached } from '@/server/providers/routing';
import type { RoutePath } from '@/server/providers/types';
import {
  computeRoutePlan,
  discardRoutePlan,
  getRoutePlanningData,
  saveRoutePlan,
  type ComputedRoute,
} from '@/server/services/route-service';
import {
  acceptRouteSuggestion,
  generateRouteSuggestions,
  type AcceptSuggestionResult,
  type GenerateSuggestionsResult,
} from '@/server/services/route-suggestion-service';

export async function getRoutePlanningDataAction(employeeId: string, date: string) {
  return runAction(() => getRoutePlanningData(employeeId, date));
}

const routePathSchema = z.object({
  points: z
    .array(
      z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      }),
    )
    .min(2)
    .max(30),
});
export type RoutePathActionInput = z.input<typeof routePathSchema>;

/**
 * Tatsächlich zu fahrende Strecke für die Karte (Straßenverlauf statt
 * Luftlinie). Nur für angemeldete Mitglieder – Schlüssel und Anbieter bleiben
 * serverseitig; das Ergebnis ist gecacht.
 */
export async function getRoutePathAction(
  input: RoutePathActionInput,
): Promise<ActionResult<RoutePath>> {
  return runAction(async () => {
    await requireOrganizationMembership();
    const { points } = routePathSchema.parse(input);
    return computeRoutePathCached(points);
  });
}

const gpsSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    timestamp: z.number().optional(),
  })
  .optional();

const computeSchema = z.object({
  employeeId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  appointmentIds: z.array(z.string().min(1)).min(1).max(30),
  originType: z.enum(['office', 'home', 'gps']),
  gps: gpsSchema,
  bufferMinutes: z.number().int().min(0).max(120),
  returnToStart: z.boolean(),
  manualOrder: z.boolean().optional(),
});
export type ComputeRouteActionInput = z.input<typeof computeSchema>;

export async function computeRouteAction(
  input: ComputeRouteActionInput,
): Promise<ActionResult<ComputedRoute>> {
  return runAction(async () => {
    const data = computeSchema.parse(input);
    return computeRoutePlan(data);
  });
}

export async function saveRouteAction(
  input: ComputeRouteActionInput,
  publish: boolean,
): Promise<ActionResult<{ routePlanId: string }>> {
  return runAction(async () => {
    const data = computeSchema.parse(input);
    const result = await saveRoutePlan({ ...data, publish });
    revalidatePath('/routes');
    revalidatePath('/dashboard');
    return result;
  });
}

export async function discardRouteAction(
  employeeId: string,
  date: string,
): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    await discardRoutePlan(employeeId, date);
    revalidatePath('/routes');
    return { done: true as const };
  });
}

// ------------------------- Terminvorschläge --------------------------------

const generateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scope: z.enum(['self', 'team']),
  bufferMinutes: z.number().int().min(0).max(120),
  returnToStart: z.boolean(),
  originType: z.enum(['office', 'home', 'gps']).optional(),
  gps: gpsSchema,
  appointmentIds: z.array(z.string().min(1)).max(30).optional(),
});
export type GenerateSuggestionsActionInput = z.input<typeof generateSchema>;

export async function generateRouteSuggestionsAction(
  input: GenerateSuggestionsActionInput,
): Promise<ActionResult<GenerateSuggestionsResult>> {
  return runAction(async () => {
    const data = generateSchema.parse(input);
    return generateRouteSuggestions(data);
  });
}

export async function acceptRouteSuggestionAction(
  token: string,
): Promise<ActionResult<AcceptSuggestionResult>> {
  return runAction(async () => {
    const parsed = z.string().min(20).max(4096).parse(token);
    let accepted: AcceptSuggestionResult;
    try {
      accepted = await acceptRouteSuggestion(parsed);
    } catch (error) {
      // Serialisierungskonflikt (paralleler Schreibzugriff) → als veraltet melden.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        throw new AppError('SUGGESTION_STALE');
      }
      throw error;
    }
    revalidatePath('/routes');
    revalidatePath('/calendar');
    revalidatePath('/dashboard');
    return accepted;
  });
}
