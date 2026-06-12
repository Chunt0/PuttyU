/** Auth server-state hooks (TanStack Query) over the typed client. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client.ts";
import type { AuthStatus, LoginResponse } from "../../api/types.ts";

export const authStatusKey = ["auth", "status"] as const;

export function useAuthStatus() {
  return useQuery({
    queryKey: authStatusKey,
    queryFn: async (): Promise<AuthStatus> => {
      const { data, error } = await api.GET("/api/auth/status");
      if (error || !data) throw new Error("failed to load auth status");
      return data;
    },
    staleTime: 10_000,
  });
}

export interface LoginInput {
  username: string;
  password: string;
  totp_code?: string;
  remember?: boolean;
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: LoginInput): Promise<LoginResponse> => {
      const { data, error } = await api.POST("/api/auth/login", {
        body: { ...input, remember: input.remember ?? false },
      });
      if (error || !data) throw new Error("login failed");
      return data;
    },
    onSuccess: (data) => {
      // Set status DIRECTLY (not just invalidate): a successful login means authenticated,
      // and the route guard reads this synchronously on navigate. Invalidate-only leaves
      // the stale `authenticated:false` in cache, so RequireAuth bounces back to /login
      // before the refetch lands (2FA pending != logged in, so it stays put).
      if (data.ok) {
        qc.setQueryData<AuthStatus>(authStatusKey, (old) => ({
          ...(old ?? { is_admin: false, signup_enabled: false }),
          authenticated: true,
          username: data.username ?? null,
        }));
      }
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.POST("/api/auth/logout");
    },
    onSuccess: () => {
      // Same reasoning in reverse: drop to unauthenticated immediately so the guard
      // redirects to /login without a flash of authenticated UI.
      qc.setQueryData<AuthStatus>(authStatusKey, (old) => ({
        ...(old ?? { is_admin: false, signup_enabled: false }),
        authenticated: false,
        username: null,
      }));
    },
  });
}
