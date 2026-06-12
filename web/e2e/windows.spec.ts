import { test, expect, type Page } from "@playwright/test";

/**
 * Window-manager flow (legacy modalManager parity): tools open as floating windows over
 * the chat, drag to move, snap-dock to an edge, minimize to the dock bar, restore, close.
 */

async function mockBackend(page: Page) {
  let authed = false;
  await page.route("**/api/auth/status", (r) => r.fulfill({ json: { authenticated: authed, username: authed ? "ada" : null, is_admin: true } }));
  await page.route("**/api/auth/login", (r) => { authed = true; return r.fulfill({ json: { ok: true, username: "ada" } }); });
  await page.route("**/api/sessions", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/notes**", (r) => r.fulfill({ json: { notes: [] } }));
  await page.route("**/api/calendar/**", (r) => r.fulfill({ json: { events: [], calendars: [] } }));
}

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill("ada");
  await page.getByLabel("Password").fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("open, drag, minimize, restore and close a tool window", async ({ page }) => {
  await mockBackend(page);
  await login(page);

  // Open Notes as a floating window — chat stays mounted underneath.
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  const win = page.getByTestId("window-notes");
  await expect(win).toBeVisible();
  await expect(win).toHaveClass(/floating-window/);
  await expect(page.getByText("No notes yet.")).toBeVisible();

  // Drag the window by its header: position moves.
  const before = await win.boundingBox();
  const header = win.locator(".window-header");
  await header.hover({ position: { x: 80, y: 12 } });
  await page.mouse.down();
  await page.mouse.move(before!.x + 240, before!.y + 120, { steps: 4 });
  await page.mouse.up();
  const after = await win.boundingBox();
  expect(after!.x).toBeGreaterThan(before!.x + 100);
  expect(after!.y).toBeGreaterThan(before!.y + 50);

  // Minimize -> dock chip; restore from the chip.
  await page.getByRole("button", { name: "Minimize Notes" }).click();
  await expect(win).toBeHidden();
  await page.getByTestId("dock-bar").getByRole("button", { name: "Notes" }).click();
  await expect(win).toBeVisible();

  // Close.
  await page.getByRole("button", { name: "Close Notes" }).click();
  await expect(win).toBeHidden();
});

test("snap-dock a window to the right edge and float it back", async ({ page }) => {
  await mockBackend(page);
  await login(page);

  await page.getByRole("button", { name: "Notes", exact: true }).click();
  const win = page.getByTestId("window-notes");
  await expect(win).toBeVisible();

  // Drag the header to the right viewport edge -> becomes a docked side panel.
  const viewport = page.viewportSize()!;
  const header = win.locator(".window-header");
  await header.hover({ position: { x: 80, y: 12 } });
  await page.mouse.down();
  await page.mouse.move(viewport.width - 8, 300, { steps: 6 });
  await page.mouse.up();
  await expect(win).toHaveClass(/dock-panel--right/);

  // Two tools at once: Calendar floats while Notes stays docked.
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.getByTestId("window-calendar")).toHaveClass(/floating-window/);
  await expect(win).toHaveClass(/dock-panel--right/);

  // Float Notes back out via the header button.
  await page.getByRole("button", { name: "Float Notes" }).click();
  await expect(win).toHaveClass(/floating-window/);
});
