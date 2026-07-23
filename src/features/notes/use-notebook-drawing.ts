'use client';

import * as React from 'react';

import {
  cloneNotebookDocument,
  documentPointCount,
  eraseStrokesAtPoint,
  NOTE_LIMITS,
  normalizeNotebookDocument,
  type NotebookBackgroundType,
  type NotebookDocumentV1,
  type NotebookPenStyle,
  type NotebookPoint,
  type NotebookStroke,
  type NotebookTool,
} from './drawing-model';

const MAX_HISTORY_LENGTH = 60;

interface BeginStrokeSettings {
  tool: Exclude<NotebookTool, 'eraser'>;
  point: NotebookPoint;
  penColor: string;
  penWidth: number;
  penStyle: NotebookPenStyle;
  highlighterColor: string;
  highlighterWidth: number;
  highlighterOpacity: number;
  pressureSensitivity: number;
}

function createStrokeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `stroke-${crypto.randomUUID()}`;
  }
  return `stroke-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function pointDistance(left: NotebookPoint, right: NotebookPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

export function useNotebookDrawing({
  initialDocument,
  onCommit,
}: {
  initialDocument: NotebookDocumentV1;
  onCommit: (document: NotebookDocumentV1) => void;
}) {
  const [initial] = React.useState(() => cloneNotebookDocument(normalizeNotebookDocument(initialDocument)));
  const [document, setDocument] = React.useState<NotebookDocumentV1>(initial);
  const documentRef = React.useRef(initial);
  const pointCountRef = React.useRef(documentPointCount(initial));
  const historyRef = React.useRef<NotebookDocumentV1[]>([cloneNotebookDocument(initial)]);
  const historyIndexRef = React.useRef(0);
  const [historyState, setHistoryState] = React.useState({ canUndo: false, canRedo: false });
  const gestureStartRef = React.useRef<NotebookDocumentV1 | null>(null);
  const gestureChangedRef = React.useRef(false);
  const activeStrokeIdRef = React.useRef<string | null>(null);
  const [limitReached, setLimitReached] = React.useState(false);

  const replaceDocument = React.useCallback((next: NotebookDocumentV1) => {
    documentRef.current = next;
    pointCountRef.current = documentPointCount(next);
    setDocument(next);
  }, []);

  const updateHistoryState = React.useCallback(() => {
    setHistoryState({
      canUndo: historyIndexRef.current > 0,
      canRedo: historyIndexRef.current < historyRef.current.length - 1,
    });
  }, []);

  const emitCommit = React.useCallback(
    (next: NotebookDocumentV1) => {
      onCommit(cloneNotebookDocument(next));
    },
    [onCommit],
  );

  const commitHistory = React.useCallback(
    (next: NotebookDocumentV1) => {
      const retained = historyRef.current.slice(0, historyIndexRef.current + 1);
      retained.push(cloneNotebookDocument(next));
      if (retained.length > MAX_HISTORY_LENGTH) retained.shift();
      historyRef.current = retained;
      historyIndexRef.current = retained.length - 1;
      updateHistoryState();
      emitCommit(next);
    },
    [emitCommit, updateHistoryState],
  );

  const beginGesture = React.useCallback(() => {
    if (!gestureStartRef.current) {
      gestureStartRef.current = cloneNotebookDocument(documentRef.current);
      gestureChangedRef.current = false;
    }
  }, []);

  const beginStroke = React.useCallback(
    (settings: BeginStrokeSettings): string | null => {
      if (
        documentRef.current.strokes.length >= NOTE_LIMITS.strokes ||
        pointCountRef.current >= NOTE_LIMITS.totalPoints
      ) {
        setLimitReached(true);
        return null;
      }

      beginGesture();
      const isHighlighter = settings.tool === 'highlighter';
      const stroke: NotebookStroke = {
        id: createStrokeId(),
        points: [{ ...settings.point }],
        color: isHighlighter ? settings.highlighterColor : settings.penColor,
        width: isHighlighter ? settings.highlighterWidth : settings.penWidth,
        tool: 'pen',
        source: isHighlighter ? 'highlighter' : 'handwriting',
        opacity: isHighlighter ? settings.highlighterOpacity : 1,
        penStyle: isHighlighter ? 'ballpoint' : settings.penStyle,
        pressureSensitivity: isHighlighter ? 0 : settings.pressureSensitivity,
      };
      const next = {
        ...documentRef.current,
        strokes: [...documentRef.current.strokes, stroke],
      };
      activeStrokeIdRef.current = stroke.id;
      gestureChangedRef.current = true;
      replaceDocument(next);
      return stroke.id;
    },
    [beginGesture, replaceDocument],
  );

  const appendStrokePoints = React.useCallback(
    (points: NotebookPoint[]) => {
      const activeId = activeStrokeIdRef.current;
      if (!activeId || points.length === 0) return;
      const current = documentRef.current;
      const strokeIndex = current.strokes.findIndex((stroke) => stroke.id === activeId);
      if (strokeIndex < 0) return;
      const stroke = current.strokes[strokeIndex]!;
      const remainingPerStroke = NOTE_LIMITS.pointsPerStroke - stroke.points.length;
      const remainingTotal = NOTE_LIMITS.totalPoints - pointCountRef.current;
      const capacity = Math.min(remainingPerStroke, remainingTotal);
      if (capacity <= 0) {
        setLimitReached(true);
        return;
      }

      const accepted: NotebookPoint[] = [];
      let previous = stroke.points.at(-1)!;
      for (const point of points) {
        if (accepted.length >= capacity) break;
        // Sub-pixel samples add payload without visible quality. Coalesced events
        // still provide a dense, smooth line above this small threshold.
        if (pointDistance(previous, point) < 0.35) continue;
        accepted.push({ ...point });
        previous = point;
      }
      if (accepted.length === 0) return;
      if (accepted.length < points.length) setLimitReached(true);

      const nextStroke = { ...stroke, points: [...stroke.points, ...accepted] };
      const nextStrokes = [...current.strokes];
      nextStrokes[strokeIndex] = nextStroke;
      gestureChangedRef.current = true;
      replaceDocument({ ...current, strokes: nextStrokes });
    },
    [replaceDocument],
  );

  const beginErase = React.useCallback(() => {
    beginGesture();
    activeStrokeIdRef.current = null;
  }, [beginGesture]);

  const eraseAt = React.useCallback(
    (point: NotebookPoint, radius: number) => {
      beginGesture();
      const result = eraseStrokesAtPoint(documentRef.current.strokes, point, radius);
      if (!result.changed) return;
      gestureChangedRef.current = true;
      replaceDocument({ ...documentRef.current, strokes: result.strokes });
    },
    [beginGesture, replaceDocument],
  );

  const endGesture = React.useCallback(() => {
    activeStrokeIdRef.current = null;
    const changed = gestureChangedRef.current;
    gestureStartRef.current = null;
    gestureChangedRef.current = false;
    if (changed) commitHistory(documentRef.current);
  }, [commitHistory]);

  const cancelGesture = React.useCallback(() => {
    const start = gestureStartRef.current;
    activeStrokeIdRef.current = null;
    gestureStartRef.current = null;
    gestureChangedRef.current = false;
    if (start) replaceDocument(cloneNotebookDocument(start));
  }, [replaceDocument]);

  const undo = React.useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    const previous = cloneNotebookDocument(historyRef.current[historyIndexRef.current]!);
    replaceDocument(previous);
    updateHistoryState();
    emitCommit(previous);
  }, [emitCommit, replaceDocument, updateHistoryState]);

  const redo = React.useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    const next = cloneNotebookDocument(historyRef.current[historyIndexRef.current]!);
    replaceDocument(next);
    updateHistoryState();
    emitCommit(next);
  }, [emitCommit, replaceDocument, updateHistoryState]);

  const clear = React.useCallback(() => {
    if (documentRef.current.strokes.length === 0) return;
    const next = { ...documentRef.current, strokes: [] };
    replaceDocument(next);
    commitHistory(next);
    setLimitReached(false);
  }, [commitHistory, replaceDocument]);

  const setBackground = React.useCallback(
    (type: NotebookBackgroundType) => {
      if (documentRef.current.background.type === type) return;
      const next = {
        ...documentRef.current,
        background: { ...documentRef.current.background, type },
      };
      replaceDocument(next);
      commitHistory(next);
    },
    [commitHistory, replaceDocument],
  );

  return {
    document,
    strokes: document.strokes,
    background: document.background,
    beginStroke,
    appendStrokePoints,
    beginErase,
    eraseAt,
    endGesture,
    cancelGesture,
    undo,
    redo,
    clear,
    setBackground,
    canUndo: historyState.canUndo,
    canRedo: historyState.canRedo,
    limitReached,
    dismissLimitWarning: () => setLimitReached(false),
  };
}

