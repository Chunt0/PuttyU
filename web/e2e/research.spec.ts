import { test, expect, type Page } from "@playwright/test";

/**
 * Slice-5 flow (ADR 0002 Gate 3): login -> Research -> start a job -> watch the streamed
 * progress -> the HTML report renders. Backend mocked at the network boundary, including the
 * SSE progress stream (the real /api/research/stream shape) and the HTML report endpoint.
 */

async function mockBackend(page: Page) {
  let authed = false;

  await page.route("**/api/auth/status", (r) =>
    r.fulfill({ json: { authenticated: authed, username: authed ? "ada" : null, is_admin: true } }),
  );
  await page.route("**/api/auth/login", (r) => { authed = true; return r.fulfill({ json: { ok: true, username: "ada" } }); });
  await page.route("**/api/sessions", (r) => r.fulfill({ json: [] }));

  await page.route("**/api/research/library", (r) =>
    r.fulfill({ json: { research: [{ id: "rp-old", query: "what is variance", category: "", source_count: 4, status: "done", duration: "30s", rounds: 2, started_at: 1, completed_at: 2, archived: false }], total: 1 } }),
  );
  await page.route("**/api/research/start", (r) =>
    r.fulfill({ json: { session_id: "rp-new", status: "running", query: "compare SR algorithms" } }),
  );
  await page.route("**/api/research/stream/**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        'data: {"phase":"planning"}\n\n' +
        'data: {"phase":"searching","round":1}\n\n' +
        'data: {"phase":"writing"}\n\n' +
        'data: {"status":"done","final":true}\n\n',
    }),
  );
  await page.route("**/api/research/report/**", (r) =>
    r.fulfill({ status: 200, contentType: "text/html", body: "<html><body><h1>Research Report</h1></body></html>" }),
  );
}

test("run a research job and view the report", async ({ page }) => {
  await mockBackend(page);

  await page.goto("/");
  await page.getByLabel("Username").fill("ada");
  await page.getByLabel("Password").fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("button", { name: "Research", exact: true }).click();
  await expect(page.getByText("what is variance")).toBeVisible();

  await page.getByLabel("Research query").fill("compare SR algorithms");
  await page.getByRole("button", { name: "Start research" }).click();

  // Streamed progress renders, then the report iframe loads with its heading.
  await expect(page.getByText("Planning the research…")).toBeVisible();
  const report = page.frameLocator(".research-report-frame");
  await expect(report.getByRole("heading", { name: "Research Report" })).toBeVisible();
});
