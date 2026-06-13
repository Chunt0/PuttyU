import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Progress } from "./Progress.tsx";
import { confidenceWord, stateCounts, summaryLine } from "./model.ts";
import { useCourseStore } from "../courses/store.ts";
import { useWindowStore } from "../../app/windows/windowStore.ts";
import { renderWithProviders, jsonResponse, stubFetch, findCall } from "../../test/util.tsx";

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
    {
      id: "h2", name: "Ch 2 Inference", state: "unknown", p_known: null, evidence_count: 0,
      children: [
        { id: "n3", name: "Confidence intervals", state: "mastered", p_known: 0.93, evidence_count: 5, children: [] },
      ],
    },
  ],
};

const A_STATED = {
  id: "a1", kind: "stated", relation: "states",
  statement: "I always mix up sampling error and bias",
  quote: "I always mix up sampling error and bias",
  confidence: null, subject_type: "user", object_type: "concept", object_id: "n2",
  object_name: "Sampling error", valid_from: "2026-06-08T10:00:00Z",
  invalidated_at: null, invalidation_reason: null, episode_refs: [],
};
const A_INFERRED = {
  id: "a2", kind: "inferred", relation: "struggles_with",
  statement: "avoids word problems", quote: null, confidence: 0.55,
  subject_type: "user", object_type: "concept", object_id: "n2", object_name: "Sampling error",
  valid_from: "2026-05-20T10:00:00Z", invalidated_at: null, invalidation_reason: null, episode_refs: [],
};
const A_INVALIDATED = {
  id: "a3", kind: "inferred", relation: "confuses",
  statement: "confuses standard deviation with standard error", quote: null, confidence: 0.8,
  subject_type: "user", object_type: "concept", object_id: "n2", object_name: "Sampling error",
  valid_from: "2026-05-02T10:00:00Z", invalidated_at: "2026-06-02T10:00:00Z",
  invalidation_reason: "contradicted", episode_refs: [],
};

const DETAIL_N2 = {
  id: "n2", name: "Sampling error", heading_path: ["Ch 1 Sampling", "Sampling error"],
  state: "shaky", p_known: 0.31,
  evidence: [
    { id: "e1", signal: "correct", weight: 1, created_at: "2026-06-10T15:00:00Z",
      source: "gym", note: null, indirect: false, episode_ref: null },
  ],
  assertions: [A_STATED, A_INFERRED, A_INVALIDATED],
};

// After the challenge: a2 is invalidated and the correction rides as a new stated row.
const DETAIL_N2_AFTER = {
  ...DETAIL_N2,
  assertions: [
    A_STATED,
    { ...A_INFERRED, invalidated_at: "2026-06-12T09:00:00Z", invalidation_reason: "challenged by user" },
    A_INVALIDATED,
    { ...A_STATED, id: "a4", relation: "corrects", quote: "I just hadn't gotten to them yet",
      statement: "avoids word problems", valid_from: "2026-06-12T09:00:00Z" },
  ],
};

const OBSERVATIONS = {
  observations: [
    { ...A_STATED, id: "o1", quote: "I like ice cream", statement: "I like ice cream",
      object_type: null, object_id: null, object_name: null, valid_from: "2026-06-01T09:00:00Z" },
    { ...A_STATED, id: "o2", quote: "I never learned long division",
      statement: "I never learned long division", object_type: "concept", object_id: "n1",
      object_name: "Populations", valid_from: "2026-05-30T09:00:00Z" },
  ],
};

const COURSES = { courses: [{ id: "c1", name: "AP Statistics", status: "active", settings: {} }] };

