import { test, expect, type Page } from "@playwright/test";

/**
 * Phase-2 T4 / F8 flow (ADR 0002 Gate 3): open a course → Gym → "Coach's pick" mints
 * the shakiest item (no concept_id) → answer it correctly → the engine bumps the
 * difficulty and folds the running set tally, and the dial + summary UI adopt the
 * response. Backend fully mocked.
 */

async function mockBackend(page: Page, captured: { nextPost: string | null; answerPost: string | null }) {
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

  // The concept tree drives the gym's "drill one concept" picker.
  await page.route("**/api/graph/concepts**", (r) =>
    r.fulfill({ json: {
      course_id: "c1",
      concepts: [
        { id: "h1", name: "Ch 1 Sampling", state: "unknown", p_known: null, evidence_count: 0,
          children: [
            { id: "n2", name: "Sampling error", state: "shaky", p_known: null, evidence_count: 3, children: [] },
          ] },
      ],
    } }));

  // Coach's pick: mint an item at the seed difficulty.
  await page.route("**/api/practice/gym/next", (r) => {
    captured.nextPost = r.request().postData();
    return r.fulfill({ json: {
      difficulty: 2,
      item: {
        item_key: "g1", concept_id: "n2", concept_name: "Sampling error", course_id: "c1",
        difficulty: 2, mode: "short", prompt: "Why does a larger sample shrink sampling error?",
        source: "library", citation: null,
      },
      message: null,
    } });
  });

  // Answer correctly: the engine bumps difficulty to 3 and folds the set tally.
  await page.route("**/api/practice/gym/answer", (r) => {
    captured.answerPost = r.request().postData();
    return r.fulfill({ json: {
      correct: true,
      verdict: "correct",
      feedback_short: "Yes — more draws average out the noise.",
      difficulty: 3,
      concept_id: "n2",
      concept_name: "Sampling error",
      state: "learning",
      effective_p: null,
      study_citation: null,
      summary: { attempted: 1, correct: 1, difficulty: 3, streak: 1 },
    } });
  });
}

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill("ada");
  await page.getByLabel("Password").fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("train the weakness: coach's pick, answer, difficulty adapts", async ({ page }) => {
  const captured = { nextPost: null as string | null, answerPost: null as string | null };
  await mockBackend(page, captured);
  await login(page);

  // Into the course, open the Gym tool window.
  await page.getByRole("tab", { name: "AP Statistics" }).click();
  await page.getByRole("button", { name: "Gym", exact: true }).click();
  const win = page.getByTestId("window-gym");

  // Coach's pick mints an item (no concept_id → the shakiest with errors).
  await win.getByRole("button", { name: "Coach's pick" }).click();
  await expect(win.getByText("Why does a larger sample shrink sampling error?")).toBeVisible();
  expect(JSON.parse(captured.nextPost ?? "{}").concept_id).toBeUndefined();

  // The dial opens at the seed rung (a word, never a raw probability).
  await expect(win.getByTestId("gym-difficulty")).toHaveText("level 2 of 5 · easier");

  // Answer it correctly.
  await win.getByLabel("Your answer").fill("More observations average out the random noise.");
  await win.getByRole("button", { name: "Check" }).click();

  // The verdict reads calm, and the dial + summary adopt the engine's response.
  await expect(win.getByTestId("gym-verdict")).toContainText("Got it");
  await expect(win.getByTestId("gym-difficulty")).toHaveText("level 3 of 5 · steady");
  await expect(win.getByTestId("gym-summary")).toHaveText("1 right of 1 · level 3");

  // The answer carried the item key + the running difficulty.
  const body = JSON.parse(captured.answerPost ?? "{}");
  expect(body.item_key).toBe("g1");
  expect(body.answer_text).toBe("More observations average out the random noise.");
});
