import { test, expect, type Page } from "@playwright/test";

/**
 * Phase-2 T6b / F4 flow (ADR 0002 Gate 3): the draw surface submits as an image through the
 * SAME path as a photo. Two doors:
 *  1. Inline (chat composer): Draw → sketch with the mouse → "Send to tutor" runs the
 *     CameraCapture door (canvas → PNG → File → upload) and the upload id rides the chat turn.
 *  2. Standalone (tool window): Draw → sketch → "Save to course materials" POSTs the PNG to
 *     /api/corpus/materials scoped to the active course. Backend fully mocked.
 */

const MD_REPLY = "Looks good.";

async function mockBackend(page: Page, captured: { stream: string[]; materials: string[] }) {
  let authed = false;
  const history: { role: string; content: string }[] = [];

  await page.route("**/api/auth/status", (r) =>
    r.fulfill({ json: { authenticated: authed, username: authed ? "ada" : null, is_admin: true } }));
  await page.route("**/api/auth/login", (r) => {
    authed = true;
    return r.fulfill({ json: { ok: true, username: "ada" } });
  });
  await page.route("**/api/sessions", (r) =>
    r.fulfill({ json: [{ id: "s1", name: "Algebra", model: "m", rag: false, archived: false }] }));
  await page.route(/\/api\/history\/s1/, (r) =>
    r.fulfill({ json: { history, model: "m", name: "Algebra" } }));
  await page.route("**/api/default-chat", (r) => r.fulfill({ json: {} }));
  await page.route("**/api/courses**", (r) =>
    r.fulfill({ json: { courses: [{ id: "c1", name: "AP Statistics", status: "active", settings: {} }] } }));
  await page.route("**/api/corpus/sources**", (r) => r.fulfill({ json: { sources: [] } }));

  // Thumbnails (GET) vs the upload POST.
  await page.route("**/api/upload?**", (r) => r.fulfill({ json: {} }));
  await page.route("**/api/upload", (r) =>
    r.fulfill({ json: { files: [{ id: "f1", name: "canvas-1.png", mime: "image/png", size: 12 }] } }));

  // Save-to-materials (standalone): capture the multipart body presence.
  await page.route("**/api/corpus/materials", (r) => {
    captured.materials.push(r.request().postData() ?? "");
    return r.fulfill({ json: { source_id: "m1", title: "canvas-1.png", chunk_count: 0, page_count: 1 } });
  });

  await page.route("**/api/chat_stream", (r) => {
    captured.stream.push(r.request().postData() ?? "");
    history.push({ role: "user", content: "check this" }, { role: "assistant", content: MD_REPLY });
    return r.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({ delta: MD_REPLY })}\n\ndata: [DONE]\n\n`,
    });
  });
}

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill("ada");
  await page.getByLabel("Password").fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Drag the mouse across the canvas surface to lay down a stroke (real Pointer Events). */
async function sketch(page: Page, surface: ReturnType<Page["getByTestId"]>) {
  const box = (await surface.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 90, { steps: 6 });
  await page.mouse.move(box.x + 200, box.y + 60, { steps: 6 });
  await page.mouse.up();
}

test("inline canvas: draw in the composer, send to tutor, the upload id rides the chat turn", async ({ page }) => {
  const captured = { stream: [] as string[], materials: [] as string[] };
  await mockBackend(page, captured);
  await login(page);

  // Open the chat session from the sidebar.
  await page.getByRole("complementary").getByRole("button", { name: "Algebra", exact: true }).click();

  // Open the inline draw panel and sketch.
  await page.getByRole("button", { name: "Draw" }).click();
  const surface = page.getByTestId("canvas-surface");
  await expect(surface).toBeVisible();
  await sketch(page, surface);

  // "Send to tutor" → the PNG uploads and becomes an attachment chip.
  await page.getByRole("button", { name: "Send to tutor" }).click();
  await expect(page.getByTestId("attachments")).toContainText("canvas-1.png");
  // The panel closed back to the idle button.
  await expect(page.getByRole("button", { name: "Draw" })).toBeVisible();

  // Send the turn — the upload id rides as the attachments field.
  await page.getByLabel("Message").fill("check this");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(MD_REPLY)).toBeVisible();
  expect(captured.stream[0]).toContain('["f1"]');
});

test("standalone canvas: draw in the tool window, save to course materials", async ({ page }) => {
  const captured = { stream: [] as string[], materials: [] as string[] };
  await mockBackend(page, captured);
  await login(page);

  // Activate the course, open the Canvas tool window.
  await page.getByRole("tab", { name: "AP Statistics" }).click();
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  const win = page.getByTestId("window-canvas");
  await expect(win).toBeVisible();

  // Open the surface and sketch.
  await win.getByRole("button", { name: "Draw" }).click();
  const surface = win.getByTestId("canvas-surface");
  await expect(surface).toBeVisible();
  await sketch(page, surface);

  // Standalone mode shows save-to-materials, not send-to-tutor.
  await expect(win.getByRole("button", { name: "Send to tutor" })).toHaveCount(0);
  await win.getByRole("button", { name: "Save to course materials" }).click();

  // The PNG POSTed to the materials endpoint (multipart with the file).
  await expect.poll(() => captured.materials.length).toBeGreaterThan(0);
});
