import { expect, test } from "@playwright/test";

// M0.0 DoD: "App boots; /api/health typed end-to-end (no drift)."
// The badge text can only render if UI → typed client → Vite proxy → FastAPI
// round-trips for real — the whole walking skeleton in one assertion.
test("app boots and /api/health is typed end-to-end", async ({ page }) => {
  await page.goto("/");

  // The Odysseus-shaped shell chrome renders (sidebar brand + topbar).
  await expect(page.locator(".pa-sidebar .pa-brand")).toContainText("puttyU");

  // The health badge round-trips through the typed contract seam.
  await expect(page.getByText("backend: ok · v0.0.0")).toBeVisible();
});
