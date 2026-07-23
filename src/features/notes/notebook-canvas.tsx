'use client';

import { AlertTriangle, X } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import {
  normalizePressure,
  stabilizePoint,
  type NotebookDocumentV1,
  type NotebookDrawingPreferences,
  type NotebookPoint,
  type NotebookTool,
} from './drawing-model';
import { NotebookToolbar } from './notebook-toolbar';
import { drawNotebookStroke } from './stroke-renderer';
import { useNotebookDrawing } from './use-notebook-drawing';

interface ViewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface ActivePointer {
  x: number;
  y: number;
}

const DEFAULT_VIEW: ViewTransform = { scale: 1, offsetX: 0, offsetY: 0 };

function pointerDistance(pointers: Map<number, ActivePointer>): number | null {
  const values = [...pointers.values()];
  if (values.length < 2) return null;
  return Math.hypot(values[1]!.x - values[0]!.x, values[1]!.y - values[0]!.y);
}

function pointerCenter(pointers: Map<number, ActivePointer>): ActivePointer | null {
  const values = [...pointers.values()];
  if (values.length < 2) return null;
  return {
    x: (values[0]!.x + values[1]!.x) / 2,
    y: (values[0]!.y + values[1]!.y) / 2,
  };
}

function hardwareEraser(event: React.PointerEvent<HTMLCanvasElement>): boolean {
  if (event.pointerType !== 'pen') return false;
  // W3C Pointer Events: eraser end/buttons bit 32, barrel button/buttons bit 2.
  return (
    (event.buttons & 32) !== 0 ||
    event.button === 5 ||
    (event.buttons & 2) !== 0 ||
    event.button === 2
  );
}

function capturePointer(event: React.PointerEvent<HTMLCanvasElement>) {
  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch {
    // Pointer may already have been released by the operating system.
  }
}

