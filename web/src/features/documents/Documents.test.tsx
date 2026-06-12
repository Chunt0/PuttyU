import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Documents } from "./Documents.tsx";
import { renderWithProviders, jsonResponse, stubFetch, findCall } from "../../test/util.tsx";

afterEach(() => vi.unstubAllGlobals());

const DOC = { id: "d1", title: "Worksheet", language: "markdown", current_content: "# Fractions\nadd numerators", version_count: 2, is_active: true, archived: false, session_id: null, created_at: null, updated_at: null };
const LIB = { documents: [{ id: "d1", title: "Worksheet", language: "markdown", preview: "# Fractions", version_count: 2, session_name: null, created_at: null, updated_at: null }], total: 1, languages: { markdown: 1 }, session_count: 0 };
const VERSIONS = [
  { id: "v2", version_number: 2, content: "x", summary: "Manual edit", source: "user", created_at: "t" },
  { id: "v1", version_number: 1, content: "y", summary: null, source: "ai", created_at: "t" },
];

function mockDocs() {
  // Order matters: "/api/documents/..." contains "/api/document"; specific paths first.
  return stubFetch([
    ["/api/documents/library", () => jsonResponse(LIB)],
    ["/api/documents/import-pdf", () => jsonResponse({ ...DOC, id: "d1", title: "Imported.pdf" })],
    ["/api/document/d1/versions", () => jsonResponse(VERSIONS)],
    ["/api/document/d1/restore", () => jsonResponse(DOC)],
    ["/api/document/d1/archive", () => jsonResponse({ ok: true, archived: true })],
    ["/api/document/d1", (_u, init) => (init?.method === "DELETE" ? jsonResponse({ status: "deleted", id: "d1" }) : jsonResponse(DOC))],
    ["/api/document", () => jsonResponse(DOC)],
  ]);
}

describe("Documents", () => {
  it("lists the library", async () => {
    mockDocs();
    renderWithProviders(<Documents />);
    expect(await screen.findByText("Worksheet")).toBeInTheDocument();
    expect(screen.getByText("Library (1)")).toBeInTheDocument();
  });

  it("creates a document and opens it", async () => {
    const fetchMock = mockDocs();
    renderWithProviders(<Documents />);
    await screen.findByText("Worksheet");

    await userEvent.type(screen.getByLabelText("Document title"), "New worksheet");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(findCall(fetchMock, "/api/document", "POST")).toBeTruthy());
    expect(await screen.findByTestId("editor-d1")).toBeInTheDocument();
  });

  it("opens a doc, edits and saves a new version", async () => {
    const fetchMock = mockDocs();
    renderWithProviders(<Documents />);
    await userEvent.click(await screen.findByRole("button", { name: /Worksheet/ }));

    const editor = await screen.findByTestId("editor-d1");
    const area = within(editor).getByLabelText("Document content");
    await userEvent.type(area, " — revised");
    await userEvent.click(within(editor).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(findCall(fetchMock, "/api/document/d1", "PUT")).toBeTruthy());
  });

  it("shows versions and restores one", async () => {
    const fetchMock = mockDocs();
    renderWithProviders(<Documents />);
    await userEvent.click(await screen.findByRole("button", { name: /Worksheet/ }));
    await screen.findByTestId("editor-d1");

    await userEvent.click(screen.getByRole("button", { name: "Versions (2)" }));
    const panel = await screen.findByTestId("doc-versions");
    expect(within(panel).getByText("v2")).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("button", { name: "Restore version 1" }));
    await waitFor(() => expect(findCall(fetchMock, "/api/document/d1/restore/1", "POST")).toBeTruthy());
  });

  it("deletes a document", async () => {
    const fetchMock = mockDocs();
    renderWithProviders(<Documents />);
    await userEvent.click(await screen.findByRole("button", { name: /Worksheet/ }));
    await screen.findByTestId("editor-d1");
    // Two-step destructive confirm: arm, then confirm.
    await userEvent.click(screen.getByRole("button", { name: "Delete document" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete document" }));
    await waitFor(() => expect(findCall(fetchMock, "/api/document/d1", "DELETE")).toBeTruthy());
  });

  it("imports a PDF", async () => {
    const fetchMock = mockDocs();
    renderWithProviders(<Documents />);
    await screen.findByText("Worksheet");
    const file = new File(["%PDF-1.4"], "homework.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText("Import PDF"), file);
    await waitFor(() => expect(findCall(fetchMock, "/api/documents/import-pdf", "POST")).toBeTruthy());
  });
});
