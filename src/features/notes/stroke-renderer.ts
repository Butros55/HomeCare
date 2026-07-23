import { strokeWidthAtPressure, type NotebookStroke } from './drawing-model';

function drawDot(context: CanvasRenderingContext2D, stroke: NotebookStroke): void {
  const point = stroke.points[0];
  if (!point) return;
  const width =
    stroke.source === 'highlighter'
      ? stroke.width
      : strokeWidthAtPressure(
          stroke.width,
          point.pressure,
          stroke.pressureSensitivity ?? 0,
          stroke.penStyle,
        );
  context.save();
  context.globalAlpha = stroke.opacity ?? 1;
  context.fillStyle = stroke.color;
  context.beginPath();
  context.arc(point.x, point.y, width / 2, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

/** Draws one persisted vector stroke in the context's current coordinate system. */
export function drawNotebookStroke(
  context: CanvasRenderingContext2D,
  stroke: NotebookStroke,
): void {
  if (stroke.points.length === 0) return;
  if (stroke.points.length === 1) {
    drawDot(context, stroke);
    return;
  }

  context.save();
  context.strokeStyle = stroke.color;
  context.globalAlpha = stroke.opacity ?? 1;
  context.lineCap = 'round';
  context.lineJoin = 'round';

  if (
    stroke.source === 'handwriting' &&
    stroke.penStyle !== 'ballpoint' &&
    (stroke.pressureSensitivity ?? 0) > 0
  ) {
    for (let index = 1; index < stroke.points.length; index += 1) {
      const previous = stroke.points[index - 1]!;
      const point = stroke.points[index]!;
      const pressure = ((previous.pressure ?? 0.5) + (point.pressure ?? 0.5)) / 2;
      context.beginPath();
      context.lineWidth = strokeWidthAtPressure(
        stroke.width,
        pressure,
        stroke.pressureSensitivity ?? 0,
        stroke.penStyle,
      );
      context.moveTo(previous.x, previous.y);
      context.lineTo(point.x, point.y);
      context.stroke();
    }
    context.restore();
    return;
  }

  context.lineWidth = stroke.width;
  const first = stroke.points[0]!;
  context.beginPath();
  context.moveTo(first.x, first.y);
  if (stroke.points.length === 2) {
    const last = stroke.points[1]!;
    context.lineTo(last.x, last.y);
  } else {
    for (let index = 1; index < stroke.points.length - 1; index += 1) {
      const point = stroke.points[index]!;
      const next = stroke.points[index + 1]!;
      context.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
    }
    const last = stroke.points.at(-1)!;
    context.lineTo(last.x, last.y);
  }
  context.stroke();
  context.restore();
}

