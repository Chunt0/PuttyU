import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useLogin } from "./api.ts";

/** Login screen. Cookie-based auth (SPEC §1.4): on success the server sets the session
 * cookie and we route to the app; a 2FA-enabled account is prompted for its code. */
export function Login() {
  const navigate = useNavigate();
  const login = useLogin();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await login.mutateAsync({
        username,
        password,
        totp_code: needsTotp ? totp : undefined,
      });
      if (res.ok) {
        navigate("/", { replace: true });
      } else if (res.requires_totp) {
        setNeedsTotp(true);
      } else {
        setError("Login failed.");
      }
    } catch {
      setError("Invalid credentials.");
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={onSubmit}>
        <h1 className="login-brand">
          <img src="/putty-blob.svg" alt="" width={30} height={30} />
          puttyU
        </h1>
        <p className="login-slogan">your patient tutor</p>
        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {needsTotp && (
          <label>
            2FA code
            <input value={totp} onChange={(e) => setTotp(e.target.value)} inputMode="numeric" autoFocus />
          </label>
        )}
        {error && <p className="login-error" role="alert">{error}</p>}
        <button type="submit" disabled={login.isPending}>
          {login.isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
