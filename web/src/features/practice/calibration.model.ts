/**
 * Pure helpers for the Calibration warm-up (Phase-2 T4 — SPEC F1, D8).
 *
 * The walk is a brief, skippable cold-start: a handful of items across a course's
 * library concepts, ending in a calm summary of the warmed-up states. Like the rest
 * of the mastery surface (§6 Q2), the summary speaks the 4-state vocabulary —
 * unknown / learning / shaky / mastered — and NOTHING numeric (effective_p stays in
 * the payload, never reaches the UI).
 */

export const CALIB_STATE_ORDER = ["mastered", "learning", "shaky", "unknown"] as const;
export type CalibStateName = (typeof CALIB_STATE_ORDER)[number];

/** One row of the finished walk's summary. The schema types `states` as `unknown[]`
 * (an open dict on the backend); this is the shape we read, every field defensive. */
export interface CalibStateRow {
  concept_id: string | null;
  concept_name: string | null;
  state: string | null;
  effective_p: number | null;
}

/** Narrow an opaque `states` entry into a CalibStateRow — tolerant of missing keys. */
export function asStateRow(raw: unknown): CalibStateRow {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    concept_id: typeof o.concept_id === "string" ? o.concept_id : null,
    concept_name: typeof o.concept_name === "string" ? o.concept_name : null,
    state: typeof o.state === "string" ? o.state : null,
    effective_p: typeof o.effective_p === "number" ? o.effective_p : null,
  };
}

export function asStateRows(states: readonly unknown[]): CalibStateRow[] {
  return states.map(asStateRow);
}

/** A concept's state, folded onto the 4-state vocabulary (anything else → unknown). */
export function stateWord(state: string | null): CalibStateName {
  return (CALIB_STATE_ORDER as readonly string[]).includes(state ?? "")
    ? (state as CalibStateName)
    : "unknown";
}

/** "Step 3 of 8" — the walk's progress indicator. Position is 0-based on the wire,
 * so the human-facing step is position+1, clamped into [1, total] (total may be 0). */
export function progressText(position: number, total: number): string {
  if (total <= 0) return "";
  const step = Math.min(Math.max(position + 1, 1), total);
  return `Step ${step} of ${total}`;
}

/** "2 mastered · 1 shaky · 3 unknown" — nonzero states only, never a percentage.
 * Mirrors the Progress panel's summaryLine so the two surfaces read the same. */
export function statesSummary(rows: readonly CalibStateRow[]): string {
  const counts: Record<CalibStateName, number> = {
    mastered: 0,
    learning: 0,
    shaky: 0,
    unknown: 0,
  };
  for (const r of rows) counts[stateWord(r.state)] += 1;
  return CALIB_STATE_ORDER.filter((s) => counts[s] > 0)
    .map((s) => `${counts[s]} ${s}`)
    .join(" · ");
}
