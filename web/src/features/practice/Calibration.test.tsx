import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Calibration } from "./Calibration.tsx";
import {
  asStateRows,
  progressText,
  statesSummary,
  stateWord,
} from "./calibration.model.ts";
import { useCourseStore } from "../courses/store.ts";
import { useWindowStore } from "../../app/windows/windowStore.ts";
import { renderWithProviders, jsonResponse, stubFetch, findCall } from "../../test/util.tsx";

/** Read a recorded openapi-fetch call's JSON body (the mock gets a Request object). */
async function requestJson(call: unknown[]): Promise<unknown> {
  return (call[0] as Request).clone().json();
}

const COURSES = { courses: [{ id: "c1", name: "AP Statistics", status: "active", settings: {} }] };

const ITEM_1 = {
  item_key: "k1", concept_id: "n1", concept_name: "Populations", course_id: "c1",
  difficulty: 2, mode: "free", prompt: "What is a population?", source: "calibration", citation: null,
};
const ITEM_2 = {
  item_key: "k2", concept_id: "n2", concept_name: "Sampling error", course_id: "c1",
  difficulty: 2, mode: "free", prompt: "What is sampling error?", source: "calibration", citation: null,
};

const FINISH = {
  status: "done", calibrated: true,
  message: "Calibration saved — the tutor now has a starting read on 2 concepts.",
  states: [
    { concept_id: "n1", concept_name: "Populations", state: "learning", effective_p: 0.45 },
    { concept_id: "n2", concept_name: "Sampling error", state: "shaky", effective_p: 0.3 },
  ],
};

