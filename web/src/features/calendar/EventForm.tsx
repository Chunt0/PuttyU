import { useEffect, useState, type FormEvent } from "react";
import { ConfirmButton } from "../../components/ConfirmButton.tsx";
import { Switch } from "../../components/Switch.tsx";
import { useCreateEvent, useUpdateEvent } from "./api.ts";
import type { Calendar, CalendarEvent, EventInput } from "./types.ts";

/** A datetime-local value ("YYYY-MM-DDTHH:MM") for `iso`, or a date value ("YYYY-MM-DD"). */
function toInputValue(iso: string, allDay: boolean): string {
  if (!iso) return "";
  return allDay ? iso.slice(0, 10) : iso.slice(0, 16);
}

/** Create or edit a calendar event. Recurring instances edit the whole series (via series_uid). */
export function EventForm({
  editing,
  calendars,
  defaultDate,
  onDone,
  onDelete,
}: {
  editing: CalendarEvent | null;
  calendars: Calendar[];
  defaultDate: string;
  onDone: () => void;
  /** Shown when editing — deletes the whole series (two-step confirm). */
  onDelete?: () => void;
}) {
  const create = useCreateEvent();
  const update = useUpdateEvent();

  const [summary, setSummary] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState(`${defaultDate}T09:00`);
  const [end, setEnd] = useState(`${defaultDate}T10:00`);
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [calendarHref, setCalendarHref] = useState("");
  const [rrule, setRrule] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setSummary(editing.summary ?? "");
    setAllDay(editing.all_day);
    setStart(toInputValue(editing.dtstart, editing.all_day));
    setEnd(toInputValue(editing.dtend, editing.all_day));
    setLocation(editing.location ?? "");
    setDescription(editing.description ?? "");
    setCalendarHref(editing.calendar_href ?? "");
    setRrule(editing.rrule ?? "");
  }, [editing]);

  function onToggleAllDay(next: boolean) {
    setAllDay(next);
    setStart((s) => (next ? s.slice(0, 10) : `${s.slice(0, 10)}T09:00`));
    setEnd((e) => (next ? e.slice(0, 10) : `${e.slice(0, 10)}T10:00`));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!summary.trim() || !start) {
      setError("A title and start are required.");
      return;
    }
    const input: EventInput = {
      summary: summary.trim(),
      dtstart: start,
      all_day: allDay,
      description: description.trim(),
      location: location.trim(),
    };
    if (end) input.dtend = end;
    if (calendarHref) input.calendar_href = calendarHref;
    if (rrule.trim()) input.rrule = rrule.trim();

    try {
      if (editing) await update.mutateAsync({ uid: editing.series_uid || editing.uid, input });
      else await create.mutateAsync(input);
      onDone();
    } catch {
      setError("Could not save the event.");
    }
  }

  const pending = create.isPending || update.isPending;

  return (
    <form className="event-form" onSubmit={onSubmit}>
      <h2>{editing ? "Edit event" : "New event"}</h2>

      <label>
        Title
        <input aria-label="Event title" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Lesson with Sam" />
      </label>

      <div className="event-allday">
        <Switch checked={allDay} onChange={onToggleAllDay} label="All day" />
      </div>

      <label>
        Start
        <input
          aria-label="Start"
          type={allDay ? "date" : "datetime-local"}
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
      </label>
      <label>
        End
        <input
          aria-label="End"
          type={allDay ? "date" : "datetime-local"}
          value={end}
          onChange={(e) => setEnd(e.target.value)}
        />
      </label>

      {calendars.length > 0 && (
        <label>
          Calendar
          <select aria-label="Calendar" value={calendarHref} onChange={(e) => setCalendarHref(e.target.value)}>
            <option value="">Default</option>
            {calendars.map((c) => (
              <option key={c.href} value={c.href}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label>
        Location
        <input aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Room / link" />
      </label>
      <label>
        Notes
        <textarea aria-label="Notes" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
      </label>
      <label>
        Repeat (RRULE, optional)
        <input aria-label="Repeat" value={rrule} onChange={(e) => setRrule(e.target.value)} placeholder="FREQ=WEEKLY;BYDAY=MO" />
      </label>

      <div className="event-form-actions">
        <button type="submit" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Create event"}
        </button>
        {editing && (
          <button type="button" onClick={onDone}>
            Cancel
          </button>
        )}
        {editing && onDelete && (
          <ConfirmButton className="event-delete" title="Delete event" onConfirm={onDelete} />
        )}
      </div>
      {error && <p className="event-error" role="alert">{error}</p>}
    </form>
  );
}
