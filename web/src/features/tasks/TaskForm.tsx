import { useEffect, useState, type FormEvent } from "react";
import { useTaskMeta, useCreateTask, useUpdateTask } from "./api.ts";
import type { ScheduleKind, Task, TaskInput, TaskType, TriggerType } from "./types.ts";

const SCHEDULES: ScheduleKind[] = ["daily", "weekly", "monthly", "once", "cron"];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Create or edit a scheduled task. `editing` prefills the form and switches submit to PUT. */
export function TaskForm({ editing, onDone }: { editing: Task | null; onDone: () => void }) {
  const meta = useTaskMeta();
  const create = useCreateTask();
  const update = useUpdateTask();

  const [name, setName] = useState("");
  const [taskType, setTaskType] = useState<TaskType>("llm");
  const [prompt, setPrompt] = useState("");
  const [action, setAction] = useState("");
  const [trigger, setTrigger] = useState<TriggerType>("schedule");
  const [schedule, setSchedule] = useState<ScheduleKind>("daily");
  const [time, setTime] = useState("09:00");
  const [day, setDay] = useState(0);
  const [dateLocal, setDateLocal] = useState("");
  const [cron, setCron] = useState("");
  const [triggerEvent, setTriggerEvent] = useState("");
  const [triggerCount, setTriggerCount] = useState(1);
  const [outputTarget, setOutputTarget] = useState("session");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setName(editing.name ?? "");
    setTaskType(editing.task_type);
    setPrompt(editing.prompt ?? "");
    setAction(editing.action ?? "");
    setTrigger(editing.trigger_type ?? "schedule");
    setSchedule((editing.schedule as ScheduleKind) ?? "daily");
    setTime(editing.scheduled_time ?? "09:00");
    setDay(editing.scheduled_day ?? 0);
    setCron(editing.cron_expression ?? "");
    setTriggerEvent(editing.trigger_event ?? "");
    setTriggerCount(editing.trigger_count ?? 1);
    setOutputTarget(editing.output_target ?? "session");
  }, [editing]);

  function buildInput(): TaskInput | null {
    const input: TaskInput = {
      name: name.trim() || undefined,
      task_type: taskType,
      trigger_type: trigger,
      output_target: outputTarget,
    };
    if (taskType === "action") {
      if (!action) return setError("Pick an action."), null;
      input.action = action;
    } else {
      if (!prompt.trim()) return setError("Enter a prompt."), null;
      input.prompt = prompt.trim();
    }
    if (trigger === "event") {
      if (!triggerEvent) return setError("Pick an event."), null;
      input.trigger_event = triggerEvent;
      input.trigger_count = Math.max(1, Number(triggerCount) || 1);
    } else if (trigger === "webhook") {
      // No schedule/event fields — the backend mints the webhook token on create.
    } else {
      input.schedule = schedule;
      if (schedule === "cron") {
        if (!cron.trim()) return setError("Enter a cron expression."), null;
        input.cron_expression = cron.trim();
      } else if (schedule === "once") {
        if (!dateLocal) return setError("Pick a date and time."), null;
        input.scheduled_date = new Date(dateLocal).toISOString();
      } else {
        input.scheduled_time = time;
        if (schedule === "weekly" || schedule === "monthly") input.scheduled_day = Number(day);
      }
    }
    return input;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const input = buildInput();
    if (!input) return;
    try {
      if (editing) await update.mutateAsync({ id: editing.id, input });
      else await create.mutateAsync(input);
      if (!editing) {
        setName("");
        setPrompt("");
      }
      onDone();
    } catch {
      setError("Could not save the task. Check the schedule fields.");
    }
  }

  const pending = create.isPending || update.isPending;

  return (
    <form className="task-form" onSubmit={onSubmit}>
      <h2>{editing ? "Edit task" : "New task"}</h2>

      <label>
        Name (optional)
        <input aria-label="Task name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Morning brief" />
      </label>

      <label>
        Type
        <select aria-label="Task type" value={taskType} onChange={(e) => setTaskType(e.target.value as TaskType)}>
          <option value="llm">LLM prompt</option>
          <option value="research">Deep research</option>
          <option value="action">Built-in action</option>
        </select>
      </label>

      {taskType === "action" ? (
        <label>
          Action
          <select aria-label="Action" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">Select an action…</option>
            {meta.data?.actions.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label>
          Prompt
          <textarea aria-label="Prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} placeholder="Summarize today's AI news" />
        </label>
      )}

      <label>
        Trigger
        <select aria-label="Trigger" value={trigger} onChange={(e) => setTrigger(e.target.value as TriggerType)}>
          <option value="schedule">On a schedule</option>
          <option value="event">On an event</option>
          <option value="webhook">Via webhook</option>
        </select>
      </label>

      {trigger === "event" && (
        <>
          <label>
            Event
            <select aria-label="Event" value={triggerEvent} onChange={(e) => setTriggerEvent(e.target.value)}>
              <option value="">Select an event…</option>
              {meta.data?.events.map((ev) => (
                <option key={ev.name} value={ev.name}>
                  {ev.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fire every N times
            <input aria-label="Event count" type="number" min={1} value={triggerCount} onChange={(e) => setTriggerCount(Number(e.target.value))} />
          </label>
        </>
      )}

      {trigger === "webhook" && (
        <p className="task-hint">A webhook URL is generated when you create the task — POST to it to fire the task.</p>
      )}

      {trigger === "schedule" && (
      <label>
        Schedule
        <select aria-label="Schedule" value={schedule} onChange={(e) => setSchedule(e.target.value as ScheduleKind)}>
          {SCHEDULES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      )}

      {trigger === "schedule" && schedule === "cron" && (
        <label>
          Cron expression
          <input aria-label="Cron expression" value={cron} onChange={(e) => setCron(e.target.value)} placeholder="*/30 * * * *" />
        </label>
      )}
      {trigger === "schedule" && schedule === "once" && (
        <label>
          Date &amp; time
          <input aria-label="Date" type="datetime-local" value={dateLocal} onChange={(e) => setDateLocal(e.target.value)} />
        </label>
      )}
      {trigger === "schedule" && (schedule === "daily" || schedule === "weekly" || schedule === "monthly") && (
        <label>
          Time
          <input aria-label="Time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      )}
      {trigger === "schedule" && schedule === "weekly" && (
        <label>
          Day of week
          <select aria-label="Day of week" value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </label>
      )}
      {trigger === "schedule" && schedule === "monthly" && (
        <label>
          Day of month
          <input aria-label="Day of month" type="number" min={1} max={31} value={day || 1} onChange={(e) => setDay(Number(e.target.value))} />
        </label>
      )}

      <label>
        Deliver result to
        <select aria-label="Output target" value={outputTarget} onChange={(e) => setOutputTarget(e.target.value)}>
          {(meta.data?.outputTargets ?? [{ value: "session", label: "Session", description: "" }]).map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <div className="task-form-actions">
        <button type="submit" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Create task"}
        </button>
        {editing && (
          <button type="button" onClick={onDone}>
            Cancel
          </button>
        )}
      </div>
      {error && <p className="task-error" role="alert">{error}</p>}
    </form>
  );
}
