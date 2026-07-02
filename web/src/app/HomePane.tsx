import { Putty } from "../components/ui/icons";
import { Composer } from "../features/composer/Composer";
import { useAuth } from "../features/auth/auth-context";

// The welcome surface (kit Messages.tsx Welcome): mascot + wordmark + tip.
// Streaming chat replaces the welcome at M0.4; the composer already works
// for slash commands.
export function HomePane() {
  const { state } = useAuth();
  const name = state.kind === "authenticated" ? state.user.username : "";

  return (
    <>
      <div className="welcome">
        <Putty size={92} className="boat" />
        <div className="wm">puttyU</div>
        <div className="sub">
          {name ? `Hey ${name} — ` : ""}your patient tutor is under
          construction. Chat lands at M0.4.
        </div>
        <div className="tip">Try /help — or Ctrl/⌘-K to jump anywhere</div>
      </div>
      <Composer />
    </>
  );
}
