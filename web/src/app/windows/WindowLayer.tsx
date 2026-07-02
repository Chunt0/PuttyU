// Renders all tool windows + the tile ghost + minimized dock chips, reserves
// body space for docked windows via CSS vars, and registers the Escape target
// (topmost window) with the arbiter.
import { useEffect, useState, type ReactNode } from "react";

import { Icons } from "../../components/ui/icons";
import { registerEscape } from "../escape";
import { useUiStore } from "../uiStore";
import { ShortcutsWindow } from "./ShortcutsWindow";
import { ThemeWindow } from "./ThemeWindow";
import { WindowFrame } from "./WindowFrame";
import { MIN_CHAT_WIDTH } from "./geometry";
import { useWindowStore, type Rect, type WinId } from "./windowStore";

const REGISTRY: Record<
  WinId,
  { title: string; icon: ReactNode; body: ReactNode }
> = {
  theme: { title: "Theme", icon: <Icons.Theme />, body: <ThemeWindow /> },
  shortcuts: {
    title: "Shortcuts",
    icon: <Icons.Tool size={14} />,
    body: <ShortcutsWindow />,
  },
};

export function WindowLayer() {
  const wins = useWindowStore((s) => s.wins);
  const order = useWindowStore((s) => s.order);
  const dockWidths = useWindowStore((s) => s.dockWidths);
  const [ghost, setGhost] = useState<Rect | null>(null);

  // Reserve body space for docked windows (Odysseus modalSnap: body padding
  // via CSS vars) + auto-collapse the sidebar if the chat would be squeezed.
  useEffect(() => {
    const root = document.documentElement;
    const leftDocked = Object.values(wins).some((w) => w?.open && !w.minimized && w.dock === "left");
    const rightDocked = Object.values(wins).some((w) => w?.open && !w.minimized && w.dock === "right");
    root.style.setProperty("--left-dock-w", leftDocked ? `${dockWidths.left}px` : "0px");
    root.style.setProperty("--right-dock-w", rightDocked ? `${dockWidths.right}px` : "0px");

    const ui = useUiStore.getState();
    const dockW = (leftDocked ? dockWidths.left : 0) + (rightDocked ? dockWidths.right : 0);
    if (dockW > 0 && !ui.railOnly) {
      if (window.innerWidth - dockW - ui.sidebarWidth < MIN_CHAT_WIDTH) {
        ui.setRailOnly(true, true); // auto — restored on undock
      }
    } else if (dockW === 0 && ui.railOnly && ui.railAuto) {
      ui.setRailOnly(false);
    }
  }, [wins, dockWidths]);

  // Escape closes the topmost open window (priority 100 — below palette/slash).
  useEffect(
    () =>
      registerEscape({
        priority: 100,
        isActive: () => useWindowStore.getState().topWindow() !== null,
        dismiss: () => {
          const top = useWindowStore.getState().topWindow();
          if (top) useWindowStore.getState().closeWindow(top);
        },
      }),
    [],
  );

  const minimized = (Object.keys(REGISTRY) as WinId[]).filter(
    (id) => wins[id]?.open && wins[id]?.minimized,
  );

  return (
    <>
      {order.map((id, index) => (
        <WindowFrame
          key={id}
          id={id}
          title={REGISTRY[id].title}
          icon={REGISTRY[id].icon}
          zIndex={250 + index}
          onGhost={setGhost}
        >
          {REGISTRY[id].body}
        </WindowFrame>
      ))}
      {ghost ? (
        <div
          className="tile-ghost"
          style={{ left: ghost.x, top: ghost.y, width: ghost.w, height: ghost.h }}
        />
      ) : null}
      {minimized.length > 0 ? (
        <div className="chip-dock">
          {minimized.map((id) => (
            <button
              key={id}
              className="chip"
              onClick={() => useWindowStore.getState().restoreWindow(id)}
            >
              <span className="ic">{REGISTRY[id].icon}</span>
              {REGISTRY[id].title}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
