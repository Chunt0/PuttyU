import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { useAuthStatus, useLogout } from "../features/auth/api.ts";
import { CourseTabs } from "../features/courses/CourseTabs.tsx";
import { SessionList } from "../features/sessions/SessionList.tsx";
import { Toasts } from "../components/Toasts.tsx";
import { CommandPalette } from "../features/search/CommandPalette.tsx";
import { ThemePicker } from "./ThemePicker.tsx";
import { WindowLayer } from "./windows/WindowLayer.tsx";
import { WINDOW_TOOLS } from "./windows/tools.tsx";
import { useWindowStore } from "./windows/windowStore.ts";

/** The lean app shell: chats + tools in the sidebar, chat in main. Tools open as
 * floating/dockable windows over the chat (full-page routes remain for deep links). */
export function Shell() {
  const { data: auth } = useAuthStatus();
  const logout = useLogout();
  const windows = useWindowStore((s) => s.windows);
  const open = useWindowStore((s) => s.open);

  // F11: ⌘/Ctrl-K toggles the global search palette (a transient modal, NOT a tool window).
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="shell">
      <aside className="shell-sidebar">
        <div className="shell-brand">
          <img src="/putty-blob.svg" alt="" className="brand-logo" width={24} height={24} />
          <span>puttyU</span>
        </div>
        <SessionList />
        <nav className="shell-nav">
          {WINDOW_TOOLS.filter((t) => !t.hidden).map((tool) => {
            const active = windows[tool.key] && !windows[tool.key].minimized;
            return (
              <button
                key={tool.key}
                onClick={() => open(tool.key)}
                className={active ? "nav-link nav-link--active" : "nav-link"}
              >
                {tool.title}
              </button>
            );
          })}
        </nav>
        <ThemePicker />
        <div className="shell-user">
          <span className="shell-username">{auth?.username ?? "—"}</span>
          <button onClick={() => logout.mutate()} disabled={logout.isPending}>
            Log out
          </button>
        </div>
      </aside>
      <main className="shell-main">
        <CourseTabs />
        <Outlet />
      </main>
      <WindowLayer />
      <Toasts />
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
