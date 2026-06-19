/**
 * Practice-engine server-state hooks (Phase-2 T4 — SPEC F3/F4, ADR 0005).
 *
 * practice_routes.py was born typed, so everything here rides the real OpenAPI seam
 * (the `{ data, error } = await api.GET/POST(...)` shape; throw on either). One hook
 * per endpoint — the five screens (Review, Gym, Exam, Calibration, Explain) consume
 * these so no screen duplicates client/type code.
 *
 * Answers carry `attachment_ids: string[]` (photo/file answers); screens get those ids
 * from the existing `uploadFiles` helper in features/chat/attachments.ts — multipart
 * upload does NOT ride this typed client, so it's deliberately not wired here.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client.ts";
import type {
  AnswerRequest,
  AnswerResponse,
  CalibrationAnswerRequest,
  CalibrationAnswerResponse,
  CalibrationFinishRequest,
  CalibrationFinishResponse,
  CalibrationStartRequest,
  CalibrationStartResponse,
  ExamStartRequest,
  ExamStartResponse,
  ExamSubmitRequest,
  ExamSubmitResponse,
  ExplainStartRequest,
  ExplainStartResponse,
  GymAnswerRequest,
  GymAnswerResponse,
  GymItemResponse,
  GymNextRequest,
  QueueResponse,
} from "../../api/types.ts";

/** Query key for the review queue. `null` course = the cross-course queue (all courses). */
export const reviewQueueKey = (courseId: string | null) =>
  ["practice-queue", courseId ?? "all"] as const;

// ── Review queue (D1–D4) ─────────────────────────────────────────────────────

/**
 * Today's assembled review queue + due counts. `courseId === null` is allowed and
 * means "all courses" (the queue can span courses), so this is NOT gated on a course.
 */
export function useReviewQueue(courseId: string | null) {
  return useQuery({
    queryKey: reviewQueueKey(courseId),
    queryFn: async (): Promise<QueueResponse> => {
      const { data, error } = await api.GET("/api/practice/queue", {
        params: { query: { course_id: courseId } },
      });
      if (error || !data) throw new Error("failed to load review queue");
      return data;
    },
  });
}

/** Grade a queued review answer (writes mastery evidence). Invalidates the queue. */
export function useAnswerQueueItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: AnswerRequest): Promise<AnswerResponse> => {
      const { data, error } = await api.POST("/api/practice/queue/answer", { body });
      if (error || !data) throw new Error("failed to grade review answer");
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["practice-queue"] });
    },
  });
}

// ── Gym (D5) — adaptive ZPD drilling ─────────────────────────────────────────

/** Mint the next gym item (drill a concept, or coach's-pick the shakiest with errors). */
export function useGymNext() {
  return useMutation({
    mutationFn: async (body: GymNextRequest): Promise<GymItemResponse> => {
      const { data, error } = await api.POST("/api/practice/gym/next", { body });
      if (error || !data) throw new Error("failed to load next gym item");
      return data;
    },
  });
}

/** Grade a gym item, step the difficulty, fold the running set totals. */
export function useGymAnswer() {
  return useMutation({
    mutationFn: async (body: GymAnswerRequest): Promise<GymAnswerResponse> => {
      const { data, error } = await api.POST("/api/practice/gym/answer", { body });
      if (error || !data) throw new Error("failed to grade gym answer");
      return data;
    },
  });
}

// ── Calibration (D8) — the cold-start walk ───────────────────────────────────

/** Open a calibration walk (an empty region returns status='no_region', writes nothing). */
export function useCalibrationStart() {
  return useMutation({
    mutationFn: async (body: CalibrationStartRequest): Promise<CalibrationStartResponse> => {
      const { data, error } = await api.POST("/api/practice/calibration/start", { body });
      if (error || !data) throw new Error("failed to start calibration");
      return data;
    },
  });
}

/** Grade or skip the current calibration step and mint the next one. */
export function useCalibrationAnswer() {
  return useMutation({
    mutationFn: async (body: CalibrationAnswerRequest): Promise<CalibrationAnswerResponse> => {
      const { data, error } = await api.POST("/api/practice/calibration/answer", { body });
      if (error || !data) throw new Error("failed to answer calibration step");
      return data;
    },
  });
}

/** End the walk: stamp calibrated_at + summarize the walked region. Invalidates the queue. */
export function useCalibrationFinish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CalibrationFinishRequest): Promise<CalibrationFinishResponse> => {
      const { data, error } = await api.POST("/api/practice/calibration/finish", { body });
      if (error || !data) throw new Error("failed to finish calibration");
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["practice-queue"] });
    },
  });
}

// ── Exam (D9) — timed, mixed-topic, graded all at once ───────────────────────

/** Assemble a timed, mixed-topic exam (prompts only; reference answers stay server-side). */
export function useExamStart() {
  return useMutation({
    mutationFn: async (body: ExamStartRequest): Promise<ExamStartResponse> => {
      const { data, error } = await api.POST("/api/practice/exam/start", { body });
      if (error || !data) throw new Error("failed to start exam");
      return data;
    },
  });
}

/** Grade the whole exam at once and return the debrief. Invalidates the queue. */
export function useExamSubmit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: ExamSubmitRequest): Promise<ExamSubmitResponse> => {
      const { data, error } = await api.POST("/api/practice/exam/submit", { body });
      if (error || !data) throw new Error("failed to submit exam");
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["practice-queue"] });
    },
  });
}

// ── Explain — opens a concept-bound chat session ─────────────────────────────

/** Create an explain-mode chat session bound to a concept; returns the session id. */
export function useExplainStart() {
  return useMutation({
    mutationFn: async (body: ExplainStartRequest): Promise<ExplainStartResponse> => {
      const { data, error } = await api.POST("/api/practice/explain/start", { body });
      if (error || !data) throw new Error("failed to start explain session");
      return data;
    },
  });
}
