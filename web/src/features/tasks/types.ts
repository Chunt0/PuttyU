/**
 * Hand-typed Task Scheduler contract.
 *
 * `routes/task_routes.py` is a frozen god-file (Gate 6a allowlist, at its line ceiling), so
 * we can't add `response_model`s there without a P-T6-style split — same situation as the
 * provider seam (model_routes.py). Until that split, these types are hand-maintained against
 * the route handlers, and the tasks endpoints are NOT in ui-contract-endpoints.txt.
 */

export type TaskType = "llm" | "action" | "research";
export type ScheduleKind = "once" | "daily" | "weekly" | "monthly" | "cron";
export type TriggerType = "schedule" | "event" | "webhook";
export type TaskStatus = "active" | "paused" | "completed";

export interface Task {
  id: string;
  name: string;
  prompt: string | null;
  task_type: TaskType;
  action: string | null;
  schedule: ScheduleKind | null;
  scheduled_time: string | null;
  scheduled_day: number | null;
  scheduled_date: string | null;
  cron_expression: string | null;
  trigger_type: TriggerType;
  trigger_event: string | null;
  trigger_count: number | null;
  next_run: string | null;
  last_run: string | null;
  status: TaskStatus;
  output_target: string;
  run_count: number;
  webhook_token: string | null;
  is_builtin: boolean;
}

export interface TasksResponse {
  tasks: Task[];
}

export interface TaskRun {
  id: string;
  task_id: string;
  started_at: string | null;
  finished_at: string | null;
  status: string; // running | success | error | aborted | queued
  result: string | null;
  error: string | null;
  model: string | null;
}

export interface RunsResponse {
  runs: TaskRun[];
  total: number;
}

export interface ActionMeta {
  name: string;
  description: string;
}

export interface EventMeta {
  name: string;
  description: string;
}

export interface OutputTarget {
  value: string;
  label: string;
  description: string;
}

/** Body for POST /api/tasks and PUT /api/tasks/{id}. Schedule fields apply only to
 * `trigger_type: "schedule"`; event triggers carry trigger_event + trigger_count; webhook
 * triggers carry nothing extra (the backend mints the token on create). */
export interface TaskInput {
  name?: string;
  task_type: TaskType;
  prompt?: string;
  action?: string;
  trigger_type: TriggerType;
  schedule?: ScheduleKind;
  scheduled_time?: string;
  scheduled_day?: number | null;
  scheduled_date?: string | null;
  cron_expression?: string;
  trigger_event?: string;
  trigger_count?: number;
  output_target: string;
}
