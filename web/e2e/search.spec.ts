import { test, expect, type Page } from "@playwright/test";

/**
 * Phase-2 T5 vertical-5 / F11 flow (ADR 0002 Gate 3): after login, Ctrl+K opens the global
 * search palette → typing a query lists grouped results from a stubbed /api/cmdk → picking a
 * material result opens the PDF viewer (a deep-link door), a course result activates its tab,
 * and Escape closes the palette. Backend fully mocked.
 */

async function mockBackend(page: Page) {
  let authed = false;

  await page.route("**/api/auth/status", (r) =>
    r.fulfill({ json: { authenticated: authed, username: authed ? "ada" : null, is_admin: true } }));
  await page.route("**/api/auth/login", (r) => {
    authed = true;
    return r.fulfill({ json: { ok: true, username: "ada" } });
  });

  await page.route("**/api/sessions**", (r) =>
    r.fulfill({ json: [
      { id: "s1", name: "Sampling chat", model: "m", course_id: "c1", last_message_at: "2026-06-19T09:00:00", archived: false, rag: false },
    ] }));
  await page.route("**/api/default-chat", (r) => r.fulfill({ json: {} }));
  await page.route("**/api/courses**", (r) =>
    r.fulfill({ json: { courses: [{ id: "c1", name: "AP Statistics", status: "active", settings: {} }] } }));
  await page.route("**/api/courses/*/sources", (r) =>
    r.fulfill({ json: { course_id: "c1", source_ids: ["src1"] } }));
  await page.route("**/api/calendar/events**", (r) => r.fulfill({ json: { events: [] } }));
  await page.route("**/api/dashboard**", (r) =>
    r.fulfill({ json: { review_count: 0, weak_spots: [], insights: [], reading: [] } }));
  await page.route("**/api/todos**", (r) => r.fulfill({ json: { todos: [] } }));

  // The PDF viewer's source-detail call (so the opened window can render past its loader).
  await page.route("**/api/corpus/sources/src1**", (r) =>
    r.fulfill({ json: { id: "src1", title: "Stats Primer", subject: "stats", authors: [], pages: 200, toc: [] } }));
  await page.route("**/api/corpus/sources/src1/file**", (r) =>
    r.fulfill({ status: 200, contentType: "application/pdf", body: "%PDF-1.4" }));

  // The palette search itself: grouped flat results across kinds.
  await page.route("**/api/cmdk**", (r) =>
    r.fulfill({ json: {
      query: "sa",
      results: [
        { kind: "course", id: "c1", title: "AP Statistics" },
        { kind: "material", id: "src1", source_id: "src1", title: "Stats Primer", subtitle: "intro", page: 12 },
        { kind: "concept", id: "n1", title: "Sampling error", subtitle: "Stats > Sampling", course_id: "c1" },
      ],
    } }));
}

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill("ada");
  await page.getByLabel("Password").fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("F11: Ctrl+K opens the palette; a query lists grouped results; a material opens the PDF; Esc closes", async ({ page }) => {
  await mockBackend(page);
  await login(page);

  // The app is up (the dashboard landed) before we reach for the global shortcut.
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  // Ctrl+K opens the modal dialog.
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Search" });
  await expect(dialog).toBeVisible();

  // Typing a query lists grouped results from the stubbed /api/cmdk.
  await dialog.getByLabel("Search query").fill("sa");
  await expect(dialog.getByText("Courses")).toBeVisible();
  await expect(dialog.getByText("Materials")).toBeVisible();
  await expect(dialog.getByText("Stats Primer")).toBeVisible();

  // Picking the material result opens the PDF viewer window and closes the palette.
  await dialog.getByText("Stats Primer").click();
  await expect(page.getByRole("dialog", { name: "Search" })).toHaveCount(0);
  await expect(page.getByTestId("window-pdf")).toBeVisible();

  // Reopen → Escape closes without dispatching.
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Search" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Search" })).toHaveCount(0);
});
