import { test, expect, type Page } from "@playwright/test";

/**
 * Phase-2 T4 / F8 flow (ADR 0002 Gate 3): open a course → Review → the spaced-review
 * queue renders one item at a time → type an answer, submit → the calm verdict +
 * feedback render, the study citation appears as a door, and the POSTed body carries
 * item_key + answer_text. Backend fully mocked.
 */

async function mockBackend(page: Page, captured: { answerPost: string | null }) {
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

  // The review queue: two items, worked one at a time.
  await page.route("**/api/practice/queue**", (r) =>
    r.fulfill({ json: {
      count: 2,
      course_id: "c1",
      due: [
        { concept_id: "n2", course_id: "c1", name: "Sampling error", state: "shaky",
          heading_path: ["Ch 1", "Sampling error"], score: 1, sources: ["s1"], effective_p: null },
      ],
      items: [
        { item_key: "it1", concept_id: "n2", concept_name: "Sampling error", course_id: "c1",
          difficulty: 2, mode: "short", prompt: "Define sampling error in one sentence.",
          source: "library", citation: null },
        { item_key: "it2", concept_id: "n1", concept_name: "Populations", course_id: "c1",
          difficulty: 2, mode: "short", prompt: "What is a population parameter?",
          source: "library", citation: null },
      ],
    } }));

  // Grading: capture the body, return a calm verdict with a study citation door.
  await page.route("**/api/practice/queue/answer", (r) => {
    captured.answerPost = r.request().postData();
    return r.fulfill({ json: {
      correct: true,
      verdict: "correct",
      feedback_short: "Right — the variability from drawing a sample, not the whole population.",
      concept_id: "n2",
      concept_name: "Sampling error",
      state: "mastered",
      effective_p: null,
      study_citation: {
        chunk_id: "ch1", source_id: "s1", title: "Intro Stats",
        heading: "Ch 1 > 1.2 Sampling", page_start: 14,
        citation: "[Intro Stats §1.2 Sampling, p. 14]",
      },
    } });
  });
}

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill("ada");
  await page.getByLabel("Password").fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("the user works the queue: answer an item, see the verdict and citation", async ({ page }) => {
  const captured = { answerPost: null as string | null };
  await mockBackend(page, captured);
  await login(page);

  // Into the course, then open the Review tool window.
  await page.getByRole("tab", { name: "AP Statistics" }).click();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  const win = page.getByTestId("window-review");

  // The first queued item renders, one at a time, with a neutral position line.
  await expect(win.getByText("1 of 2")).toBeVisible();
  await expect(win.getByText("Define sampling error in one sentence.")).toBeVisible();

  // Answer it and submit.
  await win.getByLabel("Your answer").fill("Variation between a sample statistic and the true parameter.");
  await win.getByRole("button", { name: "Submit" }).click();

  // The calm verdict + feedback render, and the study citation appears as a door.
  await expect(win.getByText("Correct")).toBeVisible();
  await expect(
    win.getByText("Right — the variability from drawing a sample, not the whole population."),
  ).toBeVisible();
  await expect(win.getByTestId("citations")).toBeVisible();
  await expect(win.getByRole("button", { name: "Intro Stats §1.2 Sampling · p. 14" })).toBeVisible();

  // The POSTed body carried item_key + the typed answer_text.
  const body = JSON.parse(captured.answerPost ?? "{}");
  expect(body.item_key).toBe("it1");
  expect(body.answer_text).toBe("Variation between a sample statistic and the true parameter.");
});
