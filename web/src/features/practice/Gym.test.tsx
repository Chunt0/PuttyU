import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Gym } from "./Gym.tsx";
import { difficultyLabel, difficultyLine, summaryLine, clampDifficulty } from "./gym.model.ts";
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
  ],
};

const COURSES = { courses: [{ id: "c1", name: "AP Statistics", status: "active", settings: {} }] };

const STUDY_CITATION = {
  chunk_id: "ck1", source_id: "src1", title: "Intro Stats", heading: "Sampling error",
  page_start: 42, citation: "Intro Stats §Sampling error · p. 42",
};

const ITEM_1 = {
  item_key: "k1", concept_id: "n2", concept_name: "Sampling error", course_id: "c1",
  difficulty: 2, mode: "free", prompt: "Define sampling error.", source: "gym", citation: null,
};
const ITEM_2 = {
  item_key: "k2", concept_id: "n2", concept_name: "Sampling error", course_id: "c1",
  difficulty: 3, mode: "free", prompt: "When does sampling error shrink?", source: "gym", citation: null,
};

/** The engine steps difficulty up on a correct answer and folds the running summary. */
function mockGym(opts: { itemNull?: boolean } = {}) {
  let nextCount = 0;
  return stubFetch([
    ["/api/practice/gym/next", () => {
      nextCount += 1;
      if (opts.itemNull) {
        return jsonResponse({ item: null, difficulty: 2, message: "No weak concepts to drill yet." });
      }
      // First next → ITEM_1 at level 2; a later next → ITEM_2 at level 3.
      return jsonResponse(
        nextCount === 1
          ? { item: ITEM_1, difficulty: 2, message: null }
          : { item: ITEM_2, difficulty: 3, message: null },
      );
    }],
    ["/api/practice/gym/answer", () =>
      jsonResponse({
        verdict: "correct", correct: true, feedback_short: "Right — that's the spread of the estimate.",
        concept_id: "n2", concept_name: "Sampling error", effective_p: 0.6, state: "learning",
        study_citation: null, difficulty: 3,
        summary: { attempted: 1, correct: 1, difficulty: 3, streak: 1 },
      })],
    ["/api/graph/concepts", () => jsonResponse(TREE)],
    ["/api/courses", () => jsonResponse(COURSES)],
  ]);
}

