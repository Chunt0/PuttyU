import { test, expect, type Page } from "@playwright/test";

/**
 * UX-polish pass: session inline rename + two-step delete, the two-step ConfirmButton on
 * feature deletes (notes), the save toast (documents), and window-manager geometry
 * persisting across a reload + corner resize.
 */

type N = { id: string; title: string; content: string; note_type: string; pinned: boolean; archived: boolean; repeat: string; sort_order: number };

async function mockBackend(page: Page, captured: { rename: string[]; deleted: string[] }) {
  let authed = false;
  let sessions = [
    { id: "s1", name: "First chat", model: "m", rag: false, archived: false },
    { id: "s2", name: "Second chat", model: "m", rag: false, archived: false },
  ];
  const notes: N[] = [{ id: "n1", title: "Lesson plan", content: "fractions", note_type: "note", pinned: false, archived: false, repeat: "none", sort_order: 0 }];

  await page.route("**/api/auth/status", (r) => r.fulfill({ json: { authenticated: authed, username: authed ? "ada" : null, is_admin: true } }));
  await page.route("**/api/auth/login", (r) => { authed = true; return r.fulfill({ json: { ok: true, username: "ada" } }); });
  await page.route("**/api/sessions", (r) => r.fulfill({ json: sessions }));
  await page.route(/\/api\/history\//, (r) => r.fulfill({ json: { history: [], model: "m", name: "First chat" } }));

  await page.route(/\/api\/session\/(s1|s2)$/, (r) => {
    const id = r.request().url().match(/\/api\/session\/(s[12])/)![1];
    const m = r.request().method();
    if (m === "PATCH") {
      captured.rename.push(r.request().postData() ?? "");
      return r.fulfill({ json: { id, name: "renamed" } });
    }
    if (m === "DELETE") {
      captured.deleted.push(id);
      sessions = sessions.filter((s) => s.id !== id);
      return r.fulfill({ json: { status: "deleted" } });
    }
    return r.fulfill({ json: { id } });
  });

  await page.route("**/api/notes**", (r) => {
    const wantArchived = r.request().url().includes("archived=true");
    return r.fulfill({ json: { notes: notes.filter((n) => n.archived === wantArchived) } });
  });
  await page.route(/\/api\/notes\/n1$/, (r) => {
    if (r.request().method() === "DELETE") {
      notes.splice(0, notes.length);
      return r.fulfill({ json: { ok: true } });
    }
    return r.fulfill({ json: notes[0] });
  });
}

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill("ada");
  await page.getByLabel("Password").fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("rename a session inline and delete one with the two-step confirm", async ({ page }) => {
  const captured = { rename: [] as string[], deleted: [] as string[] };
  await mockBackend(page, captured);
  await login(page);
  // Scope to the sidebar — the Dashboard's Resume card also surfaces a session by name.
  const sidebar = page.getByRole("complementary");
  await expect(sidebar.getByRole("button", { name: "First chat", exact: true })).toBeVisible();

  // Inline rename via the row's pencil action.
  await sidebar.getByRole("button", { name: "First chat", exact: true }).hover();
  await page.getByRole("button", { name: "Rename First chat" }).click();
  const input = page.getByLabel("Chat name");
  await input.fill("Linear equations");
  await input.press("Enter");
  await expect.poll(() => captured.rename.length).toBeGreaterThan(0);
  expect(captured.rename[0]).toContain("Linear equations");

  // Delete arms on the first click ("✓" confirm glyph), fires on the second.
  await page.getByRole("button", { name: "Second chat", exact: true }).hover();
  const del = page.getByRole("button", { name: "Delete Second chat" });
  await del.click();
  expect(captured.deleted).toHaveLength(0); // armed, not deleted
  await expect(del).toHaveText("✓");
  await del.click();
  await expect.poll(() => captured.deleted).toEqual(["s2"]);
  await expect(page.getByRole("button", { name: "Second chat", exact: true })).toBeHidden();
});

test("feature deletes are two-step (notes)", async ({ page }) => {
  const captured = { rename: [] as string[], deleted: [] as string[] };
  await mockBackend(page, captured);
  await login(page);

  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.getByText("Lesson plan")).toBeVisible();

  const del = page.getByRole("button", { name: "Delete Lesson plan" });
  await del.click();
  await expect(del).toHaveText("Sure?"); // armed — nothing deleted yet
  await expect(page.getByText("Lesson plan")).toBeVisible();
  await del.click();
  await expect(page.getByText("Lesson plan")).toBeHidden();
});

test("window geometry survives close, reopen and reload; corner resize works", async ({ page }) => {
  const captured = { rename: [] as string[], deleted: [] as string[] };
  await mockBackend(page, captured);
  await login(page);

  // Open Notes, drag it somewhere distinctive.
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  const win = page.getByTestId("window-notes");
  await expect(win).toBeVisible();
  const header = win.locator(".window-header");
  await header.hover({ position: { x: 80, y: 12 } });
  await page.mouse.down();
  await page.mouse.move(420, 180, { steps: 4 });
  await page.mouse.up();
  const dragged = await win.boundingBox();

  // Corner resize grows the window.
  await win.locator(".window-resize").hover();
  await page.mouse.down();
  await page.mouse.move(dragged!.x + dragged!.width + 120, dragged!.y + dragged!.height + 80, { steps: 4 });
  await page.mouse.up();
  const resized = await win.boundingBox();
  expect(resized!.width).toBeGreaterThan(dragged!.width + 100);
  expect(resized!.height).toBeGreaterThan(dragged!.height + 60);

  // Close, reload (stay authenticated), reopen -> geometry restored from localStorage.
  await page.getByRole("button", { name: "Close Notes" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  const reopened = await page.getByTestId("window-notes").boundingBox();
  expect(Math.abs(reopened!.x - resized!.x)).toBeLessThan(2);
  expect(Math.abs(reopened!.y - resized!.y)).toBeLessThan(2);
  expect(Math.abs(reopened!.width - resized!.width)).toBeLessThan(2);
});
