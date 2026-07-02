// The workspace shell (docs/M0.3-FIDELITY.md): kit .app layout — sidebar +
// chat area — plus the window layer, command palette, toasts, and global
// keyboard shortcuts. Odysseus interaction model, putty-ai skin.
import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router";

import { api } from "../api/client";
import { HealthBadge } from "../components/HealthBadge";
import { Icons } from "../components/ui/icons";
import { useAuth } from "../features/auth/auth-context";
import { COMPOSER_INPUT_ID } from "../features/composer/Composer";
import { CommandPalette, usePaletteStore } from "./CommandPalette";
import { Sidebar } from "./Sidebar";
import { ToastStack } from "./toasts";
import { useUiStore } from "./uiStore";
import { WindowLayer } from "./windows/WindowLayer";

function useGlobalShortcuts() {
  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        usePaletteStore.getState().toggle();
      } else if (key === "/" && !event.altKey) {
        event.preventDefault();
        document.getElementById(COMPOSER_INPUT_ID)?.focus();
      } else if (key === "b" && event.altKey) {
        event.preventDefault();
        useUiStore.getState().toggleRail();
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, []);
}

export function App() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const railOnly = useUiStore((s) => s.railOnly);
  const navOpen = useUiStore((s) => s.navOpen);
  useGlobalShortcuts();

  const logout = async () => {
    await api.POST("/api/auth/logout");
    await refresh();
    void navigate("/login");
  };

  return (
    <div
      className={
        "app" + (railOnly ? " rail-only" : "") + (navOpen ? " nav-open" : "")
      }
    >
      <div
        className="nav-scrim"
        onClick={() => useUiStore.getState().setNavOpen(false)}
      />
      <Sidebar />
      <main className="chat">
        <header className="topbar">
          <button
            className="topbar-burger"
            aria-label="Open sidebar"
            onClick={() => useUiStore.getState().setNavOpen(true)}
          >
            <Icons.Menu />
          </button>
          <span className="topbar-title">puttyU</span>
          <span style={{ flex: 1 }} />
          <HealthBadge />
          <button className="iconbtn" title="Log out" onClick={() => void logout()}>
            <Icons.Shell size={14} />
            <span style={{ marginLeft: 6 }}>Log out</span>
          </button>
        </header>
        <Outlet />
      </main>
      <WindowLayer />
      <CommandPalette />
      <ToastStack />
    </div>
  );
}
