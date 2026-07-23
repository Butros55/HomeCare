'use server';

import { runAction, type ActionResult } from '@/server/errors';
import {
  listCalendarEventsByIds,
  type CalendarEventDto,
} from '@/server/services/calendar-service';

/**
 * Einzelne Termine als Event-DTO nachladen – ermöglicht dem Kalender ein
 * gezieltes, optimistisches Update (nur die geänderten Divs) ohne kompletten
 * Refetch/Reload.
 */
export async function getCalendarEventsAction(
  ids: string[],
): Promise<ActionResult<CalendarEventDto[]>> {
  return runAction(() => listCalendarEventsByIds(ids));
}
