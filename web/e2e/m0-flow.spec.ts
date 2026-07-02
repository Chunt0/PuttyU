import { expect, test } from "@playwright/test";

// M0.1 DoD: "setup→login→logout Playwright e2e green" — one continuous flow
// against a fresh backend (the webServer command wipes the e2e data dir).
// The M0.0 assertion (shell + /api/health typed end-to-end) lives inside it,
// post-login.
test("first-run setup → login → logout", async ({ page }) => {
  // Fresh box: / redirects to first-run setup.
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);

  await page.getByLabel("Username").fill("owner");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Set up puttyU" }).click();

  // Owner created; setup closes and we land on login.
  await expect(page).toHaveURL(/\/login$/);

  // Wrong password stays on login with a readable error.
  await page.getByLabel("Username").fill("owner");
  await page.getByLabel("Password").fill("wrong-password-123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toContainText("Invalid");

  // Real login lands in the shell.
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator(".sb-brand .wm")).toContainText("puttyU");

  // M0.0 walking skeleton, still true behind auth: /api/health round-trips
  // the typed seam.
  await expect(page.getByText("backend: ok · v0.0.0")).toBeVisible();

  // Logout returns to login; the shell is gone.
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  // A direct visit to / while logged out bounces back to login.
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});
