import { describe, it, expect, afterEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Research } from "./Research.tsx";
import { renderWithProviders, jsonResponse, sseResponse, stubFetch, findCall } from "../../test/util.tsx";

afterEach(() => vi.unstubAllGlobals());

const LIBRARY = {
  research: [
    { id: "rp-old", query: "what is variance", category: "", source_count: 4, status: "done", duration: "30s", rounds: 2, started_at: 1, completed_at: 2, archived: false },
  ],
  total: 1,
};

function mockResearch(overrides: Partial<Record<string, () => Response>> = {}) {
  return stubFetch([
    ["/api/research/start", overrides["start"] ?? (() => jsonResponse({ session_id: "rp-new", status: "running", query: "q" }))],
    ["/api/research/stream", overrides["stream"] ?? (() =>
      sseResponse(
        'data: {"phase":"planning"}\n\n' +
          'data: {"phase":"searching","round":1}\n\n' +
          'data: {"phase":"writing"}\n\n' +
          'data: {"status":"done","final":true}\n\n',
      ))],
    ["/api/research/library", overrides["library"] ?? (() => jsonResponse(LIBRARY))],
  ]);
}

describe("Research", () => {
  it("lists past research from the library", async () => {
    mockResearch();
    renderWithProviders(<Research />);
    expect(await screen.findByText("what is variance")).toBeInTheDocument();
    expect(screen.getByText("Library (1)")).toBeInTheDocument();
  });

  it("starts a job, streams progress, then shows the report", async () => {
    const fetchMock = mockResearch();
    renderWithProviders(<Research />);
    await screen.findByText("what is variance");

    await userEvent.type(screen.getByLabelText("Research query"), "compare SR algorithms");
    await userEvent.click(screen.getByRole("button", { name: "Start research" }));

    // The streamed progress renders.
    expect(await screen.findByText("Planning the research…")).toBeInTheDocument();
    expect(await screen.findByText("Searching (round 1)")).toBeInTheDocument();

    // On completion the report iframe opens, pointed at the new session's report.
    const frame = await screen.findByTitle("Research report");
    expect(frame.getAttribute("src")).toContain("/api/research/report/rp-new");

    // The start request carried the query.
    const post = findCall(fetchMock, "/api/research/start", "POST");
    expect(post).toBeTruthy();
  });

  it("opens a past report from the library", async () => {
    mockResearch();
    renderWithProviders(<Research />);
    await userEvent.click(await screen.findByRole("button", { name: /what is variance/ }));

    const frame = await screen.findByTitle("Research report");
    expect(frame.getAttribute("src")).toContain("/api/research/report/rp-old");
  });

  it("surfaces an error if starting fails", async () => {
    mockResearch({ start: () => new Response("no provider", { status: 400 }) });
    renderWithProviders(<Research />);
    await screen.findByText("what is variance");
    await userEvent.type(screen.getByLabelText("Research query"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Start research" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/model provider/i);
  });
});
