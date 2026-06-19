import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Canvas } from "./Canvas.tsx";
import { useCourseStore } from "../courses/store.ts";
import { renderWithProviders, jsonResponse, stubFetch } from "../../test/util.tsx";

/** A recording 2D context so we can assert strokes hit the surface, plus toBlob + the
 * pointer-capture / measurement methods jsdom doesn't implement on HTMLCanvasElement. */
let lastCtx: { ops: string[]; strokes: number };

function stubCanvas() {
  lastCtx = { ops: [], strokes: 0 };
  const ctx = {
    set globalCompositeOperation(_v: string) {
      /* recorded per-op below where it matters */
    },
    get globalCompositeOperation() {
      return "source-over";
    },
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 0,
    lineCap: "butt",
    lineJoin: "miter",
    setTransform: vi.fn(),
    scale: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(() => {
      lastCtx.ops.push("curve");
    }),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob(["png-bytes"], { type: "image/png" }));
  };
  // jsdom stubs for the surface element.
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
  HTMLCanvasElement.prototype.releasePointerCapture = vi.fn();
  HTMLCanvasElement.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, top: 0, left: 0, right: 720, bottom: 460, width: 720, height: 460, toJSON: () => ({}) };
  } as unknown as () => DOMRect;
}

/** Draw a stroke: down → two moves (with pressure) → up. Returns the captured points. */
async function drawStroke(canvas: HTMLElement) {
  fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10, pressure: 0.7 });
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 40, clientY: 50, pressure: 0.9 });
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 80, clientY: 30, pressure: 0.6 });
  fireEvent.pointerUp(canvas, { pointerId: 1 });
}

beforeEach(() => {
  useCourseStore.setState({ activeCourseId: "c1", onboardingSkipped: false });
  stubFetch([["/api/courses", () => jsonResponse({ courses: [{ id: "c1", name: "Stats", status: "active", settings: {} }] })]]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("Canvas", () => {
  it("opens an inline panel from the idle Draw button", async () => {
    stubCanvas();
    renderWithProviders(<Canvas onAccept={() => undefined} />);
    expect(screen.queryByTestId("canvas-surface")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Draw" }));
    expect(screen.getByTestId("canvas-surface")).toBeInTheDocument();
  });

  it("a pointerdown/move/up enters a stroke into the model and replays it", async () => {
    stubCanvas();
    renderWithProviders(<Canvas onAccept={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "Draw" }));
    const surface = screen.getByTestId("canvas-surface");

    // Before drawing, undo/clear are disabled (no strokes).
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();

    await drawStroke(surface);

    // The polyline replayed (quadraticCurveTo ran) → a stroke is in the model.
    expect(lastCtx.ops).toContain("curve");
    // And the stroke-dependent controls light up.
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Send to tutor" })).toBeEnabled();
  });

  it("undo pops the last stroke (returns to the empty, disabled state)", async () => {
    stubCanvas();
    renderWithProviders(<Canvas onAccept={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "Draw" }));
    const surface = screen.getByTestId("canvas-surface");
    await drawStroke(surface);
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled());

    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send to tutor" })).toBeDisabled();
  });

  it("Send to tutor hands back exactly one image/png File (the CameraCapture door)", async () => {
    stubCanvas();
    const onAccept = vi.fn();
    renderWithProviders(<Canvas onAccept={onAccept} />);
    await userEvent.click(screen.getByRole("button", { name: "Draw" }));
    await drawStroke(screen.getByTestId("canvas-surface"));

    await userEvent.click(screen.getByRole("button", { name: "Send to tutor" }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    const files = onAccept.mock.calls[0][0] as File[];
    expect(files).toHaveLength(1);
    expect(files[0].type).toBe("image/png");
    expect(files[0].name).toMatch(/^canvas-\d+\.png$/);
    // The panel closes back to the idle button after sending.
    expect(screen.getByRole("button", { name: "Draw" })).toBeInTheDocument();
  });

  it("standalone mode (no onAccept) offers Save to course materials", async () => {
    stubCanvas();
    renderWithProviders(<Canvas />);
    await userEvent.click(screen.getByRole("button", { name: "Draw" }));
    await drawStroke(screen.getByTestId("canvas-surface"));
    expect(screen.queryByRole("button", { name: "Send to tutor" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save to course materials" })).toBeInTheDocument();
  });
});
