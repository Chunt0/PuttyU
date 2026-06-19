import { describe, it, expect } from "vitest";
import {
  type CanvasDoc,
  type PaintColors,
  type Stroke,
  addPoint,
  drawTemplate,
  emptyDoc,
  repaint,
} from "./canvas.model.ts";

const COLORS: PaintColors = { background: "#000", guide: "#111", axis: "#222" };

/** A recording 2D-context stub: enough surface for repaint/drawTemplate/drawStroke, plus a
 * log of the calls we assert on. */
function recordingCtx() {
  const calls: string[] = [];
  const ops: string[] = []; // every globalCompositeOperation value set, in order
  const ctx = {
    set globalCompositeOperation(v: string) {
      ops.push(v);
    },
    get globalCompositeOperation() {
      return ops[ops.length - 1] ?? "source-over";
    },
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 0,
    lineCap: "butt",
    lineJoin: "miter",
    clearRect: () => calls.push("clearRect"),
    fillRect: () => calls.push("fillRect"),
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    beginPath: () => calls.push("beginPath"),
    moveTo: () => calls.push("moveTo"),
    lineTo: () => calls.push("lineTo"),
    quadraticCurveTo: () => calls.push("quadraticCurveTo"),
    arc: () => calls.push("arc"),
    fill: () => calls.push("fill"),
    stroke: () => calls.push("stroke"),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, ops };
}

function inkStroke(): Stroke {
  return {
    points: [
      { x: 1, y: 1, p: 0.5 },
      { x: 10, y: 10, p: 0.5 },
      { x: 20, y: 5, p: 0.5 },
    ],
    color: "#abc",
    width: 3,
    erase: false,
  };
}

describe("canvas.model", () => {
  it("emptyDoc starts blank with no strokes at the given size", () => {
    const doc = emptyDoc(640, 480, "grid");
    expect(doc).toEqual({ template: "grid", strokes: [], width: 640, height: 480 });
  });

  it("addPoint appends to the last (in-progress) stroke", () => {
    const doc: CanvasDoc = { template: "blank", strokes: [inkStroke()], width: 100, height: 100 };
    addPoint(doc, { x: 30, y: 30, p: 0.9 });
    expect(doc.strokes[0].points).toHaveLength(4);
    expect(doc.strokes[0].points[3]).toEqual({ x: 30, y: 30, p: 0.9 });
  });

  it("repaint paints the template first, then replays each stroke", () => {
    const { ctx, calls } = recordingCtx();
    const doc: CanvasDoc = { template: "ruled", strokes: [inkStroke()], width: 100, height: 100 };
    repaint(ctx, doc, COLORS);

    // Order: clear → template (fillRect) → stroke (quadraticCurveTo from drawStroke).
    expect(calls[0]).toBe("clearRect");
    const fill = calls.indexOf("fillRect");
    const curve = calls.indexOf("quadraticCurveTo");
    expect(fill).toBeGreaterThan(0);
    expect(curve).toBeGreaterThan(fill); // strokes replay AFTER the template
  });

  it("drawTemplate fills the page for every template; axes/ruled/grid add guide lines", () => {
    for (const t of ["blank", "ruled", "grid", "axes"] as const) {
      const { ctx, calls } = recordingCtx();
      drawTemplate(ctx, t, 100, 100, COLORS);
      expect(calls).toContain("fillRect"); // solid page so the PNG isn't transparent
      if (t !== "blank") expect(calls).toContain("stroke"); // guide/axis lines
    }
  });

  it("eraser strokes replay with destination-out, kept (not pixel-cleared) in the stack", () => {
    const { ctx, ops, calls } = recordingCtx();
    const eraser: Stroke = { points: inkStroke().points, color: "rgba(0,0,0,1)", width: 20, erase: true };
    const doc: CanvasDoc = { template: "blank", strokes: [eraser], width: 100, height: 100 };
    repaint(ctx, doc, COLORS);
    // The eraser stroke sets destination-out (composite erase), not a clearRect carve.
    expect(ops).toContain("destination-out");
    // It's bracketed by save/restore so the mode is scoped to this stroke only — a later
    // ink stroke would draw source-over again. (Real ctx.restore() resets the op; the stub
    // can't, so we assert the bracket itself, which is the durable invariant.)
    expect(calls.filter((c) => c === "restore").length).toBeGreaterThan(0);
    // The eraser is REPLAYED (a polyline), proving it lives in the stroke stack.
    expect(calls).toContain("quadraticCurveTo");
  });

  it("an ink stroke after an eraser draws source-over (mode is per-stroke, not sticky)", () => {
    const { ctx, ops } = recordingCtx();
    const eraser: Stroke = { points: inkStroke().points, color: "#000", width: 20, erase: true };
    const ink = inkStroke();
    const doc: CanvasDoc = { template: "blank", strokes: [eraser, ink], width: 100, height: 100 };
    repaint(ctx, doc, COLORS);
    const eraseAt = ops.indexOf("destination-out");
    const inkAt = ops.lastIndexOf("source-over");
    // The ink stroke (drawn last) sets source-over AFTER the eraser's destination-out.
    expect(eraseAt).toBeGreaterThanOrEqual(0);
    expect(inkAt).toBeGreaterThan(eraseAt);
  });

  it("composites an opaque page base UNDER everything so erased holes / the PNG aren't transparent", () => {
    const { ctx, ops, calls } = recordingCtx();
    const eraser: Stroke = { points: inkStroke().points, color: "#000", width: 20, erase: true };
    const doc: CanvasDoc = { template: "blank", strokes: [inkStroke(), eraser], width: 100, height: 100 };
    repaint(ctx, doc, COLORS);
    // The FINAL composite op is destination-over — an opaque page fill painted BEHIND
    // the result (incl. the eraser's transparent holes), so the exported PNG is a solid
    // sheet the tutor can read, not a transparent gap. (F1 review fix.)
    expect(ops[ops.length - 1]).toBe("destination-over");
    // and that base fill happens AFTER the strokes replay.
    expect(calls.lastIndexOf("fillRect")).toBeGreaterThan(calls.indexOf("quadraticCurveTo"));
  });

  it("a single-tap stroke draws a dot (arc+fill), not an empty polyline", () => {
    const { ctx, calls } = recordingCtx();
    const dot: Stroke = { points: [{ x: 5, y: 5, p: 0.5 }], color: "#abc", width: 3, erase: false };
    const doc: CanvasDoc = { template: "blank", strokes: [dot], width: 100, height: 100 };
    repaint(ctx, doc, COLORS);
    expect(calls).toContain("arc");
    expect(calls).toContain("fill");
  });

  it("undo = strokes.pop() + repaint; clear = strokes=[] + repaint", () => {
    const doc: CanvasDoc = {
      template: "blank",
      strokes: [inkStroke(), inkStroke()],
      width: 100,
      height: 100,
    };
    // Undo pops the last stroke.
    doc.strokes.pop();
    expect(doc.strokes).toHaveLength(1);
    // The remaining stroke still replays.
    const r1 = recordingCtx();
    repaint(r1.ctx, doc, COLORS);
    expect(r1.calls).toContain("quadraticCurveTo");

    // Clear empties the array → only the template paints, no stroke curves.
    doc.strokes = [];
    const r2 = recordingCtx();
    repaint(r2.ctx, doc, COLORS);
    expect(r2.calls).toContain("clearRect");
    expect(r2.calls).not.toContain("quadraticCurveTo");
  });
});
