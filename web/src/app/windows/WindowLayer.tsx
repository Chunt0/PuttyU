import { useEffect } from "react";
import { useWindowStore, dockedWidth } from "./windowStore.ts";
import { FloatingWindow } from "./FloatingWindow.tsx";
import { toolByKey } from "./tools.tsx";

/** Chips for minimized windows — click to restore (legacy dock bar). */
function DockBar() {
  const windows = useWindowStore((s) => s.windows);
  const restore = useWindowStore((s) => s.restore);
  const minimized = Object.values(windows).filter((w) => w.minimized);
  if (minimized.length === 0) return null;
  return (
    <div className="dock-bar" data-testid="dock-bar">
      {minimized.map((w) => (
        <button key={w.key} className="dock-chip" onClick={() => restore(w.key)}>
          {toolByKey.get(w.key)?.title ?? w.key}
        </button>
      ))}
    </div>
  );
}

/**
 * Renders all open tool windows over the shell, plus the dock bar. Docked panels push the
 * main content aside via the --docked-left/right CSS vars on <html> (shell.css reads them).
 */
export function WindowLayer() {
  const windows = useWindowStore((s) => s.windows);

  const left = dockedWidth(windows, "left");
  const right = dockedWidth(windows, "right");
  useEffect(() => {
    const st = document.documentElement.style;
    st.setProperty("--docked-left", `${left}px`);
    st.setProperty("--docked-right", `${right}px`);
    return () => {
      st.removeProperty("--docked-left");
      st.removeProperty("--docked-right");
    };
  }, [left, right]);

  return (
    <>
      {Object.values(windows)
        .filter((w) => !w.minimized)
        .map((w) => {
          const tool = toolByKey.get(w.key);
          if (!tool) return null;
          return (
            <FloatingWindow key={w.key} win={w} title={tool.title}>
              {tool.node}
            </FloatingWindow>
          );
        })}
      <DockBar />
    </>
  );
}
