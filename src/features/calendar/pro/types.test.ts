import { describe, expect, it } from 'vitest';

import type { CalendarEventDto } from '@/server/services/calendar-service';

import { kindForEvent, toProEvent } from './types';

function event(
  status: string,
  employeeId: string | null = 'employee-1',
): CalendarEventDto {
  return {
    id: 'appointment-1',
    title: 'Einsatz',
    start: '2026-08-03T08:00:00.000Z',
    end: '2026-08-03T09:00:00.000Z',
    customerId: 'customer-1',
    customerName: 'Test Kunde',
    customerColor: '#123456',
    employeeId,
    employeeName: employeeId ? 'Test Mitarbeiter' : null,
    status,
    assignmentStatus: employeeId ? 'ACCEPTED' : 'UNASSIGNED',
    seriesId: null,
    isFlexible: false,
    routeRelevant: true,
    hasConflict: false,
    city: 'Münster',
  };
}

describe('Pro-Kalender im Alleine-Modus', () => {
  it.each(['DRAFT', 'PLANNED', 'CONFIRMED', 'IN_PROGRESS'])(
    'fasst %s als offen zusammen',
    (status) => {
      expect(kindForEvent(event(status), true)).toBe('open');
    },
  );

  it('behält die terminalen Zustände getrennt', () => {
    expect(kindForEvent(event('COMPLETED'), true)).toBe('done');
    expect(kindForEvent(event('CANCELLED'), true)).toBe('cancelled');
    expect(kindForEvent(event('NO_SHOW'), true)).toBe('cancelled');
  });

  it('zeigt im Solo-Detail keine Mitarbeiter- oder Zuordnungssemantik', () => {
    const mapped = toProEvent(event('PLANNED', null), true);
    expect(mapped.detail).toBe('Einsatz');
    expect(mapped.unassigned).toBe(false);
  });

  it('lässt die differenzierte Team-Abbildung unverändert', () => {
    expect(kindForEvent(event('PLANNED'), false)).toBe('planned');
    expect(kindForEvent(event('CONFIRMED'), false)).toBe('confirmed');
    expect(kindForEvent(event('PLANNED', null), false)).toBe('open');
  });
});