function mockProgress(opts: { emptyTree?: boolean } = {}) {
  let challenged = false;
  return stubFetch([
    ["/api/graph/concepts/n2/override", () =>
      jsonResponse({ id: "n2", state: "mastered", p_known: 0.95, evidence_count: 4 })],
    ["/api/graph/concepts/n2", () => jsonResponse(challenged ? DETAIL_N2_AFTER : DETAIL_N2)],
    ["/api/graph/concepts/n1", () =>
      jsonResponse({ id: "n1", name: "Populations", heading_path: [], state: "learning",
        p_known: 0.42, evidence: [], assertions: [] })],
    ["/api/graph/concepts", () =>
      jsonResponse(opts.emptyTree ? { course_id: "c1", concepts: [] } : TREE)],
    ["/api/graph/observations", () => jsonResponse(OBSERVATIONS)],
    ["/api/graph/assertions/a2/challenge", () => {
      challenged = true;
      return jsonResponse({
        invalidated: DETAIL_N2_AFTER.assertions[1],
        correction: DETAIL_N2_AFTER.assertions[3],
      });
    }],
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

describe("Progress model helpers", () => {
  it("counts states across the whole tree and renders the 4-state summary line", () => {
    const counts = stateCounts(TREE.concepts);
    expect(counts).toEqual({ mastered: 1, learning: 1, shaky: 1, unknown: 2 });
    expect(summaryLine(counts)).toBe("1 mastered · 1 learning · 1 shaky · 2 unknown");
    expect(summaryLine({ mastered: 3, learning: 0, shaky: 2, unknown: 14 }))
      .toBe("3 mastered · 2 shaky · 14 unknown");
  });

  it("turns confidence into a word, never a number", () => {
    expect(confidenceWord(0.8)).toBe("likely");
    expect(confidenceWord(0.55)).toBe("tentative");
    expect(confidenceWord(null)).toBe("tentative");
  });
});

describe("Progress", () => {
  it("renders the state-colored concept tree — chips and evidence counts, never a percentage", async () => {
    mockProgress();
    const { container } = renderWithProviders(<Progress />);

    expect(await screen.findByRole("button", { name: "Populations" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sampling error" })).toBeInTheDocument();
    // 4-state chips (sentence case), one per node; the section roots are "unknown".
    expect(screen.getByText("learning")).toHaveClass("state-chip--learning");
    expect(screen.getByText("shaky")).toHaveClass("state-chip--shaky");
    expect(screen.getByText("mastered")).toHaveClass("state-chip--mastered");
    expect(screen.getAllByText("unknown")).toHaveLength(2);
    expect(screen.getByText("3 evidence")).toBeInTheDocument();
    expect(screen.getByText("5 evidence")).toBeInTheDocument();
    // §6 Q2: no percentages, no raw probabilities — p_known never reaches the DOM.
    expect(container.textContent).not.toMatch(/%/);
    expect(container.textContent).not.toMatch(/0\.\d/);
  });

  it("collapses a section", async () => {
    mockProgress();
    renderWithProviders(<Progress />);
    await screen.findByRole("button", { name: "Populations" });

    await userEvent.click(screen.getByRole("button", { name: "Collapse Ch 1 Sampling" }));
    expect(screen.queryByRole("button", { name: "Populations" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confidence intervals" })).toBeInTheDocument();
  });

  it("shows the empty state with a door to the library", async () => {
    mockProgress({ emptyTree: true });
    renderWithProviders(<Progress />);

    expect(await screen.findByText(/No concepts yet — link a textbook/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open library" }));
    expect(useWindowStore.getState().windows["library"]).toBeTruthy();
  });

  it("opens the trajectory: quotes verbatim, qualifies insights with words, strikes invalidated rows", async () => {
    mockProgress();
    const { container } = renderWithProviders(<Progress />);
    await userEvent.click(await screen.findByRole("button", { name: "Sampling error" }));

    // Stated → verbatim quote with quote styling.
    const quote = await screen.findByText("I always mix up sampling error and bias");
    expect(quote.tagName).toBe("BLOCKQUOTE");
    // Inferred → statement + qualifier word; 0.55 reads "tentative", no raw number.
    expect(screen.getByText("avoids word problems")).toBeInTheDocument();
    expect(screen.getByText("(tentative)")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/0\.\d/);
    // Evidence row: "correct — gym" + its date.
    expect(screen.getByText(/correct — gym/)).toBeInTheDocument();
    // The invalidated May insight is visible but struck through, with its date.
    const invalidated = screen
      .getByText("confuses standard deviation with standard error")
      .closest("li");
    expect(invalidated).toHaveClass("timeline-row--invalidated");
    expect(invalidated?.textContent).toContain("invalidated Jun 2");
  });

  it("records overrides: 'I know this' immediately, 'I never learned this' behind a two-step confirm", async () => {
    const fetchMock = mockProgress();
    renderWithProviders(<Progress />);
    await userEvent.click(await screen.findByRole("button", { name: "Sampling error" }));
    await screen.findByText("Trajectory");

    await userEvent.click(screen.getByRole("button", { name: "I know this" }));
    await waitFor(() =>
      expect(findCall(fetchMock, "/api/graph/concepts/n2/override", "POST")).toBeTruthy());
    expect(await requestJson(findCall(fetchMock, "/api/graph/concepts/n2/override", "POST")!))
      .toEqual({ known: true });

    fetchMock.mockClear();
    const never = screen.getByRole("button", { name: "I never learned this" });
    await userEvent.click(never); // arm
    expect(findCall(fetchMock, "/override", "POST")).toBeFalsy();
    await userEvent.click(never); // confirm
    await waitFor(() => expect(findCall(fetchMock, "/override", "POST")).toBeTruthy());
    expect(await requestJson(findCall(fetchMock, "/override", "POST")!)).toEqual({ known: false });
  });

  it("challenges an insight: correction POSTed, row invalidated, correction lands as a stated quote", async () => {
    const fetchMock = mockProgress();
    renderWithProviders(<Progress />);
    await userEvent.click(await screen.findByRole("button", { name: "Sampling error" }));
    await screen.findByText("avoids word problems");

    await userEvent.click(
      screen.getByRole("button", { name: "Challenge: avoids word problems" }));
    await userEvent.type(
      screen.getByLabelText("Correction for: avoids word problems"),
      "I just hadn't gotten to them yet");
    await userEvent.click(screen.getByRole("button", { name: "Send correction" }));

    await waitFor(() => expect(findCall(fetchMock, "/challenge", "POST")).toBeTruthy());
    expect(await requestJson(findCall(fetchMock, "/challenge", "POST")!))
      .toEqual({ correction: "I just hadn't gotten to them yet" });

    // The refetched timeline shows the insight struck through + the correction verbatim.
    const corrected = await screen.findByText("I just hadn't gotten to them yet");
    expect(corrected.tagName).toBe("BLOCKQUOTE");
    await waitFor(() => {
      const row = screen.getByText("avoids word problems").closest("li");
      expect(row).toHaveClass("timeline-row--invalidated");
    });
    // An invalidated insight is no longer challengeable.
    expect(
      screen.queryByRole("button", { name: "Challenge: avoids word problems" }),
    ).not.toBeInTheDocument();
  });

  it("shows 'about you' observations verbatim and jumps to the anchored concept", async () => {
    mockProgress();
    renderWithProviders(<Progress />);

    expect(await screen.findByText("About you")).toBeInTheDocument();
    expect(screen.getByText("I like ice cream")).toBeInTheDocument();
    expect(screen.getByText("I never learned long division")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Go to concept Populations" }));
    // The detail panel opens on the anchored concept.
    expect(await screen.findByRole("heading", { name: "Populations" })).toBeInTheDocument();
  });
});
