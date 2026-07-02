// Snap-zone math (docs/M0.3-FIDELITY.md §B, thresholds from Odysseus
// tileManager/modalSnap): top strip = fullscreen/maximize, side edges = dock
// (the ghost previews the docked half-layout).
import type { DockSide, Rect, TileZone } from "./windowStore";

export const DOCK_SNAP_PX = 60; // side-edge snap-in zone (modalSnap SNAP_PX)
export const DOCK_UNSNAP_PX = 80; // drag-out distance to undock
export const FULLSCREEN_STRIP_PX = 2; // y at the very top edge
export const MAXIMIZE_STRIP_PX = 12; // just below it
export const MIN_CHAT_WIDTH = 380; // docking never squeezes chat below this

export type SnapTarget =
  | { kind: "tile"; zone: TileZone }
  | { kind: "dock"; side: DockSide }
  | null;

export function snapTargetAt(px: number, py: number): SnapTarget {
  const vw = window.innerWidth;
  if (py <= FULLSCREEN_STRIP_PX) return { kind: "tile", zone: "fullscreen" };
  if (py <= MAXIMIZE_STRIP_PX) return { kind: "tile", zone: "maximize" };
  if (px <= DOCK_SNAP_PX) return { kind: "dock", side: "left" };
  if (px >= vw - DOCK_SNAP_PX) return { kind: "dock", side: "right" };
  return null;
}

/** The rect a snap target would occupy — also used for the ghost preview. */
export function rectForTarget(
  target: NonNullable<SnapTarget>,
  sidebarWidth: number,
  dockWidths: { left: number; right: number },
): Rect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (target.kind === "tile") {
    if (target.zone === "fullscreen") return { x: 0, y: 0, w: vw, h: vh };
    // maximize: fill beside the sidebar
    return { x: sidebarWidth, y: 0, w: vw - sidebarWidth, h: vh };
  }
  const w = clampDockWidth(target.side, dockWidths[target.side], sidebarWidth);
  return target.side === "left"
    ? { x: 0, y: 0, w, h: vh }
    : { x: vw - w, y: 0, w, h: vh };
}

export function clampDockWidth(
  side: DockSide,
  desired: number,
  sidebarWidth: number,
): number {
  const vw = window.innerWidth;
  // Default ≈38% of viewport clamped 420–640 (modalSnap), then never squeeze
  // the chat area below MIN_CHAT_WIDTH.
  const base = desired || Math.max(420, Math.min(640, Math.round(vw * 0.38)));
  const chatReserve = side === "right" ? sidebarWidth : 0;
  return Math.max(320, Math.min(base, vw - chatReserve - MIN_CHAT_WIDTH));
}

export function clampRectToViewport(rect: Rect): Rect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(rect.w, vw);
  const h = Math.min(rect.h, vh);
  return {
    x: Math.max(0, Math.min(rect.x, vw - w)),
    y: Math.max(0, Math.min(rect.y, vh - h)),
    w,
    h,
  };
}

export type EdgeSet = { l: boolean; r: boolean; t: boolean; b: boolean };

/** Which window borders the pointer is near (Odysseus windowResize EDGE=7). */
export function edgesAt(rect: Rect, px: number, py: number, edge = 7): EdgeSet | null {
  const inside =
    px >= rect.x - edge &&
    px <= rect.x + rect.w + edge &&
    py >= rect.y - edge &&
    py <= rect.y + rect.h + edge;
  if (!inside) return null;
  const set: EdgeSet = {
    l: Math.abs(px - rect.x) <= edge,
    r: Math.abs(px - (rect.x + rect.w)) <= edge,
    t: Math.abs(py - rect.y) <= edge,
    b: Math.abs(py - (rect.y + rect.h)) <= edge,
  };
  return set.l || set.r || set.t || set.b ? set : null;
}

export function cursorForEdges(edges: EdgeSet): string {
  if ((edges.l && edges.t) || (edges.r && edges.b)) return "nwse-resize";
  if ((edges.r && edges.t) || (edges.l && edges.b)) return "nesw-resize";
  if (edges.l || edges.r) return "ew-resize";
  return "ns-resize";
}
