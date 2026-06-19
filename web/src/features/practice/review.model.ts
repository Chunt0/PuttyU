/**
 * Pure helpers for the Review screen (Phase-2 T4 — SPEC F8 "the user works the queue").
 *
 * The review queue is a calm, one-at-a-time walk: no streaks, no scores, no running
 * tally of right/wrong. The only "progress" surface is a neutral position line
 * ("3 of 6") and a verdict word the user can read. Verdicts map to a calm
 * label + a tone token used purely for the colored dot — never a grade.
 */

/** The verdicts the grader can return (AnswerResponse.verdict is a free string on the
 * wire; anything unrecognized falls back to the neutral "ungraded" tone). */
export type VerdictTone = "correct" | "partial" | "incorrect" | "ungraded" | "expired";

export interface VerdictDisplay {
  /** Sentence-case word the user reads. */
  label: string;
  /** Tone class suffix → drives the dot color via review.css (calm, not a grade). */
  tone: VerdictTone;
}

const VERDICTS: Record<string, VerdictDisplay> = {
  correct: { label: "Correct", tone: "correct" },
  partial: { label: "Partly there", tone: "partial" },
  incorrect: { label: "Not yet", tone: "incorrect" },
  ungraded: { label: "Saved — not graded", tone: "ungraded" },
  expired: { label: "Expired — ask again", tone: "expired" },
};

/** Map a wire verdict to its calm display; unknown verdicts read as "ungraded". */
export function verdictDisplay(verdict: string | null | undefined): VerdictDisplay {
  if (verdict && verdict in VERDICTS) return VERDICTS[verdict] as VerdictDisplay;
  return VERDICTS["ungraded"] as VerdictDisplay;
}

/** "3 of 6" — a neutral position line (1-based), never a score. */
export function queueProgress(index: number, total: number): string {
  return `${Math.min(index + 1, total)} of ${total}`;
}

/**
 * The calm empty/exhausted line. `due` is the count of concepts waiting in the
 * future (QueueResponse.due length) — surfaced as "waiting when you're ready",
 * never as pressure.
 */
export function emptyLine(due: number): string {
  if (due <= 0) return "Nothing due right now — check back later.";
  const items = due === 1 ? "1 item" : `${due} items`;
  return `Nothing due right now — ${items} waiting when you're ready.`;
}

/** A concept/course label for a queue item; falls back gracefully when unscoped. */
export function itemLabel(conceptName: string, courseName: string | null | undefined): string {
  return courseName ? `${courseName} · ${conceptName}` : conceptName;
}
