import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Explain } from "./Explain.tsx";
import { appendDelta, openingPrompt, startTurn, type ExplainTurn } from "./explain.model.ts";
import { useCourseStore } from "../courses/store.ts";
import { useWindowStore } from "../../app/windows/windowStore.ts";
import {
  renderWithProviders,
  jsonResponse,
  sseResponse,
  stubFetch,
  findCall,
  callInfo,
} from "../../test/util.tsx";

/** Read a recorded openapi-fetch call's JSON body (the mock gets a Request object). */
async function requestJson(call: unknown[]): Promise<unknown> {
  return (call[0] as Request).clone().json();
}

const TREE = {
  course_id: "c1",
  concepts: [
    {
      id: "h1", name: "Ch 1 Sampling", state: "unknown", p_known: null, evidence_count: 0,
      children: [
        { id: "n1", name: "Populations", state: "learning", p_known: 0.42, evidence_count: 2, children: [] },
        { id: "n2", name: "Sampling error", state: "shaky", p_known: 0.31, evidence_count: 3, children: [] },
      ],
    },
  ],
};

const COURSES = { courses: [{ id: "c1", name: "AP Statistics", status: "active", settings: {} }] };

const EXPLAIN_START = {
  session_id: "explain-s1",
  concept_id: "n2",
  concept_name: "Sampling error",
  message: "Teach me Sampling error in your own words — where would you start?",
};

function mockExplain() {
  return stubFetch([
    ["/api/practice/explain/start", () => jsonResponse(EXPLAIN_START)],
    ["/api/chat_stream", () =>
      sseResponse('data: {"delta":"Hm, "}\n\ndata: {"delta":"why does it shrink?"}\n\ndata: [DONE]\n\n'),
    ],
    ["/api/graph/concepts", () => jsonResponse(TREE)],
    ["/api/courses", () => jsonResponse(COURSES)],
  ]);
}

beforeEach(() => {
  useCourseStore.setState({ activeCourseId: "c1", onboardingSkipped: false });
  useWindowStore.setState({ windows: {}, nextZ: 1 });
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Explain model helpers", () => {
  it("falls back to a teach-me prompt when the backend sends no opening line", () => {
    expect(openingPrompt("Show me what you've got.", "Limits")).toBe("Show me what you've got.");
    expect(openingPrompt(null, "Limits")).toContain("Teach me Limits");
    expect(openingPrompt("  ", null)).toContain("Teach me this concept");
  });

  it("opens a user turn + an empty assistant turn, then merges deltas into the open reply", () => {
    const base: ExplainTurn[] = [{ role: "assistant", content: "Teach me X…" }];
    const after = startTurn(base, "X is the spread of an estimate");
    expect(after).toEqual([
      { role: "assistant", content: "Teach me X…" },
      { role: "user", content: "X is the spread of an estimate" },
      { role: "assistant", content: "" },
    ]);
    const streamed = appendDelta(appendDelta(after, "Hm, "), "why?");
    expect(streamed[streamed.length - 1]).toEqual({ role: "assistant", content: "Hm, why?" });
  });

  it("never appends a delta onto a user turn", () => {
    const turns: ExplainTurn[] = [{ role: "user", content: "mine" }];
    expect(appendDelta(turns, "x")).toBe(turns);
    expect(appendDelta([], "x")).toEqual([]);
  });
});

describe("Explain", () => {
  it("gates on no active course", async () => {
    useCourseStore.setState({ activeCourseId: null });
    mockExplain();
    renderWithProviders(<Explain />);
    expect(await screen.findByText("Open a course tab to teach a concept back.")).toBeInTheDocument();
  });

  it("picks a concept → POSTs explain/start {course_id, concept_id} and opens the prompt + composer", async () => {
    const fetchMock = mockExplain();
    renderWithProviders(<Explain />);

    // The concept select populates once the tree lands.
    await screen.findByRole("option", { name: "Sampling error" });
    await userEvent.selectOptions(screen.getByLabelText("Concept to explain"), "n2");

    // The start POST carries the active course + chosen concept.
    await waitFor(() =>
      expect(findCall(fetchMock, "/api/practice/explain/start", "POST")).toBeTruthy());
    expect(await requestJson(findCall(fetchMock, "/api/practice/explain/start", "POST")!))
      .toEqual({ course_id: "c1", concept_id: "n2" });

    // The opening tutor prompt + the composer render.
    expect(await screen.findByText(/Teach me Sampling error in your own words/)).toBeInTheDocument();
    expect(screen.getByLabelText("Your explanation")).toBeInTheDocument();
  });

  it("sends a turn through the chat stream and appends the streamed reply", async () => {
    const fetchMock = mockExplain();
    renderWithProviders(<Explain />);
    await screen.findByRole("option", { name: "Sampling error" });
    await userEvent.selectOptions(screen.getByLabelText("Concept to explain"), "n2");

    const box = await screen.findByLabelText("Your explanation");
    await userEvent.type(box, "It's the variability of the estimate.");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    // The chat stream is invoked, bound to the explain session id + active course.
    await waitFor(() => expect(findCall(fetchMock, "/api/chat_stream", "POST")).toBeTruthy());
    const body = callInfo(findCall(fetchMock, "/api/chat_stream", "POST")!).body as FormData;
    expect(body.get("session")).toBe("explain-s1");
    expect(body.get("message")).toBe("It's the variability of the estimate.");
    expect(body.get("course_id")).toBe("c1");

    // The user turn shows and the streamed tutor reply lands.
    expect(screen.getByText("It's the variability of the estimate.")).toBeInTheDocument();
    expect(await screen.findByText("Hm, why does it shrink?")).toBeInTheDocument();
  });

  it("can return to the picker with 'Pick another'", async () => {
    mockExplain();
    renderWithProviders(<Explain />);
    await screen.findByRole("option", { name: "Sampling error" });
    await userEvent.selectOptions(screen.getByLabelText("Concept to explain"), "n2");
    await screen.findByLabelText("Your explanation");

    await userEvent.click(screen.getByRole("button", { name: "Pick another" }));
    expect(await screen.findByLabelText("Concept to explain")).toBeInTheDocument();
    expect(screen.queryByLabelText("Your explanation")).not.toBeInTheDocument();
  });
});
