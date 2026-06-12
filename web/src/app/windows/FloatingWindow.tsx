import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import { useWindowStore, type WindowState, type DockSide } from "./windowStore.ts";

const SNAP_PX = 36; // drag within this distance of a viewport edge to snap-dock

interface Props {
  win: WindowState;
  title: string;
  children: ReactNode;
}

/** Start a pointer drag: calls `onMove` with deltas while dragging, `onUp` once on release.
 * Live updates go straight to the DOM; the caller commits to the store on release. */
function trackPointer(
  e: PointerEvent,
  onMove: (dx: number, dy: number, ev: globalThis.PointerEvent) => void,
  onUp: (dx: number, dy: number, ev: globalThis.PointerEvent) => void,
) {
  e.preventDefault();
  const startX = e.clientX;
  const startY = e.clientY;
  function move(ev: globalThis.PointerEvent) {
    onMove(ev.clientX - startX, ev.clientY - startY, ev);
  }
  function up(ev: globalThis.PointerEvent) {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    onUp(ev.clientX - startX, ev.clientY - startY, ev);
  }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/**
 * A draggable, resizable tool window (legacy modalManager parity). Drag the header to
 * move; drag near the left/right viewport edge to snap-dock as a side panel (or use the
 * explicit dock buttons). Docked panels are full-height; the float button pops them back
 * out. Minimize sends the window to the dock bar.
 */
export function FloatingWindow({ win, title, children }: Props) {
  const { close, focus, minimize, move, resize, setDock } = useWindowStore.getState();
  const ref = useRef<HTMLDivElement>(null);
  const [snapPreview, setSnapPreview] = useState<DockSide>(null);

  function snapZone(ev: globalThis.PointerEvent): DockSide {
    if (ev.clientX <= SNAP_PX) return "left";
    if (ev.clientX >= window.innerWidth - SNAP_PX) return "right";
    return null;
  }

  function onHeaderDown(e: PointerEvent) {
    if ((e.target as HTMLElement).closest("button")) return; // header buttons, not drag
    focus(win.key);
    if (win.dock) return; // docked panels don't drag; use the float button
    trackPointer(
      e,
      (dx, dy, ev) => {
        const el = ref.current;
        if (el) {
          el.style.left = `${Math.max(0, win.x + dx)}px`;
          el.style.top = `${Math.max(0, win.y + dy)}px`;
        }
        setSnapPreview(snapZone(ev));
      },
      (dx, dy, ev) => {
        setSnapPreview(null);
        const zone = snapZone(ev);
        if (zone) setDock(win.key, zone);
        else move(win.key, win.x + dx, win.y + dy);
      },
    );
  }

  function onResizeDown(e: PointerEvent) {
    focus(win.key);
    trackPointer(
      e,
      (dx, dy) => {
        const el = ref.current;
        if (el) {
          el.style.width = `${win.w + dx}px`;
          el.style.height = `${win.h + dy}px`;
        }
      },
      (dx, dy) => resize(win.key, win.w + dx, win.h + dy),
    );
  }

  /** Docked panels resize from their inner edge (left edge of a right dock, and vice versa). */
  function onDockResizeDown(e: PointerEvent) {
    const sign = win.dock === "right" ? -1 : 1;
    trackPointer(
      e,
      (dx) => {
        const el = ref.current;
        if (el) el.style.width = `${win.w + sign * dx}px`;
      },
      (dx) => resize(win.key, win.w + sign * dx, win.h),
    );
  }

  const headerButtons = (
    <span className="window-buttons">
      {win.dock ? (
        <button onClick={() => setDock(win.key, null)} aria-label={`Float ${title}`} title="Float">
          ◻
        </button>
      ) : (
        <>
          <button onClick={() => setDock(win.key, "left")} aria-label={`Dock ${title} left`} title="Dock left">
            ⇤
          </button>
          <button onClick={() => setDock(win.key, "right")} aria-label={`Dock ${title} right`} title="Dock right">
            ⇥
          </button>
        </>
      )}
      <button onClick={() => minimize(win.key)} aria-label={`Minimize ${title}`} title="Minimize">
        –
      </button>
      <button onClick={() => close(win.key)} aria-label={`Close ${title}`} title="Close">
        ✕
      </button>
    </span>
  );

  if (win.dock) {
    return (
      <aside
        ref={ref}
        className={`dock-panel dock-panel--${win.dock}`}
        style={{ width: win.w, zIndex: 40 + win.z }}
        data-testid={`window-${win.key}`}
        onPointerDown={() => focus(win.key)}
      >
        <div className="window-header" onPointerDown={onHeaderDown}>
          <span className="window-title">{title}</span>
          {headerButtons}
        </div>
        <div className="window-body">{children}</div>
        <div
          className={`dock-resize dock-resize--${win.dock}`}
          onPointerDown={onDockResizeDown}
          aria-hidden="true"
        />
      </aside>
    );
  }

  return (
    <>
      {snapPreview && <div className={`snap-preview snap-preview--${snapPreview}`} aria-hidden="true" />}
      <div
        ref={ref}
        className="floating-window"
        style={{ left: win.x, top: win.y, width: win.w, height: win.h, zIndex: 40 + win.z }}
        data-testid={`window-${win.key}`}
        onPointerDown={() => focus(win.key)}
      >
        <div className="window-header" onPointerDown={onHeaderDown}>
          <span className="window-title">{title}</span>
          {headerButtons}
        </div>
        <div className="window-body">{children}</div>
        <div className="window-resize" onPointerDown={onResizeDown} aria-hidden="true" />
      </div>
    </>
  );
}
