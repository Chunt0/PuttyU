import { HealthBadge } from "../components/HealthBadge";

export function App() {
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
        </header>
        <section className="pa-content">
          <h1>puttyU</h1>
          <p>Foundation skeleton — the workspace shell grows here (M0.3).</p>
        </section>
      </main>
    </div>
  );
}
