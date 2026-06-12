/** Window-manager component tests: windows render their tool, minimize to the dock bar,
 * dock as side panels, and close. Drag/resize math is covered by the store tests. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WindowLayer } from "./WindowLayer.tsx";
import { useWindowStore } from "./windowStore.ts";
import { renderWithProviders, jsonResponse, stubFetch } from "../../test/util.tsx";

beforeEach(() => {
  localStorage.clear();
  useWindowStore.setState({ windows: {}, nextZ: 1 });
  stubFetch([["/api/notes", () => jsonResponse({ notes: [] })]]);
});

afterEach(() => vi.unstubAllGlobals());

describe("WindowLayer", () => {
  it("renders an opened tool window with its screen inside", async () => {
    renderWithProviders(<WindowLayer />);
    act(() => useWindowStore.getState().open("notes"));
    const win = screen.getByTestId("window-notes");
    expect(win).toHaveClass("floating-window");
    // The Notes screen rendered inside the window body.
    expect(await screen.findByRole("heading", { name: "Notes" })).toBeInTheDocument();
  });

  it("minimizes to a dock chip and restores from it", async () => {
    renderWithProviders(<WindowLayer />);
    act(() => useWindowStore.getState().open("notes"));

    await userEvent.click(screen.getByRole("button", { name: "Minimize Notes" }));
    expect(screen.queryByTestId("window-notes")).not.toBeInTheDocument();

    const chip = screen.getByTestId("dock-bar").querySelector("button");
    expect(chip).toHaveTextContent("Notes");
    await userEvent.click(chip!);
    expect(screen.getByTestId("window-notes")).toBeInTheDocument();
  });

  it("docks to the right as a side panel and floats back out", async () => {
    renderWithProviders(<WindowLayer />);
    act(() => useWindowStore.getState().open("notes"));

    await userEvent.click(screen.getByRole("button", { name: "Dock Notes right" }));
    expect(screen.getByTestId("window-notes")).toHaveClass("dock-panel", "dock-panel--right");
    // The docked width is published for the shell margins.
    expect(document.documentElement.style.getPropertyValue("--docked-right")).not.toBe("0px");

    await userEvent.click(screen.getByRole("button", { name: "Float Notes" }));
    expect(screen.getByTestId("window-notes")).toHaveClass("floating-window");
  });

  it("closes a window", async () => {
    renderWithProviders(<WindowLayer />);
    act(() => useWindowStore.getState().open("notes"));
    await userEvent.click(screen.getByRole("button", { name: "Close Notes" }));
    expect(screen.queryByTestId("window-notes")).not.toBeInTheDocument();
  });
});
