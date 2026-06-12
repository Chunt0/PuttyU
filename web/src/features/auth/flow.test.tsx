import { describe, it, expect, afterEach, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useLogin, useLogout, authStatusKey } from "./api.ts";
import type { AuthStatus } from "../../api/types.ts";
import { jsonResponse, stubFetch } from "../../test/util.tsx";

afterEach(() => vi.unstubAllGlobals());

/**
 * Guards the fix for the auth-boundary desync the Slice-1 e2e caught: a successful login
 * must set the auth-status cache to `authenticated:true` SYNCHRONOUSLY (not just
 * invalidate), so the route guard doesn't read stale `false` and bounce back to /login.
 * Tested at the hook level — robust, and complements the full-flow Playwright e2e.
 */
describe("auth cache transitions", () => {
  function harness() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData<AuthStatus>(authStatusKey, {
      authenticated: false,
      username: null,
      is_admin: false,
      signup_enabled: false,
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    return { qc, wrapper };
  }

  it("marks the cache authenticated on successful login", async () => {
    stubFetch([["/api/auth/login", () => jsonResponse({ ok: true, username: "ada" })]]);
    const { qc, wrapper } = harness();
    const { result } = renderHook(() => useLogin(), { wrapper });

    await result.current.mutateAsync({ username: "ada", password: "pw" });

    await waitFor(() =>
      expect(qc.getQueryData<AuthStatus>(authStatusKey)).toMatchObject({
        authenticated: true,
        username: "ada",
      }),
    );
  });

  it("does NOT authenticate when the server asks for 2FA", async () => {
    stubFetch([["/api/auth/login", () => jsonResponse({ ok: false, requires_totp: true, username: "ada" })]]);
    const { qc, wrapper } = harness();
    const { result } = renderHook(() => useLogin(), { wrapper });

    await result.current.mutateAsync({ username: "ada", password: "pw" });

    expect(qc.getQueryData<AuthStatus>(authStatusKey)?.authenticated).toBe(false);
  });

  it("drops the cache to unauthenticated on logout", async () => {
    stubFetch([["/api/auth/logout", () => jsonResponse({ ok: true })]]);
    const { qc, wrapper } = harness();
    qc.setQueryData<AuthStatus>(authStatusKey, {
      authenticated: true,
      username: "ada",
      is_admin: false,
      signup_enabled: false,
    });
    const { result } = renderHook(() => useLogout(), { wrapper });

    await result.current.mutateAsync();

    await waitFor(() =>
      expect(qc.getQueryData<AuthStatus>(authStatusKey)?.authenticated).toBe(false),
    );
  });
});
