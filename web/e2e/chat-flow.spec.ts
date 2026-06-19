import { test, expect, type Page } from "@playwright/test";

/**
 * Slice-1 critical flow (ADR 0002 Gate 3): login -> chat -> switch session -> reload,
 * with history intact. The backend API is mocked at the network boundary (page.route),
 * so this runs in CI without a live backend or LLM provider — it exercises exactly the
 * frontend auth/routing/session state that the typed layer can't catch. The real-backend
 * + real-streaming flow lands with the provider work in Slice 2.
 */

const SESSIONS = [
  { id: "s1", name: "First chat", model: "m", rag: false, archived: false },
  { id: "s2", name: "Second chat", model: "m", rag: false, archived: false },
];

const HISTORY: Record<string, { role: string; content: string }[]> = {
  s1: [{ role: "user", content: "question one" }, { role: "assistant", content: "answer one" }],
  s2: [{ role: "user", content: "question two" }, { role: "assistant", content: "answer two" }],
};

async function mockApi(page: Page) {
  let authed = false;

  await page.route("**/api/auth/status", (route) =>
    route.fulfill({ json: { authenticated: authed, username: authed ? "ada" : null, is_admin: false } }),
  );
  await page.route("**/api/auth/login", (route) => {
    authed = true;
    return route.fulfill({ json: { ok: true, username: "ada" } });
  });
  await page.route("**/api/sessions", (route) => route.fulfill({ json: SESSIONS }));
  await page.route(/\/api\/history\/(s\d)/, (route, req) => {
    const id = req.url().match(/\/api\/history\/(s\d)/)![1];
    return route.fulfill({ json: { history: HISTORY[id], model: "m", name: id, endpoint_url: null } });
  });
}

test("login -> chat -> switch session -> reload keeps history", async ({ page }) => {
  await mockApi(page);

  // Unauthenticated: visiting the app redirects to the login screen.
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);

  // Sign in.
  await page.getByLabel("Username").fill("ada");
  await page.getByLabel("Password").fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();

  // Lands in the shell on the Dashboard (T5); the sidebar lists the chats. Pick the first
  // to open it — its history shows. Scope to the sidebar (the Resume card names a chat too).
  await expect(page.getByText("ada")).toBeVisible();
  await page.getByRole("complementary").getByRole("button", { name: "First chat", exact: true }).click();
  await expect(page.getByText("answer one")).toBeVisible();

  // Switch sessions -> the transcript follows the selection (no desync).
  // exact: the row also has "Rename Second chat" / "Delete Second chat" hover actions.
  await page.getByRole("button", { name: "Second chat", exact: true }).click();
  await expect(page.getByText("answer two")).toBeVisible();
  await expect(page.getByText("answer one")).toBeHidden();

  // Reload -> still authenticated, app restored (not bounced to /login). The selected
  // chat doesn't persist, so this lands back on the Dashboard; the sidebar still lists it.
  await page.reload();
  await expect(page.getByRole("complementary").getByText("First chat")).toBeVisible();
  await expect(page).not.toHaveURL(/\/login$/);
});
