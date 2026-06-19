import { test, expect, type Page } from "@playwright/test";

/**
 * Phase-2 T4 / F8 "Explain it back" flow (ADR 0002 Gate 3): open a course → Explain →
 * pick a concept → the explain/start POST fires, an explain-mode session opens, and the
 * conversation surface renders with the tutor's opening prompt + a composer → typing a
 * turn streams a reply through the same chat door (/api/chat_stream). Backend fully mocked.
 */

async function mockBackend(
  page: Page,
  captured: { explainPost: string | null; chatPost: string | null },
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

  // The concept tree drives the Explain picker.
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

  // Opening an explain session returns the session id + the tutor's opening line.
  await page.route("**/api/practice/explain/start", (r) => {
    captured.explainPost = r.request().postData();
    return r.fulfill({ json: {
      session_id: "ex-sess-1",
      concept_id: "n2",
      concept_name: "Sampling error",
      message: "Teach me sampling error in your own words — I'm listening.",
    } });
  });

  // The conversation rides the same chat door as the main chat.
  await page.route("**/api/chat_stream", (r) => {
    captured.chatPost = r.request().postData();
    return r.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        'data: {"delta":"So when the sample grows, what happens to the error?"}\n\n' +
        "data: [DONE]\n\n",
    });
  });
}

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill("ada");
  await page.getByLabel("Password").fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("explain it back: pick a concept, the session opens", async ({ page }) => {
  const captured = { explainPost: null as string | null, chatPost: null as string | null };
  await mockBackend(page, captured);
  await login(page);

  // Into the course, open the Explain tool window.
  await page.getByRole("tab", { name: "AP Statistics" }).click();
  await page.getByRole("button", { name: "Explain", exact: true }).click();
  const win = page.getByTestId("window-explain");

  // Pick a concept to teach back: the explain/start POST fires.
  await win.getByLabel("Concept to explain").selectOption({ label: "Sampling error" });
  await expect.poll(() => captured.explainPost).not.toBeNull();
  expect(JSON.parse(captured.explainPost ?? "{}")).toEqual({ course_id: "c1", concept_id: "n2" });

  // The conversation surface opens, bound to the concept, with the opening prompt.
  await expect(win.locator(".explain-concept-name")).toHaveText("Sampling error");
  const transcript = win.getByTestId("explain-transcript");
  await expect(transcript).toBeVisible();
  await expect(transcript.getByText("Teach me sampling error in your own words — I'm listening.")).toBeVisible();

  // The composer is present; a turn can be typed and streams a reply via /api/chat_stream.
  const composer = win.getByLabel("Your explanation");
  await expect(composer).toBeVisible();
  await composer.fill("It's the variability you get from only looking at a sample.");
  await win.getByRole("button", { name: "Send" }).click();

  await expect(transcript.getByText("It's the variability you get from only looking at a sample.")).toBeVisible();
  await expect(transcript.getByText("So when the sample grows, what happens to the error?")).toBeVisible();

  // The turn rode the chat door bound to the explain session + the course.
  expect(captured.chatPost).toContain('name="session"');
  expect(captured.chatPost).toContain("ex-sess-1");
  expect(captured.chatPost).toContain("c1");
});
