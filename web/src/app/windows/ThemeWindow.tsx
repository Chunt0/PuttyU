// The theme picker (docs/M0.3-FIDELITY.md §F): a swatch grid over the kit's
// 18 themes; selection applies instantly and persists.
import { THEMES } from "../themes";
import { useThemeStore } from "../themeStore";

export function ThemeWindow() {
  const current = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  return (
    <div className="theme-grid">
      {Object.values(THEMES).map((theme) => (
        <button
          key={theme.key}
          className={"theme-swatch" + (theme.key === current ? " active" : "")}
          onClick={() => setTheme(theme.key)}
          aria-pressed={theme.key === current}
        >
          <span className="strip" aria-hidden>
            <span style={{ background: theme.colors.bg }} />
            <span style={{ background: theme.colors.panel }} />
            <span style={{ background: theme.colors.fg }} />
            <span style={{ background: theme.colors.accent }} />
          </span>
          <span className="nm">{theme.label}</span>
        </button>
      ))}
    </div>
  );
}
