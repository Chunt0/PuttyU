// Theme state (DESIGN-SYSTEM §Themes): data-theme on <html>, persisted, with
// the kit's one-frame transition suppression so var() colors don't stick
// mid-fade (docs/M0.3-FIDELITY.md §F).
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { DEFAULT_THEME, THEMES } from "./themes";

function applyThemeToDom(key: string): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme-switching", "");
  root.dataset.theme = key;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => root.removeAttribute("data-theme-switching"));
  });
}

interface ThemeState {
  theme: string;
  /** Returns false for an unknown theme key (callers surface the error). */
  setTheme: (key: string) => boolean;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: DEFAULT_THEME,
      setTheme: (key: string) => {
        if (!(key in THEMES)) return false;
        applyThemeToDom(key);
        set({ theme: key });
        return true;
      },
    }),
    {
      name: "puttyu-theme",
      onRehydrateStorage: () => (state) => {
        applyThemeToDom(state?.theme ?? DEFAULT_THEME);
      },
    },
  ),
);