/** start → item, answer once → next item, answer again → done, finish → summary. */
function mockCalibration(opts: { noRegion?: boolean } = {}) {
  let answers = 0;
  return stubFetch([
    ["/api/practice/calibration/start", () =>
      opts.noRegion
        ? jsonResponse({
            status: "no_region", session_key: null, item: null, position: 0, total: 0,
            message: "No library concepts to calibrate yet — the graph warms up as you study.",
          })
        : jsonResponse({
            status: "in_progress", session_key: "sess1", item: ITEM_1, position: 0, total: 2,
            message: null,
          })],
    ["/api/practice/calibration/answer", () => {
      answers += 1;
      // First answer → next item at position 1; second → done.
      return jsonResponse(
        answers === 1
          ? {
              verdict: "correct", correct: true, feedback_short: "", concept_id: "n1",
              concept_name: "Populations", effective_p: 0.45, state: "learning",
              next_item: ITEM_2, position: 1, total: 2, done: false,
            }
          : {
              verdict: "partial", correct: false, feedback_short: "", concept_id: "n2",
              concept_name: "Sampling error", effective_p: 0.3, state: "shaky",
              next_item: null, position: 2, total: 2, done: true,
            },
      );
    }],
    ["/api/practice/calibration/finish", () => jsonResponse(FINISH)],
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

describe("Calibration model helpers", () => {
  it("turns position/total into a 1-based step line, clamped, blank when empty", () => {
    expect(progressText(0, 8)).toBe("Step 1 of 8");
    expect(progressText(7, 8)).toBe("Step 8 of 8");
    // Out-of-range positions clamp into [1, total].
    expect(progressText(9, 8)).toBe("Step 8 of 8");
    expect(progressText(-2, 8)).toBe("Step 1 of 8");
    expect(progressText(0, 0)).toBe("");
  });

  it("folds states onto the 4-state vocabulary and summarizes them, never a number", () => {
    expect(stateWord("learning")).toBe("learning");
    expect(stateWord("weird")).toBe("unknown");
    expect(stateWord(null)).toBe("unknown");

    const rows = asStateRows([
      { concept_id: "a", concept_name: "A", state: "mastered", effective_p: 0.9 },
      { concept_id: "b", concept_name: "B", state: "shaky", effective_p: 0.3 },
      { concept_id: "c", concept_name: "C", state: "weird", effective_p: null },
    ]);
    expect(statesSummary(rows)).toBe("1 mastered · 1 shaky · 1 unknown");
    // Tolerant of missing keys (open dicts on the wire).
    expect(asStateRows([{}])[0]).toEqual({
      concept_id: null, concept_name: null, state: null, effective_p: null,
    });
  });
});

describe("Calibration", () => {
  it("gates on no active course", async () => {
    useCourseStore.setState({ activeCourseId: null });
    mockCalibration();
    renderWithProviders(<Calibration />);
    expect(await screen.findByText("Open a course tab to warm up on it.")).toBeInTheDocument();
  });

  it("shows the intro card scoped to the active course", async () => {
    mockCalibration();
    renderWithProviders(<Calibration />);
    expect(await screen.findByText("Show me where you are.")).toBeInTheDocument();
    expect(screen.getByText(/AP Statistics/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start warm-up" })).toBeInTheDocument();
  });

  it("renders the no_region terminal card and writes nothing", async () => {
    mockCalibration({ noRegion: true });
    renderWithProviders(<Calibration />);
    await userEvent.click(await screen.findByRole("button", { name: "Start warm-up" }));

    expect(
      await screen.findByText(/No library concepts to calibrate yet/),
    ).toBeInTheDocument();
    // No walk renders.
    expect(screen.queryByLabelText("Your answer")).not.toBeInTheDocument();
  });

  it("walks: start → answer one (carries session_key, skip=false) → done → finish summary", async () => {
    const fetchMock = mockCalibration();
    renderWithProviders(<Calibration />);
    await userEvent.click(await screen.findByRole("button", { name: "Start warm-up" }));

    // First item + progress indicator.
    expect(await screen.findByText("What is a population?")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();

    // Answer it.
    await userEvent.type(screen.getByLabelText("Your answer"), "every member of a group");
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));

    // The answer POST carries session_key + skip=false + the item_key.
    await waitFor(() =>
      expect(findCall(fetchMock, "/api/practice/calibration/answer", "POST")).toBeTruthy());
    const body = (await requestJson(
      findCall(fetchMock, "/api/practice/calibration/answer", "POST")!,
    )) as { session_key: string; item_key: string; answer_text: string; skip: boolean };
    expect(body.session_key).toBe("sess1");
    expect(body.item_key).toBe("k1");
    expect(body.answer_text).toBe("every member of a group");
    expect(body.skip).toBe(false);

    // Second item advances to step 2.
    expect(await screen.findByText("What is sampling error?")).toBeInTheDocument();
    expect(screen.getByText("Step 2 of 2")).toBeInTheDocument();

    // Answering the last item -> done -> finish auto-fires -> the calm summary lands.
    await userEvent.type(screen.getByLabelText("Your answer"), "variation from sampling");
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(await screen.findByText("You're warmed up")).toBeInTheDocument();
    expect(screen.getByText(/starting read on 2 concepts/)).toBeInTheDocument();
    // The summary rolls the states up in the 4-state vocabulary, no numbers.
    expect(screen.getByText("1 learning · 1 shaky")).toBeInTheDocument();
    expect(screen.getByText("learning")).toHaveClass("state-chip--learning");
    expect(screen.getByText("shaky")).toHaveClass("state-chip--shaky");
    await waitFor(() =>
      expect(findCall(fetchMock, "/api/practice/calibration/finish", "POST")).toBeTruthy());
  });

  it("Skip posts skip=true and a null answer_text", async () => {
    const fetchMock = mockCalibration();
    renderWithProviders(<Calibration />);
    await userEvent.click(await screen.findByRole("button", { name: "Start warm-up" }));
    await screen.findByText("What is a population?");

    await userEvent.click(screen.getByRole("button", { name: "Skip" }));

    await waitFor(() =>
      expect(findCall(fetchMock, "/api/practice/calibration/answer", "POST")).toBeTruthy());
    const body = (await requestJson(
      findCall(fetchMock, "/api/practice/calibration/answer", "POST")!,
    )) as { session_key: string; skip: boolean; answer_text: string | null };
    expect(body.session_key).toBe("sess1");
    expect(body.skip).toBe(true);
    expect(body.answer_text).toBeNull();
  });

  it("the persistent exit finishes the walk early (two-step confirm)", async () => {
    const fetchMock = mockCalibration();
    renderWithProviders(<Calibration />);
    await userEvent.click(await screen.findByRole("button", { name: "Start warm-up" }));
    await screen.findByText("What is a population?");

    // ConfirmButton keeps its aria-label fixed; the visible text flips to "Finish now?".
    const exit = screen.getByRole("button", { name: "Skip / finish anytime" });
    await userEvent.click(exit); // arm
    expect(findCall(fetchMock, "/api/practice/calibration/finish", "POST")).toBeFalsy();
    expect(exit).toHaveTextContent("Finish now?");
    await userEvent.click(exit); // confirm

    await waitFor(() =>
      expect(findCall(fetchMock, "/api/practice/calibration/finish", "POST")).toBeTruthy());
    expect(await screen.findByText("You're warmed up")).toBeInTheDocument();
  });
});
