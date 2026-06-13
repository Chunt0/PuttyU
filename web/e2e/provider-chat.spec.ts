import { test, expect, type Page } from "@playwright/test";

/**
 * Slice-2 flow (ADR 0002 Gate 3): login -> add a provider -> pick the default model ->
 * start a new chat -> send -> see the streamed reply. The backend + LLM are mocked at the
 * network boundary with stateful handlers (adding an endpoint, setting the default, and
 * creating a session against that default all persist within the run).
 */

const MODELS = {
  hosts: [],
  items: [
    {
      endpoint_id: "ep1", endpoint_name: "Local", url: "http://localhost:11434/v1/chat",
      models: ["llama3"], models_display: ["llama3"], category: "local",
      endpoint_kind: "local", model_type: "llm",
    },
  ],
};

async function mockBackend(page: Page) {
  let authed = false;
  const endpoints: unknown[] = [];
  const sessions: { id: string; name: string; model: string }[] = [];
  const def = { endpoint_id: "", endpoint_url: "", model: "" };

  await page.route("**/api/auth/status", (r) =>
    r.fulfill({ json: { authenticated: authed, username: authed ? "ada" : null, is_admin: false } }),
  );
  await page.route("**/api/auth/login", (r) => { authed = true; return r.fulfill({ json: { ok: true, username: "ada" } }); });

  await page.route("**/api/model-endpoints", (r) => {
    if (r.request().method() === "POST") {
      const ep = { id: "ep1", name: "Local", base_url: "http://localhost:11434", has_key: false, is_enabled: true, models: ["llama3"], pinned_models: [], hidden_count: 0, online: true, status: "online", ping_error: null, model_type: "llm", supports_tools: true, endpoint_kind: "local", category: "local" };
      endpoints.push(ep);
      return r.fulfill({ json: ep });
    }
    return r.fulfill({ json: endpoints });
  });
  await page.route("**/api/models**", (r) => r.fulfill({ json: MODELS }));
  await page.route("**/api/default-chat", (r) => r.fulfill({ json: def }));
  await page.route(/\/api\/prefs\/default_endpoint_id/, async (r) => {
    def.endpoint_id = JSON.parse(r.request().postData() ?? "{}").value;
    def.endpoint_url = MODELS.items[0].url;
    return r.fulfill({ json: { key: "default_endpoint_id", value: def.endpoint_id } });
  });
  await page.route(/\/api\/prefs\/default_model/, async (r) => {
    def.model = JSON.parse(r.request().postData() ?? "{}").value;
    return r.fulfill({ json: { key: "default_model", value: def.model } });
  });

  // Router settings (F7) — the Providers screen now hosts the Routing section.
  const routerCfg: { policy: string; configured: boolean; pins: Record<string, unknown>; capabilities: Record<string, unknown> } =
    { policy: "local_first", configured: false, pins: {}, capabilities: {} };
  await page.route("**/api/router/config", (r) => {
    if (r.request().method() === "PUT") {
      Object.assign(routerCfg, JSON.parse(r.request().postData() ?? "{}"), { configured: true });
    }
    return r.fulfill({ json: routerCfg });
  });
  await page.route("**/api/router/resolution", (r) =>
    r.fulfill({
      json: {
        policy: routerCfg.policy,
        configured: routerCfg.configured,
        rows: [
          { tier: "micro", modality: "text", endpoint_id: "ep1", model: "llama3", token_budget: 2048, why: "policy=local_first: tier 'micro' -> 'ep1' (reasoning=standard, local)", degraded: false },
          { tier: "standard", modality: "vision", error: "No vision-capable model is configured." },
        ],
      },
    }));
  await page.route("**/api/router/log**", (r) =>
    r.fulfill({ json: { entries: [{ ts: 1760000000, endpoint_id: "ep1", model: "llama3", why: "policy=local_first: tier 'standard' -> 'ep1'", profile: { tier: "standard" } }] } }));

  await page.route("**/api/sessions", (r) => r.fulfill({ json: sessions }));
  await page.route("**/api/session", (r) => {
    const s = { id: "s1", name: "New chat", model: def.model, rag: false, archived: false };
    sessions.push(s);
    return r.fulfill({ json: s });
  });
  // History is stateful: the chat_stream handler "saves" the turn (as the real backend
  // does — it emits message_saved), so the reply persists after the stream completes and
  // Chat refetches history. Without this the optimistic reply vanishes the moment the
  // stream ends and the assertion races it.
  const history: { role: string; content: string }[] = [];
  await page.route(/\/api\/history\/s1/, (r) =>
    r.fulfill({ json: { history, model: def.model, name: "New chat" } }),
  );
  await page.route("**/api/chat_stream", (r) => {
    history.push({ role: "user", content: "hi" }, { role: "assistant", content: "Hello from llama3" });
    return r.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'data: {"delta":"Hello from "}\n\ndata: {"delta":"llama3"}\n\ndata: [DONE]\n\n',
    });
  });
}

test("configure a provider, pick a model, and chat", async ({ page }) => {
  await mockBackend(page);

  await page.goto("/");
  await page.getByLabel("Username").fill("ada");
  await page.getByLabel("Password").fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();

  // Go to Providers, add an endpoint, pick the default model.
  await page.getByRole("button", { name: "Providers", exact: true }).click();
  await page.getByLabel("Base URL").fill("http://localhost:11434");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  // The endpoint row appears (its Disable toggle is unique to a listed, enabled endpoint).
  await expect(page.getByRole("button", { name: "Disable" })).toBeVisible();
  await page.getByLabel("Default chat model").selectOption("ep1|llama3");

  // Start a new chat (created against the default) and send a message.
  await page.getByRole("button", { name: "+ New chat" }).click();
  await page.getByLabel("Message").fill("hi");
  await page.getByRole("button", { name: "Send" }).click();

  // The streamed reply renders in the transcript.
  await expect(page.getByText("Hello from llama3")).toBeVisible();
});

test("routing settings: live resolution table, policy dial, pin a tier", async ({ page }) => {
  await mockBackend(page);

  await page.goto("/");
  await page.getByLabel("Username").fill("ada");
  await page.getByLabel("Password").fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("button", { name: "Providers", exact: true }).click();
  const win = page.getByTestId("window-models");

  // Observability: the live tier→model table including the vision setup hint.
  await expect(win.getByText("Live resolution")).toBeVisible();
  await expect(win.getByText(/tier 'micro' -> 'ep1'/)).toBeVisible();
  await expect(win.getByText("No vision-capable model is configured.")).toBeVisible();
  // ...and the recent-decisions log.
  await expect(win.getByText(/tier 'standard' -> 'ep1'/)).toBeVisible();

  // Policy dial: flip to quality-first; the PUT round-trips and the radio sticks.
  await win.getByLabel(/quality-first/).click();
  await expect(win.getByLabel(/quality-first/)).toBeChecked();

  // Pin a tier to a model (choices come from the configured providers).
  await win.getByLabel("Pin for deep").selectOption("ep1|llama3");
  await expect(win.getByLabel("Pin for deep")).toHaveValue("ep1|llama3");
});
