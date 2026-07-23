import { z } from 'zod';

export const NOTE_DOCUMENT_VERSION = 1 as const;

export const NOTE_LIMITS = {
  titleLength: 120,
  strokes: 1_000,
  pointsPerStroke: 2_000,
  totalPoints: 24_000,
  serializedCharacters: 800_000,
  coordinateMagnitude: 100_000,
} as const;

export type NotebookTool = 'pen' | 'highlighter' | 'eraser';
export type NotebookBackgroundType = 'grid' | 'lined' | 'blank';
export type NotebookPenStyle = 'fountain' | 'ballpoint' | 'brush';

export interface NotebookPoint {
  x: number;
  y: number;
  pressure?: number;
}

/**
 * Eraser gestures are applied destructively to the vector geometry and are not
 * stored as strokes. `tool` remains explicit to keep the document self-describing.
 */
export interface NotebookStroke {
  id: string;
  points: NotebookPoint[];
  color: string;
  width: number;
  tool: 'pen';
  source: 'handwriting' | 'highlighter';
  opacity?: number;
  penStyle?: NotebookPenStyle;
  pressureSensitivity?: number;
}

export interface NotebookDocumentV1 {
  version: typeof NOTE_DOCUMENT_VERSION;
  background: {
    type: NotebookBackgroundType;
    spacing: number;
  };
  strokes: NotebookStroke[];
}

export interface HandwrittenNoteClient {
  id: string;
  title: string;
  document: NotebookDocumentV1;
  contentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface NotebookDrawingPreferences {
  lastTool: NotebookTool;
  penColor: string;
  penWidth: number;
  highlighterColor: string;
  highlighterWidth: number;
  highlighterOpacity: number;
  eraserWidth: number;
  stabilization: number;
  pressureSensitivity: number;
  touchDrawEnabled: boolean;
}

export const DEFAULT_NOTEBOOK_PREFERENCES: NotebookDrawingPreferences = {
  lastTool: 'pen',
  penColor: '#1b1f36',
  penWidth: 3,
  highlighterColor: '#facc15',
  highlighterWidth: 18,
  highlighterOpacity: 0.3,
  eraserWidth: 24,
  stabilization: 0.2,
  pressureSensitivity: 0.65,
  touchDrawEnabled: false,
};

export const notebookPointSchema = z
  .object({
    x: z.number().finite().min(-NOTE_LIMITS.coordinateMagnitude).max(NOTE_LIMITS.coordinateMagnitude),
    y: z.number().finite().min(-NOTE_LIMITS.coordinateMagnitude).max(NOTE_LIMITS.coordinateMagnitude),
    pressure: z.number().finite().min(0).max(1).optional(),
  })
  .strict();

export const notebookStrokeSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    points: z.array(notebookPointSchema).min(1).max(NOTE_LIMITS.pointsPerStroke),
    color: z.string().regex(/^#[0-9a-f]{6}$/i, 'Ungültige Stiftfarbe.'),
    width: z.number().finite().min(0.5).max(64),
    tool: z.literal('pen'),
    source: z.enum(['handwriting', 'highlighter']),
    opacity: z.number().finite().min(0.05).max(1).optional(),
    penStyle: z.enum(['fountain', 'ballpoint', 'brush']).optional(),
    pressureSensitivity: z.number().finite().min(0).max(1).optional(),
  })
  .strict();

export const notebookDocumentSchema = z
  .object({
    version: z.literal(NOTE_DOCUMENT_VERSION),
    background: z
      .object({
        type: z.enum(['grid', 'lined', 'blank']),
        spacing: z.number().int().min(16).max(64),
      })
      .strict(),
    strokes: z.array(notebookStrokeSchema).max(NOTE_LIMITS.strokes),
  })
  .strict()
  .superRefine((document, context) => {
    const totalPoints = document.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0);
    if (totalPoints > NOTE_LIMITS.totalPoints) {
      context.addIssue({
        code: 'custom',
        path: ['strokes'],
        message: `Eine Notiz darf höchstens ${NOTE_LIMITS.totalPoints.toLocaleString('de-DE')} Punkte enthalten.`,
      });
    }

    if (JSON.stringify(document).length > NOTE_LIMITS.serializedCharacters) {
      context.addIssue({
        code: 'custom',
        message: 'Die Notiz ist zu groß. Bitte eine neue Notiz beginnen.',
      });
    }
  });

export const noteTitleSchema = z
  .string()
  .trim()
  .min(1, 'Bitte einen Namen für die Notiz eingeben.')
  .max(NOTE_LIMITS.titleLength, `Der Name darf höchstens ${NOTE_LIMITS.titleLength} Zeichen haben.`);

