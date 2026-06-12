/** Chat history server-state hook. The live stream is handled in Chat.tsx via streamChat. */
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client.ts";
import type { HistoryResponse } from "../../api/types.ts";

export const historyKey = (sessionId: string) => ["history", sessionId] as const;

export function useHistory(sessionId: string | null) {
  return useQuery({
    queryKey: historyKey(sessionId ?? ""),
    enabled: !!sessionId,
    queryFn: async (): Promise<HistoryResponse> => {
      const { data, error } = await api.GET("/api/history/{session_id}", {
        params: { path: { session_id: sessionId as string } },
      });
      if (error || !data) throw new Error("failed to load history");
      return data;
    },
  });
}
