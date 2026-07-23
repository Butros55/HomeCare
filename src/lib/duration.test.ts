import { describe, expect, it } from 'vitest';

import {
  formatMinutesAsClock,
  formatMinutesAsDecimalHours,
  formatMinutesAsHours,
  formatMinutesVerbose,
  parseDurationInput,
} from './duration';

function minutesOf(input: string): number | null {
  const result = parseDurationInput(input);
  return result.ok ? result.minutes : null;
}

describe('parseDurationInput', () => {
  it('parst ganze Stunden', () => {
    expect(minutesOf('2')).toBe(120);
    expect(minutesOf('0')).toBe(0);
    expect(minutesOf('10')).toBe(600);
  });

  it('parst Dezimalstunden mit Komma und Punkt', () => {
    expect(minutesOf('2,5')).toBe(150);
    expect(minutesOf('2.5')).toBe(150);
    expect(minutesOf('0,25')).toBe(15);
    expect(minutesOf('1,75')).toBe(105);
  });

  it('rundet krumme Dezimalstunden auf ganze Minuten', () => {
    expect(minutesOf('0,33')).toBe(20); // 19,8 → 20
    expect(minutesOf('0,01')).toBe(1); // 0,6 → 1
  });

  it('parst H:MM', () => {
    expect(minutesOf('2:30')).toBe(150);
    expect(minutesOf('0:45')).toBe(45);
    expect(minutesOf('10:05')).toBe(605);
  });

  it('lehnt ungültige Minutenanteile in H:MM ab', () => {
    expect(minutesOf('2:60')).toBeNull();
    expect(minutesOf('2:99')).toBeNull();
  });

  it('parst Minutenangaben', () => {
    expect(minutesOf('150 Minuten')).toBe(150);
    expect(minutesOf('150 minuten')).toBe(150);
    expect(minutesOf('90 min')).toBe(90);
    expect(minutesOf('45m')).toBe(45);
    expect(minutesOf('30 Min.')).toBe(30);
  });

  it('parst Stundenangaben mit Einheit', () => {
    expect(minutesOf('2 h')).toBe(120);
    expect(minutesOf('2 Std')).toBe(120);
    expect(minutesOf('2,5 Stunden')).toBe(150);
    expect(minutesOf('3 std.')).toBe(180);
  });

  it('parst kombinierte Angaben', () => {
    expect(minutesOf('1h 30min')).toBe(90);
    expect(minutesOf('1 Std 30 Min')).toBe(90);
    expect(minutesOf('2h15m')).toBe(135);
  });

  it('behandelt Leerraum großzügig', () => {
    expect(minutesOf('  2,5  ')).toBe(150);
    expect(minutesOf(' 150   Minuten ')).toBe(150);
  });

  it('meldet leere Eingaben', () => {
    expect(parseDurationInput('')).toEqual({ ok: false, error: 'EMPTY' });
    expect(parseDurationInput('   ')).toEqual({ ok: false, error: 'EMPTY' });
  });

  it('meldet negative Eingaben', () => {
    expect(parseDurationInput('-2')).toEqual({ ok: false, error: 'NEGATIVE' });
  });

  it('meldet unparsebare Eingaben', () => {
    expect(parseDurationInput('abc')).toEqual({ ok: false, error: 'INVALID' });
    expect(parseDurationInput('2,5,5')).toEqual({ ok: false, error: 'INVALID' });
    expect(parseDurationInput('h30')).toEqual({ ok: false, error: 'INVALID' });
  });

  it('meldet absurd große Eingaben', () => {
    expect(parseDurationInput('999999')).toEqual({ ok: false, error: 'TOO_LARGE' });
  });
});

describe('Formatierung', () => {
  it('formatMinutesAsHours', () => {
    expect(formatMinutesAsHours(150)).toBe('2,5 h');
    expect(formatMinutesAsHours(120)).toBe('2 h');
    expect(formatMinutesAsHours(0)).toBe('0 h');
    expect(formatMinutesAsHours(20)).toBe('0,33 h');
  });

  it('formatMinutesAsDecimalHours', () => {
    expect(formatMinutesAsDecimalHours(150)).toBe('2,50 h');
    expect(formatMinutesAsDecimalHours(120)).toBe('2,00 h');
  });

  it('formatMinutesAsClock', () => {
    expect(formatMinutesAsClock(150)).toBe('2:30 h');
    expect(formatMinutesAsClock(45)).toBe('0:45 h');
    expect(formatMinutesAsClock(-90)).toBe('−1:30 h');
  });

  it('formatMinutesVerbose', () => {
    expect(formatMinutesVerbose(90)).toBe('1 Std. 30 Min.');
    expect(formatMinutesVerbose(45)).toBe('45 Min.');
    expect(formatMinutesVerbose(120)).toBe('2 Std.');
    expect(formatMinutesVerbose(-30)).toBe('−30 Min.');
  });

  it('Roundtrip: parse(format(x)) bleibt stabil', () => {
    for (const m of [0, 1, 15, 60, 90, 150, 480, 599]) {
      const clock = formatMinutesAsClock(m).replace(' h', '');
      expect(minutesOf(clock)).toBe(m);
    }
  });
});
