import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Notes } from "./Notes.tsx";
import { renderWithProviders, jsonResponse, stubFetch, findCall } from "../../test/util.tsx";

afterEach(() => vi.unstubAllGlobals());

const ACTIVE = [{ id: "n1", title: "Lesson plan", content: "cover fractions", note_type: "note", pinned: false, archived: false, repeat: "none", sort_order: 0 }];
const ARCHIVED = [{ id: "n2", title: "Old note", content: "last term", note_type: "note", pinned: false, archived: true, repeat: "none", sort_order: 0 }];

function mockNotes() {
  // Specific paths first; "/api/notes" serves both list (GET, by ?archived) and create (POST).
  return stubFetch([
    ["/api/notes/n1/pin", () => jsonResponse({ ok: true, pinned: true })],
    ["/api/notes/n1/archive", () => jsonResponse({ ok: true, archived: true })],
    ["/api/notes/n1", () => jsonResponse({ ...ACTIVE[0], title: "updated" })],
    ["/api/notes", (u) => jsonResponse({ notes: u.includes("archived=true") ? ARCHIVED : ACTIVE })],
  ]);
}

describe("Notes", () => {
  it("lists active notes", async () => {
    mockNotes();
    renderWithProviders(<Notes />);
    expect(await screen.findByText("Lesson plan")).toBeInTheDocument();
    expect(screen.getByText("cover fractions")).toBeInTheDocument();
  });

  it("creates a note", async () => {
    const fetchMock = mockNotes();
    renderWithProviders(<Notes />);
    await screen.findByText("Lesson plan");

    await userEvent.type(screen.getByLabelText("Note title"), "Homework");
    await userEvent.type(screen.getByLabelText("Note content"), "page 42");
    await userEvent.click(screen.getByRole("button", { name: "Add note" }));

    await waitFor(() => expect(findCall(fetchMock, "/api/notes", "POST")).toBeTruthy());
  });

  it("pins a note", async () => {
    const fetchMock = mockNotes();
    renderWithProviders(<Notes />);
    await screen.findByText("Lesson plan");
    await userEvent.click(screen.getByRole("button", { name: "Pin Lesson plan" }));
    await waitFor(() => expect(findCall(fetchMock, "/api/notes/n1/pin", "POST")).toBeTruthy());
  });

  it("archives a note", async () => {
    const fetchMock = mockNotes();
    renderWithProviders(<Notes />);
    await screen.findByText("Lesson plan");
    await userEvent.click(screen.getByRole("button", { name: "Archive Lesson plan" }));
    await waitFor(() => expect(findCall(fetchMock, "/api/notes/n1/archive", "POST")).toBeTruthy());
  });

  it("deletes a note", async () => {
    const fetchMock = mockNotes();
    renderWithProviders(<Notes />);
    await screen.findByText("Lesson plan");
    // Two-step destructive confirm: arm, then confirm.
    await userEvent.click(screen.getByRole("button", { name: "Delete Lesson plan" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Lesson plan" }));
    await waitFor(() => expect(findCall(fetchMock, "/api/notes/n1", "DELETE")).toBeTruthy());
  });

  it("switches to the archived view", async () => {
    mockNotes();
    renderWithProviders(<Notes />);
    await screen.findByText("Lesson plan");
    await userEvent.click(screen.getByRole("button", { name: "Archived" }));
    expect(await screen.findByText("Old note")).toBeInTheDocument();
    expect(screen.queryByText("Lesson plan")).not.toBeInTheDocument();
  });
});
