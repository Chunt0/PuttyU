/** Notes server-state hooks over the typed client (note_routes isn't frozen → real seam). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client.ts";
import type { Note } from "../../api/types.ts";

export const notesKey = (archived: boolean) => ["notes", archived] as const;

export function useNotes(archived: boolean) {
  return useQuery({
    queryKey: notesKey(archived),
    queryFn: async (): Promise<Note[]> => {
      const { data, error } = await api.GET("/api/notes", { params: { query: { archived } } });
      if (error || !data) throw new Error("failed to load notes");
      return data.notes ?? [];
    },
  });
}

export interface NoteInput {
  title: string;
  content: string;
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ queryKey: ["notes"] });
}

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NoteInput) => {
      const { data, error } = await api.POST("/api/notes", {
        body: { title: input.title, content: input.content, note_type: "note", pinned: false, repeat: "none", source: "user" },
      });
      if (error || !data) throw new Error("failed to create note");
      return data;
    },
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: NoteInput }) => {
      const { data, error } = await api.PUT("/api/notes/{note_id}", {
        params: { path: { note_id: id } },
        body: { title: input.title, content: input.content },
      });
      if (error || !data) throw new Error("failed to update note");
      return data;
    },
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.DELETE("/api/notes/{note_id}", { params: { path: { note_id: id } } });
      if (error) throw new Error("failed to delete note");
    },
    onSuccess: () => invalidate(qc),
  });
}

export function usePinNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.POST("/api/notes/{note_id}/pin", { params: { path: { note_id: id } } });
      if (error) throw new Error("failed to pin note");
    },
    onSuccess: () => invalidate(qc),
  });
}

export function useArchiveNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.POST("/api/notes/{note_id}/archive", { params: { path: { note_id: id } } });
      if (error) throw new Error("failed to archive note");
    },
    onSuccess: () => invalidate(qc),
  });
}
