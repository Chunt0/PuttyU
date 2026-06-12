import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tasks } from "./Tasks.tsx";
import { renderWithProviders, jsonResponse, stubFetch, findCall, callInfo } from "../../test/util.tsx";

afterEach(() => vi.unstubAllGlobals());

const TASK = {
  id: "t1", name: "Morning brief", prompt: "summarize AI news", task_type: "llm", action: null,
  schedule: "daily", scheduled_time: "09:00", scheduled_day: null, scheduled_date: null, cron_expression: null,
  trigger_type: "schedule", trigger_event: null, next_run: "2026-06-06T09:00:00Z", last_run: null,
  status: "active", output_target: "session", run_count: 3, is_builtin: false,
};
const RUNS = {
  runs: [{ id: "r1", task_id: "t1", started_at: "2026-06-05T09:00:00Z", finished_at: "2026-06-05T09:01:00Z", status: "success", result: "brief delivered", error: null, model: "m" }],
  total: 1,
};

function mockTasks() {
  // Specific paths FIRST — "/run" is a prefix of "/runs", and "/api/tasks" is a prefix of all.
  return stubFetch([
    ["/api/tasks/meta/actions", () => jsonResponse({ actions: [{ name: "tidy_sessions", description: "Tidy chats" }] })],
    ["/api/tasks/meta/events", () => jsonResponse({ events: [{ name: "memory_added", description: "Fires when a memory is added" }, { name: "session_created", description: "new session" }] })],
    ["/api/tasks/meta/output-targets", () => jsonResponse({ targets: [{ value: "session", label: "Session", description: "" }, { value: "notification", label: "Notification", description: "" }] })],
    ["/api/tasks/t1/runs", () => jsonResponse(RUNS)],
    ["/api/tasks/t1/run", () => jsonResponse({ ok: true, message: "Task triggered" })],
    ["/api/tasks/t1/webhook-regenerate", () => jsonResponse({ ok: true, webhook_token: "newtok" })],
    ["/api/tasks/t1", () => jsonResponse({ ok: true })],
    ["/api/tasks", (_u, init) => (init?.method === "POST" ? jsonResponse({ ...TASK, id: "t2" }) : jsonResponse({ tasks: [TASK] }))],
  ]);
}

const WEBHOOK_TASK = {
  ...TASK, id: "t1", name: "Hook task", trigger_type: "webhook", schedule: null,
  scheduled_time: null, webhook_token: "secrettoken123", next_run: null,
};

describe("Tasks", () => {
  it("lists scheduled tasks with their schedule summary", async () => {
    mockTasks();
    renderWithProviders(<Tasks />);
    expect(await screen.findByText("Morning brief")).toBeInTheDocument();
    expect(screen.getByText("daily at 09:00")).toBeInTheDocument();
    expect(screen.getByText("Scheduled (1)")).toBeInTheDocument();
  });

  it("creates a daily LLM task from the form", async () => {
    const fetchMock = mockTasks();
    renderWithProviders(<Tasks />);
    await screen.findByText("Morning brief");

    await userEvent.type(screen.getByLabelText("Prompt"), "summarize the news");
    await userEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() => {
      const post = findCall(fetchMock, "/api/tasks", "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(callInfo(post!).body as string);
      expect(body).toMatchObject({
        task_type: "llm",
        prompt: "summarize the news",
        trigger_type: "schedule",
        schedule: "daily",
        scheduled_time: "09:00",
        output_target: "session",
      });
    });
  });

  it("runs a task now", async () => {
    const fetchMock = mockTasks();
    renderWithProviders(<Tasks />);
    await screen.findByText("Morning brief");
    await userEvent.click(screen.getByRole("button", { name: "Run Morning brief" }));
    await waitFor(() => expect(findCall(fetchMock, "/api/tasks/t1/run", "POST")).toBeTruthy());
  });

  it("expands a task to show its runs", async () => {
    mockTasks();
    renderWithProviders(<Tasks />);
    await screen.findByText("Morning brief");
    await userEvent.click(screen.getByRole("button", { name: "Runs Morning brief" }));

    const panel = await screen.findByTestId("runs-t1");
    expect(await within(panel).findByText("brief delivered")).toBeInTheDocument();
    expect(within(panel).getByText("success")).toBeInTheDocument();
  });

  it("deletes a task", async () => {
    const fetchMock = mockTasks();
    renderWithProviders(<Tasks />);
    await screen.findByText("Morning brief");
    // Two-step destructive confirm: arm, then confirm.
    await userEvent.click(screen.getByRole("button", { name: "Delete Morning brief" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Morning brief" }));
    await waitFor(() => expect(findCall(fetchMock, "/api/tasks/t1", "DELETE")).toBeTruthy());
  });

  it("creates an event-triggered task", async () => {
    const fetchMock = mockTasks();
    renderWithProviders(<Tasks />);
    await screen.findByText("Morning brief");

    await userEvent.type(screen.getByLabelText("Prompt"), "react to new memories");
    await userEvent.selectOptions(screen.getByLabelText("Trigger"), "event");
    await userEvent.selectOptions(screen.getByLabelText("Event"), "memory_added");
    await userEvent.clear(screen.getByLabelText("Event count"));
    await userEvent.type(screen.getByLabelText("Event count"), "3");
    await userEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() => {
      const post = findCall(fetchMock, "/api/tasks", "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(callInfo(post!).body as string);
      expect(body).toMatchObject({ trigger_type: "event", trigger_event: "memory_added", trigger_count: 3 });
      expect(body.schedule).toBeUndefined();
    });
  });

  it("creates a webhook task", async () => {
    const fetchMock = mockTasks();
    renderWithProviders(<Tasks />);
    await screen.findByText("Morning brief");

    await userEvent.type(screen.getByLabelText("Prompt"), "fire on demand");
    await userEvent.selectOptions(screen.getByLabelText("Trigger"), "webhook");
    expect(screen.getByText(/webhook URL is generated/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() => {
      const post = findCall(fetchMock, "/api/tasks", "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(callInfo(post!).body as string);
      expect(body.trigger_type).toBe("webhook");
      expect(body.schedule).toBeUndefined();
    });
  });

  it("shows a webhook task's fire URL and regenerates the token", async () => {
    const fetchMock = stubFetch([
      ["/api/tasks/meta/actions", () => jsonResponse({ actions: [] })],
      ["/api/tasks/meta/events", () => jsonResponse({ events: [] })],
      ["/api/tasks/meta/output-targets", () => jsonResponse({ targets: [{ value: "session", label: "Session", description: "" }] })],
      ["/api/tasks/t1/webhook-regenerate", () => jsonResponse({ ok: true, webhook_token: "newtok" })],
      ["/api/tasks", () => jsonResponse({ tasks: [WEBHOOK_TASK] })],
    ]);
    renderWithProviders(<Tasks />);
    await screen.findByText("Hook task");

    expect(screen.getByText(/\/api\/tasks\/t1\/webhook\/secrettoken123/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Regenerate webhook Hook task" }));
    await waitFor(() => expect(findCall(fetchMock, "/api/tasks/t1/webhook-regenerate", "POST")).toBeTruthy());
  });
});
