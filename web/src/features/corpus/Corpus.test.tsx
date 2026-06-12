import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Corpus } from "./Corpus.tsx";
import { renderWithProviders, jsonResponse, stubFetch, findCall, callInfo } from "../../test/util.tsx";

afterEach(() => vi.unstubAllGlobals());

const FILES = [
  { name: "stats-ch1.pdf", size: 204800, path: "/data/personal_uploads/local/stats-ch1-abc.pdf" },
];

function mockCorpus(overrides: Partial<Record<string, () => Response>> = {}) {
  return stubFetch([
    ["/api/personal/upload", overrides["upload"] ?? (() => jsonResponse({ success: true, uploaded: ["notes.txt"], indexed_count: 4, failed_count: 0 }))],
    ["/api/personal/file", overrides["delete"] ?? (() => jsonResponse({ success: true, removed_chunks: 3, deleted_from_disk: true }))],
    ["/api/personal", overrides["list"] ?? (() => jsonResponse({ files: FILES, directories: [] }))],
    ["/api/embeddings/endpoint", () => jsonResponse({ url: "", model: "", active: false })],
    ["/api/embeddings/models", () => jsonResponse([{ model: "BAAI/bge-small-en-v1.5", active: true, downloaded: true }])],
  ]);
}

describe("Corpus", () => {
  it("lists indexed documents and the active embedding model", async () => {
    mockCorpus();
    renderWithProviders(<Corpus />);
    expect(await screen.findByText("stats-ch1.pdf")).toBeInTheDocument();
    expect(screen.getByText("Indexed documents (1)")).toBeInTheDocument();
    expect(await screen.findByText(/bge-small-en-v1\.5 \(built-in\)/)).toBeInTheDocument();
  });

  it("uploads selected files", async () => {
    const fetchMock = mockCorpus();
    renderWithProviders(<Corpus />);
    await screen.findByText("stats-ch1.pdf");

    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    await userEvent.upload(screen.getByLabelText("Documents"), file);
    await userEvent.click(screen.getByRole("button", { name: /Upload/ }));

    await waitFor(() => {
      const post = findCall(fetchMock, "/api/personal/upload", "POST");
      expect(post).toBeTruthy();
      expect(callInfo(post!).body).toBeInstanceOf(FormData);
    });
    expect(await screen.findByText(/Indexed 4 chunks/)).toBeInTheDocument();
  });

  it("removes a document", async () => {
    const fetchMock = mockCorpus();
    renderWithProviders(<Corpus />);
    await screen.findByText("stats-ch1.pdf");

    // Two-step destructive confirm: arm, then confirm.
    await userEvent.click(screen.getByRole("button", { name: "Delete stats-ch1.pdf" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete stats-ch1.pdf" }));

    await waitFor(() => {
      expect(findCall(fetchMock, "/api/personal/file", "DELETE")).toBeTruthy();
    });
  });
});
