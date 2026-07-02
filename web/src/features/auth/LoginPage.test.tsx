import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import { AuthProvider } from "./auth-context";
import { LoginPage } from "./LoginPage";

afterEach(cleanup);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("LoginPage shows a readable error on invalid credentials", async () => {
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/api/auth/me")) {
      return jsonResponse(401, { detail: "unauthenticated" });
    }
    return jsonResponse(401, { detail: "invalid_credentials" });
  }) as unknown as typeof fetch;

  const { getByLabelText, getByRole } = render(
    <MemoryRouter>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </MemoryRouter>,
  );

  await waitFor(() => getByLabelText("Username"));
  fireEvent.change(getByLabelText("Username"), {
    target: { value: "owner" },
  });
  fireEvent.change(getByLabelText("Password"), {
    target: { value: "wrong-password" },
  });
  fireEvent.submit(getByRole("button", { name: "Log in" }));

  await waitFor(() =>
    expect(document.body.textContent).toContain(
      "Invalid username or password.",
    ),
  );
});
