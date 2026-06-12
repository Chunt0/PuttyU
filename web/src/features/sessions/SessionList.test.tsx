import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionList } from "./SessionList.tsx";
import { useUiStore } from "../../lib/store.ts";
import { renderWithProviders, jsonResponse, stubFetch, findCall, callInfo } from "../../test/util.tsx";

afterEach(() => {
  vi.unstubAllGlobals();
  useUiStore.setState({ currentSessionId: null });
});

const sessions = [
  { id: "s1", name: "Algebra help" },
  { id: "s2", name: "Essay review" },
];

describe("SessionList", () => {
  it("renames a session inline", async () => {
    const fetchMock = stubFetch([
      ["/api/sessions", () => jsonResponse(sessions)],
      ["/api/session/s1", () => jsonResponse({ id: "s1", name: "Linear equations" })],
    ]);
    renderWithProviders(<SessionList />);
    await screen.findByText("Algebra help");

    await userEvent.click(screen.getByRole("button", { name: "Rename Algebra help" }));
    const input = screen.getByLabelText("Chat name");
    await userEvent.clear(input);
    await userEvent.type(input, "Linear equations{Enter}");

    await waitFor(() => {
      const call = findCall(fetchMock, "/api/session/s1", "PATCH");
      expect(call).toBeTruthy();
      expect((callInfo(call!).body as FormData).get("name")).toBe("Linear equations");
    });
  });

  it("deletes a session after a confirm click and clears selection", async () => {
    useUiStore.setState({ currentSessionId: "s1" });
    const fetchMock = stubFetch([
      ["/api/sessions", () => jsonResponse(sessions)],
      ["/api/session/s1", () => jsonResponse({ status: "deleted" })],
    ]);
    renderWithProviders(<SessionList />);
    await screen.findByText("Algebra help");

    const del = screen.getByTitle("Delete Algebra help");
    await userEvent.click(del); // arm
    expect(findCall(fetchMock, "/api/session/s1", "DELETE")).toBeFalsy();
    await userEvent.click(del); // confirm

    await waitFor(() => expect(findCall(fetchMock, "/api/session/s1", "DELETE")).toBeTruthy());
  });
});
