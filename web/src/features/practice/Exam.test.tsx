import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Exam } from "./Exam.tsx";
import {
  clampInt,
  debriefSummary,
  formatClock,
  remainingSeconds,
} from "./exam.model.ts";
import { useCourseStore } from "../courses/store.ts";
import { useWindowStore } from "../../app/windows/windowStore.ts";
import { renderWithProviders, jsonResponse, stubFetch, findCall } from "../../test/util.tsx";

/** Read a recorded openapi-fetch call's JSON body (the mock gets a Request object). */
async function requestJson(call: unknown[]): Promise<unknown> {
  return (call[0] as Request).clone().json();
}

const START_TWO = {
  exam_key: "ex1",
  // started a moment ago so the live countdown shows ~30 min.
  started_at: new Date(Date.now() - 1000).toISOString(),
  duration_seconds: 1800,
  message: null,
  items: [
    {
      item_key: "i1",
      concept_id: "n1",
      concept_name: "Sampling error",
      prompt: "Explain **sampling error** in one sentence.",
      citation: null,
    },
    {
      item_key: "i2",
      concept_id: "n2",
      concept_name: "Confidence intervals",
      prompt: "What does a 95% interval mean?",
      citation: null,
    },
  ],
};

const START_EMPTY = {
  exam_key: "ex0",
  started_at: new Date().toISOString(),
  duration_seconds: 1800,
  message: "No exam items yet — link a textbook to this course.",
  items: [],
};

const SUBMIT_DEBRIEF = {
  total: 2,
  correct: 1,
  partial: 0,
  incorrect: 0,
  skipped: 1,
  readiness: "You're **close** — confidence intervals need another pass.",
  verdicts: [
    {
      item_key: "i1",
      concept_id: "n1",
      concept_name: "Sampling error",
      verdict: "correct",
      correct: true,
      feedback_short: "Right — variation from chance, not bias.",
      prompt: "Explain sampling error in one sentence.",
      state: "learning",
      effective_p: 0.6,
      citation: {
        chunk_id: "ch1",
        source_id: "src1",
        title: "Stats Primer",
        heading: "Ch 1 > Sampling",
        page_start: 12,
        citation: "Stats Primer §Sampling · p. 12",
      },
    },
    {
      item_key: "i2",
      concept_id: "n2",
      concept_name: "Confidence intervals",
      verdict: "skipped",
      correct: false,
      feedback_short: "",
      prompt: "What does a 95% interval mean?",
      state: null,
      effective_p: null,
      citation: null,
    },
  ],
};

const COURSES = { courses: [{ id: "c1", name: "AP Statistics", status: "active", settings: {} }] };

function mockExam(opts: { empty?: boolean } = {}) {
  return stubFetch([
    ["/api/practice/exam/submit", () => jsonResponse(SUBMIT_DEBRIEF)],
    ["/api/practice/exam/start", () => jsonResponse(opts.empty ? START_EMPTY : START_TWO)],
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

describe("Exam model helpers", () => {
  it("formats mm:ss, padding seconds and not capping minutes", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(1800)).toBe("30:00");
    expect(formatClock(5400)).toBe("90:00");
    expect(formatClock(-5)).toBe("0:00");
  });

  it("computes remaining seconds from started_at + duration, floored at 0", () => {
    const start = "2026-06-19T10:00:00Z";
    const now = Date.parse("2026-06-19T10:05:00Z"); // 5 min in
    expect(remainingSeconds(start, 1800, now)).toBe(1500);
    // Past the end → 0, never negative.
    expect(remainingSeconds(start, 60, now)).toBe(0);
  });

  it("clamps form ints with a fallback for blank/NaN", () => {
    expect(clampInt("", 1, 240, 30)).toBe(30);
    expect(clampInt("   ", 1, 240, 30)).toBe(30);
    expect(clampInt("abc", 1, 50, 10)).toBe(10);
    expect(clampInt("900", 1, 240, 30)).toBe(240);
    expect(clampInt("0", 1, 50, 10)).toBe(1);
    expect(clampInt("15.6", 1, 240, 30)).toBe(16);
  });

  it("writes a calm debrief summary, dropping zero buckets", () => {
    expect(debriefSummary(SUBMIT_DEBRIEF)).toBe("1 correct · 1 skipped of 2");
    expect(
      debriefSummary({ ...SUBMIT_DEBRIEF, correct: 4, partial: 1, incorrect: 2, skipped: 3, total: 10 }),
    ).toBe("4 correct · 1 partial · 2 incorrect · 3 skipped of 10");
  });
});

describe("Exam", () => {
  it("gates on no active course", async () => {
    useCourseStore.setState({ activeCourseId: null, onboardingSkipped: false });
    mockExam();
    renderWithProviders(<Exam />);
    expect(await screen.findByText(/Open a course tab/)).toBeInTheDocument();
  });

  it("shows the empty message when the paper has no items", async () => {
    mockExam({ empty: true });
    renderWithProviders(<Exam />);
    await userEvent.click(await screen.findByRole("button", { name: "Start exam" }));
    expect(await screen.findByText(/No exam items yet/)).toBeInTheDocument();
    // No timed view, no submit.
    expect(screen.queryByTestId("exam-clock")).not.toBeInTheDocument();
  });

  it("runs the timed sitting silently, then submits {exam_key, answers} and renders the debrief", async () => {
    const fetchMock = mockExam();
    renderWithProviders(<Exam />);

    await userEvent.click(await screen.findByRole("button", { name: "Start exam" }));

    // The silent sitting: both prompts present, a countdown clock, NO verdict UI yet.
    expect(await screen.findByText(/Explain/)).toBeInTheDocument();
    expect(screen.getByText(/95% interval/)).toBeInTheDocument();
    expect(screen.getByTestId("exam-clock")).toBeInTheDocument();
    expect(screen.queryByTestId("exam-debrief")).not.toBeInTheDocument();
    expect(screen.queryByTestId("exam-verdict")).not.toBeInTheDocument();

    // Answer the first item only (the second is left blank → skipped server-side).
    await userEvent.type(
      screen.getByLabelText("Answer for question 1"),
      "Variation from sampling chance.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Submit exam" }));

    await waitFor(() =>
      expect(findCall(fetchMock, "/api/practice/exam/submit", "POST")).toBeTruthy());
    const body = (await requestJson(
      findCall(fetchMock, "/api/practice/exam/submit", "POST")!,
    )) as { exam_key: string; answers: { item_key: string; answer_text: string; attachment_ids: string[] }[] };
    expect(body.exam_key).toBe("ex1");
    expect(body.answers).toHaveLength(2);
    expect(body.answers[0]).toEqual({
      item_key: "i1",
      answer_text: "Variation from sampling chance.",
      attachment_ids: [],
    });
    expect(body.answers[1]).toEqual({
      item_key: "i2",
      answer_text: "",
      attachment_ids: [],
    });

    // The debrief: bucket counts, the readiness narrative, per-item verdicts + the citation door.
    expect(await screen.findByTestId("exam-debrief")).toBeInTheDocument();
    expect(screen.getByText("1 correct · 1 skipped of 2")).toBeInTheDocument();
    expect(screen.getByTestId("exam-readiness").textContent).toMatch(/close/);
    expect(screen.getByText("Correct")).toBeInTheDocument();
    expect(screen.getByText("Skipped")).toBeInTheDocument();
    expect(screen.getByText(/variation from chance/)).toBeInTheDocument();
    // study citation rides as a clickable door (the chip opens the cited page).
    expect(screen.getByTestId("exam-citation")).toHaveTextContent(/study:.*p\. 12/);
  });
});
