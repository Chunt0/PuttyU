// themes.ts — theme metadata for the picker (subset of putty-ai-design/themes.ts).
// The full per-theme token blocks live in app/themes.css; this file only carries
// what the UI needs to LIST and APPLY a theme: its key, human label, and whether
// it is a light canvas (used to group/sort the picker).

export interface ThemeMeta {
  /** data-theme attribute value */
  key: string;
  /** human-readable label shown in the picker */
  label: string;
  /** true for light-canvas themes */
  light: boolean;
}

/** Order mirrors the design kit's swatch grid; putty (mono) is the default. */
export const THEMES: ThemeMeta[] = [
  { key: "putty", label: "putty (mono)", light: false },
  { key: "putty-light", label: "putty (light)", light: true },
  { key: "dark", label: "Original", light: false },
  { key: "light", label: "Light", light: true },
  { key: "midnight", label: "Midnight", light: false },
  { key: "paper", label: "Paper", light: true },
  { key: "cyberpunk", label: "Cyberpunk", light: false },
  { key: "retrowave", label: "Retrowave", light: false },
  { key: "forest", label: "Forest", light: false },
  { key: "ocean", label: "Ocean", light: false },
  { key: "ume", label: "Ume", light: false },
  { key: "copper", label: "Copper", light: false },
  { key: "terminal", label: "Terminal", light: false },
  { key: "organs", label: "Organs", light: false },
  { key: "lavender", label: "Lavender", light: true },
  { key: "gpt", label: "GPT", light: false },
  { key: "claude", label: "Claude", light: false },
  { key: "cute", label: "Cute", light: true },
];

export const THEME_KEYS = THEMES.map((t) => t.key);
export const DEFAULT_THEME = "putty";
