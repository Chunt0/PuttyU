/**
 * Pure helpers for the Dashboard (Phase-2 T5 — SPEC F11). Calm by directive (D7):
 * no scores, no streaks, no guilt mechanics — just plain dates and sentences.
 */
import type { DashboardInsight, TodoResponse } from "../../api/types.ts";
import type { CalendarEvent } from "../calendar/types.ts";

/** Today's local date as an ISO `YYYY-MM-DD` (for comparing against todo due dates). */
export function todayISODate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Start of today as a naive local ISO datetime (the calendar's timed-local convention). */
export function todayStartISO(now: Date = new Date()): string {
  return `${todayISODate(now)}T00:00:00`;
}

/** End of today (exclusive — start of tomorrow) as a naive local ISO datetime. */
export function todayEndISO(now: Date = new Date()): string {
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return `${todayISODate(t)}T00:00:00`;
}

export type DueBucket = "overdue" | "today" | "later" | "none";

/**
 * Where a todo's due date sits relative to today. `due_date` is an ISO date string
 * (`YYYY-MM-DD`, mirrors Note.due_date); no due date → "none".
 */
export function dueBucket(due_date: string | null | undefined, today = todayISODate()): DueBucket {
  if (!due_date) return "none";
  const day = due_date.slice(0, 10);
  if (day < today) return "overdue";
  if (day === today) return "today";
  return "later";
}

/** A calm word for a due bucket — read by the user, never a badge/score. */
export function dueLabel(bucket: DueBucket): string | null {
  switch (bucket) {
    case "overdue":
      return "overdue";
    case "today":
      return "due today";
    default:
      return null;
  }
}

/**
 * Order open todos for the Today view: overdue first, then due-today, then dated-later,
 * then undated — each group oldest-due first, ties by text. Stable, pure.
 */
export function sortTodos(todos: TodoResponse[], today = todayISODate()): TodoResponse[] {
  const rank: Record<DueBucket, number> = { overdue: 0, today: 1, later: 2, none: 3 };
  return [...todos].sort((a, b) => {
    const ra = rank[dueBucket(a.due_date, today)];
    const rb = rank[dueBucket(b.due_date, today)];
    if (ra !== rb) return ra - rb;
    const da = a.due_date ?? "";
    const db = b.due_date ?? "";
    if (da !== db) return da < db ? -1 : 1;
    return a.text.localeCompare(b.text);
  });
}

/** Today's calendar events, earliest first (all-day before timed, then by start). */
export function sortEvents(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => {
    if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
    return a.dtstart < b.dtstart ? -1 : a.dtstart > b.dtstart ? 1 : 0;
  });
}

/** A timed event's `HH:MM`; all-day events read as "All day". */
export function eventTime(ev: CalendarEvent): string {
  if (ev.all_day) return "All day";
  const m = /T(\d{2}:\d{2})/.exec(ev.dtstart);
  return m ? m[1] : "";
}

/**
 * A momentum insight as a plain sentence (D7 — narrative, not a score). Prefers the
 * tutor's verbatim `literal`; otherwise renders the structured relation as readable text.
 */
export function insightSentence(ins: DashboardInsight): string {
  const literal = (ins.literal ?? "").trim();
  if (literal) return literal;
  const rel = (ins.relation ?? "").replace(/_/g, " ").trim();
  const concept = (ins.concept_name ?? "").trim();
  if (rel && concept) return `${rel} ${concept}`;
  return rel || concept || "the tutor noticed something";
}

/** The calm empty line for the review card (D7) — never pressure. */
export function reviewLine(count: number): string {
  if (count <= 0) return "Nothing due — the queue fills as you study.";
  const items = count === 1 ? "1 item" : `${count} items`;
  return `${items} due`;
}

/** A reading recommendation as one readable line: "Title §heading p. N". */
export function readingLine(title: string, heading: string, pageStart: number | null): string {
  const sec = heading ? ` §${heading}` : "";
  const pg = pageStart != null ? ` p. ${pageStart}` : "";
  return `${title}${sec}${pg}`;
}
