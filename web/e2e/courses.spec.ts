import { test, expect, type Page } from "@playwright/test";

/**
 * Phase-2 T1 / F1 flow (ADR 0002 Gate 3): first login lands on course onboarding →
 * create a course → its tab appears with the honest no-sources chip → a chat created
 * inside the course carries course_id → archive hides the tab → unarchive restores it.
 * Backend fully mocked; the course/session stores are stateful.
 */

type C = { id: string; name: string; status: string; settings: Record<string, never> };
type S = { id: string; name: string; model: string; course_id: string | null };

async function mockBackend(page: Page, captured: { sessionPost: string | null }) {
  let authed = false;
  const courses: C[] = [];
  const sessions: S[] = [];

  await page.route("**/api/auth/status", (r) =>
    r.fulfill({ json: { authenticated: authed, username: authed ? "ada" : null, is_admin: true } }));
  await page.route("**/api/auth/login", (r) => {
    authed = true;
    return r.fulfill({ json: { ok: true, username: "ada" } });
  });

  await page.route("**/api/sessions**", (r) => {
    const url = new URL(r.request().url());
    const cid = url.searchParams.get("course_id");
    return r.fulfill({ json: cid ? sessions.filter((s) => s.course_id === cid) : sessions });
  });
  await page.route("**/api/default-chat", (r) => r.fulfill({ json: {} }));
  await page.route("**/api/session", (r) => {
    captured.sessionPost = r.request().postData();
    const cid = /name="course_id"\r\n\r\n([^\r]+)/.exec(captured.sessionPost ?? "")?.[1] ?? null;
    const s: S = { id: "s1", name: "New chat", model: "m", course_id: cid };
    sessions.push(s);
    return r.fulfill({ json: s });
  });
  await page.route("**/api/history/*", (r) =>
    r.fulfill({ json: { history: [], model: "m", name: "New chat", course_id: "c1" } }));

  // General courses route first; specific sub-paths registered last so they win.
  await page.route("**/api/courses**", (r) => {
    if (r.request().method() === "POST") {
      const b = JSON.parse(r.request().postData() ?? "{}");
      const c: C = { id: "c1", name: b.name, status: "active", settings: {} };
      courses.push(c);
      return r.fulfill({ json: c });
    }
    return r.fulfill({ json: { courses } });
  });
  await page.route("**/api/courses/*/sources", (r) =>
    r.fulfill({ json: { course_id: "c1", source_ids: [] } }));
  await page.route("**/api/courses/*/archive", (r) => {
    const c = courses.find((x) => x.id === "c1");
    if (c) c.status = "archived";
    return r.fulfill({ json: { ...c, status: "archived" } });
  });
  await page.route("**/api/courses/*/unarchive", (r) => {
    const c = courses.find((x) => x.id === "c1");
    if (c) c.status = "active";
    return r.fulfill({ json: { ...c, status: "active" } });
  });
}

test("F1: onboarding → course tab → course chat → archive → unarchive", async ({ page }) => {
  const captured = { sessionPost: null as string | null };
  await mockBackend(page, captured);

  await page.goto("/");
  await page.getByLabel("Username").fill("ada");
  await page.getByLabel("Password").fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();

  // First login: the welcome step, not an empty chat.
  await expect(page.getByText("What are you studying right now?")).toBeVisible();
  await page.getByLabel("Course name").fill("AP Statistics");
  await page.getByRole("button", { name: "Create course" }).click();

  // The course tab appears and its landing pane is honest about coverage.
  await expect(page.getByRole("tab", { name: "AP Statistics" })).toBeVisible();
  await expect(page.getByText(/No library sources linked/)).toBeVisible();

  // A chat started inside the course carries course_id.
  await page.getByRole("button", { name: "+ New chat", exact: true }).first().click();
  await expect.poll(() => captured.sessionPost ?? "").toContain("course_id");
  expect(captured.sessionPost).toContain("c1");

  // Archive (two-step confirm) → tab disappears, back to Home.
  const archive = page.getByRole("button", { name: "Archive AP Statistics" });
  await archive.click(); // arm
  await archive.click(); // confirm
  await expect(page.getByRole("tab", { name: "AP Statistics" })).toBeHidden();
  await expect(page.getByRole("tab", { name: "Home" })).toBeVisible();

  // Manage courses (the + menu) lists it archived; unarchive restores the tab.
  await page.getByRole("button", { name: "Add course", exact: true }).click();
  await expect(page.getByText("Manage courses")).toBeVisible();
  await page.getByRole("button", { name: "Unarchive", exact: true }).click();
  await expect(page.getByRole("tab", { name: "AP Statistics" })).toBeVisible();
});
