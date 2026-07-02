import { useState } from "react";
import { Navigate } from "react-router";

import { api } from "../../api/client";
import { AuthScreen } from "./AuthScreen";
import { useAuth } from "./auth-context";

// First-run: create the owner (the one student — SPEC §2). After creation the
// auth state flips to unauthenticated and the guard below routes to /login.
export function SetupPage() {
  const { state, refresh } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (state.kind === "authenticated") return <Navigate to="/" replace />;
  if (state.kind === "unauthenticated") return <Navigate to="/login" replace />;
  if (state.kind === "loading") return null;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      const { response } = await api.POST("/api/auth/setup", {
        body: { username, password },
      });
      if (response.ok) {
        await refresh(); // -> unauthenticated -> guard navigates to /login
      } else {
        setError("Setup failed — is the owner already created?");
      }
    } catch {
      setError("Cannot reach the backend.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen title="Create your account" error={error} onSubmit={submit}>
      <label>
        Username
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
        />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
      </label>
      <button type="submit" disabled={busy}>
        Set up puttyU
      </button>
      <p className="auth-hint">
        One student, one account — this box is yours.
      </p>
    </AuthScreen>
  );
}
