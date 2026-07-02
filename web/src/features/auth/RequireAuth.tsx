import type { ReactNode } from "react";
import { Navigate } from "react-router";

import { useAuth } from "./auth-context";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  if (state.kind === "loading") return null;
  if (state.kind === "needs_setup") return <Navigate to="/setup" replace />;
  if (state.kind === "unauthenticated") return <Navigate to="/login" replace />;
  return children;
}
