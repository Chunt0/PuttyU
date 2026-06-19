import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { toast } from "../../components/toast.ts";
import { useCourseStore } from "../courses/store.ts";
import { useCourses } from "../courses/api.ts";
import { useUploadMaterial } from "../library/api.ts";
import {
  type CanvasDoc,
  type PaintColors,
  type Point,
  type Stroke,
  type Template,
  addPoint,
  emptyDoc,
  repaint,
} from "./canvas.model.ts";
import "./canvas.css";

interface Props {
  /** Send-to-tutor mode: hand back the drawing as a PNG `File`, exactly like CameraCapture.
   * Absent → standalone window mode (offers "Save to course materials" instead). */
  onAccept?: (files: File[]) => void;
  label?: string;
}

type Tool = "pen" | "eraser";

const SURFACE_W = 720;
const SURFACE_H = 460;
const TEMPLATES: { value: Template; label: string }[] = [
  { value: "blank", label: "Blank" },
  { value: "ruled", label: "Ruled" },
  { value: "grid", label: "Grid" },
  { value: "axes", label: "Axes" },
];

/** ≤3 palette colors, all token-derived (CONTRACT D4). The keys are CSS custom properties
 * resolved against the live theme, so a re-skin re-colors the palette too. */
const PALETTE: { token: string; label: string }[] = [
  { token: "--accent", label: "Coral" },
  { token: "--text", label: "Ink" },
  { token: "--green", label: "Green" },
];

function readToken(el: HTMLElement, token: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(token).trim();
  return v || fallback;
}

/**
 * Canvas — the draw surface (T6b / SPEC F4). Mirrors CameraCapture's inline affordance: an
 * idle "Draw" button opens an inline panel with a <canvas> + a calm toolbar (template,
 * pen/eraser, undo, clear, a small palette). Pointer Events (mouse / pad / stylus, pressure
 * aware) build one immutable stroke array — the bitmap is derived from it, so undo/clear are
 * array ops. "Send to tutor" runs the EXACT CameraCapture door: canvas → toBlob PNG → File →
 * `onAccept` → the existing upload path. With no `onAccept` (standalone window), it offers
 * "Save to course materials" via the existing useUploadMaterial, gated on an active course.
 */
