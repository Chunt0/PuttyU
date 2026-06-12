import { create } from "zustand";
import { DEFAULT_THEME, THEME_KEYS } from "./themes.ts";

/**
 * Client/UI state ONLY (ADR 0001: never server data here — that lives in TanStack Query).
 * `currentSessionId` is which session the user has selected; null = none yet.
 */
interface UiState {
  currentSessionId: string | null;
  setCurrentSession: (id: string | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  currentSessionId: null,
  setCurrentSession: (id) => set({ currentSessionId: id }),
}));

const THEME_KEY = "puttyu-theme";

/** Read the saved theme from localStorage, falling back to the default. */
function readSavedTheme(): string {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved && THEME_KEYS.includes(saved)) return saved;
  } catch {
    /* localStorage unavailable (private mode / SSR) — use default */
  }
  return DEFAULT_THEME;
}

/** Apply a theme by toggling `data-theme` on <html>. */
function applyTheme(key: string): void {
  document.documentElement.dataset.theme = key;
}

/**
 * Theme selection — the chosen theme key, persisted to localStorage and applied
 * to <html> via `data-theme`. The default putty look is the `:root` baseline in
 * shell.css; a non-default key activates the matching block in themes.css.
 */
interface ThemeState {
  theme: string;
  setTheme: (key: string) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: readSavedTheme(),
  setTheme: (key) => {
    applyTheme(key);
    try {
      localStorage.setItem(THEME_KEY, key);
    } catch {
      /* ignore persistence failure */
    }
    set({ theme: key });
  },
}));

/** Apply the saved theme on first import (before React mounts). */
applyTheme(readSavedTheme());
