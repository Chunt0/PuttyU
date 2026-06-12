import { test, expect, type Page } from "@playwright/test";

/**
 * Slice-6.5a flow (ADR 0002 Gate 3): login -> Calendar -> create an event -> it appears as a
 * chip in the month grid -> the week and day time-grid views show it too. Backend mocked at
 * the network boundary; the event store is stateful so a created event persists into refetches.
 */

type Ev = { uid: string; summary: string; dtstart: string; dtend: string; all_day: boolean; is_utc: boolean; description: string; location: string; rrule: string; calendar: string; calendar_href: string; color: string | null; event_type: string | null; importance: string; is_recurrence: boolean; series_uid: string };

async function mockBackend(page: Page) {
  let authed = false;
  const events: Ev[] = [];

  await page.route("**/api/auth/status", (r) => r.fulfill({ json: { authenticated: authed, username: authed ? "ada" : null, is_admin: true } }));
  await page.route("**/api/auth/login", (r) => { authed = true; return r.fulfill({ json: { ok: true, username: "ada" } }); });
  await page.route("**/api/sessions", (r) => r.fulfill({ json: [] }));

  await page.route("**/api/calendar/calendars", (r) => r.fulfill({ json: { calendars: [{ name: "Personal", href: "cal1", color: "#5b8abf", source: "local" }] } }));
  await page.route("**/api/calendar/config", (r) => r.fulfill({ json: { url: "", username: "", has_password: false, local: true } }));
  await page.route("**/api/calendar/events**", (r) => {
    if (r.request().method() === "POST") {
      const b = JSON.parse(r.request().postData() ?? "{}");
      events.push({
        uid: "e1", summary: b.summary, dtstart: b.dtstart, dtend: b.dtend ?? b.dtstart, all_day: !!b.all_day, is_utc: false,
        description: b.description ?? "", location: b.location ?? "", rrule: b.rrule ?? "", calendar: "Personal",
        calendar_href: b.calendar_href ?? "cal1", color: null, event_type: null, importance: "normal", is_recurrence: false, series_uid: "e1",
      });
      return r.fulfill({ json: { ok: true, uid: "e1" } });
    }
    return r.fulfill({ json: { events } });
  });
}

test("create an event and see it in the month, week and day views", async ({ page }) => {
  await mockBackend(page);

  await page.goto("/");
  await page.getByLabel("Username").fill("ada");
  await page.getByLabel("Password").fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  // Month grid is the default view; empty month shows the empty state.
  await expect(page.getByTestId("month-grid")).toBeVisible();
  await expect(page.getByText("No events this month.")).toBeVisible();

  // The form is collapsed until requested.
  await expect(page.getByLabel("Event title")).toHaveCount(0);
  await page.getByRole("button", { name: "New event" }).click();
  await page.getByLabel("Event title").fill("Tutoring: fractions");
  await page.getByRole("button", { name: "Create event" }).click();

  // Chip lands in today's month cell (form default date = today, 09:00).
  const chip = page.getByRole("button", { name: "Edit Tutoring: fractions" });
  await expect(chip).toBeVisible();

  // Week view: time grid with the event block.
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(page.getByTestId("timegrid")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit Tutoring: fractions" })).toBeVisible();

  // Day view: still there, single column.
  await page.getByRole("button", { name: "Day", exact: true }).click();
  await expect(page.getByTestId("timegrid")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit Tutoring: fractions" })).toBeVisible();

  // Clicking the chip opens the edit form.
  await page.getByRole("button", { name: "Edit Tutoring: fractions" }).click();
  await expect(page.getByLabel("Event title")).toHaveValue("Tutoring: fractions");
});
