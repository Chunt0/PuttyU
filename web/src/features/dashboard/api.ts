/**
 * Dashboard + todos server-state hooks (Phase-2 T5 — SPEC F11, CONTRACT D2/D3).
 *
 * Both dashboard_routes.py and todo_routes.py were born typed, so everything here
 * rides the real OpenAPI seam (the `{ data, error } = await api.GET/POST(...)` shape;
 * throw on either). Mirrors features/practice/api.ts. The aggregator is read-only; the
 * todo mutations all invalidate the todos query key so the Todos card stays in sync.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client.ts";
import type {
  DashboardResponse,
  TodoCreateRequest,
  TodoResponse,
  TodoUpdateRequest,
} from "../../api/types.ts";

/** Query key for the dashboard aggregator. `null` course = the cross-course Home view. */
export const dashboardKey = (courseId: string | null) =>
  ["dashboard", courseId ?? "all"] as const;

/** Query key for the todos list. Scoped by course + the done filter (open/done/both). */
export const todosKey = (courseId: string | null, done?: boolean) =>
  ["todos", courseId ?? "all", done ?? "both"] as const;

// ── Dashboard aggregator (D3) ────────────────────────────────────────────────

/**
 * The landing surface: review_count, weak_spots, insights, reading. `courseId === null`
 * spans all active courses (the Home dashboard) — so this is NOT gated on a course.
 * Read-only; the route degrades per-section and never 500s.
 */
export function useDashboard(courseId: string | null) {
  return useQuery({
    queryKey: dashboardKey(courseId),
    queryFn: async (): Promise<DashboardResponse> => {
      const { data, error } = await api.GET("/api/dashboard", {
        params: { query: { course_id: courseId } },
      });
      if (error || !data) throw new Error("failed to load dashboard");
      return data;
    },
  });
}

// ── Todos (D2) — manual CRUD ─────────────────────────────────────────────────

/**
 * The caller's todos. `courseId === null` spans all courses (Home). `done` filters:
 * `false` → open only, `true` → completed only, omitted → both.
 */
export function useTodos(courseId: string | null, done?: boolean) {
  return useQuery({
    queryKey: todosKey(courseId, done),
    queryFn: async (): Promise<TodoResponse[]> => {
      const { data, error } = await api.GET("/api/todos", {
        params: { query: { course_id: courseId, done } },
      });
      if (error || !data) throw new Error("failed to load todos");
      return data.todos ?? [];
    },
  });
}

/** All todos queries — invalidated by every mutation so each card stays in sync. */
function invalidateTodos(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ queryKey: ["todos"] });
}

/** Create a manual todo (text required; course_id null = Home). Invalidates the list. */
export function useCreateTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: TodoCreateRequest): Promise<TodoResponse> => {
      const { data, error } = await api.POST("/api/todos", { body });
      if (error || !data) throw new Error("failed to create todo");
      return data;
    },
    onSuccess: () => void invalidateTodos(qc),
  });
}

/** Edit a todo's text / due date / course. Invalidates the list. */
export function useUpdateTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      { id, body }: { id: string; body: TodoUpdateRequest },
    ): Promise<TodoResponse> => {
      const { data, error } = await api.PATCH("/api/todos/{todo_id}", {
        params: { path: { todo_id: id } },
        body,
      });
      if (error || !data) throw new Error("failed to update todo");
      return data;
    },
    onSuccess: () => void invalidateTodos(qc),
  });
}

/** Mark a todo done (stamps done_at) or reopen it (clears done_at). Invalidates the list. */
export function useToggleTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      { id, done }: { id: string; done: boolean },
    ): Promise<TodoResponse> => {
      const { data, error } = await api.POST("/api/todos/{todo_id}/done", {
        params: { path: { todo_id: id }, query: { done } },
      });
      if (error || !data) throw new Error("failed to toggle todo");
      return data;
    },
    onSuccess: () => void invalidateTodos(qc),
  });
}

/** Hard-delete a todo (todos are ephemeral). Invalidates the list. */
export function useDeleteTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await api.DELETE("/api/todos/{todo_id}", {
        params: { path: { todo_id: id } },
      });
      if (error) throw new Error("failed to delete todo");
    },
    onSuccess: () => void invalidateTodos(qc),
  });
}
