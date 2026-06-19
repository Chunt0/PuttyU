/**
 * Worksheet-grading server-state hook (Phase-2 T6a — SPEC F4, CONTRACT D6).
 *
 * practice_routes.py was born typed, so this rides the real OpenAPI seam (the
 * `{ data, error } = await api.POST(...)` shape; throw on either). The body is the
 * typed `WorksheetGradeRequest` — `attachment_ids` come from the existing `uploadFiles`
 * helper (multipart upload is not on this typed client), `guide` is the hint-vs-answer
 * toggle. The graded per-problem feedback IS the confirmable artifact; nothing here
 * silently mutates state beyond the evidence the backend writes against the upload.
 */
import { useMutation } from "@tanstack/react-query";
import { api } from "../../api/client.ts";
import type { WorksheetGradeRequest, WorksheetGradeResponse } from "../../api/types.ts";

/** Grade a photographed/scanned worksheet. POST /api/practice/worksheet. */
export function useGradeWorksheet() {
  return useMutation({
    mutationFn: async (body: WorksheetGradeRequest): Promise<WorksheetGradeResponse> => {
      const { data, error } = await api.POST("/api/practice/worksheet", { body });
      if (error || !data) throw new Error("failed to grade worksheet");
      return data;
    },
  });
}
