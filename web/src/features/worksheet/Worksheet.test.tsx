import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Worksheet } from "./Worksheet.tsx";
import { useCourseStore } from "../courses/store.ts";
import { useWindowStore } from "../../app/windows/windowStore.ts";
import { renderWithProviders, jsonResponse, stubFetch, findCall } from "../../test/util.tsx";

/** Read a recorded openapi-fetch call's JSON body (the mock gets a Request object). */
async function requestJson(call: unknown[]): Promise<unknown> {
  return (call[0] as Request).clone().json();
}

const COURSES = { courses: [{ id: "c1", name: "AP Statistics", status: "active", settings: {} }] };

const UPLOAD = { files: [{ id: "f1", name: "worksheet.png", mime: "image/png", size: 10 }] };

const GRADE_TWO = {
  concepts_touched: ["Sampling error", "Confidence intervals"],
  problems: [
    {
      problem_label: "Problem 1",
      verdict: "correct",
      whats_right: "You set up the sampling distribution correctly.",
      first_error: "",
      nudge_question: "",
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
    },
    {
      problem_label: "Problem 2",
      verdict: "incorrect",
      whats_right: "Good — you remembered to use the t-distribution.",
      first_error: "The standard error uses n, not n minus 1, in the denominator here.",
      nudge_question: "Which n belongs under the square root for a sample mean?",
      concept_id: "n2",
      concept_name: "Confidence intervals",
      state: "shaky",
      effective_p: 0.3,
    },
  ],
};

function mockWorksheet(grade: unknown = GRADE_TWO) {
  return stubFetch([
    ["/api/practice/worksheet", () => jsonResponse(grade)],
    ["/api/upload", () => jsonResponse(UPLOAD)],
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

describe("Worksheet", () => {
  it("gates on no active course", async () => {
    useCourseStore.setState({ activeCourseId: null, onboardingSkipped: false });
    mockWorksheet();
    renderWithProviders(<Worksheet />);
    expect(await screen.findByText(/Open a course tab/)).toBeInTheDocument();
  });

  it("attaches a photo, checks the work, posts {course_id, attachment_ids, guide} and renders per-problem cards", async () => {
    const fetchMock = mockWorksheet();
    renderWithProviders(<Worksheet />);

    // "Check my work" is disabled until at least one attachment lands.
    const check = await screen.findByRole("button", { name: "Check my work" });
    expect(check).toBeDisabled();

    // Upload a photo via the hidden file input → a chip appears.
    const file = new File(["x"], "worksheet.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Upload photos"), file);
    expect(await screen.findByText("worksheet.png")).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Check my work" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Check my work" }));

    // The POST carried the typed body shape (guide defaults ON).
    await waitFor(() =>
      expect(findCall(fetchMock, "/api/practice/worksheet", "POST")).toBeTruthy());
    const body = await requestJson(findCall(fetchMock, "/api/practice/worksheet", "POST")!);
    expect(body).toMatchObject({ course_id: "c1", attachment_ids: ["f1"], guide: true });

    // Two per-problem cards render.
    expect(await screen.findAllByTestId("worksheet-problem")).toHaveLength(2);

    // Problem 1: calm verdict + what's right + the citation door.
    expect(screen.getByText("Correct")).toBeInTheDocument();
    expect(screen.getByText(/sampling distribution correctly/)).toBeInTheDocument();
    expect(screen.getByTestId("citations")).toBeInTheDocument();
    expect(screen.getByText(/Stats Primer/)).toBeInTheDocument();

    // Problem 2: the FIRST error + the nudge question (guide mode) + the mastery state.
    expect(screen.getByText("Not yet")).toBeInTheDocument();
    expect(screen.getByText(/n minus 1, in the denominator/)).toBeInTheDocument();
    expect(screen.getByText(/Which n belongs under the square root/)).toBeInTheDocument();
    expect(screen.getByText("shaky")).toHaveClass("state-chip--shaky");
  });

  it("withholds the nudge question when guide mode is off", async () => {
    mockWorksheet();
    renderWithProviders(<Worksheet />);

    const file = new File(["x"], "worksheet.png", { type: "image/png" });
    await userEvent.upload(await screen.findByLabelText("Upload photos"), file);
    await screen.findByText("worksheet.png");

    await userEvent.click(screen.getByLabelText(/Guide me/));
    await userEvent.click(screen.getByRole("button", { name: "Check my work" }));

    expect(await screen.findByText(/n minus 1, in the denominator/)).toBeInTheDocument();
    // Nudge questions are hidden once the student opted out of guide mode.
    expect(screen.queryByText(/Which n belongs under the square root/)).not.toBeInTheDocument();
  });

  it("shows the setup hint (and no problems) when no vision model is configured", async () => {
    mockWorksheet({
      concepts_touched: [],
      problems: [],
      setup_hint: "No vision model configured — add one in Providers to grade photos.",
    });
    renderWithProviders(<Worksheet />);

    const file = new File(["x"], "worksheet.png", { type: "image/png" });
    await userEvent.upload(await screen.findByLabelText("Upload photos"), file);
    await screen.findByText("worksheet.png");
    await userEvent.click(screen.getByRole("button", { name: "Check my work" }));

    expect(await screen.findByText(/No vision model configured/)).toBeInTheDocument();
    expect(screen.queryByTestId("worksheet-problem")).not.toBeInTheDocument();
  });

  it("lets the student check another worksheet after grading", async () => {
    mockWorksheet();
    renderWithProviders(<Worksheet />);

    const file = new File(["x"], "worksheet.png", { type: "image/png" });
    await userEvent.upload(await screen.findByLabelText("Upload photos"), file);
    await screen.findByText("worksheet.png");
    await userEvent.click(screen.getByRole("button", { name: "Check my work" }));
    await screen.findAllByTestId("worksheet-problem");

    await userEvent.click(screen.getByRole("button", { name: "Check another" }));
    // Back to the input surface; the prior attachment is cleared.
    expect(await screen.findByRole("button", { name: "Check my work" })).toBeDisabled();
    expect(screen.queryByText("worksheet.png")).not.toBeInTheDocument();
  });
});
