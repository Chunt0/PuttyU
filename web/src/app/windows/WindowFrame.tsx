// A dockable tool window (docs/M0.3-FIDELITY.md §B): drag by header (4px
// threshold), resize by border proximity (no handles), edge dock, top-strip
// tiles with ghost preview, z promoted on interaction, minimize to chip.
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Icons } from "../../components/ui/icons";
import {
  clampRectToViewport,
  cursorForEdges,
  edgesAt,
  rectForTarget,
  snapTargetAt,
  type SnapTarget,
} from "./geometry";
import { useWindowStore, type Rect, type WinId } from "./windowStore";
import { useUiStore } from "../uiStore";

const MOVE_THRESHOLD = 4;
const MIN_W = 320;
const MIN_H = 200;

export function WindowFrame({
  id,
  title,
  icon,
  zIndex,
  children,
  onGhost,
}: {
  id: WinId;
  title: string;
  icon: ReactNode;
  zIndex: number;
  children: ReactNode;
  onGhost: (rect: Rect | null) => void;
}) {
  const win = useWindowStore((s) => s.wins[id]);
  const { focusWindow, closeWindow, minimizeWindow, setRect, setDock, setTile } =
    useWindowStore.getState();
  const sidebarWidth = useUiStore((s) => (s.railOnly ? 52 : s.sidebarWidth));
  const frameRef = useRef<HTMLDivElement>(null);
  const [snapping, setSnapping] = useState(false);
  const [hoverCursor, setHoverCursor] = useState<string | undefined>();

  // Live rect during drag/resize lives in a ref + inline style (smooth);
  // committed to the store on pointerup (Odysseus writes px the same way).
  const liveRect = useRef<Rect | null>(null);

  const applyStyle = (rect: Rect) => {
    const el = frameRef.current;
    if (!el) return;
    el.style.left = `${rect.x}px`;
    el.style.top = `${rect.y}px`;
    el.style.width = `${rect.w}px`;
    el.style.height = `${rect.h}px`;
  };

  const layoutRect = (): Rect => {
    if (!win) return { x: 0, y: 0, w: MIN_W, h: MIN_H };
    if (win.tile || win.dock) {
      const target: NonNullable<SnapTarget> = win.tile
        ? { kind: "tile", zone: win.tile }
        : { kind: "dock", side: win.dock! };
      return rectForTarget(target, sidebarWidth, useWindowStore.getState().dockWidths);
    }
    return clampRectToViewport(win.rect);
  };

  // --- header drag (move / unsnap / snap) ---------------------------------
  const onHeaderPointerDown = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    focusWindow(id);
    const startX = event.clientX;
    const startY = event.clientY;
    const startRect = layoutRect();
    const wasSnapped = Boolean(win?.tile || win?.dock);
    let moved = false;
    let target: SnapTarget = null;

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < MOVE_THRESHOLD) return;
      if (!moved) {
        moved = true;
        if (wasSnapped) {
          // Unsnap: restore the floating size under the cursor.
          const pre = useWindowStore.getState().wins[id]?.preSnap ?? startRect;
          if (win?.tile) setTile(id, null);
          if (win?.dock) setDock(id, null);
          liveRect.current = {
            x: e.clientX - pre.w / 2,
            y: e.clientY - 19,
            w: pre.w,
            h: pre.h,
          };
        } else {
          liveRect.current = { ...startRect };
        }
      }
      const base = liveRect.current;
      if (!base) return;
      const next = wasSnapped
        ? { ...base, x: e.clientX - base.w / 2, y: Math.max(0, e.clientY - 19) }
        : { ...base, x: startRect.x + dx, y: Math.max(0, startRect.y + dy) };
      liveRect.current = next;
      applyStyle(next);
      target = snapTargetAt(e.clientX, e.clientY);
      onGhost(
        target
          ? rectForTarget(target, sidebarWidth, useWindowStore.getState().dockWidths)
          : null,
      );
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onGhost(null);
      if (!moved) return;
      const finalRect = liveRect.current;
      liveRect.current = null;
      if (target) {
        setSnapping(true);
        if (target.kind === "tile") setTile(id, target.zone);
        else setDock(id, target.side);
        window.setTimeout(() => setSnapping(false), 240);
      } else if (finalRect) {
        setRect(id, clampRectToViewport(finalRect));
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // --- border-proximity resize (floating windows only) --------------------
  const onFramePointerMove = (event: React.PointerEvent) => {
    if (win?.tile || win?.dock || liveRect.current) return;
    const edges = edgesAt(layoutRect(), event.clientX, event.clientY);
    setHoverCursor(edges ? cursorForEdges(edges) : undefined);
  };

  const onFramePointerDown = (event: React.PointerEvent) => {
    focusWindow(id);
    if (win?.tile || win?.dock) return;
    const rect = layoutRect();
    const edges = edgesAt(rect, event.clientX, event.clientY);
    if (!edges) return;
    const interactive = (event.target as HTMLElement).closest(
      "button,input,select,textarea,a",
    );
    if (interactive) return;
    event.preventDefault();
    event.stopPropagation();
    const start = { ...rect };
    const sx = event.clientX;
    const sy = event.clientY;

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      const next = { ...start };
      if (edges.r) next.w = Math.max(MIN_W, start.w + dx);
      if (edges.b) next.h = Math.max(MIN_H, start.h + dy);
      if (edges.l) {
        next.w = Math.max(MIN_W, start.w - dx);
        next.x = start.x + (start.w - next.w);
      }
      if (edges.t) {
        next.h = Math.max(MIN_H, start.h - dy);
        next.y = start.y + (start.h - next.h);
      }
      liveRect.current = clampRectToViewport(next);
      applyStyle(liveRect.current);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const finalRect = liveRect.current;
      liveRect.current = null;
      if (finalRect) setRect(id, finalRect, true); // persist size per id
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Re-clamp on viewport resize (Odysseus tileManager._reclampAll).
  const [, forceLayout] = useState(0);
  useEffect(() => {
    const onResize = () => forceLayout((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Keep style in sync with store state (snap/unsnap/viewport changes).
  const rect = layoutRect();
  useEffect(() => {
    if (!liveRect.current) applyStyle(rect);
  });

  // Docked windows expose a drag handle on their inner edge to resize the
  // dock width (persisted; modalSnap edge-dock-resize-handle).
  const onDockResizeStart = (event: React.PointerEvent) => {
    const side = win?.dock;
    if (!side) return;
    event.preventDefault();
    event.stopPropagation();
    const onMove = (e: PointerEvent) => {
      const w = side === "left" ? e.clientX : window.innerWidth - e.clientX;
      useWindowStore.getState().setDockWidth(side, w);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  if (!win?.open || win.minimized) return null;

  return (
    <div
      ref={frameRef}
      className={
        "win" + (snapping ? " snapping" : "") + (win.dock ? " docked" : "")
      }
      style={{
        zIndex,
        cursor: hoverCursor,
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
      }}
      onPointerDown={onFramePointerDown}
      onPointerMove={onFramePointerMove}
      role="dialog"
      aria-label={title}
      data-window={id}
    >
      <div className="win-head" onPointerDown={onHeaderPointerDown}>
        <span className="ic">{icon}</span>
        <span className="grow">{title}</span>
        <button
          className="win-btn"
          aria-label={`Minimize ${title}`}
          onClick={() => minimizeWindow(id)}
        >
          <Icons.Minimize />
        </button>
        <button
          className="win-btn"
          aria-label={`Close ${title}`}
          onClick={() => closeWindow(id)}
        >
          <Icons.Close />
        </button>
      </div>
      <div className="win-body">{children}</div>
      {win.dock ? (
        <div
          className={`dock-resize dock-resize-${win.dock}`}
          onPointerDown={onDockResizeStart}
          aria-hidden
        />
      ) : null}
    </div>
  );
}
