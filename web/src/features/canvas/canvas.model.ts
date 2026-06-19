/**
 * canvas.model.ts — the pure, DOM-free stroke model for the draw surface (T6b / SPEC F4,
 * CONTRACT D2). The bitmap is DERIVED from `strokes`: `repaint` clears the context, paints
 * the chosen template, then replays every stroke. So undo = `strokes.pop()` + repaint, and
 * clear = `strokes = []` + repaint — both are array ops, never pixel surgery. Eraser strokes
 * are kept IN the stack and replayed with `globalCompositeOperation = "destination-out"` (so
 * undoing an erase brings the ink back, and a future stroke-JSON sidecar reopens editable).
 *
 * No imports, no DOM lookups: every color is passed in (resolved from CSS tokens by the
 * caller). That keeps this file trivially unit-testable with a stubbed 2D context.
 */

export interface Point {
  x: number;
  y: number;
  /** Pen pressure 0..1; mice report 0 so callers default to 0.5 (CONTRACT D3). */
  p: number;
}

export interface Stroke {
  points: Point[];
  color: string;
  width: number;
  erase: boolean;
}

export type Template = "blank" | "ruled" | "grid" | "axes";

export interface CanvasDoc {
  template: Template;
  strokes: Stroke[];
  width: number;
  height: number;
}

/** Token-derived colors the caller resolves once and threads through paint calls. */
export interface PaintColors {
  /** Page background (var(--bg) / var(--panel)). */
  background: string;
  /** Ruled/grid guide lines (var(--border)). */
  guide: string;
  /** Coordinate axes (var(--border2)). */
  axis: string;
}

export const DEFAULT_TEMPLATES: Template[] = ["blank", "ruled", "grid", "axes"];

/** A fresh empty document at the given size on the given template. */
export function emptyDoc(width: number, height: number, template: Template = "blank"): CanvasDoc {
  return { template, strokes: [], width, height };
}

/** Append a point to the last (in-progress) stroke, mutating in place. Returns the doc. */
export function addPoint(doc: CanvasDoc, point: Point): CanvasDoc {
  const stroke = doc.strokes[doc.strokes.length - 1];
  if (stroke) stroke.points.push(point);
  return doc;
}

const RULED_GAP = 32;
const GRID_GAP = 28;

/** Paint the template background into `ctx` (called by `repaint` before strokes). */
export function drawTemplate(
  ctx: CanvasRenderingContext2D,
  template: Template,
  w: number,
  h: number,
  colors: PaintColors,
): void {
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  // Solid page so the exported PNG isn't transparent (the tutor sees a "sheet").
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, w, h);

  if (template === "ruled") {
    ctx.strokeStyle = colors.guide;
    ctx.lineWidth = 1;
    for (let y = RULED_GAP; y < h; y += RULED_GAP) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  } else if (template === "grid") {
    ctx.strokeStyle = colors.guide;
    ctx.lineWidth = 1;
    for (let x = GRID_GAP; x < w; x += GRID_GAP) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = GRID_GAP; y < h; y += GRID_GAP) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  } else if (template === "axes") {
    // Centered coordinate axes (most math work starts here — CONTRACT D4).
    const cx = Math.round(w / 2);
    const cy = Math.round(h / 2);
    ctx.strokeStyle = colors.axis;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(w, cy);
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.stroke();
  }
  // "blank" paints only the page fill.
  ctx.restore();
}

/** Replay one stroke as a smoothed polyline. Pressure modulates width (CONTRACT D3). */
function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const pts = stroke.points;
  if (pts.length === 0) return;

  ctx.save();
  ctx.globalCompositeOperation = stroke.erase ? "destination-out" : "source-over";
  ctx.strokeStyle = stroke.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // A single tap → a dot (a zero-length polyline draws nothing otherwise).
  if (pts.length === 1) {
    const only = pts[0];
    ctx.fillStyle = stroke.color;
    ctx.beginPath();
    ctx.arc(only.x, only.y, Math.max(0.5, (stroke.width * (0.4 + 0.6 * only.p)) / 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  // Width walks with pressure per segment, so a press swells the line.
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    ctx.lineWidth = stroke.width * (0.4 + 0.6 * b.p);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    // Quadratic smoothing toward the segment midpoint reads less jagged than raw lines.
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    ctx.quadraticCurveTo(a.x, a.y, mx, my);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

/** Clear → template → replay every stroke → paint an opaque page base UNDER it all.
 * The single source of truth for the bitmap. The trailing destination-over fill is
 * load-bearing: the eraser is a destination-out stroke that punches alpha to zero, so
 * without a base BEHIND the result, erased regions (and the exported PNG) would be
 * transparent — defeating the "solid sheet the tutor can see" invariant. */
export function repaint(ctx: CanvasRenderingContext2D, doc: CanvasDoc, colors: PaintColors): void {
  ctx.clearRect(0, 0, doc.width, doc.height);
  drawTemplate(ctx, doc.template, doc.width, doc.height, colors);
  for (const stroke of doc.strokes) drawStroke(ctx, stroke);
  // Fill the page color behind everything (incl. erased holes) → opaque sheet.
  ctx.save();
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, doc.width, doc.height);
  ctx.restore();
}
