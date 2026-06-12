import { test, expect } from "@playwright/test";

// Smoke: an unauthenticated visit lands on the login screen (the full login -> chat flow
// lives in chat-flow.spec.ts). Mock /api/auth/status so no backend is needed.
test("unauthenticated visit shows the login screen", async ({ page }) => {
  await page.route("**/api/auth/status", (route) =>
    route.fulfill({ json: { authenticated: false, username: null } }),
  );
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
