import { test, expect, type Page } from "@playwright/test";

/**
 * Phase-2 T4 / F8 flow (ADR 0002 Gate 3): open a course → Exam → start a timed,
 * SILENT sitting (no per-item grading mid-exam) → answer every item → submit grades
 * the whole paper at once and reveals the debrief (verdicts + readiness). Backend
 * fully mocked.
 */

async function mockBackend(page: Page, captured: { submitPost: string | null }) {
  let authed = false;

  await page.route("**/api/auth/status", (r) =>
    r.fulfill({ json: { authenticated: authed, username: authed ? "ada" : null, is_admin: true } }));
  await page.route("**/api/auth/login", (r) => {
    authed = true;
    return r.fulfill({ json: { ok: true, username: "ada" } });
  });
  await page.route("**/api/sessions**", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/default-chat", (r) => r.fulfill({ json: {} }));
  await page.route("**/api/courses**", (r) =>
    r.fulfill({ json: { courses: [{ id: "c1", name: "AP Statistics", status: "active", settings: {} }] } }));
  await page.route("**/api/courses/*/sources", (r) =>
    r.fulfill({ json: { course_id: "c1", source_ids: ["s1"] } }));
  await page.route("**/api/corpus/sources**", (r) => r.fulfill({ json: { sources: [] } }));
  await page.route("**/api/corpus/materials**", (r) => r.fulfill({ json: { sources: [] } }));

  // Start: two items, a long enough duration that the clock won't auto-submit on us.
  await page.route("**/api/practice/exam/start", (r) =>
    r.fulfill({ json: {
      exam_key: "ex1",
      duration_seconds: 1800,
      started_at: new Date().toISOString(),
      message: null,
      items: [
        { item_key: "q1", concept_id: "n1", concept_name: "Populations", prompt: "Define a population parameter.", citation: null },
        { item_key: "q2", concept_id: "n2", concept_name: "Sampling error", prompt: "What drives sampling error down?", citation: null },
      ],
    } }));

  // Submit: grade the whole paper at once, return a calm debrief.
  await page.route("**/api/practice/exam/submit", (r) => {
    captured.submitPost = r.request().postData();
    return r.fulfill({ json: {
      total: 2,
      correct: 1,
      partial: 1,
      incorrect: 0,
      skipped: 0,
      readiness: "You're close — sampling error needs one more pass.",
      verdicts: [
        { item_key: "q1", concept_id: "n1", concept_name: "Populations", correct: true,
          verdict: "correct", feedback_short: "Right.", prompt: "Define a population parameter.",
          state: "mastered", effective_p: null, citation: null },
        { item_key: "q2", concept_id: "n2", concept_name: "Sampling error", correct: false,
          verdict: "partial", feedback_short: "Partly — name the sample-size effect.",
          prompt: "What drives sampling error down?", state: "shaky", effective_p: null,
          citation: {
            chunk_id: "ch1", source_id: "s1", title: "Intro Stats",
            heading: "Ch 1 > 1.2 Sampling", page_start: 14,
            citation: "[Intro Stats §1.2 Sampling, p. 14]",
          } },
      ],
    } });
  });
}

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill("ada");
  await page.getByLabel("Password").fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("exam simulation: timed, silent, then debrief", async ({ page }) => {
  const captured = { submitPost: null as string | null };
  await mockBackend(page, captured);
  await login(page);

  // Into the course, open the Exam tool window, start the sitting.
  await page.getByRole("tab", { name: "AP Statistics" }).click();
  await page.getByRole("button", { name: "Exam", exact: true }).click();
  const win = page.getByTestId("window-exam");

  await win.getByRole("button", { name: "Start exam" }).click();

  // We're under test conditions: a clock runs, both prompts show, and NO verdict
  // surfaces mid-exam.
  await expect(win.getByTestId("exam-clock")).toBeVisible();
  await expect(win.getByText("Define a population parameter.")).toBeVisible();
  await expect(win.getByTestId("exam-verdict")).toHaveCount(0);
  await expect(win.getByTestId("exam-debrief")).toHaveCount(0);

  // Answer every item, then submit.
  await win.getByLabel("Answer for question 1").fill("A numeric summary of the whole population.");
  await win.getByLabel("Answer for question 2").fill("More observations.");
  await win.getByRole("button", { name: "Submit exam" }).click();

  // The debrief grades the whole paper at once: bucket summary, readiness, per-item verdicts.
  const debrief = win.getByTestId("exam-debrief");
  await expect(debrief).toBeVisible();
  await expect(debrief.getByText("1 correct · 1 partial of 2")).toBeVisible();
  await expect(win.getByTestId("exam-readiness")).toContainText("sampling error needs one more pass");
  await expect(win.getByTestId("exam-verdict")).toHaveCount(2);
  await expect(win.getByTestId("exam-citation")).toBeVisible();

  // The submit carried both answers under the exam key.
  const body = JSON.parse(captured.submitPost ?? "{}");
  expect(body.exam_key).toBe("ex1");
  expect(body.answers).toHaveLength(2);
});
