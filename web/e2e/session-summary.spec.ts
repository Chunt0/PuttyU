import { test, expect, type Page } from "@playwright/test";

/**
 * Phase-2 T5 vertical-4 / F9 "a session leaves a note behind" (ADR 0002 Gate 3): after a
 * substantive course chat the user clicks "Summarize" → the on-demand
 * POST /api/sessions/{id}/summary fires → on `ok` a success toast appears and the Notes
 * window opens (the deep-link; the note is edited there, no auto-modal — calm). The
 * `too_short` path returns nothing-written → info toast, Notes stays closed. Fully mocked.
 */

async function mockBackend(
  page: Page,
  summary: { status: "ok" | "too_short" },
  captured: { summaryPost: string | null; summaryCalls: number },
) {
  let authed = false;
  const history: { role: string; content: string }[] = [];

  await page.route("**/api/auth/status", (r) =>
    r.fulfill({ json: { authenticated: authed, username: authed ? "ada" : null, is_admin: true } }));
  await page.route("**/api/auth/login", (r) => { authed = true; return r.fulfill({ json: { ok: true, username: "ada" } }); });

  await page.route("**/api/courses**", (r) =>
    r.fulfill({ json: { courses: [{ id: "c1", name: "AP Statistics", status: "active", settings: {} }] } }));
  await page.route("**/api/courses/*/sources", (r) =>
    r.fulfill({ json: { course_id: "c1", source_ids: [] } }));
  await page.route("**/api/corpus/sources**", (r) => r.fulfill({ json: { sources: [] } }));
  await page.route("**/api/corpus/materials**", (r) => r.fulfill({ json: { sources: [] } }));

  const sessions: { id: string; name: string; model: string; course_id: string }[] = [];
  await page.route("**/api/sessions**", (r) => r.fulfill({ json: sessions }));
  await page.route("**/api/default-chat", (r) => r.fulfill({ json: {} }));
  await page.route("**/api/session", (r) => {
    const s = { id: "s1", name: "New chat", model: "m", course_id: "c1" };
    sessions.push(s);
    return r.fulfill({ json: s });
  });
  await page.route(/\/api\/history\/s1/, (r) =>
    r.fulfill({ json: { history, model: "m", name: "New chat", course_id: "c1" } }));

  await page.route("**/api/chat_stream", (r) => {
    history.push(
      { role: "user", content: "what's a sampling distribution?" },
      { role: "assistant", content: "The distribution of a statistic over repeated samples." },
    );
    return r.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        'data: {"delta":"The distribution of a statistic over repeated samples."}\n\n' +
        "data: [DONE]\n\n",
    });
  });

  // Notes list (the Notes window reads this when it opens).
  await page.route("**/api/notes**", (r) => r.fulfill({ json: { notes: [] } }));

  // The on-demand summary endpoint.
  await page.route("**/api/sessions/*/summary", (r) => {
    captured.summaryCalls += 1;
    captured.summaryPost = r.request().method();
    const json =
      summary.status === "ok"
        ? { status: "ok", note: { id: "n1", title: "Session summary — AP Statistics", content: "## Covered\n- sampling" } }
        : { status: "too_short" };
    return r.fulfill({ json });
  });
}

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill("ada");
  await page.getByLabel("Password").fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function startCourseChat(page: Page) {
  await page.getByRole("tab", { name: "AP Statistics" }).click();
  await page.getByRole("main").getByRole("button", { name: "+ New chat" }).click();
  await page.getByLabel("Message").fill("what's a sampling distribution?");
  await page.getByRole("button", { name: "Send" }).click();
  // Wait for the streamed reply so the session is substantive (button only shows then).
  await expect(page.getByText("The distribution of a statistic over repeated samples.")).toBeVisible();
}

test("summarize a session: POST fires, success toast, Notes opens", async ({ page }) => {
  const captured = { summaryPost: null as string | null, summaryCalls: 0 };
  await mockBackend(page, { status: "ok" }, captured);
  await login(page);
  await startCourseChat(page);

  await page.getByRole("button", { name: "Summarize" }).click();

  // The on-demand POST fired against the session-summary route.
  await expect.poll(() => captured.summaryCalls).toBeGreaterThanOrEqual(1);
  expect(captured.summaryPost).toBe("POST");

  // A success toast appears and the Notes window opens (deep-link, not an auto-modal).
  await expect(page.getByText(/saved a note from this session/i)).toBeVisible();
  await expect(page.getByTestId("window-notes")).toBeVisible();
});

test("too_short summary: info toast, Notes does NOT open", async ({ page }) => {
  const captured = { summaryPost: null as string | null, summaryCalls: 0 };
  await mockBackend(page, { status: "too_short" }, captured);
  await login(page);
  await startCourseChat(page);

  await page.getByRole("button", { name: "Summarize" }).click();

  await expect.poll(() => captured.summaryCalls).toBeGreaterThanOrEqual(1);
  await expect(page.getByText(/not much to summarize yet/i)).toBeVisible();
  await expect(page.getByTestId("window-notes")).toHaveCount(0);
});
