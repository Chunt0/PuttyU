import { test, expect, type Page } from "@playwright/test";

/**
 * Slice-6.5b flow (ADR 0002 Gate 3): login -> Notes -> create a note -> it appears, then
 * archive it. Backend mocked; the note store is stateful (archived flag flips on toggle).
 */

type N = { id: string; title: string; content: string; note_type: string; pinned: boolean; archived: boolean; repeat: string; sort_order: number };

async function mockBackend(page: Page) {
  let authed = false;
  const notes: N[] = [];

  await page.route("**/api/auth/status", (r) => r.fulfill({ json: { authenticated: authed, username: authed ? "ada" : null, is_admin: true } }));
  await page.route("**/api/auth/login", (r) => { authed = true; return r.fulfill({ json: { ok: true, username: "ada" } }); });
  await page.route("**/api/sessions", (r) => r.fulfill({ json: [] }));

  // General first; the more-specific /archive route is registered LAST so it wins
  // (Playwright matches the most-recently-added route).
  await page.route("**/api/notes**", (r) => {
    if (r.request().method() === "POST") {
      const b = JSON.parse(r.request().postData() ?? "{}");
      notes.push({ id: "n1", title: b.title, content: b.content, note_type: "note", pinned: false, archived: false, repeat: "none", sort_order: 0 });
      return r.fulfill({ json: notes[notes.length - 1] });
    }
    const wantArchived = r.request().url().includes("archived=true");
    return r.fulfill({ json: { notes: notes.filter((n) => n.archived === wantArchived) } });
  });
  await page.route("**/api/notes/*/archive", (r) => {
    const id = r.request().url().match(/\/api\/notes\/([^/]+)\/archive/)![1];
    const n = notes.find((x) => x.id === id);
    if (n) n.archived = !n.archived;
    return r.fulfill({ json: { ok: true, archived: n?.archived ?? true } });
  });
}

test("create and archive a note", async ({ page }) => {
  await mockBackend(page);

  await page.goto("/");
  await page.getByLabel("Username").fill("ada");
  await page.getByLabel("Password").fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.getByText("No notes yet.")).toBeVisible();

  await page.getByLabel("Note title").fill("Sam — fractions");
  await page.getByLabel("Note content").fill("struggled with common denominators");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Sam — fractions")).toBeVisible();

  // Archive it -> it leaves the active view.
  await page.getByRole("button", { name: "Archive Sam — fractions" }).click();
  await expect(page.getByText("Sam — fractions")).toBeHidden();
  // …and shows up under Archived.
  await page.getByRole("button", { name: "Archived" }).click();
  await expect(page.getByText("Sam — fractions")).toBeVisible();
});
