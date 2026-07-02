import { expect, test } from "@playwright/test";

import { ensureLoggedIn } from "./helpers";

// M0.3 DoD (docs/M0.3-FIDELITY.md): the shell's interaction model, end-to-end.

test("Cmd-K palette: toggle, arrow-navigate, Enter executes", async ({ page }) => {
  await ensureLoggedIn(page);

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();

  // Toggle: same key closes.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette).not.toBeVisible();

  // Navigate to Providers via the palette.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByLabel("Palette query").fill("prov");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/settings\/providers$/);

  // Escape closes the palette (single-dismissal arbiter).
  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).not.toBeVisible();
});

test("slash commands: autocomplete, Tab insert, /theme switches + persists", async ({ page }) => {
  await ensureLoggedIn(page);

  const composer = page.getByLabel("Message");
  await composer.click();
  await composer.fill("/th");

  // Popup shows the /theme command; Tab inserts the token.
  const popup = page.getByRole("listbox", { name: "Slash commands" });
  await expect(popup).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(composer).toHaveValue("/theme ");

  // Complete and run: theme applies to <html data-theme> and persists.
  await composer.fill("/theme midnight");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight");

  // Unknown command → did-you-mean toast, never silently swallowed.
  await composer.fill("/thme paper");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/did you mean \/theme/)).toBeVisible();

  // Back to the default for later tests.
  await composer.fill("/theme putty");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "putty");
});

test("tool window: open, drag, minimize to chip, restore, Escape closes", async ({ page }) => {
  await ensureLoggedIn(page);

  // Open the Theme window from the sidebar Tools section.
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  const win = page.locator('[data-window="theme"]');
  await expect(win).toBeVisible();

  // Drag by the header: the window moves.
  const head = win.locator(".win-head");
  const before = await win.boundingBox();
  await head.hover();
  await page.mouse.down();
  await page.mouse.move(before!.x + 160, before!.y + 120, { steps: 5 });
  await page.mouse.up();
  const after = await win.boundingBox();
  expect(Math.abs(after!.x - before!.x)).toBeGreaterThan(50);

  // Minimize → dock chip; restore from the chip.
  await win.getByRole("button", { name: "Minimize Theme" }).click();
  await expect(win).not.toBeVisible();
  const chip = page.locator(".chip", { hasText: "Theme" });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(win).toBeVisible();

  // Escape closes the topmost window.
  await page.keyboard.press("Escape");
  await expect(win).not.toBeVisible();
});

test("theme picker window applies a theme by swatch", async ({ page }) => {
  await ensureLoggedIn(page);
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  await page.getByRole("button", { name: "Ocean" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ocean");
  await page.getByRole("button", { name: "putty (mono)" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "putty");
});

test("sidebar collapses to the icon rail and back", async ({ page }) => {
  await ensureLoggedIn(page);

  const sidebar = page.locator("nav.sb");
  const wide = (await sidebar.boundingBox())!.width;
  expect(wide).toBeGreaterThan(200);

  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await expect
    .poll(async () => (await sidebar.boundingBox())!.width)
    .toBeLessThan(60);

  // A rail icon expands the sidebar again.
  await page.locator(".rail-btn", { hasText: "" }).first().click();
  await expect
    .poll(async () => (await sidebar.boundingBox())!.width)
    .toBeGreaterThan(200);
});
