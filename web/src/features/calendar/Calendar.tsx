import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Spinner } from "../../components/Spinner.tsx";
import { ConfirmButton } from "../../components/ConfirmButton.tsx";
import {
  useEvents,
  useCalendars,
  useDeleteEvent,
  useCalDAVConfig,
  useSyncCalDAV,
  useTestCalDAV,
  useSaveCalDAV,
} from "./api.ts";
import { EventForm } from "./EventForm.tsx";
import type { CalendarEvent } from "./types.ts";
import {
  addDays,
  addMonths,
  eventsOnDay,
  gridRange,
  isoDate,
  layoutDayEvents,
  monthGrid,
  sameDay,
  timeLabel,
  weekDays,
} from "./calendarGrid.ts";

type View = "month" | "week" | "day" | "agenda";
const VIEWS: View[] = ["month", "week", "day", "agenda"];
const VIEW_LABEL: Record<View, string> = { month: "Month", week: "Week", day: "Day", agenda: "Agenda" };
const VIEW_KEY = "puttyu-cal-view";

const HOUR_PX = 48; // one hour of the time grid

function dayHeading(key: string): string {
  return new Date(`${key}T00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function groupByDay(events: CalendarEvent[]): [string, CalendarEvent[]][] {
  const map = new Map<string, CalendarEvent[]>();
  for (const ev of events) {
    const key = ev.dtstart.slice(0, 10);
    const bucket = map.get(key) ?? [];
    bucket.push(ev);
    map.set(key, bucket);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, evs]) => [k, evs.sort((a, b) => a.dtstart.localeCompare(b.dtstart))]);
}

function CalDAVPanel() {
  const config = useCalDAVConfig();
  const sync = useSyncCalDAV();
  const test = useTestCalDAV();
  const save = useSaveCalDAV();
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const connected = config.data && !config.data.local;

  async function onTest() {
    setMsg(null);
    const res = await test.mutateAsync({ url, username, password });
    setMsg(res.ok ? "Connection OK" : res.error || "Connection failed");
  }
  async function onSave() {
    setMsg(null);
    await save.mutateAsync({ url, username, password });
    setMsg("Saved");
  }

  return (
    <div className="caldav">
      <h2>CalDAV</h2>
      {connected ? (
        <div className="caldav-status">
          <span>
            Connected: <strong>{config.data?.username}</strong> @ {config.data?.url}
          </span>
          <button onClick={() => sync.mutate()} disabled={sync.isPending}>
            {sync.isPending ? "Syncing…" : "Sync now"}
          </button>
          {sync.data && (
            <span className="caldav-msg">
              +{sync.data.added ?? 0} added, {sync.data.updated ?? 0} updated
            </span>
          )}
        </div>
      ) : (
        <form className="caldav-form" onSubmit={(e) => e.preventDefault()}>
          <p className="caldav-hint">Connect a CalDAV server (Fastmail, iCloud, Nextcloud…) to sync events.</p>
          <input aria-label="CalDAV URL" placeholder="https://caldav.example.com/" value={url} onChange={(e) => setUrl(e.target.value)} />
          <input aria-label="CalDAV username" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input aria-label="CalDAV password" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="caldav-actions">
            <button type="button" onClick={onTest} disabled={!url || test.isPending}>
              Test
            </button>
            <button type="button" onClick={onSave} disabled={!url || save.isPending}>
              Connect
            </button>
          </div>
        </form>
      )}
      {msg && <p className="caldav-msg" role="status">{msg}</p>}
    </div>
  );
}

/** Chip for one event in the month grid / all-day strip (click = edit). */
function EventChip({ ev, onEdit }: { ev: CalendarEvent; onEdit: (ev: CalendarEvent) => void }) {
  return (
    <button
      className={`cal-chip ${ev.all_day ? "cal-chip--allday" : ""}`.trim()}
      aria-label={`Edit ${ev.summary}`}
      title={ev.summary}
      onClick={() => onEdit(ev)}
    >
      {!ev.all_day && <span className="cal-chip-time">{timeLabel(ev)}</span>}
      {ev.summary || "(no title)"}
    </button>
  );
}

function MonthView({
  anchor,
  events,
  onEdit,
  onOpenDay,
}: {
  anchor: Date;
  events: CalendarEvent[];
  onEdit: (ev: CalendarEvent) => void;
  onOpenDay: (day: Date) => void;
}) {
  const today = new Date();
  const weeks = monthGrid(anchor);
  const dows = weeks[0].map((d) => d.toLocaleDateString(undefined, { weekday: "short" }));
  return (
    <div className="cal-month" data-testid="month-grid">
      {dows.map((dow) => (
        <div key={dow} className="cal-dow">
          {dow}
        </div>
      ))}
      {weeks.flat().map((day) => {
        const evs = eventsOnDay(events, day);
        const out = day.getMonth() !== anchor.getMonth();
        const isToday = sameDay(day, today);
        return (
          <div
            key={isoDate(day)}
            data-testid={`cell-${isoDate(day)}`}
            className={`cal-cell ${out ? "cal-cell--out" : ""} ${isToday ? "cal-cell--today" : ""}`.trim()}
          >
            <button className="cal-daynum" aria-label={`Open ${isoDate(day)}`} onClick={() => onOpenDay(day)}>
              {day.getDate()}
            </button>
            {evs.slice(0, 3).map((ev) => (
              <EventChip key={ev.uid} ev={ev} onEdit={onEdit} />
            ))}
            {evs.length > 3 && (
              <button className="cal-more" onClick={() => onOpenDay(day)}>
                +{evs.length - 3} more
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Week and day views share this: an all-day strip + a 24h time grid. */
function TimeGridView({
  days,
  events,
  onEdit,
  onOpenDay,
}: {
  days: Date[];
  events: CalendarEvent[];
  onEdit: (ev: CalendarEvent) => void;
  onOpenDay: (day: Date) => void;
}) {
  const today = new Date();
  const scrollRef = useRef<HTMLDivElement>(null);
  // Open the grid at 07:00 instead of midnight.
  const dayKey = days.map(isoDate).join();
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_PX;
  }, [dayKey]);
  const cols = { "--cal-cols": days.length } as CSSProperties;

  return (
    <div className="timegrid" data-testid="timegrid">
      <div className="timegrid-head" style={cols}>
        <div className="timegrid-gutter" />
        {days.map((day) => (
          <button
            key={isoDate(day)}
            className={`timegrid-day ${sameDay(day, today) ? "timegrid-day--today" : ""}`.trim()}
            onClick={() => onOpenDay(day)}
          >
            {day.toLocaleDateString(undefined, days.length > 1 ? { weekday: "short", day: "numeric" } : { weekday: "long", month: "long", day: "numeric" })}
          </button>
        ))}
      </div>
      <div className="timegrid-allday" style={cols}>
        <div className="timegrid-gutter">all-day</div>
        {days.map((day) => (
          <div key={isoDate(day)} className="timegrid-allday-col">
            {eventsOnDay(events, day)
              .filter((ev) => ev.all_day)
              .map((ev) => (
                <EventChip key={ev.uid} ev={ev} onEdit={onEdit} />
              ))}
          </div>
        ))}
      </div>
      <div className="timegrid-scroll" ref={scrollRef}>
        <div className="timegrid-body" style={cols}>
          <div className="timegrid-hours">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="timegrid-hour">
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>
          {days.map((day) => (
            <div
              key={isoDate(day)}
              data-testid={`col-${isoDate(day)}`}
              className={`timegrid-col ${sameDay(day, today) ? "timegrid-col--today" : ""}`.trim()}
            >
              {layoutDayEvents(events, day).map((b) => (
                <button
                  key={b.ev.uid}
                  className="cal-block"
                  aria-label={`Edit ${b.ev.summary}`}
                  title={`${timeLabel(b.ev)} ${b.ev.summary}`}
                  style={{ top: `${b.topPct}%`, height: `${b.heightPct}%`, left: `${b.leftPct}%`, width: `${b.widthPct}%` }}
                  onClick={() => onEdit(b.ev)}
                >
                  <span className="cal-chip-time">{timeLabel(b.ev)}</span>
                  {b.ev.summary || "(no title)"}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AgendaView({
  events,
  onEdit,
  onDelete,
}: {
  events: CalendarEvent[];
  onEdit: (ev: CalendarEvent) => void;
  onDelete: (ev: CalendarEvent) => void;
}) {
  const grouped = groupByDay(events);
  return (
    <div className="calendar-agenda">
      {grouped.map(([day, evs]) => (
        <div key={day} className="agenda-day" data-testid={`day-${day}`}>
          <h3 className="agenda-date">{dayHeading(day)}</h3>
          <ul>
            {evs.map((ev) => (
              <li key={ev.uid} className="event-row">
                <span className="event-time">{timeLabel(ev)}</span>
                <span className="event-title">
                  {ev.summary || "(no title)"}
                  {ev.is_recurrence && <span className="event-recur" title="Recurring">↻</span>}
                </span>
                <span className="event-loc">{ev.location}</span>
                <button aria-label={`Edit ${ev.summary}`} onClick={() => onEdit(ev)}>
                  Edit
                </button>
                <ConfirmButton className="event-delete" title={`Delete ${ev.summary}`} onConfirm={() => onDelete(ev)} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Calendar: month grid / week / day time grids + agenda, create/edit/delete, CalDAV sync. */
export function Calendar() {
  const [view, setViewState] = useState<View>(() => {
    const saved = localStorage.getItem(VIEW_KEY);
    return VIEWS.includes(saved as View) ? (saved as View) : "month";
  });
  const [anchor, setAnchor] = useState(() => new Date());
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);

  function setView(v: View) {
    setViewState(v);
    localStorage.setItem(VIEW_KEY, v);
  }

  // Fetch range + toolbar label per view. Month/agenda fetch the whole visible
  // grid (incl. the lead-in/out days of adjacent months).
  let range: { start: string; end: string };
  let label: string;
  if (view === "week") {
    const days = weekDays(anchor);
    range = gridRange(days);
    const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    label = `${fmt(days[0])} – ${fmt(days[6])}, ${days[6].getFullYear()}`;
  } else if (view === "day") {
    range = gridRange([anchor]);
    label = anchor.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  } else {
    range = gridRange(monthGrid(anchor).flat());
    label = anchor.toLocaleString(undefined, { month: "long", year: "numeric" });
  }

  const events = useEvents(range.start, range.end);
  const calendars = useCalendars();
  const del = useDeleteEvent();

  function step(dir: 1 | -1) {
    if (view === "week") setAnchor(addDays(anchor, 7 * dir));
    else if (view === "day") setAnchor(addDays(anchor, dir));
    else setAnchor(addMonths(anchor, dir));
  }

  function openEdit(ev: CalendarEvent) {
    setEditing(ev);
    setFormOpen(true);
  }
  function openDay(day: Date) {
    setAnchor(day);
    setView("day");
  }
  function closeForm() {
    setEditing(null);
    setFormOpen(false);
  }

  const list = events.data ?? [];
  const unit = view === "week" ? "week" : view === "day" ? "day" : "month";

  return (
    <section className="calendar">
      <div className="calendar-head">
        <h1>Calendar</h1>
        <div className="view-tabs" role="group" aria-label="Calendar view">
          {VIEWS.map((v) => (
            <button key={v} className={view === v ? "active" : ""} onClick={() => setView(v)}>
              {VIEW_LABEL[v]}
            </button>
          ))}
        </div>
      </div>

      <div className="cal-toolbar">
        <div className="calendar-nav">
          <button aria-label={`Previous ${unit}`} onClick={() => step(-1)}>
            ‹
          </button>
          <button className="cal-today" onClick={() => setAnchor(new Date())}>
            Today
          </button>
          <button aria-label={`Next ${unit}`} onClick={() => step(1)}>
            ›
          </button>
        </div>
        <span className="calendar-month">{label}</span>
        <button className="cal-new" onClick={() => (formOpen ? closeForm() : setFormOpen(true))}>
          {formOpen ? "Close form" : "New event"}
        </button>
      </div>

      {formOpen && (
        <EventForm
          editing={editing}
          calendars={calendars.data ?? []}
          defaultDate={isoDate(anchor)}
          onDone={closeForm}
          onDelete={
            editing
              ? () => {
                  del.mutate(editing.series_uid || editing.uid);
                  closeForm();
                }
              : undefined
          }
        />
      )}

      {events.isLoading && <Spinner label="Loading events…" />}
      {!events.isLoading && list.length === 0 && <p className="calendar-empty">No events this {unit}.</p>}

      {view === "month" && <MonthView anchor={anchor} events={list} onEdit={openEdit} onOpenDay={openDay} />}
      {view === "week" && <TimeGridView days={weekDays(anchor)} events={list} onEdit={openEdit} onOpenDay={openDay} />}
      {view === "day" && <TimeGridView days={[anchor]} events={list} onEdit={openEdit} onOpenDay={openDay} />}
      {view === "agenda" && (
        <AgendaView events={list} onEdit={openEdit} onDelete={(ev) => del.mutate(ev.series_uid || ev.uid)} />
      )}

      <CalDAVPanel />
    </section>
  );
}
