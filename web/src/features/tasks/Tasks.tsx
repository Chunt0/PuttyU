import { useState } from "react";
import { Spinner } from "../../components/Spinner.tsx";
import { useTasks, useRunTask, useSetTaskPaused, useDeleteTask, useTaskRuns, useRegenerateWebhook } from "./api.ts";
import { TaskForm } from "./TaskForm.tsx";
import { ConfirmButton } from "../../components/ConfirmButton.tsx";
import type { Task } from "./types.ts";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function scheduleSummary(t: Task): string {
  if (t.trigger_type === "event") return `on ${t.trigger_event ?? "event"}`;
  if (t.trigger_type === "webhook") return "via webhook";
  switch (t.schedule) {
    case "cron":
      return `cron: ${t.cron_expression ?? ""}`;
    case "once":
      return `once${t.scheduled_date ? ` at ${new Date(t.scheduled_date).toLocaleString()}` : ""}`;
    case "daily":
      return `daily at ${t.scheduled_time ?? ""}`;
    case "weekly":
      return `weekly on ${WEEKDAYS[t.scheduled_day ?? 0]} at ${t.scheduled_time ?? ""}`;
    case "monthly":
      return `monthly on day ${t.scheduled_day ?? 1} at ${t.scheduled_time ?? ""}`;
    default:
      return t.schedule ?? "";
  }
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

function TaskRow({ task, onEdit }: { task: Task; onEdit: (t: Task) => void }) {
  const run = useRunTask();
  const setPaused = useSetTaskPaused();
  const del = useDeleteTask();
  const regen = useRegenerateWebhook();
  const [open, setOpen] = useState(false);
  const runs = useTaskRuns(task.id, open);
  const paused = task.status === "paused";
  const webhookUrl =
    task.trigger_type === "webhook" && task.webhook_token
      ? `${window.location.origin}/api/tasks/${task.id}/webhook/${task.webhook_token}`
      : null;

  return (
    <li className="task-row">
      <div className="task-row-main">
        <span className={`task-status task-status--${task.status}`} title={task.status} />
        <span className="task-name">{task.name || "(untitled)"}</span>
        <span className="task-kind">{task.task_type === "action" ? task.action : task.task_type}</span>
        <span className="task-sched">{scheduleSummary(task)}</span>
        <span className="task-next">next: {fmt(task.next_run)}</span>
        <div className="task-actions">
          <button aria-label={`Run ${task.name}`} onClick={() => run.mutate(task.id)} disabled={run.isPending}>
            Run
          </button>
          <button aria-label={`${paused ? "Resume" : "Pause"} ${task.name}`} onClick={() => setPaused.mutate({ id: task.id, paused: !paused })}>
            {paused ? "Resume" : "Pause"}
          </button>
          <button aria-label={`Edit ${task.name}`} onClick={() => onEdit(task)}>
            Edit
          </button>
          <button aria-label={`Runs ${task.name}`} onClick={() => setOpen((v) => !v)}>
            Runs
          </button>
          <ConfirmButton
            className="task-delete"
            title={`Delete ${task.name}`}
            onConfirm={() => del.mutate(task.id)}
          />
        </div>
      </div>
      {webhookUrl && (
        <div className="task-webhook" data-testid={`webhook-${task.id}`}>
          <span className="task-webhook-label">POST to fire:</span>
          <code className="task-webhook-url">{webhookUrl}</code>
          <button aria-label={`Regenerate webhook ${task.name}`} onClick={() => regen.mutate(task.id)} disabled={regen.isPending}>
            Regenerate
          </button>
        </div>
      )}
      {open && (
        <div className="task-runs" data-testid={`runs-${task.id}`}>
          {runs.isLoading && <p>Loading runs…</p>}
          {runs.data?.runs.length === 0 && <p className="task-empty">No runs yet.</p>}
          <ul>
            {runs.data?.runs.map((r) => (
              <li key={r.id} className="task-run">
                <span className={`run-status run-status--${r.status}`}>{r.status}</span>
                <span className="run-time">{fmt(r.started_at)}</span>
                <span className="run-result">{r.error || r.result || ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

/** Tasks: create/edit a scheduled task, run it now, pause/resume, delete, view its runs. */
export function Tasks() {
  const tasks = useTasks();
  const [editing, setEditing] = useState<Task | null>(null);

  return (
    <section className="tasks">
      <h1>Tasks</h1>

      <TaskForm editing={editing} onDone={() => setEditing(null)} />

      <div className="task-list">
        <h2>Scheduled ({tasks.data?.length ?? 0})</h2>
        {tasks.isLoading && <Spinner label="Loading tasks…" />}
        {!tasks.isLoading && (tasks.data?.length ?? 0) === 0 && (
          <p className="task-empty">No tasks yet — create one above.</p>
        )}
        <ul>
          {tasks.data?.map((t) => (
            <TaskRow key={t.id} task={t} onEdit={setEditing} />
          ))}
        </ul>
      </div>
    </section>
  );
}
