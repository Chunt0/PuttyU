import { test, expect, type Page } from "@playwright/test";

/**
 * Slice-6 flow (ADR 0002 Gate 3): login -> Tasks -> create a daily LLM task (it appears + run
 * it) AND a webhook task (its fire URL renders). Backend mocked at the network boundary; the
 * task store is stateful so created tasks persist into the refetched list.
 */

type T = { id: string; name: string; task_type: string; action: string | null; schedule: string | null; scheduled_time: string | null; scheduled_day: number | null; scheduled_date: string | null; cron_expression: string | null; trigger_type: string; trigger_event: string | null; trigger_count: number | null; next_run: string | null; last_run: string | null; status: string; output_target: string; run_count: number; webhook_token: string | null; is_builtin: boolean; prompt: string | null };

async function mockBackend(page: Page) {
  let authed = false;
  const tasks: T[] = [];

  await page.route("**/api/auth/status", (r) =>
    r.fulfill({ json: { authenticated: authed, username: authed ? "ada" : null, is_admin: true } }),
  );
  await page.route("**/api/auth/login", (r) => { authed = true; return r.fulfill({ json: { ok: true, username: "ada" } }); });
  await page.route("**/api/sessions", (r) => r.fulfill({ json: [] }));

  await page.route("**/api/tasks/meta/actions", (r) => r.fulfill({ json: { actions: [{ name: "tidy_sessions", description: "Tidy chats" }] } }));
  await page.route("**/api/tasks/meta/events", (r) => r.fulfill({ json: { events: [{ name: "memory_added", description: "Fires when a memory is added" }] } }));
  await page.route("**/api/tasks/meta/output-targets", (r) => r.fulfill({ json: { targets: [{ value: "session", label: "Session", description: "" }] } }));
  await page.route("**/api/tasks/*/run", (r) => r.fulfill({ json: { ok: true, message: "Task triggered" } }));
  await page.route("**/api/tasks", (r) => {
    if (r.request().method() === "POST") {
      const body = JSON.parse(r.request().postData() ?? "{}");
      const isWebhook = body.trigger_type === "webhook";
      const t: T = {
        id: `t${tasks.length + 1}`, name: body.prompt || "Untitled", task_type: body.task_type, action: null,
        schedule: body.schedule ?? null, scheduled_time: body.scheduled_time ?? null, scheduled_day: null, scheduled_date: null,
        cron_expression: null, trigger_type: body.trigger_type, trigger_event: body.trigger_event ?? null,
        trigger_count: body.trigger_count ?? null, next_run: isWebhook ? null : "2026-06-06T09:00:00Z",
        last_run: null, status: "active", output_target: body.output_target, run_count: 0,
        webhook_token: isWebhook ? "wh-secret-token" : null, is_builtin: false, prompt: body.prompt ?? null,
      };
      tasks.push(t);
      return r.fulfill({ json: t });
    }
    return r.fulfill({ json: { tasks } });
  });
}

test("create a scheduled task and run it", async ({ page }) => {
  await mockBackend(page);

  await page.goto("/");
  await page.getByLabel("Username").fill("ada");
  await page.getByLabel("Password").fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(page.getByText("No tasks yet — create one above.")).toBeVisible();

  // Create a daily LLM task (defaults: type=LLM, schedule=daily, time=09:00).
  await page.getByLabel("Prompt").fill("summarize the morning news");
  await page.getByRole("button", { name: "Create task" }).click();

  // It appears in the list with its schedule summary.
  await expect(page.getByText("summarize the morning news")).toBeVisible();
  await expect(page.getByText("daily at 09:00")).toBeVisible();

  // Run it now.
  await page.getByRole("button", { name: "Run summarize the morning news" }).click();
});

test("create a webhook-triggered task and see its fire URL", async ({ page }) => {
  await mockBackend(page);

  await page.goto("/");
  await page.getByLabel("Username").fill("ada");
  await page.getByLabel("Password").fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();

  await page.getByLabel("Prompt").fill("fire from CI");
  await page.getByLabel("Trigger").selectOption("webhook");
  await expect(page.getByText(/webhook URL is generated/i)).toBeVisible();
  await page.getByRole("button", { name: "Create task" }).click();

  // The task lists as webhook-triggered and shows its POST-to-fire URL.
  await expect(page.getByText("fire from CI")).toBeVisible();
  await expect(page.locator(".task-sched", { hasText: "via webhook" })).toBeVisible();
  await expect(page.getByText(/\/webhook\/wh-secret-token/)).toBeVisible();
});
