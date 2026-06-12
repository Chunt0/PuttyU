import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Calendar } from "./Calendar.tsx";
import { renderWithProviders, jsonResponse, stubFetch, findCall, callInfo } from "../../test/util.tsx";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear(); // the view choice persists; don't leak it between tests
});

// Events are derived from "today" so the default month view always contains
// them regardless of when the suite runs.
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const NOW = new Date();
const TODAY = iso(NOW);
const TOMORROW = iso(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 1));

const EVENTS = [
  { uid: "e1", summary: "Lesson with Sam", dtstart: `${TODAY}T15:00:00`, dtend: `${TODAY}T16:00:00`, all_day: false, is_utc: false, description: "", location: "Room 2", rrule: "", calendar: "Personal", calendar_href: "cal1", color: null, event_type: null, importance: "normal", is_recurrence: false, series_uid: "e1" },
  { uid: "e2", summary: "Holiday", dtstart: TODAY, dtend: TOMORROW, all_day: true, is_utc: false, description: "", location: "", rrule: "", calendar: "Personal", calendar_href: "cal1", color: null, event_type: null, importance: "normal", is_recurrence: false, series_uid: "e2" },
];

function mockCalendar(configLocal = true) {
  return stubFetch([
    ["/api/calendar/calendars", () => jsonResponse({ calendars: [{ name: "Personal", href: "cal1", color: "#5b8abf", source: "local" }] })],
    ["/api/calendar/config", (_u, init) => (init?.method === "POST" ? jsonResponse({ ok: true }) : jsonResponse({ url: configLocal ? "" : "https://dav.x/", username: configLocal ? "" : "me", has_password: !configLocal, local: configLocal }))],
    ["/api/calendar/sync", () => jsonResponse({ ok: true, added: 2, updated: 0 })],
    ["/api/calendar/test", () => jsonResponse({ ok: true })],
    ["/api/calendar/events", (_u, init) => {
      const m = init?.method ?? "GET";
      if (m === "POST") return jsonResponse({ ok: true, uid: "new" });
      if (m === "PUT" || m === "DELETE") return jsonResponse({ ok: true });
      return jsonResponse({ events: EVENTS });
    }],
  ]);
}

describe("Calendar", () => {
  it("shows events as chips in today's month-grid cell (default view)", async () => {
    mockCalendar();
    renderWithProviders(<Calendar />);
    expect(await screen.findByTestId("month-grid")).toBeInTheDocument();
    const cell = screen.getByTestId(`cell-${TODAY}`);
    expect(await within(cell).findByRole("button", { name: "Edit Lesson with Sam" })).toBeInTheDocument();
    expect(within(cell).getByRole("button", { name: "Edit Holiday" })).toBeInTheDocument();
  });

  it("week and day views render the time grid with the event block", async () => {
    mockCalendar();
    renderWithProviders(<Calendar />);
    await screen.findByRole("button", { name: "Edit Lesson with Sam" });

    await userEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(await screen.findByTestId("timegrid")).toBeInTheDocument();
    const col = screen.getByTestId(`col-${TODAY}`);
    expect(within(col).getByRole("button", { name: "Edit Lesson with Sam" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Day" }));
    expect(await screen.findByTestId(`col-${TODAY}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Lesson with Sam" })).toBeInTheDocument();
  });

  it("agenda view lists events grouped by day", async () => {
    mockCalendar();
    renderWithProviders(<Calendar />);
    await screen.findByTestId("month-grid");
    await userEvent.click(screen.getByRole("button", { name: "Agenda" }));

    expect(await screen.findByTestId(`day-${TODAY}`)).toBeInTheDocument();
    expect(screen.getByText("Room 2")).toBeInTheDocument();
    expect(screen.getByText("All day", { selector: ".event-time" })).toBeInTheDocument();
  });

  it("creates an event (form opens on demand)", async () => {
    const fetchMock = mockCalendar();
    renderWithProviders(<Calendar />);
    await screen.findByTestId("month-grid");

    await userEvent.click(screen.getByRole("button", { name: "New event" }));
    await userEvent.type(screen.getByLabelText("Event title"), "Algebra session");
    await userEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => {
      const post = findCall(fetchMock, "/api/calendar/events", "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(callInfo(post!).body as string);
      expect(body.summary).toBe("Algebra session");
      expect(body.all_day).toBe(false);
      expect(body.dtstart).toBeTruthy();
    });
    // The form closes after a successful create.
    expect(screen.queryByLabelText("Event title")).not.toBeInTheDocument();
  });

  it("edits an event from its chip (whole series)", async () => {
    const fetchMock = mockCalendar();
    renderWithProviders(<Calendar />);
    await screen.findByTestId("month-grid");

    await userEvent.click(await screen.findByRole("button", { name: "Edit Lesson with Sam" }));
    expect(await screen.findByDisplayValue("Lesson with Sam")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(findCall(fetchMock, "/api/calendar/events/e1", "PUT")).toBeTruthy());
  });

  it("deletes an event from the edit form (two-step confirm)", async () => {
    const fetchMock = mockCalendar();
    renderWithProviders(<Calendar />);
    await screen.findByTestId("month-grid");

    await userEvent.click(await screen.findByRole("button", { name: "Edit Holiday" }));
    await screen.findByDisplayValue("Holiday");
    await userEvent.click(screen.getByRole("button", { name: "Delete event" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete event" }));
    await waitFor(() => expect(findCall(fetchMock, "/api/calendar/events/e2", "DELETE")).toBeTruthy());
  });

  it("connects a CalDAV server", async () => {
    const fetchMock = mockCalendar(true);
    renderWithProviders(<Calendar />);
    await screen.findByTestId("month-grid");

    await userEvent.type(screen.getByLabelText("CalDAV URL"), "https://dav.example.com/");
    await userEvent.type(screen.getByLabelText("CalDAV username"), "tutor");
    await userEvent.type(screen.getByLabelText("CalDAV password"), "secret");
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(findCall(fetchMock, "/api/calendar/config", "POST")).toBeTruthy());
  });
});
