/**
 * Hand-typed Calendar contract. `routes/calendar_routes.py` is a frozen god-file (1404 lines),
 * so — like tasks/models — these types are hand-maintained against the route handlers and the
 * calendar endpoints are NOT in ui-contract-endpoints.txt (a typed seam needs a P-T6 split).
 *
 * Datetime conventions (from calendar_routes._event_to_dict):
 *  - all-day: dtstart/dtend are "YYYY-MM-DD" (no time).
 *  - timed local (is_utc=false): "YYYY-MM-DDTHH:MM:SS" — naive, the user's local wall time.
 *  - timed UTC (is_utc=true): "...Z".
 * Recurring events are expanded server-side into instances with a compound uid
 * (`{series_uid}::{date}`); edit/delete operate on the whole series via `series_uid`.
 */

export interface CalendarEvent {
  uid: string;
  summary: string;
  dtstart: string;
  dtend: string;
  all_day: boolean;
  is_utc: boolean;
  description: string;
  location: string;
  rrule: string;
  calendar: string;
  calendar_href: string;
  color: string | null;
  event_type: string | null;
  importance: string;
  is_recurrence: boolean;
  series_uid: string;
}

export interface EventsResponse {
  events: CalendarEvent[];
  truncated?: boolean;
}

export interface Calendar {
  name: string;
  href: string;
  color: string;
  source: "local" | "caldav" | "import" | "timetree";
}

export interface CalendarsResponse {
  calendars: Calendar[];
}

/** Body for POST/PUT /api/calendar/events (EventCreate / EventUpdate). */
export interface EventInput {
  summary: string;
  dtstart: string;
  dtend?: string;
  all_day?: boolean;
  description?: string;
  location?: string;
  calendar_href?: string;
  rrule?: string;
}

export interface CalDAVConfig {
  url: string;
  username: string;
  has_password: boolean;
  local: boolean;
}

export interface CalDAVSaveInput {
  url: string;
  username: string;
  password: string;
}
