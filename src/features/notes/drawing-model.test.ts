import { describe, expect, it } from 'vitest';

import {
  createEmptyNotebookDocument,
  eraseStrokesAtPoint,
  normalizeNotebookDocument,
  notebookDocumentSchema,
  stabilizePoint,
  strokeWidthAtPressure,
  type NotebookStroke,
} from './drawing-model';

function lineStroke(points: Array<[number, number]>, width = 2): NotebookStroke {
  return {
    id: 'stroke-1',
    points: points.map(([x, y]) => ({ x, y, pressure: 0.5 })),
    color: '#1b1f36',
    width,
    tool: 'pen',
    source: 'handwriting',
    opacity: 1,
    penStyle: 'fountain',
    pressureSensitivity: 0.65,
  };
}

describe('notebook document format', () => {
  it('keeps a valid versioned vector document', () => {
    const document = createEmptyNotebookDocument('lined');
    document.strokes = [lineStroke([[0, 0], [10, 10]])];

    expect(normalizeNotebookDocument(document)).toEqual(document);
    expect(notebookDocumentSchema.safeParse(document).success).toBe(true);
  });

  it('falls back safely for unsupported or malformed persisted JSON', () => {
    expect(normalizeNotebookDocument({ version: 2, strokes: [] })).toEqual(
      createEmptyNotebookDocument(),
    );
    expect(
      notebookDocumentSchema.safeParse({
        ...createEmptyNotebookDocument(),
        strokes: [lineStroke([[Number.NaN, 0], [10, 10]])],
      }).success,
    ).toBe(false);
  });
});

describe('stylus geometry', () => {
  it('uses pressure for tapered ink but keeps ballpoint width stable', () => {
    const light = strokeWidthAtPressure(4, 0.1, 1, 'fountain');
    const heavy = strokeWidthAtPressure(4, 0.9, 1, 'fountain');

    expect(heavy).toBeGreaterThan(light);
    expect(strokeWidthAtPressure(4, 0.1, 1, 'ballpoint')).toBe(
      strokeWidthAtPressure(4, 0.9, 1, 'ballpoint'),
    );
  });

  it('stabilizes a point without losing pressure', () => {
    const point = stabilizePoint(
      { x: 0, y: 0, pressure: 0.2 },
      { x: 10, y: 20, pressure: 0.8 },
      0.5,
    );

    expect(point.x).toBeGreaterThan(0);
    expect(point.x).toBeLessThan(10);
    expect(point.y).toBeGreaterThan(0);
    expect(point.y).toBeLessThan(20);
    expect(point.pressure).toBe(0.8);
  });
});

describe('segment eraser', () => {
  it('splits an intersected vector stroke and keeps both surviving sides', () => {
    const stroke = lineStroke([
      [0, 0],
      [5, 0],
      [10, 0],
      [15, 0],
      [20, 0],
    ]);

    const result = eraseStrokesAtPoint([stroke], { x: 10, y: 0 }, 1);

    expect(result.changed).toBe(true);
    expect(result.strokes).toHaveLength(2);
    expect(result.strokes[0]?.points.map((point) => point.x)).toEqual([0, 5]);
    expect(result.strokes[1]?.points.map((point) => point.x)).toEqual([15, 20]);
    expect(result.strokes.every((part) => part.color === stroke.color)).toBe(true);
  });

  it('returns the original vector content when the eraser misses', () => {
    const stroke = lineStroke([[0, 0], [20, 0]]);
    const result = eraseStrokesAtPoint([stroke], { x: 10, y: 50 }, 4);

    expect(result.changed).toBe(false);
    expect(result.strokes).toEqual([stroke]);
  });
});
