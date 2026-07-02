import { useNavigate } from "react-router";

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

  return (
    <div className="pa-shell">
      <aside className="pa-sidebar">
        <div className="pa-brand">
          <img src="/putty-blob.svg" alt="" />
          <span>puttyU</span>
        </div>
        <nav className="pa-nav">
          <div className="pa-navitem">Home</div>
          <div className="pa-navitem">Chat</div>
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
        <section className="pa-content">
          <h1>puttyU</h1>
          <p>Foundation skeleton — the workspace shell grows here (M0.3).</p>
        </section>
      </main>
    </div>
  );
}
