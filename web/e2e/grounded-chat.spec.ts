import { test, expect, type Page } from "@playwright/test";

/**
 * Phase-2 T2b / F3 flow (ADR 0002 Gate 3): a chat inside a course streams a `citations`
 * control event before the tokens → grounding chips render for the turn → clicking a chip
 * opens the PDF viewer at the cited page ("citations are doors"). Also covers the F4
 * no-secure-context webcam scenario: without mediaDevices the composer shows the setup
 * hint, never a dead camera button.
 */

async function mockBackend(page: Page, captured: { chatPost: string | null }) {
  let authed = false;
  const history: { role: string; content: string }[] = [];

  await page.route("**/api/auth/status", (r) =>
    r.fulfill({ json: { authenticated: authed, username: authed ? "ada" : null, is_admin: true } }));
  await page.route("**/api/auth/login", (r) => { authed = true; return r.fulfill({ json: { ok: true, username: "ada" } }); });

  await page.route("**/api/courses**", (r) =>
    r.fulfill({ json: { courses: [{ id: "c1", name: "AP Statistics", status: "active", settings: {} }] } }));
  await page.route("**/api/courses/*/sources", (r) =>
    r.fulfill({ json: { course_id: "c1", source_ids: ["s1"] } }));
  await page.route("**/api/corpus/sources**", (r) => r.fulfill({ json: { sources: [] } }));
  await page.route("**/api/corpus/sources/*/pdf**", (r) =>
    r.fulfill({ status: 200, contentType: "application/pdf", body: "%PDF-1.4 fake" }));

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
    captured.chatPost = r.request().postData();
    history.push(
      { role: "user", content: "parameter vs statistic?" },
      { role: "assistant", content: "A parameter describes a population. [Intro Stats §1.1 Definitions, p. 9]" },
    );
    return r.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        'data: {"type":"citations","data":[{"chunk_id":"ch1","source_id":"s1","title":"Intro Stats","heading":"Ch 1 > 1.1 Definitions","page_start":9,"citation":"[Intro Stats §1.1 Definitions, p. 9]"}]}\n\n' +
        'data: {"delta":"A parameter describes a population. [Intro Stats §1.1 Definitions, p. 9]"}\n\n' +
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

test("course chat renders grounding chips; a chip opens the PDF at the cited page", async ({ page }) => {
  const captured = { chatPost: null as string | null };
  await mockBackend(page, captured);
  await login(page);

  // Into the course, start a chat, ask.
  await page.getByRole("tab", { name: "AP Statistics" }).click();
  await page.getByRole("main").getByRole("button", { name: "+ New chat" }).click();
  await page.getByLabel("Message").fill("parameter vs statistic?");
  await page.getByRole("button", { name: "Send" }).click();

  // Chips render for the grounded turn (compact, not a banner).
  await expect(page.getByText("grounded in 1 source")).toBeVisible();
  const chip = page.getByRole("button", { name: "Intro Stats §1.1 Definitions · p. 9" });
  await expect(chip).toBeVisible();

  // The send carried the course_id grounding fallback.
  expect(captured.chatPost).toContain('name="course_id"');
  expect(captured.chatPost).toContain("c1");

  // The chip is a door: the PDF viewer opens at the cited page.
  await chip.click();
  const pdfWin = page.getByTestId("window-pdf");
  await expect(pdfWin).toBeVisible();
  await expect(pdfWin.getByText("p. 9")).toBeVisible();
  await expect(pdfWin.locator("iframe")).toHaveAttribute("src", "/api/corpus/sources/s1/pdf#page=9");
});

test("no secure context: the composer shows the camera setup hint, not a dead button", async ({ page }) => {
  // Simulate an instance served over plain LAN HTTP (no camera API exposed).
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
  });
  const captured = { chatPost: null as string | null };
  await mockBackend(page, captured);
  await login(page);

  await page.getByRole("tab", { name: "AP Statistics" }).click();
  await page.getByRole("main").getByRole("button", { name: "+ New chat" }).click();
  await expect(page.getByLabel("Message")).toBeVisible();

  await expect(page.getByText(/camera needs HTTPS or localhost/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Take photo" })).toHaveCount(0);
});
