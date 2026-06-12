/**
 * Pure date/grid math for the calendar views (month grid, week/day time grid).
 * No React, no fetch — unit-tested directly (same pattern as chat/agentSteps.ts).
 *
 * Weeks start on Sunday. All-day events follow the iCal convention: dtend is
 * EXCLUSIVE (a one-day event on the 20th has dtend on the 21st).
 */
import type { CalendarEvent } from "./types.ts";

export const pad2 = (n: number) => String(n).padStart(2, "0");

/** Local ISO date ("YYYY-MM-DD") — NOT toISOString(), which shifts to UTC. */
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

/** Sunday of the week containing `d` (local midnight). */
export const startOfWeek = (d: Date) =>
  addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -d.getDay());

export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** The 7 days (Sun..Sat) of the week containing `anchor`. */
export function weekDays(anchor: Date): Date[] {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Full weeks (rows of 7 days, Sun-start) covering `anchor`'s month. */
export function monthGrid(anchor: Date): Date[][] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const weeks: Date[][] = [];
  for (let d = startOfWeek(first); d <= last; d = addDays(d, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  }
  return weeks;
}

/** [start, endExclusive) ISO dates covering a set of grid days (for the events fetch). */
export function gridRange(days: Date[]): { start: string; end: string } {
  return { start: isoDate(days[0]), end: isoDate(addDays(days[days.length - 1], 1)) };
}

/** Event start as a local Date. All-day "YYYY-MM-DD" parses to local midnight;
 * naive "…THH:MM:SS" parses as local wall time; "…Z" as UTC (then shown local). */
export function eventStart(ev: CalendarEvent): Date {
  if (ev.all_day) {
    const [y, m, d] = ev.dtstart.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(ev.dtstart);
}

/** Event end (exclusive) as a local Date; missing/invalid dtend falls back to start. */
export function eventEnd(ev: CalendarEvent): Date {
  if (ev.all_day) {
    const raw = (ev.dtend || "").slice(0, 10);
    if (!raw) return addDays(eventStart(ev), 1);
    const [y, m, d] = raw.split("-").map(Number);
    const end = new Date(y, m - 1, d);
    return end > eventStart(ev) ? end : addDays(eventStart(ev), 1);
  }
  const end = ev.dtend ? new Date(ev.dtend) : eventStart(ev);
  return isNaN(end.getTime()) ? eventStart(ev) : end;
}

/** Events overlapping [day, day+1), all-day first, then by start time. */
export function eventsOnDay(events: CalendarEvent[], day: Date): CalendarEvent[] {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const dayEnd = addDays(dayStart, 1);
  return events
    .filter((ev) => {
      const s = eventStart(ev);
      const e = eventEnd(ev);
      return s < dayEnd && (e > dayStart || (!ev.all_day && +e === +s && s >= dayStart));
    })
    .sort((a, b) => Number(b.all_day) - Number(a.all_day) || +eventStart(a) - +eventStart(b));
}

export interface DayBlock {
  ev: CalendarEvent;
  topPct: number;
  heightPct: number;
  leftPct: number;
  widthPct: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_BLOCK_MS = 30 * 60 * 1000; // zero-length events still get a clickable block

/**
 * Absolute-position layout for the TIMED events of one day column.
 * Overlapping events are packed into lanes (greedy interval partitioning);
 * each transitively-overlapping cluster splits the column width evenly.
 */
export function layoutDayEvents(events: CalendarEvent[], day: Date): DayBlock[] {
  const dayStart = +new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const dayEnd = dayStart + DAY_MS;
  const items = eventsOnDay(events, day)
    .filter((ev) => !ev.all_day)
    .map((ev) => {
      const s = Math.max(+eventStart(ev), dayStart);
      const e = Math.min(Math.max(+eventEnd(ev), s + MIN_BLOCK_MS), dayEnd);
      return { ev, s, e, lane: 0, lanes: 1 };
    })
    .sort((a, b) => a.s - b.s || b.e - a.e);

  // Cluster = maximal run of transitively overlapping items; lane = first
  // free track within the cluster.
  let cluster: typeof items = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    for (const it of cluster) it.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };
  for (const it of items) {
    if (it.s >= clusterEnd) {
      flush();
      clusterEnd = it.e;
    } else {
      clusterEnd = Math.max(clusterEnd, it.e);
    }
    let lane = laneEnds.findIndex((end) => end <= it.s);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(it.e);
    } else {
      laneEnds[lane] = it.e;
    }
    it.lane = lane;
    cluster.push(it);
  }
  flush();

  return items.map(({ ev, s, e, lane, lanes }) => ({
    ev,
    topPct: ((s - dayStart) / DAY_MS) * 100,
    heightPct: Math.max(((e - s) / DAY_MS) * 100, 1.5),
    leftPct: (lane / lanes) * 100,
    widthPct: 100 / lanes,
  }));
}

export function timeLabel(ev: CalendarEvent): string {
  if (ev.all_day) return "All day";
  return eventStart(ev).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
