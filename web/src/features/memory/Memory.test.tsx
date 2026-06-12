import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Memory } from "./Memory.tsx";
import { renderWithProviders, jsonResponse, stubFetch, findCall } from "../../test/util.tsx";

afterEach(() => vi.unstubAllGlobals());

const MEMORIES = [
  { id: "m1", text: "User prefers dark mode", category: "preference", source: "user", timestamp: 1, uses: 0, owner: null },
  { id: "m2", text: "User is a teacher", category: "identity", source: "user", timestamp: 2, uses: 0, owner: null },
];

function mockMemory(overrides: Partial<Record<string, () => Response>> = {}) {
  return stubFetch([
    ["/api/memory/add", overrides["add"] ?? (() => jsonResponse({ ok: true, count: 3 }))],
    ["/api/memory/search", overrides["search"] ?? (() => jsonResponse({ memories: [MEMORIES[1]], total: 1, query: "teacher" }))],
    // The wildcard list/delete share the /api/memory prefix; order matters — specific first.
    ["/api/memory", overrides["list"] ?? (() => jsonResponse({ memory: MEMORIES }))],
  ]);
}

describe("Memory", () => {
  it("lists existing memories", async () => {
    mockMemory();
    renderWithProviders(<Memory />);
    expect(await screen.findByText("User prefers dark mode")).toBeInTheDocument();
    expect(screen.getByText("User is a teacher")).toBeInTheDocument();
    expect(screen.getByText("All memories (2)")).toBeInTheDocument();
  });

  it("adds a memory via the form", async () => {
    const fetchMock = mockMemory();
    renderWithProviders(<Memory />);
    await screen.findByText("User is a teacher");

    await userEvent.type(screen.getByLabelText("Memory text"), "User lives in Berlin");
    await userEvent.selectOptions(screen.getByLabelText("Category"), "fact");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(findCall(fetchMock, "/api/memory/add", "POST")).toBeTruthy();
    });
  });

  it("searches and shows only matching memories", async () => {
    mockMemory();
    renderWithProviders(<Memory />);
    await screen.findByText("User prefers dark mode");

    await userEvent.type(screen.getByLabelText("Search memories"), "teacher");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("Results (1)")).toBeInTheDocument();
    expect(screen.getByText("User is a teacher")).toBeInTheDocument();
    expect(screen.queryByText("User prefers dark mode")).not.toBeInTheDocument();
  });

  it("deletes a memory", async () => {
    const fetchMock = mockMemory();
    renderWithProviders(<Memory />);
    await screen.findByText("User prefers dark mode");

    // Two-step destructive confirm: arm, then confirm.
    await userEvent.click(screen.getByRole("button", { name: "Delete memory m1" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete memory m1" }));

    await waitFor(() => {
      expect(findCall(fetchMock, "/api/memory/m1", "DELETE")).toBeTruthy();
    });
  });
});
