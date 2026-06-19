/**
 * Pure helpers for the Exam screen (Phase-2 T4 — SPEC F8 "Exam simulation":
 * timed, silent, debrief).
 *
 * The exam runs under test conditions — a client-side countdown, no per-item
 * grading until the whole thing is submitted. These helpers own the clock math
 * and the calm debrief summary so the screen stays declarative and they can be
 * unit-tested without the timer.
 */
import type { ExamSubmitResponse } from "../../api/types.ts";

/** Defaults the start form seeds (also mirrors the request defaults: 30 min / 10 items). */
export const DEFAULT_DURATION_MINUTES = 30;
export const DEFAULT_N_ITEMS = 10;

/**
 * Clamp a form field into a sane integer range. The raw field value is a string so a
 * blank field (or garbage) falls back to the default rather than collapsing to the min.
 */
export function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const trimmed = raw.trim();
  if (trimmed === "") return fallback;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Seconds remaining = (started_at + duration) − now, floored at 0. `started_at` is
 * an ISO instant from the server; `nowMs` defaults to the wall clock (injected in tests).
 */
export function remainingSeconds(
  startedAt: string,
  durationSeconds: number,
  nowMs: number = Date.now(),
): number {
  const startMs = Date.parse(startedAt);
  if (Number.isNaN(startMs)) return Math.max(0, Math.floor(durationSeconds));
  const endMs = startMs + durationSeconds * 1000;
  return Math.max(0, Math.floor((endMs - nowMs) / 1000));
}

/** "mm:ss" — the countdown clock. Minutes are not capped at 59 (a 90-min exam reads "90:00"). */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

/**
 * The debrief headline: "4 correct · 1 partial · 2 incorrect · 3 skipped of 10".
 * Zero-count buckets drop out so the line stays calm (no "0 partial" noise).
 */
export function debriefSummary(r: ExamSubmitResponse): string {
  const parts: string[] = [];
  if (r.correct > 0) parts.push(`${r.correct} correct`);
  if (r.partial > 0) parts.push(`${r.partial} partial`);
  if (r.incorrect > 0) parts.push(`${r.incorrect} incorrect`);
  if (r.skipped > 0) parts.push(`${r.skipped} skipped`);
  if (parts.length === 0) parts.push("0 graded");
  return `${parts.join(" · ")} of ${r.total}`;
}
