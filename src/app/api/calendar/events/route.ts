import { NextRequest, NextResponse } from 'next/server';

import { AppError } from '@/server/errors';
import { listCalendarEvents } from '@/server/services/calendar-service';

/**
 * Kalender-Feed (GET): liefert Termine des sichtbaren Zeitraums.
 * Auth/Scope laufen im Service (Session-Cookie, Organisationsbindung).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const start = new Date(params.get('start') ?? '');
  const end = new Date(params.get('end') ?? '');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return NextResponse.json({ error: 'VALIDATION_FAILED' }, { status: 400 });
  }
  // Schutz: maximal ~13 Monate pro Abfrage (Jahresansicht + Puffer).
  if (end.getTime() - start.getTime() > 400 * 24 * 3600 * 1000) {
    return NextResponse.json({ error: 'VALIDATION_FAILED' }, { status: 400 });
  }

  try {
    const events = await listCalendarEvents(
      { start, end },
      {
        employeeId: params.get('employeeId') ?? undefined,
        customerId: params.get('customerId') ?? undefined,
        teamId: params.get('teamId') ?? undefined,
        status: params.get('status')?.split(',').filter(Boolean),
        assignment:
          (params.get('assignment') as 'assigned' | 'unassigned' | 'declined' | null) ?? undefined,
        conflictsOnly: params.get('conflictsOnly') === '1',
        onlyMine: params.get('onlyMine') === '1',
        routeRelevantOnly: params.get('routeRelevant') === '1',
      },
    );
    return NextResponse.json({ events });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('[calendar/events]', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
