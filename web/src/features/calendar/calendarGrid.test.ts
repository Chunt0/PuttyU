import { describe, it, expect } from "vitest";
import {
  monthGrid,
  weekDays,
  gridRange,
  isoDate,
  startOfWeek,
  eventStart,
  eventEnd,
  eventsOnDay,
  layoutDayEvents,
  timeLabel,
} from "./calendarGrid.ts";
import type { CalendarEvent } from "./types.ts";

function ev(partial: Partial<CalendarEvent>): CalendarEvent {
  return {
    uid: "u1",
    summary: "x",
    dtstart: "2026-06-15T09:00:00",
    dtend: "2026-06-15T10:00:00",
    all_day: false,
    is_utc: false,
    description: "",
    location: "",
    rrule: "",
    calendar: "Personal",
    calendar_href: "cal1",
    color: null,
    event_type: null,
    importance: "normal",
    is_recurrence: false,
    series_uid: "u1",
    ...partial,
  };
}

describe("monthGrid", () => {
  it("starts on the Sunday on/before the 1st and covers the whole month", () => {
    // June 2026: the 1st is a Monday — lead-in from May 31 (Sunday).
    const june = monthGrid(new Date(2026, 5, 15));
    expect(isoDate(june[0][0])).toBe("2026-05-31");
    expect(june.length).toBe(5);
    expect(june.flat().some((d) => isoDate(d) === "2026-06-30")).toBe(true);

    // August 2026: the 1st is a Saturday — lead-in from July 26 (Sunday).
    const aug = monthGrid(new Date(2026, 7, 1));
    expect(isoDate(aug[0][0])).toBe("2026-07-26");
    expect(aug.flat().some((d) => isoDate(d) === "2026-08-31")).toBe(true);
    for (const week of aug) expect(week.length).toBe(7);
  });
});

describe("weekDays / startOfWeek / gridRange", () => {
  it("returns Sun..Sat around the anchor", () => {
    // 2026-06-10 is a Wednesday.
    const days = weekDays(new Date(2026, 5, 10));
    expect(days.map(isoDate)).toEqual([
      "2026-06-07", "2026-06-08", "2026-06-09", "2026-06-10",
      "2026-06-11", "2026-06-12", "2026-06-13",
    ]);
    expect(isoDate(startOfWeek(new Date(2026, 5, 7)))).toBe("2026-06-07"); // Sunday maps to itself
    expect(gridRange(days)).toEqual({ start: "2026-06-07", end: "2026-06-14" });
  });
});

describe("event date parsing", () => {
  it("parses all-day dates as local midnight with an exclusive end", () => {
    const holiday = ev({ all_day: true, dtstart: "2026-06-20", dtend: "2026-06-21" });
    expect(isoDate(eventStart(holiday))).toBe("2026-06-20");
    expect(isoDate(eventEnd(holiday))).toBe("2026-06-21");
    // Missing dtend → one day long.
    const single = ev({ all_day: true, dtstart: "2026-06-20", dtend: "" });
    expect(isoDate(eventEnd(single))).toBe("2026-06-21");
  });
  it("parses naive timed datetimes as local wall time", () => {
    const lesson = ev({ dtstart: "2026-06-15T15:30:00", dtend: "2026-06-15T16:00:00" });
    expect(eventStart(lesson).getHours()).toBe(15);
    expect(eventStart(lesson).getMinutes()).toBe(30);
    expect(timeLabel(ev({ all_day: true }))).toBe("All day");
  });
});

describe("eventsOnDay", () => {
  const holiday = ev({ uid: "h", all_day: true, dtstart: "2026-06-20", dtend: "2026-06-21" });
  const trip = ev({ uid: "t", all_day: true, dtstart: "2026-06-20", dtend: "2026-06-23" });
  const lesson = ev({ uid: "l", dtstart: "2026-06-20T15:00:00", dtend: "2026-06-20T16:00:00" });
  const all = [lesson, holiday, trip];

  it("includes events overlapping the day, all-day first", () => {
    const on20 = eventsOnDay(all, new Date(2026, 5, 20));
    expect(on20.map((e) => e.uid)).toEqual(["h", "t", "l"]);
  });
  it("treats all-day dtend as exclusive", () => {
    expect(eventsOnDay([holiday], new Date(2026, 5, 21))).toEqual([]);
    expect(eventsOnDay([trip], new Date(2026, 5, 22)).map((e) => e.uid)).toEqual(["t"]);
    expect(eventsOnDay([trip], new Date(2026, 5, 23))).toEqual([]);
  });
});

describe("layoutDayEvents", () => {
  const day = new Date(2026, 5, 20);

  it("positions a block by time of day", () => {
    const six = ev({ dtstart: "2026-06-20T06:00:00", dtend: "2026-06-20T12:00:00" });
    const [b] = layoutDayEvents([six], day);
    expect(b.topPct).toBe(25); // 6/24
    expect(b.heightPct).toBe(25); // 6h
    expect(b.widthPct).toBe(100);
  });

  it("splits overlapping events into lanes; sequential events get full width", () => {
    const a = ev({ uid: "a", dtstart: "2026-06-20T09:00:00", dtend: "2026-06-20T11:00:00" });
    const b = ev({ uid: "b", dtstart: "2026-06-20T10:00:00", dtend: "2026-06-20T12:00:00" });
    const c = ev({ uid: "c", dtstart: "2026-06-20T14:00:00", dtend: "2026-06-20T15:00:00" });
    const blocks = layoutDayEvents([c, b, a], day);
    const byUid = Object.fromEntries(blocks.map((x) => [x.ev.uid, x]));
    expect(byUid.a.widthPct).toBe(50);
    expect(byUid.b.widthPct).toBe(50);
    expect(byUid.a.leftPct + byUid.b.leftPct).toBe(50); // lanes 0 and 1
    expect(byUid.c.widthPct).toBe(100); // separate cluster
  });

  it("gives zero-length events a visible minimum block and skips all-day events", () => {
    const zero = ev({ uid: "z", dtstart: "2026-06-20T09:00:00", dtend: "2026-06-20T09:00:00" });
    const allday = ev({ uid: "ad", all_day: true, dtstart: "2026-06-20", dtend: "2026-06-21" });
    const blocks = layoutDayEvents([zero, allday], day);
    expect(blocks.map((b) => b.ev.uid)).toEqual(["z"]);
    expect(blocks[0].heightPct).toBeGreaterThan(0);
  });
});
