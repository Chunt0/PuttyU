import { test, expect, type Page } from "@playwright/test";

/**
 * Slice-4 flow (ADR 0002 Gate 3): login -> turn on Agent mode -> send -> the agent stream's
 * tool steps (tool_start/tool_output) render inline, then the final answer. Backend + LLM
 * are mocked at the network boundary; the chat_stream handler emits the real agent SSE shape
 * (confirmed against src/agent_loop.py).
 */

async function mockBackend(page: Page) {
  let authed = false;
  const history: { role: string; content: string }[] = [];

  await page.route("**/api/auth/status", (r) =>
    r.fulfill({ json: { authenticated: authed, username: authed ? "ada" : null, is_admin: true } }),
  );
  await page.route("**/api/auth/login", (r) => { authed = true; return r.fulfill({ json: { ok: true, username: "ada" } }); });
  await page.route("**/api/sessions", (r) => r.fulfill({ json: [{ id: "s1", name: "Agent chat", model: "m", rag: false, archived: false }] }));
  await page.route(/\/api\/history\/s1/, (r) => r.fulfill({ json: { history, model: "m", name: "Agent chat" } }));

  await page.route("**/api/chat_stream", (r) => {
    history.push({ role: "user", content: "list root" }, { role: "assistant", content: "Done — listed /." });
    return r.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        'data: {"type":"tool_start","tool":"bash","command":"ls /","round":1}\n\n' +
        'data: {"type":"tool_output","tool":"bash","command":"ls /","output":"etc\\nvar\\nhome","exit_code":0,"round":1}\n\n' +
        'data: {"delta":"Done — listed /."}\n\n' +
        "data: [DONE]\n\n",
    });
  });
}

test("run an agent turn and see tool steps", async ({ page }) => {
  await mockBackend(page);

  await page.goto("/");
  await page.getByLabel("Username").fill("ada");
  await page.getByLabel("Password").fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();

  // Login lands on the Dashboard (T5); open the chat, then turn on agent mode and send.
  await page.getByRole("complementary").getByRole("button", { name: "Agent chat", exact: true }).click();
  await page.getByLabel("Agent mode").check();
  await page.getByLabel("Message").fill("list root");
  await page.getByRole("button", { name: "Send" }).click();

  // The tool step renders (name, command, output) and the final answer arrives.
  await expect(page.getByText("bash")).toBeVisible();
  await expect(page.getByText("ls /")).toBeVisible();
  await expect(page.getByText(/etc/)).toBeVisible();
  await expect(page.getByText("Done — listed /.")).toBeVisible();
});
