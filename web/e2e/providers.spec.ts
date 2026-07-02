import { expect, test } from "@playwright/test";

import { ensureLoggedIn } from "./helpers";

// M0.2 DoD: add a provider in the UI; /api/router/resolution renders;
// vision-absent fails loud (the test-mode FakeProvider is text-only).
test("add a provider and watch the live resolution table", async ({ page }) => {
  await ensureLoggedIn(page);

  await page.getByRole("button", { name: "Providers" }).first().click();
  await expect(page).toHaveURL(/\/settings\/providers$/);

  // The resolution table renders tiers off the FakeProvider…
  const resolution = page.locator(".providers-table").last();
  await expect(resolution).toContainText("standard");
  await expect(resolution).toContainText("FakeProvider / fake-standard");
  // …deep is served below preference, visibly…
  await expect(resolution).toContainText("below preferred");
  // …and vision is loudly unavailable, never silently text-only.
  await expect(resolution).toContainText("unavailable (no_vision_model)");

  // Add a local endpoint through the UI.
  await page.getByLabel("Name", { exact: true }).fill("box");
  await page.getByLabel("Model name").fill("local-small");
  await page.getByLabel("Class").selectOption("light");
  await page.getByRole("button", { name: "Add endpoint" }).click();

  // It appears in the endpoints table with no key stored.
  const endpoints = page.locator(".providers-table").first();
  await expect(endpoints).toContainText("box");
  await expect(endpoints).toContainText("local-small");

  // The resolution table now routes light traffic to it (local-first).
  await expect(resolution).toContainText("box / local-small");
});