/** A struggle answer hands back a study citation door. */
function mockGymStruggle() {
  return stubFetch([
    ["/api/practice/gym/next", () =>
      jsonResponse({ item: ITEM_1, difficulty: 2, message: null })],
    ["/api/practice/gym/answer", () =>
      jsonResponse({
        verdict: "incorrect", correct: false, feedback_short: "Not quite — re-read the definition.",
        concept_id: "n2", concept_name: "Sampling error", effective_p: 0.2, state: "shaky",
        study_citation: STUDY_CITATION, difficulty: 1,
        summary: { attempted: 1, correct: 0, difficulty: 1, streak: 0 },
      })],
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

describe("Gym model helpers", () => {
  it("turns difficulty into a word and a line, never a bare number", () => {
    expect(difficultyLabel(1)).toBe("easiest");
    expect(difficultyLabel(3)).toBe("steady");
    expect(difficultyLabel(5)).toBe("hardest");
    expect(difficultyLine(3)).toBe("level 3 of 5 · steady");
    // Out-of-range clamps into the rung set.
    expect(clampDifficulty(9)).toBe(5);
    expect(clampDifficulty(0)).toBe(1);
  });

  it("renders the honest running tally, surfacing a streak only once it's worth it", () => {
    expect(summaryLine({ attempted: 6, correct: 4, difficulty: 3, streak: 1 }))
      .toBe("4 right of 6 · level 3");
    expect(summaryLine({ attempted: 6, correct: 5, difficulty: 4, streak: 3 }))
      .toBe("5 right of 6 · level 4 · 3 in a row");
  });
});

describe("Gym", () => {
  it("gates on no active course", async () => {
    useCourseStore.setState({ activeCourseId: null });
    mockGym();
    renderWithProviders(<Gym />);
    expect(await screen.findByText("Open a course tab to start drilling.")).toBeInTheDocument();
  });

  it("coach's pick → answer correct: POSTs difficulty+streak and the dials update from the response", async () => {
    const fetchMock = mockGym();
    renderWithProviders(<Gym />);

    // The picker resolves once the active course lands.
    await userEvent.click(await screen.findByRole("button", { name: "Coach's pick" }));

    // Coach's pick carries NO concept_id, seeds difficulty=2.
    await waitFor(() => expect(findCall(fetchMock, "/api/practice/gym/next", "POST")).toBeTruthy());
    const nextBody = (await requestJson(findCall(fetchMock, "/api/practice/gym/next", "POST")!)) as {
      course_id: string; concept_id?: string; difficulty: number;
    };
    expect(nextBody.course_id).toBe("c1");
    expect(nextBody.concept_id).toBeUndefined();
    expect(nextBody.difficulty).toBe(2);

    // The first item renders, dials seed at level 2.
    expect(await screen.findByText("Define sampling error.")).toBeInTheDocument();
    expect(screen.getByTestId("gym-difficulty")).toHaveTextContent("level 2 of 5 · easier");
    expect(screen.getByTestId("gym-summary")).toHaveTextContent("0 right of 0 · level 2");

    // Answer it.
    await userEvent.type(screen.getByLabelText("Your answer"), "the spread of an estimate");
    await userEvent.click(screen.getByRole("button", { name: "Check" }));

    // The answer POST carries the local set state (difficulty=2 at submit, streak=0).
    await waitFor(() => expect(findCall(fetchMock, "/api/practice/gym/answer", "POST")).toBeTruthy());
    const answerBody = (await requestJson(findCall(fetchMock, "/api/practice/gym/answer", "POST")!)) as {
      item_key: string; answer_text: string; attachment_ids: string[]; difficulty: number; streak: number;
    };
    expect(answerBody.item_key).toBe("k1");
    expect(answerBody.difficulty).toBe(2);
    expect(answerBody.streak).toBe(0);
    expect(answerBody.attachment_ids).toEqual([]);

    // The verdict shows + the dials adopt the response: difficulty 3, summary 1/1 with a streak.
    expect(await screen.findByTestId("gym-verdict")).toHaveTextContent("Got it");
    expect(screen.getByTestId("gym-difficulty")).toHaveTextContent("level 3 of 5 · steady");
    expect(screen.getByTestId("gym-summary")).toHaveTextContent("1 right of 1 · level 3");
  });

  it("requests the next item at the adopted difficulty", async () => {
    const fetchMock = mockGym();
    renderWithProviders(<Gym />);
    await userEvent.click(await screen.findByRole("button", { name: "Coach's pick" }));
    await screen.findByText("Define sampling error.");
    await userEvent.type(screen.getByLabelText("Your answer"), "an answer");
    await userEvent.click(screen.getByRole("button", { name: "Check" }));
    await screen.findByTestId("gym-verdict");

    fetchMock.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(findCall(fetchMock, "/api/practice/gym/next", "POST")).toBeTruthy());
    const body = (await requestJson(findCall(fetchMock, "/api/practice/gym/next", "POST")!)) as {
      difficulty: number;
    };
    // After adopting the response's difficulty=3, "Next" asks for the next at level 3.
    expect(body.difficulty).toBe(3);
    expect(await screen.findByText("When does sampling error shrink?")).toBeInTheDocument();
  });

  it("a struggle surfaces the study-citation door", async () => {
    mockGymStruggle();
    renderWithProviders(<Gym />);
    await userEvent.click(await screen.findByRole("button", { name: "Coach's pick" }));
    await screen.findByText("Define sampling error.");
    await userEvent.type(screen.getByLabelText("Your answer"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Check" }));

    expect(await screen.findByTestId("gym-verdict")).toHaveTextContent("Not quite");
    expect(screen.getByRole("button", { name: /study: Sampling error · p\. 42/ })).toBeInTheDocument();
  });

  it("renders the coach's-pick-exhausted message (item: null)", async () => {
    mockGym({ itemNull: true });
    renderWithProviders(<Gym />);
    await userEvent.click(await screen.findByRole("button", { name: "Coach's pick" }));
    expect(await screen.findByText("No weak concepts to drill yet.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Your answer")).not.toBeInTheDocument();
  });

  it("drills a chosen concept by id from the dropdown", async () => {
    const fetchMock = mockGym();
    renderWithProviders(<Gym />);
    // Wait for the concept tree to populate the select.
    await screen.findByRole("option", { name: "Sampling error" });
    await userEvent.selectOptions(screen.getByLabelText("Concept to drill"), "n2");

    await waitFor(() => expect(findCall(fetchMock, "/api/practice/gym/next", "POST")).toBeTruthy());
    const body = (await requestJson(findCall(fetchMock, "/api/practice/gym/next", "POST")!)) as {
      concept_id?: string; difficulty: number;
    };
    expect(body.concept_id).toBe("n2");
    expect(body.difficulty).toBe(2);
  });
});
