// Shell UI state (docs/M0.3-FIDELITY.md §A): sidebar width/rail/sections are
// persisted; the mobile drawer is ephemeral.
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 700;
export const SIDEBAR_COLLAPSE_BELOW = 150;
export const SIDEBAR_DEFAULT = 264;

interface UiState {
  sidebarWidth: number;
  railOnly: boolean;
  /** Rail collapse forced by a dock squeeze — restored on undock. */
  railAuto: boolean;
  navOpen: boolean; // mobile drawer (not persisted)
  collapsedSections: Record<string, boolean>;
  setSidebarWidth: (w: number) => void;
  setRailOnly: (rail: boolean, auto?: boolean) => void;
  toggleRail: () => void;
  setNavOpen: (open: boolean) => void;
  toggleSection: (id: string) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarWidth: SIDEBAR_DEFAULT,
      railOnly: false,
      railAuto: false,
      navOpen: false,
      collapsedSections: {},
      setSidebarWidth: (w) =>
        set({
          sidebarWidth: Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)),
        }),
      setRailOnly: (rail, auto = false) =>
        set({ railOnly: rail, railAuto: rail ? auto : false }),
      toggleRail: () =>
        set((s) => ({ railOnly: !s.railOnly, railAuto: false })),
      setNavOpen: (open) => set({ navOpen: open }),
      toggleSection: (id) =>
        set((s) => ({
          collapsedSections: {
            ...s.collapsedSections,
            [id]: !s.collapsedSections[id],
          },
        })),
    }),
    {
      name: "puttyu-ui",
      partialize: (s) => ({
        sidebarWidth: s.sidebarWidth,
        railOnly: s.railOnly,
        collapsedSections: s.collapsedSections,
      }),
    },
  ),
);
