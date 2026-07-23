'use client';

import * as React from 'react';

import type { NotebookDocumentV1, NotebookPoint } from './drawing-model';
import { drawNotebookStroke } from './stroke-renderer';

const PREVIEW_PADDING = 14;

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function documentBounds(document: NotebookDocumentV1): Bounds | null {
  let bounds: Bounds | null = null;
  for (const stroke of document.strokes) {
    for (const point of stroke.points) {
      const radius = stroke.width / 2;
      if (!bounds) {
        bounds = {
          minX: point.x - radius,
          minY: point.y - radius,
          maxX: point.x + radius,
          maxY: point.y + radius,
        };
      } else {
        bounds.minX = Math.min(bounds.minX, point.x - radius);
        bounds.minY = Math.min(bounds.minY, point.y - radius);
        bounds.maxX = Math.max(bounds.maxX, point.x + radius);
        bounds.maxY = Math.max(bounds.maxY, point.y + radius);
      }
    }
  }
  return bounds;
}

function drawPreviewPaper(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  document: NotebookDocumentV1,
) {
  context.fillStyle = '#faf9f6';
  context.fillRect(0, 0, width, height);
  if (document.background.type === 'blank') return;

  context.save();
  context.strokeStyle = 'rgba(148, 163, 184, 0.23)';
  context.lineWidth = 1;
  const spacing = Math.max(12, document.background.spacing * 0.55);
  if (document.background.type === 'grid') {
    for (let x = spacing; x < width; x += spacing) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
  }
  for (let y = spacing; y < height; y += spacing) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  context.restore();
}

export function StrokePreview({
  document,
  className,
}: {
  document: NotebookDocumentV1;
  className?: string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width <= 0 || size.height <= 0) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(size.width * dpr));
    canvas.height = Math.max(1, Math.round(size.height * dpr));
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPreviewPaper(context, size.width, size.height, document);

    const bounds = documentBounds(document);
    if (!bounds) return;
    const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
    const contentHeight = Math.max(1, bounds.maxY - bounds.minY);
    const scale = Math.min(
      1,
      (size.width - PREVIEW_PADDING * 2) / contentWidth,
      (size.height - PREVIEW_PADDING * 2) / contentHeight,
    );
    const offset: NotebookPoint = {
      x: (size.width - contentWidth * scale) / 2 - bounds.minX * scale,
      y: (size.height - contentHeight * scale) / 2 - bounds.minY * scale,
    };

    context.save();
    context.translate(offset.x, offset.y);
    context.scale(scale, scale);
    document.strokes.forEach((stroke) => drawNotebookStroke(context, stroke));
    context.restore();
  }, [document, size]);

  return (
    <div ref={containerRef} className={className} aria-hidden>
      <canvas ref={canvasRef} className="block size-full" />
    </div>
  );
}
