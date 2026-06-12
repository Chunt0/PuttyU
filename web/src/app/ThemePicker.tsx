import { useThemeStore } from "../lib/store.ts";
import { THEMES } from "../lib/themes.ts";

/** Compact theme selector for the sidebar — applies/persists via the store. */
export function ThemePicker() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  return (
    <label className="theme-picker">
      <span className="theme-picker-label">Theme</span>
      <select
        aria-label="Theme"
        value={theme}
        onChange={(e) => setTheme(e.target.value)}
      >
        {THEMES.map((t) => (
          <option key={t.key} value={t.key}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
  );
}
