/** Session server-state hooks. List is JSON (typed client); create is a form endpoint. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client.ts";
import { del, getJson, patchForm, postForm } from "../../api/forms.ts";
import type { Session, SessionResponse } from "../../api/types.ts";
import type { DefaultChat } from "../models/types.ts";
import { useCourseStore } from "../courses/store.ts";

export const sessionsKey = ["sessions"] as const;

/** Sessions, optionally scoped to a course (ADR 0004). `null` = all (Home). */
export function useSessions(courseId: string | null = null) {
  return useQuery({
    queryKey: courseId ? ([...sessionsKey, courseId] as const) : sessionsKey,
    queryFn: async (): Promise<Session[]> => {
      const { data, error } = await api.GET("/api/sessions", {
        params: { query: courseId ? { course_id: courseId } : {} },
      });
      if (error || !data) throw new Error("failed to load sessions");
      return data;
    },
  });
}

export function useCreateSession() {
  const qc = useQueryClient();
  return useMutation<SessionResponse, Error, string>({
    mutationFn: async (name: string) => {
      // Create against the user's default endpoint+model so chat_stream has a model to
      // call. Falls back to skip_validation when no provider is configured yet (Slice 1).
      const def = await getJson<DefaultChat>("/api/default-chat").catch(() => null);
      const fields =
        def?.endpoint_id && def.model
          ? { name, endpoint_id: def.endpoint_id, model: def.model }
          : { name, skip_validation: "true" };
      // A chat started under a course tab belongs to that course (ADR 0004).
      const courseId = useCourseStore.getState().activeCourseId;
      return postForm<SessionResponse>(
        "/api/session",
        courseId ? { ...fields, course_id: courseId } : fields,
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: sessionsKey }),
  });
}

export function useRenameSession() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { id: string; name: string }>({
    mutationFn: ({ id, name }) =>
      patchForm(`/api/session/${encodeURIComponent(id)}`, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: sessionsKey }),
  });
}

export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, string>({
    mutationFn: (id) => del(`/api/session/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: sessionsKey }),
  });
}
