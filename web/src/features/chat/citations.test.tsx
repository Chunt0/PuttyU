import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Chat } from "./Chat.tsx";
import { useUiStore } from "../../lib/store.ts";
import { useCourseStore } from "../courses/store.ts";
import { usePdfStore } from "../library/pdfStore.ts";
import { useWindowStore } from "../../app/windows/windowStore.ts";
import { renderWithProviders, jsonResponse, sseResponse, stubFetch, findCall, callInfo } from "../../test/util.tsx";

const CITATIONS_WIRE =
  'data: {"type":"citations","data":[' +
  '{"chunk_id":"ch1","source_id":"s1","title":"Intro Stats","heading":"Ch 1 > 1.1 Definitions","page_start":9,"citation":"[Intro Stats §1.1 Definitions, p. 9]"},' +
  '{"chunk_id":"ch2","source_id":"s1","title":"Intro Stats","heading":"Ch 2 > 2.3 Data","page_start":87,"citation":"[Intro Stats §2.3 Data, p. 87]"}' +
  "]}\n\n" +
  'data: {"delta":"A parameter describes a population."}\n\n' +
  "data: [DONE]\n\n";

beforeEach(() => {
  useUiStore.setState({ currentSessionId: "s1" });
  useCourseStore.setState({ activeCourseId: "c1" });
  usePdfStore.setState({ target: null });
  useWindowStore.setState({ windows: {}, nextZ: 1 });
});

afterEach(() => {
  vi.unstubAllGlobals();
  useUiStore.setState({ currentSessionId: null });
  useCourseStore.setState({ activeCourseId: null });
  localStorage.clear();
});

function mockChat() {
  return stubFetch([
    ["/api/history/", () => jsonResponse({ history: [], model: "m", name: "Stats" })],
    ["/api/chat_stream", () => sseResponse(CITATIONS_WIRE)],
  ]);
}

describe("Chat citations (F3)", () => {
  it("renders grounding chips for the turn and sends the active course id", async () => {
    const fetchMock = mockChat();
    renderWithProviders(<Chat />);
    const box = await screen.findByLabelText("Message");
    await userEvent.type(box, "parameter vs statistic?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    // Chips: one count label (2 chunks, 1 source) + a chip per excerpt.
    await waitFor(() => expect(screen.getByTestId("citations")).toBeInTheDocument());
    expect(screen.getByText("grounded in 1 source")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Intro Stats §1.1 Definitions · p. 9" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Intro Stats §2.3 Data · p. 87" })).toBeInTheDocument();

    // The send carried the F3 course_id fallback.
    const call = findCall(fetchMock, "/api/chat_stream", "POST");
    expect((callInfo(call!).body as FormData).get("course_id")).toBe("c1");
  });

  it("clicking a chip opens the PDF viewer window at the cited page", async () => {
    mockChat();
    renderWithProviders(<Chat />);
    await userEvent.type(await screen.findByLabelText("Message"), "q");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    const chip = await screen.findByRole("button", { name: "Intro Stats §2.3 Data · p. 87" });
    await userEvent.click(chip);

    expect(usePdfStore.getState().target).toEqual({ sourceId: "s1", title: "Intro Stats", page: 87 });
    expect(useWindowStore.getState().windows["pdf"]).toBeTruthy();
  });

  it("chips persist after the turn completes and clear on the next send", async () => {
    let streamCalls = 0;
    stubFetch([
      ["/api/history/", () => jsonResponse({ history: [], model: "m", name: "Stats" })],
      ["/api/chat_stream", () => {
        streamCalls += 1;
        // Second turn has no citations event — the chips must clear.
        return sseResponse(streamCalls === 1 ? CITATIONS_WIRE : 'data: {"delta":"ok"}\n\ndata: [DONE]\n\n');
      }],
    ]);
    renderWithProviders(<Chat />);

    await userEvent.type(await screen.findByLabelText("Message"), "first");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByTestId("citations")).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText("Message"), "second");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(streamCalls).toBe(2));
    await waitFor(() => expect(screen.queryByTestId("citations")).not.toBeInTheDocument());
  });
});
