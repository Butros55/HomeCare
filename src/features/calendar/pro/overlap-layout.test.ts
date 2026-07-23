import { describe, expect, it } from 'vitest';

import { layoutOverlapping } from './overlap-layout';

const span = (id: string, startMinutes: number, endMinutes: number) => ({ id, startMinutes, endMinutes });

describe('layoutOverlapping', () => {
  it('gibt nicht überlappenden Terminen jeweils eine volle Spalte', () => {
    const out = layoutOverlapping([span('a', 540, 600), span('b', 660, 720)]);
    expect(out.every((e) => e.colCount === 1 && e.colIndex === 0)).toBe(true);
  });

  it('legt zwei überlappende Termine nebeneinander (2 Spalten)', () => {
    const out = layoutOverlapping([span('a', 540, 660), span('b', 600, 720)]);
    expect(out.map((e) => [e.id, e.colIndex, e.colCount])).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
    ]);
  });

  it('macht exakt gleichzeitige Termine beide sichtbar (verschiedene Spalten)', () => {
    const out = layoutOverlapping([span('a', 540, 660), span('b', 540, 660)]);
    const cols = out.map((e) => e.colIndex).sort();
    expect(cols).toEqual([0, 1]);
    expect(out.every((e) => e.colCount === 2)).toBe(true);
  });

  it('nutzt frei gewordene Spalten wieder', () => {
    // a 9–10, b 9–11, c 10–11 → a&b überlappen (2 Spalten), c passt in Spalte 0 (nach a).
    const out = layoutOverlapping([span('a', 540, 600), span('b', 540, 660), span('c', 600, 660)]);
    const byId = new Map(out.map((e) => [e.id, e]));
    expect(byId.get('a')!.colIndex).toBe(0);
    expect(byId.get('b')!.colIndex).toBe(1);
    expect(byId.get('c')!.colIndex).toBe(0);
    // Cluster hat max. 2 gleichzeitige → colCount 2.
    expect(byId.get('c')!.colCount).toBe(2);
  });

  it('trennt nicht zusammenhängende Cluster', () => {
    const out = layoutOverlapping([span('a', 540, 600), span('b', 540, 600), span('c', 700, 760)]);
    const byId = new Map(out.map((e) => [e.id, e]));
    expect(byId.get('a')!.colCount).toBe(2);
    expect(byId.get('c')!.colCount).toBe(1);
  });
});
