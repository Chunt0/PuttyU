/**
 * Schedule-miner server-state hooks (Phase-2 T5 vertical-2 — SPEC F2, CONTRACT D8).
 *
 * schedule_routes.py was born typed, so both calls ride the real OpenAPI seam (the
 * `{ data, error } = await api.POST(...)` shape; throw on either). Two routes:
 *  - `mine` is READ-ONLY — it only proposes (untrusted-content invariant).
 *  - `apply` is THE ONLY WRITER — it persists the confirmed, unambiguous items, then
 *    we invalidate the calendar + todos + dashboard queries so every surface refreshes.
 *
 * `mine` can 503 when no model is configured for the extraction profile; we carry the
 * HTTP status on the thrown error so the screen can show a setup hint vs. a generic toast.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client.ts";
import type { MineApplyItem, MineApplyResponse, MineResponse } from "../../api/types.ts";

/** A mine/apply failure carrying the HTTP status (so the UI can branch on 503 = no model). */
export class ScheduleError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ScheduleError";
    this.status = status;
  }
}

/**
 * Mine a material for schedule-shaped content → a review sheet of PROPOSALS. Writes
 * nothing. 503 → no model is configured for the extraction profile (the caller shows a
 * setup hint instead of a generic error).
 */
export function useMineSchedule() {
  return useMutation({
    mutationFn: async ({ sourceId }: { sourceId: string }): Promise<MineResponse> => {
      const { data, error, response } = await api.POST("/api/schedule/{source_id}/mine", {
        params: { path: { source_id: sourceId } },
      });
      if (error || !data) throw new ScheduleError("failed to mine schedule", response.status);
      return data;
    },
  });
}

/**
 * Apply the user-confirmed proposals (the only writer). Creates/updates events + todos
 * with provenance, then invalidates the calendar, todos, and dashboard query trees so the
 * new dates show up everywhere without a manual refresh.
 */
export function useApplyProposals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      { sourceId, items }: { sourceId: string; items: MineApplyItem[] },
    ): Promise<MineApplyResponse> => {
      const { data, error, response } = await api.POST("/api/schedule/{source_id}/apply", {
        params: { path: { source_id: sourceId } },
        body: { items },
      });
      if (error || !data) throw new ScheduleError("failed to apply proposals", response.status);
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["calendar", "events"] });
      void qc.invalidateQueries({ queryKey: ["todos"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
