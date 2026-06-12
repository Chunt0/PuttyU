import { Navigate, Outlet } from "react-router-dom";
import { useAuthStatus } from "./api.ts";

/** Route guard: gates the app shell behind a valid session, redirecting to /login. */
export function RequireAuth() {
  const { data, isLoading, isError } = useAuthStatus();

  if (isLoading) {
    return <div className="auth-pending">Loading…</div>;
  }
  if (isError || !data?.authenticated) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
