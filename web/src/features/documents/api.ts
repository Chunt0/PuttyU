/** Documents server-state hooks (hand-typed; document_routes.py is frozen). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, postJson, putJson, del, postFormData } from "../../api/forms.ts";
import type { DocCreateInput, DocFull, DocItem, DocVersion, LibraryResponse } from "./types.ts";

export const libraryKey = (search: string) => ["documents", "library", search] as const;
export const documentKey = (id: string) => ["documents", "doc", id] as const;
export const versionsKey = (id: string) => ["documents", "versions", id] as const;

export function useLibrary(search: string) {
  return useQuery({
    queryKey: libraryKey(search),
    queryFn: async (): Promise<DocItem[]> => {
      const q = search ? `?search=${encodeURIComponent(search)}` : "";
      return (await getJson<LibraryResponse>(`/api/documents/library${q}`)).documents ?? [];
    },
  });
}

export function useDocument(id: string | null) {
  return useQuery({
    queryKey: documentKey(id ?? ""),
    enabled: !!id,
    queryFn: () => getJson<DocFull>(`/api/document/${id}`),
  });
}

export function useVersions(id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: versionsKey(id ?? ""),
    enabled: !!id && enabled,
    queryFn: () => getJson<DocVersion[]>(`/api/document/${id}/versions`),
  });
}

const invalidateLib = (qc: ReturnType<typeof useQueryClient>) =>
  qc.invalidateQueries({ queryKey: ["documents", "library"] });

export function useCreateDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DocCreateInput) => postJson<DocFull>("/api/document", input),
    onSuccess: () => invalidateLib(qc),
  });
}

export function useUpdateDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      putJson<DocFull>(`/api/document/${id}`, { content, summary: "Manual edit" }),
    onSuccess: (_d, { id }) => {
      void qc.invalidateQueries({ queryKey: documentKey(id) });
      void qc.invalidateQueries({ queryKey: versionsKey(id) });
      void invalidateLib(qc);
    },
  });
}

export function useDeleteDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del<{ status: string; id: string }>(`/api/document/${id}`),
    onSuccess: () => invalidateLib(qc),
  });
}

export function useArchiveDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      postJson<{ ok: boolean; archived: boolean }>(`/api/document/${id}/archive?archived=${archived}`),
    onSuccess: () => invalidateLib(qc),
  });
}

export function useRestoreVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, num }: { id: string; num: number }) => postJson<DocFull>(`/api/document/${id}/restore/${num}`),
    onSuccess: (_d, { id }) => {
      void qc.invalidateQueries({ queryKey: documentKey(id) });
      void qc.invalidateQueries({ queryKey: versionsKey(id) });
    },
  });
}

/** Import a PDF (incl. scanned/handwritten work — image-heavy pages get VL text extraction). */
export function useImportPdf() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return postFormData<DocFull>("/api/documents/import-pdf", form);
    },
    onSuccess: () => invalidateLib(qc),
  });
}