export function createEmptyNotebookDocument(
  background: NotebookBackgroundType = 'grid',
): NotebookDocumentV1 {
  return {
    version: NOTE_DOCUMENT_VERSION,
    background: { type: background, spacing: 24 },
    strokes: [],
  };
}

/** Converts unknown persisted JSON into the supported, bounded document format. */
export function normalizeNotebookDocument(value: unknown): NotebookDocumentV1 {
  const parsed = notebookDocumentSchema.safeParse(value);
  if (!parsed.success) return createEmptyNotebookDocument();
  return parsed.data;
}

export function cloneNotebookDocument(document: NotebookDocumentV1): NotebookDocumentV1 {
  return {
    version: NOTE_DOCUMENT_VERSION,
    background: { ...document.background },
    strokes: document.strokes.map((stroke) => ({
      ...stroke,
      points: stroke.points.map((point) => ({ ...point })),
    })),
  };
}

export function normalizePressure(pressure: number | undefined, fallback = 0.5): number {
  if (!Number.isFinite(pressure)) return fallback;
  return Math.min(1, Math.max(0, pressure ?? fallback));
}

export function stabilizePoint(
  previous: NotebookPoint,
  point: NotebookPoint,
  stabilization: number,
): NotebookPoint {
  const normalized = Math.min(0.9, Math.max(0, stabilization));
  if (normalized === 0) return { ...point };
  const follow = Math.max(0.15, 1 - normalized * 0.82);
  return {
    ...point,
    x: previous.x + (point.x - previous.x) * follow,
    y: previous.y + (point.y - previous.y) * follow,
  };
}

export function strokeWidthAtPressure(
  baseWidth: number,
  pressure: number | undefined,
  sensitivity: number,
  style: NotebookPenStyle = 'fountain',
): number {
  const styleFactor = style === 'brush' ? 1.15 : style === 'fountain' ? 0.95 : 1;
  if (style === 'ballpoint') return Math.max(0.4, baseWidth * styleFactor);
  const factor = 1 + (normalizePressure(pressure) - 0.5) * Math.min(1, Math.max(0, sensitivity)) * 1.6;
  return Math.max(0.4, baseWidth * styleFactor * factor);
}

function distance(a: NotebookPoint, b: NotebookPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceToSegment(point: NotebookPoint, start: NotebookPoint, end: NotebookPoint): number {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared === 0) return distance(point, start);
  const projection = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) / lengthSquared,
    ),
  );
  const projected = {
    x: start.x + segmentX * projection,
    y: start.y + segmentY * projection,
  };
  return Math.hypot(point.x - projected.x, point.y - projected.y);
}

export interface EraseResult {
  strokes: NotebookStroke[];
  changed: boolean;
}

/**
 * GoodNotes-style vector eraser: only intersecting portions are removed. The
 * surviving parts retain every visual property and receive stable derivative IDs.
 */
export function eraseStrokesAtPoint(
  strokes: readonly NotebookStroke[],
  point: NotebookPoint,
  radius: number,
): EraseResult {
  const safeRadius = Math.max(1, radius);
  const updated: NotebookStroke[] = [];
  let changed = false;

  for (const stroke of strokes) {
    if (stroke.points.length === 1) {
      const hit = distance(point, stroke.points[0]!) <= safeRadius + stroke.width / 2;
      if (hit) changed = true;
      else updated.push(stroke);
      continue;
    }

    const threshold = safeRadius + stroke.width / 2;
    const segments: NotebookPoint[][] = [];
    let current: NotebookPoint[] = [stroke.points[0]!];
    let strokeChanged = false;

    for (let index = 0; index < stroke.points.length - 1; index += 1) {
      const start = stroke.points[index]!;
      const end = stroke.points[index + 1]!;
      const hit =
        distanceToSegment(point, start, end) <= threshold || distance(point, end) <= threshold;

      if (hit) {
        strokeChanged = true;
        if (current.length >= 2) segments.push(current);
        current = distance(point, end) > threshold ? [{ ...end }] : [];
      } else {
        current.push({ ...end });
      }
    }

    if (current.length >= 2) segments.push(current);

    if (!strokeChanged) {
      updated.push(stroke);
      continue;
    }

    changed = true;
    segments.forEach((segment, segmentIndex) => {
      updated.push({
        ...stroke,
        id: `${stroke.id}:e${segmentIndex}`,
        points: segment,
      });
    });
  }

  return { strokes: changed ? updated : [...strokes], changed };
}

export function documentPointCount(document: NotebookDocumentV1): number {
  return document.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0);
}

