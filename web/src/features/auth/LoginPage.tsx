import { useState } from "react";
import { Navigate } from "react-router";

import { api } from "../../api/client";
import { AuthScreen } from "./AuthScreen";
import { useAuth } from "./auth-context";

export function LoginPage() {
  const { state, refresh } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (state.kind === "authenticated") return <Navigate to="/" replace />;
  if (state.kind === "needs_setup") return <Navigate to="/setup" replace />;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { response } = await api.POST("/api/auth/login", {
        body: { username, password },
      });
      if (response.ok) {
        await refresh(); // -> authenticated -> guard navigates to /
      } else if (response.status === 429) {
        setError("Too many attempts — wait a minute and try again.");
      } else {
        setError("Invalid username or password.");
      }
    } catch {
      setError("Cannot reach the backend.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen title="Welcome back" error={error} onSubmit={submit}>
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
          autoComplete="current-password"
          required
        />
      </label>
      <button type="submit" disabled={busy}>
        Log in
      </button>
    </AuthScreen>
  );
}
