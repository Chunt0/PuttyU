/** Task-scheduler server-state hooks (hand-typed; see ./types.ts for why). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, postJson, putJson, del } from "../../api/forms.ts";
import type { ActionMeta, EventMeta, OutputTarget, RunsResponse, Task, TaskInput, TasksResponse } from "./types.ts";

export const tasksKey = ["tasks"] as const;
export const taskMetaKey = ["tasks", "meta"] as const;
export const taskRunsKey = (id: string) => ["tasks", id, "runs"] as const;

export function useTasks() {
  return useQuery({
    queryKey: tasksKey,
    queryFn: async (): Promise<Task[]> => (await getJson<TasksResponse>("/api/tasks")).tasks ?? [],
  });
}

export interface TaskMeta {
  actions: ActionMeta[];
  events: EventMeta[];
  outputTargets: OutputTarget[];
}

export function useTaskMeta() {
  return useQuery({
    queryKey: taskMetaKey,
    queryFn: async (): Promise<TaskMeta> => {
      const [actions, events, targets] = await Promise.all([
        getJson<{ actions: ActionMeta[] }>("/api/tasks/meta/actions"),
        getJson<{ events: EventMeta[] }>("/api/tasks/meta/events"),
        getJson<{ targets: OutputTarget[] }>("/api/tasks/meta/output-targets"),
      ]);
      return {
        actions: actions.actions ?? [],
        events: events.events ?? [],
        outputTargets: targets.targets ?? [],
      };
    },
    staleTime: 60_000,
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TaskInput) => postJson<Task>("/api/tasks", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: tasksKey }),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: TaskInput }) => putJson<Task>(`/api/tasks/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: tasksKey }),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del<unknown>(`/api/tasks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: tasksKey }),
  });
}

export function useRunTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => postJson<unknown>(`/api/tasks/${id}/run`),
    onSuccess: () => qc.invalidateQueries({ queryKey: tasksKey }),
  });
}

export function useSetTaskPaused() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, paused }: { id: string; paused: boolean }) =>
      postJson<unknown>(`/api/tasks/${id}/${paused ? "pause" : "resume"}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: tasksKey }),
  });
}

export function useRegenerateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => postJson<{ ok: boolean; webhook_token: string }>(`/api/tasks/${id}/webhook-regenerate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: tasksKey }),
  });
}

export function useTaskRuns(id: string, enabled: boolean) {
  return useQuery({
    queryKey: taskRunsKey(id),
    enabled,
    queryFn: () => getJson<RunsResponse>(`/api/tasks/${id}/runs?limit=10`),
  });
}
