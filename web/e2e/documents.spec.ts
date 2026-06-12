import { test, expect, type Page } from "@playwright/test";

/**
 * Slice-6.5c flow (ADR 0002 Gate 3): login -> Documents -> create a doc -> the editor opens
 * with its content -> edit -> save. Backend mocked; the doc store is stateful so the created
 * doc loads in the editor and edits persist.
 */

type Full = { id: string; title: string; language: string | null; current_content: string; version_count: number; is_active: boolean; archived: boolean; session_id: string | null; created_at: string | null; updated_at: string | null };

async function mockBackend(page: Page) {
  let authed = false;
  const store: Record<string, Full> = {};
  const lib: { id: string; title: string; language: string; preview: string; version_count: number; session_name: string | null; created_at: string | null; updated_at: string | null }[] = [];

  await page.route("**/api/auth/status", (r) => r.fulfill({ json: { authenticated: authed, username: authed ? "ada" : null, is_admin: true } }));
  await page.route("**/api/auth/login", (r) => { authed = true; return r.fulfill({ json: { ok: true, username: "ada" } }); });
  await page.route("**/api/sessions", (r) => r.fulfill({ json: [] }));

  await page.route("**/api/documents/library**", (r) => r.fulfill({ json: { documents: lib, total: lib.length, languages: {}, session_count: 0 } }));
  await page.route("**/api/document/*", (r) => {
    const id = r.request().url().split("/api/document/")[1].split(/[?#]/)[0];
    const m = r.request().method();
    if (m === "PUT") {
      const b = JSON.parse(r.request().postData() ?? "{}");
      store[id] = { ...store[id], current_content: b.content, version_count: store[id].version_count + 1 };
    }
    if (m === "DELETE") return r.fulfill({ json: { status: "deleted", id } });
    return r.fulfill({ json: store[id] });
  });
  await page.route("**/api/document", (r) => {
    const b = JSON.parse(r.request().postData() ?? "{}");
    const doc: Full = { id: "d1", title: b.title, language: "text", current_content: b.content, version_count: 1, is_active: true, archived: false, session_id: null, created_at: null, updated_at: null };
    store.d1 = doc;
    lib.push({ id: "d1", title: b.title, language: "text", preview: b.content.slice(0, 80), version_count: 1, session_name: null, created_at: null, updated_at: null });
    return r.fulfill({ json: doc });
  });
}

test("create and edit a document", async ({ page }) => {
  await mockBackend(page);

  await page.goto("/");
  await page.getByLabel("Username").fill("ada");
  await page.getByLabel("Password").fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await expect(page.getByText("No documents yet.")).toBeVisible();

  await page.getByLabel("Document title").fill("Lesson 1: fractions");
  await page.getByLabel("New document content").fill("Intro to numerators and denominators.");
  await page.getByRole("button", { name: "Create" }).click();

  // Editor opens with the created content.
  const editor = page.getByTestId("editor-d1");
  await expect(editor.getByRole("heading", { name: "Lesson 1: fractions" })).toBeVisible();
  await expect(editor.getByLabel("Document content")).toHaveValue("Intro to numerators and denominators.");

  // Edit and save a new version — a success toast confirms it.
  await editor.getByLabel("Document content").fill("Intro to numerators and denominators. Practice set A.");
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".toast--success", { hasText: "Saved" })).toBeVisible();
  await expect(editor.getByRole("button", { name: "Save" })).toBeDisabled();
});
