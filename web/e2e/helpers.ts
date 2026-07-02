import { expect, type Page } from "@playwright/test";

export const OWNER = { username: "owner", password: "correct-horse-battery" };

// Self-sufficient auth: works whether the box is fresh (does first-run setup)
// or already set up (just logs in) — specs stay order-independent.
export async function ensureLoggedIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForURL(/\/(setup|login)$|\/$/);

  if (/\/setup$/.test(page.url())) {
    await page.getByLabel("Username").fill(OWNER.username);
    await page.getByLabel("Password").fill(OWNER.password);
    await page.getByRole("button", { name: "Set up puttyU" }).click();
    await page.waitForURL(/\/login$/);
  }
  if (/\/login$/.test(page.url())) {
    await page.getByLabel("Username").fill(OWNER.username);
    await page.getByLabel("Password").fill(OWNER.password);
    await page.getByRole("button", { name: "Log in" }).click();
  }
  await expect(page.locator(".pa-sidebar .pa-brand")).toContainText("puttyU");
}
