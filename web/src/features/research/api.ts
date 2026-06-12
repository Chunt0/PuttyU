/** Deep-research server-state hooks (typed client) + helpers. The progress stream lives in
 * api/streaming.ts (streamResearch); the report is HTML, shown via an iframe URL. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client.ts";
import type { ResearchLibraryItem, ResearchStartResponse } from "../../api/types.ts";

export const researchLibraryKey = ["research", "library"] as const;

export function useResearchLibrary() {
  return useQuery({
    queryKey: researchLibraryKey,
    queryFn: async (): Promise<ResearchLibraryItem[]> => {
      const { data, error } = await api.GET("/api/research/library");
      if (error || !data) throw new Error("failed to load research library");
      return data.research ?? [];
    },
  });
}

export function useStartResearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (query: string): Promise<ResearchStartResponse> => {
      const { data, error } = await api.POST("/api/research/start", {
        // max_rounds 0 = "Auto"; max_time is the server-side budget (seconds).
        body: { query, max_rounds: 0, max_time: 300 },
      });
      if (error || !data) throw new Error("failed to start research");
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: researchLibraryKey }),
  });
}

/** Same-origin URL for the visual HTML report (rendered in an iframe). */
export const reportUrl = (sessionId: string) =>
  `/api/research/report/${encodeURIComponent(sessionId)}`;
