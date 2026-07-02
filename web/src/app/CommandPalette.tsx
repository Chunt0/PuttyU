// Cmd/Ctrl-K palette (docs/M0.3-FIDELITY.md §C): toggles open, grouped results,
// arrow navigation, Enter executes. Odysseus scopes it to conversation search;
// PuttyU extends the same interaction shell to commands + navigation (SPEC F11)
// — session search joins at M0.4.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";

import { Icons } from "../components/ui/icons";
import { registerEscape } from "./escape";
import { THEMES } from "./themes";
import { useThemeStore } from "./themeStore";
import { useWindowStore } from "./windows/windowStore";
import { create } from "zustand";

interface PaletteState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const usePaletteStore = create<PaletteState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));

interface PaletteItem {
  id: string;
  category: string;
  label: string;
  keywords: string;
  icon: ReactNode;
  kbd?: string;
  run: () => void;
}

function usePaletteItems(): PaletteItem[] {
  const navigate = useNavigate();
  return useMemo(() => {
    const openWindow = (id: "theme" | "shortcuts") =>
      useWindowStore.getState().openWindow(id);
    const items: PaletteItem[] = [
      { id: "home", category: "Navigate", label: "Home", keywords: "home welcome", icon: <Icons.Chat />, run: () => void navigate("/") },
      { id: "providers", category: "Navigate", label: "Providers", keywords: "providers settings models endpoints router", icon: <Icons.Settings size={14} />, run: () => void navigate("/settings/providers") },
      { id: "win-theme", category: "Tools", label: "Theme picker", keywords: "theme colors appearance", icon: <Icons.Theme />, run: () => openWindow("theme") },
      { id: "win-shortcuts", category: "Tools", label: "Keyboard shortcuts", keywords: "shortcuts keys help", icon: <Icons.Tool size={14} />, run: () => openWindow("shortcuts") },
      ...Object.values(THEMES).map((t) => ({
        id: `theme-${t.key}`,
        category: "Theme",
        label: `Theme: ${t.label}`,
        keywords: `theme ${t.key} ${t.label}`,
        icon: <Icons.Theme />,
        run: () => void useThemeStore.getState().setTheme(t.key),
      })),
    ];
    return items;
  }, [navigate]);
}

function scoreItem(item: PaletteItem, query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  const label = item.label.toLowerCase();
  if (label.startsWith(q)) return 500;
  if (label.includes(q)) return 100;
  if (item.keywords.toLowerCase().includes(q)) return 50;
  return 0;
}

export function CommandPalette() {
  const open = usePaletteStore((s) => s.open);
  const setOpen = usePaletteStore((s) => s.setOpen);
  const items = usePaletteItems();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    return items
      .map((item) => [scoreItem(item, query), item] as const)
      .filter(([score]) => score > 0)
      .sort((a, b) => b[0] - a[0])
      .map(([, item]) => item);
  }, [items, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setSelected(0), [query]);

  useEffect(
    () =>
      registerEscape({
        priority: 200,
        isActive: () => usePaletteStore.getState().open,
        dismiss: () => usePaletteStore.getState().setOpen(false),
      }),
    [],
  );

  useEffect(() => {
    listRef.current
      ?.querySelector(".palette-item.selected")
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!open) return null;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((i) => Math.min(results.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = results[selected];
      if (item) {
        setOpen(false);
        item.run();
      }
    }
  };

  let lastCategory = "";
  return (
    <div className="palette-scrim" onClick={() => setOpen(false)}>
      <div className="palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <div className="palette-input">
          <Icons.Search size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to, run, switch…"
            aria-label="Palette query"
          />
        </div>
        <div className="palette-list" ref={listRef}>
          {results.length === 0 ? (
            <div className="palette-empty">No results</div>
          ) : (
            results.map((item, index) => {
              const header =
                item.category !== lastCategory ? (
                  <div className="palette-cat">{item.category}</div>
                ) : null;
              lastCategory = item.category;
              return (
                <div key={item.id}>
                  {header}
                  <div
                    className={
                      "palette-item" + (index === selected ? " selected" : "")
                    }
                    onMouseEnter={() => setSelected(index)}
                    onClick={() => {
                      setOpen(false);
                      item.run();
                    }}
                  >
                    <span className="ic">{item.icon}</span>
                    {item.label}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
