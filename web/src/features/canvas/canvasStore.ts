/**
 * canvasStore.ts — the cross-window opener for the standalone Canvas tool (T6b / SPEC F4,
 * CONTRACT D7). The window manager's tool registry is static, so a caller raises the Canvas
 * window through `openCanvas`. Mirrors gymStore.ts / pdfStore.ts.
 *
 * `target` is minimal for v1 (null = a blank standalone canvas in save-to-materials mode);
 * the inline composer/gym/worksheet mounts pass their own `onAccept` and don't use it. It's
 * the seam where a future "reopen this material editable" (D8 follow-up) would land.
 */
import { create } from "zustand";
import { useWindowStore } from "../../app/windows/windowStore.ts";

export interface CanvasTarget {
  /** Reserved for the D8 sidecar follow-up: a material to reopen as an editable doc. */
  sourceId: string;
}

interface CanvasState {
  target: CanvasTarget | null;
  setTarget: (t: CanvasTarget | null) => void;
  clear: () => void;
}

export const useCanvasStore = create<CanvasState>((set) => ({
  target: null,
  setTarget: (target) => set({ target }),
  clear: () => set({ target: null }),
}));

/** Open (or refocus) the standalone Canvas window. v1: a blank surface (no target). */
export function openCanvas(target?: CanvasTarget): void {
  useCanvasStore.getState().setTarget(target ?? null);
  useWindowStore.getState().open("canvas");
}
