/**
 * windowStore.ts — the floating-window manager's state (legacy modalManager parity).
 *
 * Tool screens (calendar, notes, …) open as draggable windows over the chat. A window can
 * be moved, resized, minimized to the dock bar, or snapped to the left/right edge (where
 * it becomes a full-height side panel and the chat shrinks to make room). Geometry is
 * persisted per window key so a tool reopens where the user left it.
 */
import { create } from "zustand";

export type DockSide = "left" | "right" | null;

export interface WindowState {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  minimized: boolean;
  dock: DockSide;
}

interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
  dock: DockSide;
}

const STORAGE_KEY = "puttyu-windows";
const DEFAULT_W = 620;
const DEFAULT_H = 540;
const MIN_W = 320;
const MIN_H = 240;

function loadGeometry(): Record<string, Geometry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Geometry>) : {};
  } catch {
    return {};
  }
}

function saveGeometry(key: string, g: Geometry): void {
  try {
    const all = loadGeometry();
    all[key] = g;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* persistence is best-effort */
  }
}

const geom = (w: WindowState): Geometry => ({ x: w.x, y: w.y, w: w.w, h: w.h, dock: w.dock });

interface WindowsStore {
  windows: Record<string, WindowState>;
  nextZ: number;
  open: (key: string) => void;
  close: (key: string) => void;
  focus: (key: string) => void;
  minimize: (key: string) => void;
  restore: (key: string) => void;
  move: (key: string, x: number, y: number) => void;
  resize: (key: string, w: number, h: number) => void;
  setDock: (key: string, side: DockSide) => void;
}

export const useWindowStore = create<WindowsStore>((set, get) => ({
  windows: {},
  nextZ: 1,

  open: (key) => {
    const { windows, nextZ } = get();
    const existing = windows[key];
    if (existing) {
      // Re-opening an open window focuses (and un-minimizes) it.
      set({
        windows: { ...windows, [key]: { ...existing, minimized: false, z: nextZ } },
        nextZ: nextZ + 1,
      });
      return;
    }
    const saved = loadGeometry()[key];
    const cascade = Object.keys(windows).length;
    const win: WindowState = {
      key,
      x: saved?.x ?? 120 + cascade * 32,
      y: saved?.y ?? 72 + cascade * 26,
      w: saved?.w ?? DEFAULT_W,
      h: saved?.h ?? DEFAULT_H,
      dock: saved?.dock ?? null,
      minimized: false,
      z: nextZ,
    };
    set({ windows: { ...windows, [key]: win }, nextZ: nextZ + 1 });
  },

  close: (key) => {
    const { windows } = get();
    const win = windows[key];
    if (win) saveGeometry(key, geom(win));
    const rest = { ...windows };
    delete rest[key];
    set({ windows: rest });
  },

  focus: (key) => {
    const { windows, nextZ } = get();
    const win = windows[key];
    if (!win || win.z === nextZ - 1) return;
    set({ windows: { ...windows, [key]: { ...win, z: nextZ } }, nextZ: nextZ + 1 });
  },

  minimize: (key) => {
    const { windows } = get();
    const win = windows[key];
    if (!win) return;
    set({ windows: { ...windows, [key]: { ...win, minimized: true } } });
  },

  restore: (key) => {
    const { windows, nextZ } = get();
    const win = windows[key];
    if (!win) return;
    set({
      windows: { ...windows, [key]: { ...win, minimized: false, z: nextZ } },
      nextZ: nextZ + 1,
    });
  },

  move: (key, x, y) => {
    const { windows } = get();
    const win = windows[key];
    if (!win) return;
    const next = { ...win, x: Math.max(0, x), y: Math.max(0, y) };
    saveGeometry(key, geom(next));
    set({ windows: { ...windows, [key]: next } });
  },

  resize: (key, w, h) => {
    const { windows } = get();
    const win = windows[key];
    if (!win) return;
    const next = { ...win, w: Math.max(MIN_W, w), h: Math.max(MIN_H, h) };
    saveGeometry(key, geom(next));
    set({ windows: { ...windows, [key]: next } });
  },

  setDock: (key, side) => {
    const { windows, nextZ } = get();
    const win = windows[key];
    if (!win) return;
    const next = { ...win, dock: side, minimized: false, z: nextZ };
    saveGeometry(key, geom(next));
    set({ windows: { ...windows, [key]: next }, nextZ: nextZ + 1 });
  },
}));

/** Width (px) of the panel docked on `side`, 0 if none — drives the chat's margins. */
export function dockedWidth(windows: Record<string, WindowState>, side: "left" | "right"): number {
  let max = 0;
  for (const w of Object.values(windows)) {
    if (w.dock === side && !w.minimized) max = Math.max(max, w.w);
  }
  return max;
}
