// The sidebar (docs/M0.3-FIDELITY.md §A): brand + burger, collapsible
// sections (persisted), resize handle (200–700, collapse below 150, width as
// CSS var), icon rail when collapsed. Chats section fills at M0.4.
import { useNavigate } from "react-router";

import { EmptyState } from "../components/ui/data";
import { Icons, Putty } from "../components/ui/icons";
import { useAuth } from "../features/auth/auth-context";
import {
  SIDEBAR_COLLAPSE_BELOW,
  useUiStore,
} from "./uiStore";
import { useWindowStore } from "./windows/windowStore";

function Section({
  id,
  title,
  icon,
  children,
}: {
  id: string;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const collapsed = useUiStore((s) => s.collapsedSections[id] ?? false);
  const toggleSection = useUiStore((s) => s.toggleSection);
  return (
    <div className={"sb-sec" + (collapsed ? " collapsed" : "")}>
      <button
        className="sb-sec-title"
        onClick={() => toggleSection(id)}
        aria-expanded={!collapsed}
      >
        <span className="ic">{icon}</span>
        {title}
        <span className="chev">
          <Icons.Chevron />
        </span>
      </button>
      <div className="sb-sec-body">{children}</div>
    </div>
  );
}

export function Sidebar() {
  const { state } = useAuth();
  const navigate = useNavigate();
  const sidebarWidth = useUiStore((s) => s.sidebarWidth);
  const railOnly = useUiStore((s) => s.railOnly);
  const openWindow = useWindowStore((s) => s.openWindow);
  const username = state.kind === "authenticated" ? state.user.username : "?";

  const burger = () => {
    const ui = useUiStore.getState();
    if (window.innerWidth <= 720) ui.setNavOpen(!ui.navOpen);
    else ui.toggleRail();
  };

  // Drag-resize (Odysseus init.js): 200–700px, collapse to rail below ~150.
  const onResizeStart = (event: React.PointerEvent) => {
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.classList.add("dragging");
    const onMove = (e: PointerEvent) => {
      const ui = useUiStore.getState();
      if (e.clientX < SIDEBAR_COLLAPSE_BELOW) {
        if (!ui.railOnly) ui.setRailOnly(true);
        return;
      }
      if (ui.railOnly) ui.setRailOnly(false);
      ui.setSidebarWidth(e.clientX);
    };
    const onUp = () => {
      handle.classList.remove("dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const expandAnd = (action: () => void) => () => {
    useUiStore.getState().setRailOnly(false);
    action();
  };

  return (
    <nav
      className="sb"
      style={{ "--sidebar-w": railOnly ? "52px" : `${sidebarWidth}px` } as React.CSSProperties}
      aria-label="Sidebar"
    >
      <div className="sb-head">
        <button className="sb-burger" onClick={burger} aria-label="Toggle sidebar">
          <Icons.Menu />
        </button>
        <div className="sb-brand" onClick={() => void navigate("/")}>
          <Putty size={22} className="boat" />
          <span className="wm">puttyU</span>
        </div>
      </div>

      {/* Icon rail (collapsed mode): section icons expand the sidebar. */}
      <div className="rail">
        <button className="rail-btn" title="Home" onClick={expandAnd(() => void navigate("/"))}>
          <Icons.Chat size={16} />
        </button>
        <button className="rail-btn" title="Providers" onClick={expandAnd(() => void navigate("/settings/providers"))}>
          <Icons.Settings />
        </button>
        <button className="rail-btn" title="Theme" onClick={expandAnd(() => openWindow("theme"))}>
          <Icons.Theme size={16} />
        </button>
        <button className="rail-btn rail-bottom" title="Shortcuts" onClick={expandAnd(() => openWindow("shortcuts"))}>
          <Icons.Tool size={15} />
        </button>
      </div>

      <div className="sb-inner">
        <Section id="chats" title="Chats" icon={<Icons.Chat size={12} />}>
          <EmptyState
            title="No chats yet"
            message="Sessions and streaming chat arrive with M0.4."
          />
        </Section>

        <Section id="tools" title="Tools" icon={<Icons.Tool />}>
          <button className="li" onClick={() => void navigate("/")}>
            <span className="ic">
              <Icons.Chat />
            </span>
            <span className="grow">Home</span>
          </button>
          <button className="li" onClick={() => void navigate("/settings/providers")}>
            <span className="ic">
              <Icons.Settings size={14} />
            </span>
            <span className="grow">Providers</span>
          </button>
          <button className="li" onClick={() => openWindow("theme")}>
            <span className="ic">
              <Icons.Theme />
            </span>
            <span className="grow">Theme</span>
          </button>
          <button className="li" onClick={() => openWindow("shortcuts")}>
            <span className="ic">
              <Icons.Tool size={13} />
            </span>
            <span className="grow">Shortcuts</span>
          </button>
        </Section>
      </div>

      <div className="sb-user">
        <span className="avatar">{username.slice(0, 1).toUpperCase()}</span>
        <span className="nm">{username}</span>
        <button
          className="iconbtn"
          title="Providers & settings"
          onClick={() => void navigate("/settings/providers")}
        >
          <Icons.Settings size={15} />
        </button>
      </div>

      <div className="sb-resize" onPointerDown={onResizeStart} aria-hidden />
    </nav>
  );
}
