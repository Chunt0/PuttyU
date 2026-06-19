import { test, expect, type Page } from "@playwright/test";

/**
 * Chat UX (legacy-parity pass): the tutor welcome on an empty session, markdown rendering
 * of streamed replies (tables + syntax-highlighted code), the code-block and per-message
 * copy buttons (real clipboard), and attachments (upload -> chip -> ids ride the send).
 */

const MD_REPLY =
  "## Solution\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n```python\nprint('hi')\n```";

async function mockBackend(page: Page, captured: { stream: string[] }) {
  let authed = false;
  const history: { role: string; content: string }[] = [];

  await page.route("**/api/auth/status", (r) => r.fulfill({ json: { authenticated: authed, username: authed ? "ada" : null, is_admin: true } }));
  await page.route("**/api/auth/login", (r) => { authed = true; return r.fulfill({ json: { ok: true, username: "ada" } }); });
  await page.route("**/api/sessions", (r) => r.fulfill({ json: [{ id: "s1", name: "Algebra", model: "m", rag: false, archived: false }] }));
  await page.route(/\/api\/history\/s1/, (r) => r.fulfill({ json: { history, model: "m", name: "Algebra" } }));

  await page.route("**/api/upload?**", (r) => r.fulfill({ json: {} })); // thumbnails
  await page.route("**/api/upload", (r) =>
    r.fulfill({ json: { files: [{ id: "f1", name: "worksheet.png", mime: "image/png", size: 10 }] } }),
  );

  await page.route("**/api/chat_stream", (r) => {
    captured.stream.push(r.request().postData() ?? "");
    history.push({ role: "user", content: "solve it" }, { role: "assistant", content: MD_REPLY });
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

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("welcome state, markdown reply, code + message copy", async ({ page }) => {
  const captured = { stream: [] as string[] };
  await mockBackend(page, captured);
  await login(page);

  // Login lands on the Dashboard (T5); open the chat from the sidebar.
  await page.getByRole("complementary").getByRole("button", { name: "Algebra", exact: true }).click();
  // Fresh session -> the tutor-framed welcome.
  await expect(page.getByText("What are we working on today?")).toBeVisible();

  await page.getByLabel("Message").fill("solve it");
  await page.getByRole("button", { name: "Send" }).click();

  // The reply renders as markdown: heading, GFM table, highlighted code block.
  await expect(page.getByRole("heading", { name: "Solution" })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  const code = page.locator(".codeblock");
  await expect(code).toContainText("print('hi')");
  await expect(page.getByText("What are we working on today?")).toBeHidden();

  // Code-block copy: hover reveals the button; clicking copies the code text.
  await code.hover();
  await code.getByRole("button", { name: "Copy code" }).click();
  await expect(code.getByText("Copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("print('hi')");

  // Per-message copy grabs the raw markdown, not the rendered HTML.
  const msg = page.locator(".msg--assistant").last();
  await msg.hover();
  await msg.getByRole("button", { name: "Copy message" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("## Solution");
});

test("attachments upload to chips and ride the send", async ({ page }) => {
  const captured = { stream: [] as string[] };
  await mockBackend(page, captured);
  await login(page);
  await page.getByRole("complementary").getByRole("button", { name: "Algebra", exact: true }).click();

  await page.getByLabel("Attach files").setInputFiles({
    name: "worksheet.png",
    mimeType: "image/png",
    buffer: Buffer.from("fake-png-bytes"),
  });

  // The chip appears once the upload resolves; it can be removed (but keep it).
  const chip = page.getByTestId("attachments");
  await expect(chip).toContainText("worksheet.png");

  await page.getByLabel("Message").fill("check my work");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("heading", { name: "Solution" })).toBeVisible();

  // The upload id was sent as the attachments form field.
  expect(captured.stream[0]).toContain('["f1"]');
  // Chips clear after a successful send.
  await expect(chip).toBeHidden();
});
