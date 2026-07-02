import { expect, type Page } from "@playwright/test";

export const OWNER = { username: "owner", password: "correct-horse-battery" };

// Self-sufficient auth: works whether the box is fresh (does first-run setup)
// or already set up (just logs in) — specs stay order-independent.
//
// Waits on RENDERED markers, not URLs: right after goto("/") the URL is still
// "/" while the auth state loads, so URL matching races the redirect.
export async function ensureLoggedIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator(".auth-card, .pa-shell").first().waitFor();

  const setupButton = page.getByRole("button", { name: "Set up puttyU" });
  if (await setupButton.isVisible()) {
    await page.getByLabel("Username").fill(OWNER.username);
    await page.getByLabel("Password").fill(OWNER.password);
    await setupButton.click();
    await page.getByRole("button", { name: "Log in" }).waitFor();
  }

  const loginButton = page.getByRole("button", { name: "Log in" });
  if (await loginButton.isVisible()) {
    await page.getByLabel("Username").fill(OWNER.username);
    await page.getByLabel("Password").fill(OWNER.password);
    await loginButton.click();
  }

  await expect(page.locator(".pa-sidebar .pa-brand")).toContainText("puttyU");
}
