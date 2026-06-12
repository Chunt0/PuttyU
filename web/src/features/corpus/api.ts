/**
 * Personal-docs (RAG) server-state hooks.
 *
 * S3-T3 design note: the future *tutoring* corpus will be a separate, shared, read-only
 * ChromaDB collection (subject/concept/grade metadata) alongside these owner-scoped
 * personal docs. Phase 1 wires only the personal-docs path; the upload UI is kept
 * metadata-extensible so the tutoring importer can ride the same screen later.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client.ts";
import { postFormData } from "../../api/forms.ts";
import type { PersonalFile, PersonalUploadResponse } from "../../api/types.ts";

export const personalKey = ["personal"] as const;
export const embeddingEndpointKey = ["embeddings", "endpoint"] as const;
export const embeddingModelsKey = ["embeddings", "models"] as const;

export function usePersonalDocs() {
  return useQuery({
    queryKey: personalKey,
    queryFn: async (): Promise<PersonalFile[]> => {
      const { data, error } = await api.GET("/api/personal");
      if (error || !data) throw new Error("failed to load personal documents");
      return data.files ?? [];
    },
  });
}

export function useUploadDocs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (files: File[]): Promise<PersonalUploadResponse> => {
      const form = new FormData();
      for (const f of files) form.append("files", f);
      return postFormData<PersonalUploadResponse>("/api/personal/upload", form);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: personalKey }),
  });
}

export function useDeleteDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (filepath: string) => {
      const { error } = await api.DELETE("/api/personal/file", {
        params: { query: { filepath } },
      });
      if (error) throw new Error("failed to delete document");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: personalKey }),
  });
}

/** Which embedding model is indexing the corpus (custom endpoint or built-in fastembed). */
export function useEmbeddingEndpoint() {
  return useQuery({
    queryKey: embeddingEndpointKey,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/embeddings/endpoint");
      if (error || !data) throw new Error("failed to load embedding endpoint");
      return data;
    },
    staleTime: 60_000,
  });
}

export function useActiveEmbeddingModel() {
  return useQuery({
    queryKey: embeddingModelsKey,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await api.GET("/api/embeddings/models");
      if (error || !data) throw new Error("failed to load embedding models");
      return data.find((m) => m.active)?.model ?? null;
    },
    staleTime: 60_000,
  });
}
