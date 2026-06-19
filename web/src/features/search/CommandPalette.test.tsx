import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Spy on the session navigate door (the palette navigates Home so Chat renders).
const navigateSpy = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateSpy };
});

import { CommandPalette } from "./CommandPalette.tsx";
import { useCourseStore } from "../courses/store.ts";
import { useUiStore } from "../../lib/store.ts";
import { useWindowStore } from "../../app/windows/windowStore.ts";
import { usePdfStore } from "../library/pdfStore.ts";
import { useProgressStore, progressForConcept } from "../progress/progressStore.ts";
import { renderWithProviders, jsonResponse, stubFetch } from "../../test/util.tsx";

const RESULTS = {
  query: "sa",
  results: [
    { kind: "course", id: "c1", title: "AP Statistics" },
    { kind: "concept", id: "n1", title: "Sampling error", subtitle: "Stats > Sampling", course_id: "c1" },
    { kind: "material", id: "src1", source_id: "src1", title: "Stats Primer", subtitle: "intro", page: 12 },
    { kind: "note", id: "no1", title: "Sampling notes", course_id: "c1" },
    { kind: "todo", id: "t1", title: "Sampling problem set", course_id: "c1" },
    { kind: "session", id: "s1", title: "Sampling chat" },
  ],
};

function mockSearch(results: unknown = RESULTS) {
  return stubFetch([["/api/cmdk", () => jsonResponse(results)]]);
}

const onClose = vi.fn();

beforeEach(() => {
  useCourseStore.setState({ activeCourseId: null, onboardingSkipped: false });
  useUiStore.setState({ currentSessionId: null });
  useWindowStore.setState({ windows: {}, nextZ: 1 });
  usePdfStore.setState({ target: null });
  useProgressStore.setState({ target: null });
  navigateSpy.mockClear();
  onClose.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("progressStore", () => {
  it("progressForConcept activates the course, sets the target, and opens Progress", () => {
    progressForConcept("c1", "n1");
    expect(useCourseStore.getState().activeCourseId).toBe("c1");
    expect(useProgressStore.getState().target).toEqual({ conceptId: "n1" });
    expect(useWindowStore.getState().windows.progress).toBeTruthy();
  });
});

describe("CommandPalette", () => {
  it("renders as an accessible modal dialog with an autofocused input", async () => {
    mockSearch();
    renderWithProviders(<CommandPalette onClose={onClose} />);

    const dialog = screen.getByRole("dialog", { name: "Search" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByLabelText("Search query")).toHaveFocus();
    // Below two chars: a hint, no search.
    expect(screen.getByText(/at least two characters/)).toBeInTheDocument();
  });

  it("groups the flat results by kind into labeled sections", async () => {
    mockSearch();
    renderWithProviders(<CommandPalette onClose={onClose} />);

    await userEvent.type(screen.getByLabelText("Search query"), "sa");

    expect(await screen.findByText("Courses")).toBeInTheDocument();
    expect(screen.getByText("Concepts")).toBeInTheDocument();
    expect(screen.getByText("Materials")).toBeInTheDocument();
    expect(screen.getByText("Notes")).toBeInTheDocument();
    expect(screen.getByText("Todos")).toBeInTheDocument();
    expect(screen.getByText("Sessions")).toBeInTheDocument();
    expect(screen.getByText("Sampling error")).toBeInTheDocument();
  });

  it("shows 'No results' for a query that matches nothing", async () => {
    mockSearch({ query: "zzz", results: [] });
    renderWithProviders(<CommandPalette onClose={onClose} />);

    await userEvent.type(screen.getByLabelText("Search query"), "zz");
    expect(await screen.findByText("No results.")).toBeInTheDocument();
  });

  it("keyboard nav: ArrowDown moves the cursor; Enter fires the active door + closes", async () => {
    mockSearch();
    renderWithProviders(<CommandPalette onClose={onClose} />);

    const input = screen.getByLabelText("Search query");
    await userEvent.type(input, "sa");
    await screen.findByText("AP Statistics"); // first flat item (course)

    // From index 0 (course) → ArrowDown to index 1 (concept) → Enter opens the trajectory.
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(useProgressStore.getState().target).toEqual({ conceptId: "n1" });
    expect(useWindowStore.getState().windows.progress).toBeTruthy();
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking a material result opens the PDF viewer at the page + closes", async () => {
    mockSearch();
    renderWithProviders(<CommandPalette onClose={onClose} />);

    await userEvent.type(screen.getByLabelText("Search query"), "sa");
    await userEvent.click(await screen.findByText("Stats Primer"));

    expect(usePdfStore.getState().target).toEqual({ sourceId: "src1", title: "Stats Primer", page: 12 });
    expect(useWindowStore.getState().windows.pdf).toBeTruthy();
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking a course result activates that course + closes", async () => {
    mockSearch();
    renderWithProviders(<CommandPalette onClose={onClose} />);

    await userEvent.type(screen.getByLabelText("Search query"), "sa");
    await userEvent.click(await screen.findByText("AP Statistics"));

    expect(useCourseStore.getState().activeCourseId).toBe("c1");
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking a session result selects it, navigates Home, and closes", async () => {
    mockSearch();
    renderWithProviders(<CommandPalette onClose={onClose} />);

    await userEvent.type(screen.getByLabelText("Search query"), "sa");
    await userEvent.click(await screen.findByText("Sampling chat"));

    await waitFor(() => expect(useUiStore.getState().currentSessionId).toBe("s1"));
    expect(navigateSpy).toHaveBeenCalledWith("/");
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape closes the palette", async () => {
    mockSearch();
    renderWithProviders(<CommandPalette onClose={onClose} />);

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
