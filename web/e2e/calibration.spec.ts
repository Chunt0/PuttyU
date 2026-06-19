import { test, expect, type Page } from "@playwright/test";

/**
 * Phase-2 T4 / F1 (D8) flow (ADR 0002 Gate 3): open a course → Calibration → the
 * optional cold-start warm-up. Two terminal shapes covered: the happy walk (start →
 * answer → reach finish → calm summary in the 4-state vocabulary) and the no_region
 * path (an empty region returns status='no_region' → a friendly card, never a walk).
 * Backend fully mocked.
 */

type CalibFixture = {
  startStatus: string;
  startMessage: string | null;
  withItem: boolean;
};

async function mockBackend(
  page: Page,
  fixture: CalibFixture,
  captured: { startPost: string | null; answerPost: string | null; finishPost: string | null },
) {
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

  await page.route("**/api/practice/calibration/start", (r) => {
    captured.startPost = r.request().postData();
    return r.fulfill({ json: {
      status: fixture.startStatus,
      message: fixture.startMessage,
      session_key: fixture.withItem ? "cal1" : null,
      position: 0,
      total: 1,
      item: fixture.withItem
        ? {
            item_key: "ci1", concept_id: "n2", concept_name: "Sampling error", course_id: "c1",
            difficulty: 2, mode: "short", prompt: "Sketch what sampling error means to you.",
            source: "library", citation: null,
          }
        : null,
    } });
  });

  // One step, then done → the screen finishes the walk.
  await page.route("**/api/practice/calibration/answer", (r) => {
    captured.answerPost = r.request().postData();
    return r.fulfill({ json: {
      correct: true,
      verdict: "correct",
      feedback_short: "",
      done: true,
      next_item: null,
      position: 1,
      total: 1,
      concept_id: "n2",
      concept_name: "Sampling error",
      state: "learning",
      effective_p: null,
    } });
  });

  await page.route("**/api/practice/calibration/finish", (r) => {
    captured.finishPost = r.request().postData();
    return r.fulfill({ json: {
      calibrated: true,
      status: "done",
      message: "Got a starting read on AP Statistics.",
      states: [
        { concept_id: "n2", concept_name: "Sampling error", state: "learning", effective_p: 0.4 },
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

test("optional calibration warms up the graph", async ({ page }) => {
  const captured = { startPost: null as string | null, answerPost: null as string | null, finishPost: null as string | null };
  await mockBackend(page, { startStatus: "ready", startMessage: null, withItem: true }, captured);
  await login(page);

  await page.getByRole("tab", { name: "AP Statistics" }).click();
  await page.getByRole("button", { name: "Calibration", exact: true }).click();
  const win = page.getByTestId("window-calibration");

  // The intro card, then start the walk.
  await expect(win.getByText("Show me where you are.")).toBeVisible();
  await win.getByRole("button", { name: "Start warm-up" }).click();

  // The walk: one item with progress, answer it.
  await expect(win.getByText("Step 1 of 1")).toBeVisible();
  await win.getByLabel("Your answer").fill("It's the gap between a sample and the truth.");
  await win.getByRole("button", { name: "Submit" }).click();

  // The walk ends in a calm 4-state summary (no percentages ever).
  await expect(win.getByText("You're warmed up")).toBeVisible();
  await expect(win.getByText("Got a starting read on AP Statistics.")).toBeVisible();
  await expect(win.getByText("Sampling error")).toBeVisible();
  await expect(win.locator(".state-chip--learning")).toHaveText("learning");
  expect(await win.textContent()).not.toContain("%");

  // The walk's steps actually fired.
  expect(JSON.parse(captured.startPost ?? "{}").course_id).toBe("c1");
  expect(JSON.parse(captured.answerPost ?? "{}").session_key).toBe("cal1");
  expect(JSON.parse(captured.finishPost ?? "{}").session_key).toBe("cal1");
});

test("no library concepts: a friendly card, never a walk", async ({ page }) => {
  const captured = { startPost: null as string | null, answerPost: null as string | null, finishPost: null as string | null };
  await mockBackend(
    page,
    { startStatus: "no_region", startMessage: "No library concepts to calibrate yet — the graph warms up as you study.", withItem: false },
    captured,
  );
  await login(page);

  await page.getByRole("tab", { name: "AP Statistics" }).click();
  await page.getByRole("button", { name: "Calibration", exact: true }).click();
  const win = page.getByTestId("window-calibration");

  await win.getByRole("button", { name: "Start warm-up" }).click();

  // The friendly terminal card — no item, no progress line.
  await expect(win.getByText("No library concepts to calibrate yet — the graph warms up as you study.")).toBeVisible();
  await expect(win.getByText(/Step \d+ of \d+/)).toHaveCount(0);
  await expect(win.getByLabel("Your answer")).toHaveCount(0);
  // No walk fired beyond the start probe.
  expect(captured.answerPost).toBeNull();
});
