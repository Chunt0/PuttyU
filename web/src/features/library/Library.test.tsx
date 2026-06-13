import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Library } from "./Library.tsx";
import { usePdfStore } from "./pdfStore.ts";
import { useCourseStore } from "../courses/store.ts";
import { useWindowStore } from "../../app/windows/windowStore.ts";
import { renderWithProviders, jsonResponse, stubFetch } from "../../test/util.tsx";

const SOURCES = [
  {
    id: "s1", kind: "library", title: "Intro Stats", source_type: "textbook",
    subject: "statistics", authors: "OpenStax", status: "ready", course_id: null,
    tags: [], has_pdf: true, chunk_count: 120,
  },
  {
    id: "s2", kind: "library", title: "Physics Vol 1", source_type: "textbook",
    subject: "physics", authors: null, status: "ready", course_id: null,
    tags: [], has_pdf: true, chunk_count: 80,
  },
  {
    id: "m1", kind: "material", title: "week-3 sheet", source_type: "material",
    subject: null, authors: null, status: "ready", course_id: "c1",
    tags: ["homework"], has_pdf: true, chunk_count: 3,
  },
];

const TOC = [
  {
    heading: "Ch 2 Data", ordinal: 0, page_start: 70,
    children: [{ heading: "2.3 Two kinds of data", ordinal: 1, page_start: 87, children: [] }],
  },
];

function mockLibrary() {
  return stubFetch([
    ["/api/corpus/sources/s1/toc", () => jsonResponse({ source_id: "s1", toc: TOC })],
    ["/api/corpus/sources", () => jsonResponse({ sources: SOURCES })],
    ["/api/courses/c1/sources", () => jsonResponse({ course_id: "c1", source_ids: ["s1"] })],
    ["/api/courses", () =>
      jsonResponse({ courses: [{ id: "c1", name: "AP Statistics", status: "active", settings: {} }] })],
  ]);
}

beforeEach(() => {
  useCourseStore.setState({ activeCourseId: null });
  usePdfStore.setState({ target: null });
  useWindowStore.setState({ windows: {}, nextZ: 1 });
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Library", () => {
  it("lists all library sources with kind badges when no course is active", async () => {
    mockLibrary();
    renderWithProviders(<Library />);
    expect(await screen.findByText("Intro Stats")).toBeInTheDocument();
    expect(screen.getByText("Physics Vol 1")).toBeInTheDocument();
    expect(screen.getAllByText("library")).toHaveLength(2);
    // materials render in their own section, not the library list
    expect(screen.getByText("week-3 sheet")).toBeInTheDocument();
    expect(screen.getByText("material")).toBeInTheDocument();
  });

  it("scopes the library to the active course's linked sources", async () => {
    useCourseStore.setState({ activeCourseId: "c1" });
    mockLibrary();
    renderWithProviders(<Library />);
    expect(await screen.findByText("Intro Stats")).toBeInTheDocument();
    expect(screen.getByText(/Sources linked to AP Statistics/)).toBeInTheDocument();
    expect(screen.queryByText("Physics Vol 1")).not.toBeInTheDocument();
  });

  it("expands the TOC and opens the PDF viewer at the node's page", async () => {
    mockLibrary();
    renderWithProviders(<Library />);
    await screen.findByText("Intro Stats");

    await userEvent.click(screen.getByRole("button", { name: "Contents of Intro Stats" }));
    expect(await screen.findByText("2.3 Two kinds of data")).toBeInTheDocument();
    expect(screen.getByText("Ch 2 Data")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /2\.3 Two kinds of data/ }));
    expect(usePdfStore.getState().target).toEqual({ sourceId: "s1", title: "Intro Stats", page: 87 });
    expect(useWindowStore.getState().windows["pdf"]).toBeTruthy();
  });

  it("opens the PDF from the source row (no page anchor)", async () => {
    mockLibrary();
    renderWithProviders(<Library />);
    await screen.findByText("Intro Stats");

    await userEvent.click(screen.getByRole("button", { name: "Open PDF of Intro Stats" }));
    expect(usePdfStore.getState().target).toEqual({ sourceId: "s1", title: "Intro Stats", page: null });
    expect(useWindowStore.getState().windows["pdf"]).toBeTruthy();
  });
});
