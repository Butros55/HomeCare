import { describe, expect, it } from 'vitest';

import {
  isAppointmentCompletableStatus,
  simpleAppointmentStatus,
} from '@/lib/status-maps';

describe('vereinfachter Terminstatus', () => {
  it.each(['DRAFT', 'PLANNED', 'CONFIRMED', 'IN_PROGRESS'])(
    'bildet %s als offen und abschließbar ab',
    (status) => {
      expect(simpleAppointmentStatus(status)).toBe('OPEN');
      expect(isAppointmentCompletableStatus(status)).toBe(true);
    },
  );

  it.each([
    ['COMPLETED', 'COMPLETED'],
    ['CANCELLED', 'CANCELLED'],
    ['NO_SHOW', 'CANCELLED'],
  ] as const)('bildet %s auf %s ab und behandelt den Zustand als terminal', (status, simple) => {
    expect(simpleAppointmentStatus(status)).toBe(simple);
    expect(isAppointmentCompletableStatus(status)).toBe(false);
  });
});
