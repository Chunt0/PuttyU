/**
 * Library + course-materials server-state hooks (Phase-2 T2b — SPEC F2).
 *
 * corpus_routes.py is born typed, so everything here rides the real OpenAPI seam
 * (openapi-fetch) except the multipart material upload, which uses postFormData with
 * the response type named from the generated schema — same pattern as Slice 3.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client.ts";
import { postFormData } from "../../api/forms.ts";
import type { CorpusMaterialUpload, CorpusSource, CorpusTocNode } from "../../api/types.ts";

export const corpusSourcesKey = ["corpus-sources"] as const;
export const tocKey = (sourceId: string) => ["corpus-toc", sourceId] as const;

/** Everything the caller can see: shared library sources (kind=library) and their own
 * uploaded materials (kind=material). Components split/filter by `kind`. */
export function useCorpusSources() {
  return useQuery({
    queryKey: corpusSourcesKey,
    queryFn: async (): Promise<CorpusSource[]> => {
      const { data, error } = await api.GET("/api/corpus/sources");
      if (error || !data) throw new Error("failed to load library sources");
      return data.sources ?? [];
    },
  });
}

/** A source's heading tree — fetched lazily when the user expands it. */
export function useSourceToc(sourceId: string | null) {
  return useQuery({
    queryKey: tocKey(sourceId ?? ""),
    enabled: sourceId !== null,
    queryFn: async (): Promise<CorpusTocNode[]> => {
      const { data, error } = await api.GET("/api/corpus/sources/{source_id}/toc", {
        params: { path: { source_id: sourceId ?? "" } },
      });
      if (error || !data) throw new Error("failed to load table of contents");
      return data.toc ?? [];
    },
    staleTime: 60_000,
  });
}

export interface MaterialUploadInput {
  files: File[];
  courseId?: string | null;
  tags?: string[];
  title?: string;
}

/** Upload one material: a PDF, or several images the backend assembles into ONE PDF
 * (the multi-page webcam capture path). Idempotent server-side by content hash. */
export function useUploadMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MaterialUploadInput): Promise<CorpusMaterialUpload> => {
      const form = new FormData();
      for (const f of input.files) form.append("files", f);
      if (input.courseId) form.set("course_id", input.courseId);
      if (input.tags?.length) form.set("tags", JSON.stringify(input.tags));
      if (input.title) form.set("title", input.title);
      return postFormData<CorpusMaterialUpload>("/api/corpus/materials", form);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: corpusSourcesKey }),
  });
}

/** Replace a material's tag list (the backend stores tags whole, not incrementally). */
export function useReplaceTags() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ sourceId, tags }: { sourceId: string; tags: string[] }) => {
      const { data, error } = await api.PATCH("/api/corpus/materials/{source_id}/tags", {
        params: { path: { source_id: sourceId } },
        body: { tags },
      });
      if (error || !data) throw new Error("failed to update tags");
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: corpusSourcesKey }),
  });
}

export function useDeleteMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sourceId: string) => {
      const { error } = await api.DELETE("/api/corpus/materials/{source_id}", {
        params: { path: { source_id: sourceId } },
      });
      if (error) throw new Error("failed to delete material");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: corpusSourcesKey }),
  });
}
