/** Memory server-state hooks (TanStack Query over the typed client). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client.ts";
import { postForm } from "../../api/forms.ts";
import type { MemoryItem, MemorySearchResponse } from "../../api/types.ts";

export const memoryKey = ["memory"] as const;

/** The memory categories the backend accepts (mirrors MemoryAddRequest.validate_category). */
export const MEMORY_CATEGORIES = [
  "fact",
  "identity",
  "preference",
  "contact",
  "task",
  "project",
  "goal",
] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export function useMemories() {
  return useQuery({
    queryKey: memoryKey,
    queryFn: async (): Promise<MemoryItem[]> => {
      const { data, error } = await api.GET("/api/memory");
      if (error || !data) throw new Error("failed to load memories");
      return data.memory ?? [];
    },
  });
}

export interface AddMemoryInput {
  text: string;
  category: MemoryCategory;
}

export function useAddMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddMemoryInput) => {
      const { data, error } = await api.POST("/api/memory/add", {
        body: { ...input, source: "user" },
      });
      if (error || !data) throw new Error("failed to add memory");
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: memoryKey }),
  });
}

export function useDeleteMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (memory_id: string) => {
      const { error } = await api.DELETE("/api/memory/{memory_id}", {
        params: { path: { memory_id } },
      });
      if (error) throw new Error("failed to delete memory");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: memoryKey }),
  });
}

/** Search is a form endpoint (FastAPI Form params) — off the JSON seam, but the response is typed. */
export function useSearchMemories() {
  return useMutation({
    mutationFn: (query: string): Promise<MemorySearchResponse> =>
      postForm<MemorySearchResponse>("/api/memory/search", { query }),
  });
}
