import { describe, it, expect, afterEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { Shell } from "./Shell.tsx";
import { renderWithProviders, jsonResponse, stubFetch } from "../test/util.tsx";

afterEach(() => vi.unstubAllGlobals());

describe("Shell", () => {
  it("renders the brand, the signed-in user, and the feature nav", async () => {
    stubFetch([
      ["/api/auth/status", () => jsonResponse({ authenticated: true, username: "ada", is_admin: false })],
      ["/api/sessions", () => jsonResponse([{ id: "s1", name: "First chat", model: "m" }])],
      ["/api/courses", () => jsonResponse({ courses: [] })],
    ]);
    renderWithProviders(<Shell />);

    expect(screen.getByText("puttyU")).toBeInTheDocument();
    // Tools are window-opening buttons now (routes remain only for deep links).
    expect(screen.getByRole("button", { name: "Providers" })).toBeInTheDocument();
    expect(await screen.findByText("ada")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "First chat" })).toBeInTheDocument();
    // The course strip always offers Home (Phase-2 T1).
    expect(await screen.findByRole("tab", { name: "Home" })).toBeInTheDocument();
  });
});
