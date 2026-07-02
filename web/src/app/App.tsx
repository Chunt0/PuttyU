import { NavLink, Outlet, useNavigate } from "react-router";

import { api } from "../api/client";
import { HealthBadge } from "../components/HealthBadge";
import { useAuth } from "../features/auth/auth-context";

export function App() {
  const { state, refresh } = useAuth();
  const navigate = useNavigate();
  const username = state.kind === "authenticated" ? state.user.username : "";

  const logout = async () => {
    await api.POST("/api/auth/logout");
    await refresh(); // -> unauthenticated; guard sends us to /login
    void navigate("/login");
  };

  const navClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? "pa-navitem active" : "pa-navitem";

  return (
    <div className="pa-shell">
      <aside className="pa-sidebar">
        <div className="pa-brand">
          <img src="/putty-blob.svg" alt="" />
          <span>puttyU</span>
        </div>
        <nav className="pa-nav">
          <NavLink to="/" end className={navClass}>
            Home
          </NavLink>
          <NavLink to="/settings/providers" className={navClass}>
            Providers
          </NavLink>
        </nav>
      </aside>
      <main className="pa-main">
        <header className="pa-topbar">
          <HealthBadge />
          <span className="pa-topbar-spacer" />
          <span className="pa-user">{username}</span>
          <button className="pa-logout" onClick={() => void logout()}>
            Log out
          </button>
        </header>
        <Outlet />
      </main>
    </div>
  );
}
