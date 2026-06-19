import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Review } from "./Review.tsx";
import { verdictDisplay, queueProgress, emptyLine, itemLabel } from "./review.model.ts";
import { useCourseStore } from "../courses/store.ts";
import { useWindowStore } from "../../app/windows/windowStore.ts";
import { renderWithProviders, jsonResponse, stubFetch, findCall } from "../../test/util.tsx";

/** Read a recorded openapi-fetch call's JSON body (the mock gets a Request object). */
async function requestJson(call: unknown[]): Promise<unknown> {
  return (call[0] as Request).clone().json();
}

const ITEM_1 = {
  item_key: "k1",
  concept_id: "n1",
  concept_name: "Sampling error",
  course_id: "c1",
  difficulty: 2,
  mode: "free",
  prompt: "Explain **sampling error** in one sentence.",
  source: "review",
  citation: null,
};
const ITEM_2 = {
  item_key: "k2",
  concept_id: "n2",
  concept_name: "Confidence intervals",
  course_id: "c1",
  difficulty: 3,
  mode: "free",
  prompt: "What does a 95% interval mean?",
  source: "review",
  citation: null,
};

const QUEUE_TWO = {
  count: 2,
  course_id: "c1",
  items: [ITEM_1, ITEM_2],
  due: [
    { concept_id: "n1", name: "Sampling error", state: "shaky", score: 0.8, heading_path: [], sources: [], course_id: "c1", effective_p: 0.3 },
    { concept_id: "n2", name: "Confidence intervals", state: "learning", score: 0.5, heading_path: [], sources: [], course_id: "c1", effective_p: 0.5 },
  ],
};

const QUEUE_EMPTY = {
  count: 0,
  course_id: "c1",
  items: [],
  due: [
    { concept_id: "n3", name: "Regression", state: "learning", score: 0.2, heading_path: [], sources: [], course_id: "c1", effective_p: 0.6 },
  ],
};

const ANSWER_CORRECT = {
  verdict: "correct",
  correct: true,
  feedback_short: "Right — error from chance, not bias.",
  concept_id: "n1",
  concept_name: "Sampling error",
  state: "learning",
  effective_p: 0.55,
  study_citation: {
    chunk_id: "ch1",
    source_id: "src1",
    title: "Stats Primer",
    heading: "Ch 1 > Sampling",
    page_start: 12,
    citation: "Stats Primer §Sampling · p. 12",
  },
};

const COURSES = { courses: [{ id: "c1", name: "AP Statistics", status: "active", settings: {} }] };

function mockReview(opts: { empty?: boolean } = {}) {
  return stubFetch([
    ["/api/practice/queue/answer", () => jsonResponse(ANSWER_CORRECT)],
    ["/api/practice/queue", () => jsonResponse(opts.empty ? QUEUE_EMPTY : QUEUE_TWO)],
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

describe("Review model helpers", () => {
  it("maps verdicts to a calm label + tone, never a grade", () => {
    expect(verdictDisplay("correct")).toEqual({ label: "Correct", tone: "correct" });
    expect(verdictDisplay("partial")).toEqual({ label: "Partly there", tone: "partial" });
    expect(verdictDisplay("incorrect")).toEqual({ label: "Not yet", tone: "incorrect" });
    expect(verdictDisplay("expired").tone).toBe("expired");
    // Unknown / null verdicts read as the neutral "ungraded" tone.
    expect(verdictDisplay("weird").tone).toBe("ungraded");
    expect(verdictDisplay(null).tone).toBe("ungraded");
  });

  it("renders a neutral position line (1-based), never a score", () => {
    expect(queueProgress(0, 6)).toBe("1 of 6");
    expect(queueProgress(2, 6)).toBe("3 of 6");
    // Never overruns the total.
    expect(queueProgress(9, 6)).toBe("6 of 6");
  });

  it("writes the calm empty line, pluralizing the waiting count", () => {
    expect(emptyLine(0)).toMatch(/Nothing due right now/);
    expect(emptyLine(1)).toBe("Nothing due right now — 1 item waiting when you're ready.");
    expect(emptyLine(3)).toBe("Nothing due right now — 3 items waiting when you're ready.");
  });

  it("scopes the item label by course when present", () => {
    expect(itemLabel("Sampling error", "AP Statistics")).toBe("AP Statistics · Sampling error");
    expect(itemLabel("Sampling error", null)).toBe("Sampling error");
  });
});

describe("Review", () => {
  it("gates on no active course", async () => {
    useCourseStore.setState({ activeCourseId: null, onboardingSkipped: false });
    mockReview();
    renderWithProviders(<Review />);
    expect(await screen.findByText(/Open a course tab/)).toBeInTheDocument();
  });

  it("works the first item: posts {item_key, answer_text}, renders the verdict + feedback + citation + state", async () => {
    const fetchMock = mockReview();
    renderWithProviders(<Review />);

    // Step one: the first prompt and the neutral position line.
    expect(await screen.findByText(/Explain/)).toBeInTheDocument();
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    expect(screen.getByText("AP Statistics · Sampling error")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Your answer"), "Variation from sampling chance.");
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() =>
      expect(findCall(fetchMock, "/api/practice/queue/answer", "POST")).toBeTruthy());
    const body = await requestJson(findCall(fetchMock, "/api/practice/queue/answer", "POST")!);
    expect(body).toMatchObject({ item_key: "k1", answer_text: "Variation from sampling chance." });

    // Calm verdict + feedback rendered.
    expect(await screen.findByText("Correct")).toBeInTheDocument();
    expect(screen.getByText(/error from chance/)).toBeInTheDocument();
    // study_citation rides as a clickable door.
    expect(screen.getByTestId("citations")).toBeInTheDocument();
    expect(screen.getByText(/Stats Primer/)).toBeInTheDocument();
    // Resulting mastery state chip.
    expect(screen.getByText("learning")).toHaveClass("state-chip--learning");
  });

  it("advances to the next item with Next", async () => {
    mockReview();
    renderWithProviders(<Review />);

    await userEvent.type(await screen.findByLabelText("Your answer"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByText("Correct");

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText(/95% interval/)).toBeInTheDocument();
    expect(screen.getByText("2 of 2")).toBeInTheDocument();
    // Last item: the advance control reads "Done", not "Next".
    await userEvent.type(screen.getByLabelText("Your answer"), "y");
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByText("Correct");
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("inserts a typed equation into the answer as delimited LaTeX (F4)", async () => {
    mockReview();
    renderWithProviders(<Review />);

    const textarea = await screen.findByLabelText("Your answer");
    await userEvent.type(textarea, "Mean is");

    await userEvent.click(screen.getByRole("button", { name: "Insert equation" }));
    // (userEvent.type treats {} as special keys — use brace-free LaTeX here.)
    await userEvent.type(screen.getByLabelText("LaTeX equation"), "x^2");
    await userEvent.click(screen.getByRole("button", { name: "Insert" }));

    expect(textarea).toHaveValue("Mean is $$x^2$$");
  });

  it("shows the calm empty state with the waiting count when the queue is empty", async () => {
    mockReview({ empty: true });
    renderWithProviders(<Review />);
    expect(
      await screen.findByText("Nothing due right now — 1 item waiting when you're ready."),
    ).toBeInTheDocument();
    // No prompt, no scoreboard.
    expect(screen.queryByLabelText("Your answer")).not.toBeInTheDocument();
  });
});