export function Canvas({ onAccept, label = "Draw" }: Props) {
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState<Tool>("pen");
  const [template, setTemplate] = useState<Template>("blank");
  const [colorToken, setColorToken] = useState<string>("--accent");
  const [strokeCount, setStrokeCount] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const docRef = useRef<CanvasDoc>(emptyDoc(SURFACE_W, SURFACE_H, template));
  const colorsRef = useRef<PaintColors>({ background: "#0e0e10", guide: "#313338", axis: "#42444a" });
  const drawingRef = useRef(false);

  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const { data: courses } = useCourses();
  const activeCourse = courses?.find((c) => c.id === activeCourseId && c.status === "active");
  const upload = useUploadMaterial();

  const ctx = useCallback((): CanvasRenderingContext2D | null => {
    return canvasRef.current?.getContext("2d") ?? null;
  }, []);

  const paint = useCallback(() => {
    const c = ctx();
    if (c) repaint(c, docRef.current, colorsRef.current);
  }, [ctx]);

  // Size the backing store to devicePixelRatio for crisp lines, then scale the context so
  // all drawing math stays in CSS pixels. Re-runs when the panel opens or the template
  // changes (a template swap rebuilds the doc keeping the strokes).
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    colorsRef.current = {
      background: readToken(canvas, "--bg", "#0e0e10"),
      guide: readToken(canvas, "--border", "#313338"),
      axis: readToken(canvas, "--border2", "#42444a"),
    };
    const dpr = window.devicePixelRatio || 1;
    canvas.width = SURFACE_W * dpr;
    canvas.height = SURFACE_H * dpr;
    const c = canvas.getContext("2d");
    if (c) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.scale(dpr, dpr);
    }
    docRef.current = { ...docRef.current, template };
    paint();
  }, [open, template, paint]);

  function reset() {
    docRef.current = emptyDoc(SURFACE_W, SURFACE_H, template);
    setStrokeCount(0);
    paint();
  }

  function close() {
    setOpen(false);
    reset();
    requestAnimationFrame(() => openButtonRef.current?.focus());
  }

  /** Map a pointer event to canvas-local CSS coordinates (CONTRACT D3). */
  function toPoint(e: ReactPointerEvent<HTMLCanvasElement>): Point {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = rect.width ? SURFACE_W / rect.width : 1;
    const sy = rect.height ? SURFACE_H / rect.height : 1;
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top) * sy,
      p: e.pressure || 0.5, // mice report 0 → default 0.5
    };
  }

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const stroke: Stroke = {
      points: [toPoint(e)],
      color: tool === "eraser" ? "rgba(0,0,0,1)" : readToken(e.currentTarget, colorToken, "#e06c75"),
      width: tool === "eraser" ? 22 : 3,
      erase: tool === "eraser",
    };
    docRef.current.strokes.push(stroke);
    paint();
  }

  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    addPoint(docRef.current, toPoint(e));
    paint();
  }

  function onPointerUp(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone */
    }
    setStrokeCount(docRef.current.strokes.length);
  }

  function undo() {
    docRef.current.strokes.pop();
    setStrokeCount(docRef.current.strokes.length);
    paint();
  }

  function clearAll() {
    docRef.current.strokes = [];
    setStrokeCount(0);
    paint();
  }

  /** The "send to tutor" door — the EXACT CameraCapture path: canvas → toBlob PNG → File. */
  function toFile(then: (file: File) => void) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) {
        toast.error("Couldn't export the drawing — try again.");
        return;
      }
      then(new File([blob], `canvas-${Date.now()}.png`, { type: "image/png" }));
    }, "image/png");
  }

  function send() {
    if (!onAccept) return;
    toFile((file) => {
      onAccept([file]);
      close();
    });
  }

  function saveToMaterials() {
    if (!activeCourse) return;
    toFile((file) => {
      upload.mutate(
        { files: [file], courseId: activeCourse.id },
        {
          onSuccess: () => {
            toast.success("Saved to course materials.");
            close();
          },
          onError: () => toast.error("Couldn't save — try again."),
        },
      );
    });
  }

  if (!open) {
    return (
      <span className="canvas">
        <button
          ref={openButtonRef}
          type="button"
          className="canvas-open"
          onClick={() => setOpen(true)}
        >
          {label}
        </button>
      </span>
    );
  }

  const empty = strokeCount === 0;
  return (
    <div className="canvas canvas--active" role="group" aria-label="Drawing canvas" data-testid="canvas">
      <div className="canvas-toolbar">
        <label className="canvas-tool-label">
          <span className="canvas-vh">Template</span>
          <select
            className="canvas-template"
            value={template}
            onChange={(e) => setTemplate(e.target.value as Template)}
            aria-label="Template"
          >
            {TEMPLATES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className={`canvas-toolbtn ${tool === "pen" ? "canvas-toolbtn--on" : ""}`.trim()}
          onClick={() => setTool("pen")}
          aria-pressed={tool === "pen"}
        >
          Pen
        </button>
        <button
          type="button"
          className={`canvas-toolbtn ${tool === "eraser" ? "canvas-toolbtn--on" : ""}`.trim()}
          onClick={() => setTool("eraser")}
          aria-pressed={tool === "eraser"}
        >
          Eraser
        </button>

        <span className="canvas-palette" role="group" aria-label="Pen color">
          {PALETTE.map((p) => (
            <button
              key={p.token}
              type="button"
              className={`canvas-swatch ${colorToken === p.token ? "canvas-swatch--on" : ""}`.trim()}
              style={{ background: `var(${p.token})` }}
              onClick={() => {
                setColorToken(p.token);
                setTool("pen");
              }}
              aria-pressed={colorToken === p.token}
              aria-label={p.label}
              title={p.label}
            />
          ))}
        </span>

        <button type="button" className="canvas-toolbtn" onClick={undo} disabled={empty}>
          Undo
        </button>
        <button type="button" className="canvas-toolbtn" onClick={clearAll} disabled={empty}>
          Clear
        </button>
      </div>

      <canvas
        ref={canvasRef}
        className="canvas-surface"
        style={{ width: SURFACE_W, aspectRatio: `${SURFACE_W} / ${SURFACE_H}`, touchAction: "none" }}
        aria-label="Drawing surface"
        data-testid="canvas-surface"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      <div className="canvas-actions">
        {onAccept ? (
          <button type="button" className="canvas-send" onClick={send} disabled={empty}>
            Send to tutor
          </button>
        ) : (
          <button
            type="button"
            className="canvas-send"
            onClick={saveToMaterials}
            disabled={empty || !activeCourse || upload.isPending}
            title={activeCourse ? undefined : "Open a course tab to save to its materials"}
          >
            {upload.isPending ? "Saving…" : "Save to course materials"}
          </button>
        )}
        <button type="button" className="canvas-toolbtn" onClick={close}>
          Close
        </button>
      </div>
    </div>
  );
}