export function NotebookCanvas({
  initialDocument,
  onDocumentChange,
  preferences,
  onPreferenceChange,
  className,
}: {
  initialDocument: NotebookDocumentV1;
  onDocumentChange: (document: NotebookDocumentV1) => void;
  preferences: NotebookDrawingPreferences;
  onPreferenceChange: <Key extends keyof NotebookDrawingPreferences>(
    key: Key,
    value: NotebookDrawingPreferences[Key],
  ) => void;
  className?: string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = React.useState({ width: 0, height: 0 });
  const [view, setView] = React.useState<ViewTransform>(DEFAULT_VIEW);
  const viewRef = React.useRef<ViewTransform>(DEFAULT_VIEW);
  const [toolCursor, setToolCursor] = React.useState<NotebookPoint | null>(null);
  const drawing = useNotebookDrawing({ initialDocument, onCommit: onDocumentChange });

  const drawingPointerRef = React.useRef<number | null>(null);
  const drawingToolRef = React.useRef<NotebookTool | null>(null);
  const lastStrokePointRef = React.useRef<NotebookPoint | null>(null);
  const panPointerRef = React.useRef<number | null>(null);
  const lastPanPointRef = React.useRef<ActivePointer | null>(null);
  const touchPointersRef = React.useRef<Map<number, ActivePointer>>(new Map());
  const lastPinchDistanceRef = React.useRef<number | null>(null);
  const lastPinchCenterRef = React.useRef<ActivePointer | null>(null);
  const penActiveRef = React.useRef(false);

  const applyView = React.useCallback((next: ViewTransform) => {
    viewRef.current = next;
    setView(next);
  }, []);

  const panView = React.useCallback(
    (deltaX: number, deltaY: number) => {
      const current = viewRef.current;
      applyView({
        ...current,
        offsetX: current.offsetX + deltaX,
        offsetY: current.offsetY + deltaY,
      });
    },
    [applyView],
  );

  const zoomAt = React.useCallback(
    (factor: number, centerX: number, centerY: number) => {
      const current = viewRef.current;
      const nextScale = Math.min(4, Math.max(0.35, current.scale * factor));
      if (nextScale === current.scale) return;
      const ratio = nextScale / current.scale;
      applyView({
        scale: nextScale,
        offsetX: centerX - (centerX - current.offsetX) * ratio,
        offsetY: centerY - (centerY - current.offsetY) * ratio,
      });
    },
    [applyView],
  );

  const resetView = React.useCallback(() => applyView(DEFAULT_VIEW), [applyView]);

  const clientToCanvas = React.useCallback((clientX: number, clientY: number): NotebookPoint => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const current = viewRef.current;
    return {
      x: (clientX - rect.left - current.offsetX) / current.scale,
      y: (clientY - rect.top - current.offsetY) / current.scale,
    };
  }, []);

  const pointerPoint = React.useCallback(
    (event: Pick<PointerEvent, 'clientX' | 'clientY' | 'pressure'>): NotebookPoint => ({
      ...clientToCanvas(event.clientX, event.clientY),
      pressure: normalizePressure(event.pressure, 0.5),
    }),
    [clientToCanvas],
  );

  const coalescedPoints = React.useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>, tool: NotebookTool): NotebookPoint[] => {
      const native = event.nativeEvent;
      const events =
        typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [native];
      const result: NotebookPoint[] = [];
      let previous = lastStrokePointRef.current;
      for (const sample of events) {
        let point = pointerPoint(sample);
        if (tool === 'pen' && previous) {
          point = stabilizePoint(previous, point, preferences.stabilization);
        }
        result.push(point);
        previous = point;
      }
      lastStrokePointRef.current = previous;
      return result;
    },
    [pointerPoint, preferences.stabilization],
  );

  const startDrawing = React.useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>, tool: NotebookTool) => {
      const point = pointerPoint(event.nativeEvent);
      drawingPointerRef.current = event.pointerId;
      drawingToolRef.current = tool;
      lastStrokePointRef.current = point;
      if (tool === 'eraser') {
        drawing.beginErase();
        drawing.eraseAt(point, preferences.eraserWidth / 2);
        setToolCursor(point);
        return;
      }
      const strokeId = drawing.beginStroke({
        tool,
        point,
        penColor: preferences.penColor,
        penWidth: preferences.penWidth,
        highlighterColor: preferences.highlighterColor,
        highlighterWidth: preferences.highlighterWidth,
        highlighterOpacity: preferences.highlighterOpacity,
        pressureSensitivity: preferences.pressureSensitivity,
      });
      if (!strokeId) {
        drawingPointerRef.current = null;
        drawingToolRef.current = null;
      }
    },
    [drawing, pointerPoint, preferences],
  );

  const continueDrawing = React.useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (drawingPointerRef.current !== event.pointerId) return;
      const tool = drawingToolRef.current;
      if (!tool) return;
      if (tool === 'eraser') {
        const point = pointerPoint(event.nativeEvent);
        drawing.eraseAt(point, preferences.eraserWidth / 2);
        setToolCursor(point);
        return;
      }
      drawing.appendStrokePoints(coalescedPoints(event, tool));
    },
    [coalescedPoints, drawing, pointerPoint, preferences.eraserWidth],
  );

  const finishDrawing = React.useCallback(
    (pointerId: number, cancel = false) => {
      if (drawingPointerRef.current !== pointerId) return;
      if (cancel) drawing.cancelGesture();
      else drawing.endGesture();
      drawingPointerRef.current = null;
      drawingToolRef.current = null;
      lastStrokePointRef.current = null;
    },
    [drawing],
  );

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      event.stopPropagation();
      containerRef.current?.focus({ preventScroll: true });
      capturePointer(event);

      if (event.pointerType === 'pen') {
        penActiveRef.current = true;
        touchPointersRef.current.clear();
        panPointerRef.current = null;
        lastPanPointRef.current = null;
        lastPinchDistanceRef.current = null;
        lastPinchCenterRef.current = null;
        if (preferences.touchDrawEnabled) onPreferenceChange('touchDrawEnabled', false);
        startDrawing(event, hardwareEraser(event) ? 'eraser' : preferences.lastTool);
        return;
      }

      if (event.pointerType === 'touch') {
        if (penActiveRef.current) return;
        touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const count = touchPointersRef.current.size;
        if (count === 1) {
          if (preferences.touchDrawEnabled) {
            startDrawing(event, preferences.lastTool);
          } else {
            panPointerRef.current = event.pointerId;
            lastPanPointRef.current = { x: event.clientX, y: event.clientY };
          }
        } else if (count === 2) {
          if (drawingPointerRef.current !== null) {
            finishDrawing(drawingPointerRef.current, true);
          }
          panPointerRef.current = null;
          lastPanPointRef.current = null;
          lastPinchDistanceRef.current = pointerDistance(touchPointersRef.current);
          lastPinchCenterRef.current = pointerCenter(touchPointersRef.current);
        }
        return;
      }

      if (event.pointerType === 'mouse') {
        if (event.button === 1 || (event.button === 0 && event.shiftKey)) {
          panPointerRef.current = event.pointerId;
          lastPanPointRef.current = { x: event.clientX, y: event.clientY };
          return;
        }
        if (event.button !== 0) return;
        startDrawing(event, preferences.lastTool);
      }
    },
    [
      finishDrawing,
      onPreferenceChange,
      preferences.lastTool,
      preferences.touchDrawEnabled,
      startDrawing,
    ],
  );

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.pointerType === 'touch') {
        if (penActiveRef.current) return;
        const tracked = touchPointersRef.current.get(event.pointerId);
        if (!tracked) return;
        tracked.x = event.clientX;
        tracked.y = event.clientY;

        if (touchPointersRef.current.size >= 2) {
          const center = pointerCenter(touchPointersRef.current);
          const distance = pointerDistance(touchPointersRef.current);
          if (center && lastPinchCenterRef.current) {
            panView(
              center.x - lastPinchCenterRef.current.x,
              center.y - lastPinchCenterRef.current.y,
            );
          }
          if (center && distance && lastPinchDistanceRef.current) {
            const canvas = canvasRef.current;
            if (canvas) {
              const rect = canvas.getBoundingClientRect();
              zoomAt(
                distance / lastPinchDistanceRef.current,
                center.x - rect.left,
                center.y - rect.top,
              );
            }
          }
          lastPinchCenterRef.current = center;
          lastPinchDistanceRef.current = distance;
          return;
        }

        if (drawingPointerRef.current === event.pointerId) {
          continueDrawing(event);
          return;
        }
      }

      if (
        panPointerRef.current === event.pointerId &&
        lastPanPointRef.current &&
        drawingPointerRef.current !== event.pointerId
      ) {
        panView(
          event.clientX - lastPanPointRef.current.x,
          event.clientY - lastPanPointRef.current.y,
        );
        lastPanPointRef.current = { x: event.clientX, y: event.clientY };
        return;
      }

      continueDrawing(event);
      if (
        event.pointerType !== 'touch' &&
        (preferences.lastTool === 'eraser' || preferences.lastTool === 'highlighter')
      ) {
        setToolCursor(pointerPoint(event.nativeEvent));
      }
    },
    [continueDrawing, panView, pointerPoint, preferences.lastTool, zoomAt],
  );

  const handlePointerUp = React.useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Pointer capture is best-effort across browsers and pen drivers.
      }

      finishDrawing(event.pointerId, event.type === 'pointercancel');
      if (event.pointerType === 'pen') penActiveRef.current = false;

      if (event.pointerType === 'touch') {
        touchPointersRef.current.delete(event.pointerId);
        if (touchPointersRef.current.size < 2) {
          lastPinchDistanceRef.current = null;
          lastPinchCenterRef.current = null;
          const remaining = [...touchPointersRef.current.entries()][0];
          if (remaining && !preferences.touchDrawEnabled) {
            panPointerRef.current = remaining[0];
            lastPanPointRef.current = { ...remaining[1] };
          }
        }
      }

      if (panPointerRef.current === event.pointerId) {
        panPointerRef.current = null;
        lastPanPointRef.current = null;
      }
      setToolCursor(null);
    },
    [finishDrawing, preferences.touchDrawEnabled],
  );

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, button, [role="switch"]')) return;
      if (event.ctrlKey || event.metaKey) {
        if (event.key.toLowerCase() === 'z') {
          event.preventDefault();
          if (event.shiftKey) drawing.redo();
          else drawing.undo();
        } else if (event.key.toLowerCase() === 'y') {
          event.preventDefault();
          drawing.redo();
        }
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'p') onPreferenceChange('lastTool', 'pen');
      if (key === 'h') onPreferenceChange('lastTool', 'highlighter');
      if (key === 'e') onPreferenceChange('lastTool', 'eraser');
    },
    [drawing, onPreferenceChange],
  );

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setCanvasSize({ width: rect.width, height: rect.height });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasSize.width <= 0 || canvasSize.height <= 0) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(canvasSize.width * dpr));
    const height = Math.max(1, Math.round(canvasSize.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${canvasSize.width}px`;
      canvas.style.height = `${canvasSize.height}px`;
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = '#faf9f6';
    context.fillRect(0, 0, canvasSize.width, canvasSize.height);

    context.save();
    context.translate(view.offsetX, view.offsetY);
    context.scale(view.scale, view.scale);
    drawPaperBackground(context, canvasSize, view, drawing.background);
    drawing.strokes.forEach((stroke) => drawNotebookStroke(context, stroke));

    if (toolCursor && (preferences.lastTool === 'eraser' || preferences.lastTool === 'highlighter')) {
      const diameter =
        preferences.lastTool === 'eraser'
          ? preferences.eraserWidth
          : preferences.highlighterWidth;
      context.save();
      context.beginPath();
      context.arc(toolCursor.x, toolCursor.y, diameter / 2, 0, Math.PI * 2);
      context.fillStyle =
        preferences.lastTool === 'eraser'
          ? 'rgba(255,255,255,0.72)'
          : `${preferences.highlighterColor}33`;
      context.strokeStyle =
        preferences.lastTool === 'eraser' ? 'rgba(27,31,54,0.42)' : preferences.highlighterColor;
      context.lineWidth = 1 / view.scale;
      context.fill();
      context.stroke();
      context.restore();
    }
    context.restore();
  }, [
    canvasSize,
    drawing.background,
    drawing.strokes,
    preferences.eraserWidth,
    preferences.highlighterColor,
    preferences.highlighterWidth,
    preferences.lastTool,
    toolCursor,
    view,
  ]);

  const cursor =
    preferences.lastTool === 'eraser' || preferences.lastTool === 'highlighter'
      ? 'none'
      : preferences.lastTool === 'pen'
        ? 'crosshair'
        : 'default';

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={cn(
        'relative min-h-0 overflow-hidden bg-[#faf9f6] outline-none',
        '[-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] [overscroll-behavior:contain] [user-select:none]',
        className,
      )}
      aria-label="Notiz-Zeichenfläche"
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 size-full touch-none"
        style={{ cursor }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => {
          if (drawingPointerRef.current === null) setToolCursor(null);
        }}
        onContextMenu={(event) => event.preventDefault()}
      />

      <div className="pointer-events-none absolute top-3 left-3 rounded-full border border-black/5 bg-white/75 px-2.5 py-1 text-[11px] text-slate-500 shadow-sm backdrop-blur">
        {Math.round(view.scale * 100)} %
      </div>

      {drawing.limitReached ? (
        <div className="absolute top-3 right-3 z-20 flex max-w-sm items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-warning)] bg-[var(--color-panel)] px-3 py-2 text-[length:var(--text-xs)] text-[var(--color-ink-muted)] shadow-[var(--shadow-popover)]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-warning)]" aria-hidden />
          <span>Diese Notiz hat ihr Größenlimit erreicht. Bitte eine neue Notiz beginnen.</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={drawing.dismissLimitWarning}
            aria-label="Hinweis schließen"
            className="-m-1 shrink-0"
          >
            <X aria-hidden />
          </Button>
        </div>
      ) : null}

      <NotebookToolbar
        preferences={preferences}
        onPreferenceChange={onPreferenceChange}
        background={drawing.background.type}
        onBackgroundChange={drawing.setBackground}
        canUndo={drawing.canUndo}
        canRedo={drawing.canRedo}
        onUndo={drawing.undo}
        onRedo={drawing.redo}
        onClear={drawing.clear}
        onResetView={resetView}
      />
    </div>
  );
}

function drawPaperBackground(
  context: CanvasRenderingContext2D,
  size: { width: number; height: number },
  view: ViewTransform,
  background: NotebookDocumentV1['background'],
) {
  if (background.type === 'blank') return;
  const spacing = background.spacing;
  const minX = -view.offsetX / view.scale;
  const minY = -view.offsetY / view.scale;
  const maxX = minX + size.width / view.scale;
  const maxY = minY + size.height / view.scale;
  const startX = Math.floor(minX / spacing) * spacing;
  const startY = Math.floor(minY / spacing) * spacing;

  context.save();
  context.lineWidth = 1 / view.scale;
  context.strokeStyle = '#e5e7eb';

  if (background.type === 'grid') {
    for (let x = startX; x <= maxX + spacing; x += spacing) {
      context.beginPath();
      context.moveTo(x, minY);
      context.lineTo(x, maxY);
      context.stroke();
    }
  }
  for (let y = startY; y <= maxY + spacing; y += spacing) {
    context.beginPath();
    context.moveTo(minX, y);
    context.lineTo(maxX, y);
    context.stroke();
  }

  if (background.type === 'lined') {
    context.strokeStyle = 'rgba(239,68,68,0.22)';
    context.beginPath();
    context.moveTo(52, minY);
    context.lineTo(52, maxY);
    context.stroke();
  }
  context.restore();
}
