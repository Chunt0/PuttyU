// Tool-window state (docs/M0.3-FIDELITY.md §B). Geometry is inline fixed-px
// (Odysseus model — snap/dock math reads rects and writes px, no transforms).
// Per-window floating size and dock widths persist; layout state is ephemeral.
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type WinId = "theme" | "shortcuts";
export type DockSide = "left" | "right";
export type TileZone = "fullscreen" | "maximize";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WinState {
  open: boolean;
  minimized: boolean;
  rect: Rect;
  dock: DockSide | null;
  tile: TileZone | null;
  /** Floating rect stashed before a dock/tile snap; restored on unsnap. */
  preSnap: Rect | null;
}

const DEFAULT_RECTS: Record<WinId, Rect> = {
  theme: { x: 120, y: 90, w: 520, h: 420 },
  shortcuts: { x: 180, y: 120, w: 420, h: 380 },
};

function freshWin(id: WinId, sizes: Record<string, { w: number; h: number }>): WinState {
  const base = DEFAULT_RECTS[id];
  const saved = sizes[id];
  return {
    open: false,
    minimized: false,
    rect: saved ? { ...base, w: saved.w, h: saved.h } : { ...base },
    dock: null,
    tile: null,
    preSnap: null,
  };
}

interface WindowStore {
  wins: Partial<Record<WinId, WinState>>;
  order: WinId[]; // z-order; last = topmost
  sizes: Record<string, { w: number; h: number }>; // persisted per window id
  dockWidths: { left: number; right: number }; // persisted
  openWindow: (id: WinId) => void;
  closeWindow: (id: WinId) => void;
  focusWindow: (id: WinId) => void;
  minimizeWindow: (id: WinId) => void;
  restoreWindow: (id: WinId) => void;
  setRect: (id: WinId, rect: Rect, persistSize?: boolean) => void;
  setDock: (id: WinId, side: DockSide | null) => void;
  setDockWidth: (side: DockSide, w: number) => void;
  setTile: (id: WinId, tile: TileZone | null) => void;
  /** Topmost open, non-minimized window (Escape target). */
  topWindow: () => WinId | null;
}

export const useWindowStore = create<WindowStore>()(
  persist(
    (set, get) => ({
      wins: {},
      order: [],
      sizes: {},
      dockWidths: { left: 480, right: 480 },

      openWindow: (id) =>
        set((s) => {
          const existing = s.wins[id];
          const win = existing
            ? { ...existing, open: true, minimized: false }
            : { ...freshWin(id, s.sizes), open: true };
          return {
            wins: { ...s.wins, [id]: win },
            order: [...s.order.filter((o) => o !== id), id],
          };
        }),

      closeWindow: (id) =>
        set((s) => {
          const win = s.wins[id];
          if (!win) return s;
          return {
            wins: {
              ...s.wins,
              [id]: { ...win, open: false, dock: null, tile: null, preSnap: null },
            },
            order: s.order.filter((o) => o !== id),
          };
        }),

      focusWindow: (id) =>
        set((s) =>
          s.order[s.order.length - 1] === id
            ? s
            : { order: [...s.order.filter((o) => o !== id), id] },
        ),

      minimizeWindow: (id) =>
        set((s) => {
          const win = s.wins[id];
          if (!win) return s;
          return { wins: { ...s.wins, [id]: { ...win, minimized: true } } };
        }),

      restoreWindow: (id) =>
        set((s) => {
          const win = s.wins[id];
          if (!win) return s;
          return {
            wins: { ...s.wins, [id]: { ...win, minimized: false, open: true } },
            order: [...s.order.filter((o) => o !== id), id],
          };
        }),

      setRect: (id, rect, persistSize = false) =>
        set((s) => {
          const win = s.wins[id];
          if (!win) return s;
          return {
            wins: { ...s.wins, [id]: { ...win, rect } },
            ...(persistSize
              ? { sizes: { ...s.sizes, [id]: { w: rect.w, h: rect.h } } }
              : {}),
          };
        }),

      setDock: (id, side) =>
        set((s) => {
          const win = s.wins[id];
          if (!win) return s;
          if (side === null) {
            // Undock restores the exact pre-dock floating rect.
            return {
              wins: {
                ...s.wins,
                [id]: {
                  ...win,
                  dock: null,
                  rect: win.preSnap ?? win.rect,
                  preSnap: null,
                },
              },
            };
          }
          return {
            wins: {
              ...s.wins,
              [id]: {
                ...win,
                dock: side,
                tile: null,
                preSnap: win.preSnap ?? { ...win.rect },
              },
            },
          };
        }),

      setDockWidth: (side, w) =>
        set((s) => ({
          dockWidths: {
            ...s.dockWidths,
            [side]: Math.max(320, Math.min(w, window.innerWidth - 380)),
          },
        })),

      setTile: (id, tile) =>
        set((s) => {
          const win = s.wins[id];
          if (!win) return s;
          if (tile === null) {
            return {
              wins: {
                ...s.wins,
                [id]: {
                  ...win,
                  tile: null,
                  rect: win.preSnap ?? win.rect,
                  preSnap: null,
                },
              },
            };
          }
          return {
            wins: {
              ...s.wins,
              [id]: {
                ...win,
                tile,
                dock: null,
                preSnap: win.preSnap ?? { ...win.rect },
              },
            },
          };
        }),

      topWindow: () => {
        const { order, wins } = get();
        for (let i = order.length - 1; i >= 0; i--) {
          const id = order[i];
          const win = wins[id];
          if (win?.open && !win.minimized) return id;
        }
        return null;
      },
    }),
    {
      name: "puttyu-windows",
      partialize: (s) => ({ sizes: s.sizes, dockWidths: s.dockWidths }),
    },
  ),
);
