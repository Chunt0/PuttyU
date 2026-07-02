import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { api } from "../../api/client";

// SPA auth flow (DESIGN-M0-M1 §4): GET /api/auth/me on load.
// 409 -> first-run setup · 401 -> login · 200 -> in.
export type AuthState =
  | { kind: "loading" }
  | { kind: "needs_setup" }
  | { kind: "unauthenticated" }
  | { kind: "authenticated"; user: { id: string; username: string } };

interface AuthContextValue {
  state: AuthState;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ kind: "loading" });

  const refresh = useCallback(async () => {
    try {
      const { data, response } = await api.GET("/api/auth/me");
      if (data) {
        setState({ kind: "authenticated", user: data });
      } else if (response.status === 409) {
        setState({ kind: "needs_setup" });
      } else {
        setState({ kind: "unauthenticated" });
      }
    } catch {
      // Backend unreachable — treat as logged out; the login form will
      // surface the connection error on submit.
      setState({ kind: "unauthenticated" });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ state, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}
