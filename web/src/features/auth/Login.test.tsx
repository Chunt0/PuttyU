import { describe, it, expect, afterEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Login } from "./Login.tsx";
import { renderWithProviders, jsonResponse, stubFetch } from "../../test/util.tsx";

afterEach(() => vi.unstubAllGlobals());

describe("Login", () => {
  it("submits credentials to the login endpoint", async () => {
    const fetchMock = stubFetch([
      ["/api/auth/login", () => jsonResponse({ ok: true, username: "ada" })],
    ]);
    renderWithProviders(<Login />, ["/login"]);

    await userEvent.type(screen.getByLabelText("Username"), "ada");
    await userEvent.type(screen.getByLabelText("Password"), "secret");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    // openapi-fetch dispatches a Request object — assert on it, not (url, init).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = fetchMock.mock.calls[0][0] as Request;
    expect(req.url).toContain("/api/auth/login");
    expect(req.method).toBe("POST");
  });

  it("reveals the 2FA field when the server requires it", async () => {
    stubFetch([
      ["/api/auth/login", () => jsonResponse({ ok: false, requires_totp: true, username: "ada" })],
    ]);
    renderWithProviders(<Login />, ["/login"]);

    await userEvent.type(screen.getByLabelText("Username"), "ada");
    await userEvent.type(screen.getByLabelText("Password"), "secret");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByLabelText("2FA code")).toBeInTheDocument();
  });
});
