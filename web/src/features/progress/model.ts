/**
 * Pure helpers for the Progress panel (Phase-2 T3b — SPEC F5).
 *
 * The mastery vocabulary is the 4-state surface of §6 Q2 — unknown / learning /
 * shaky / mastered — and NOTHING numeric ever reaches the UI: `p_known` stays in
 * the payload, confidence becomes a word, there are no percentages anywhere.
 */
import type { GraphConceptNode } from "../../api/types.ts";

export const STATE_ORDER = ["mastered", "learning", "shaky", "unknown"] as const;
export type MasteryStateName = (typeof STATE_ORDER)[number];
export type StateCounts = Record<MasteryStateName, number>;

export function flattenConcepts(nodes: GraphConceptNode[]): GraphConceptNode[] {
  const out: GraphConceptNode[] = [];
  const walk = (ns: GraphConceptNode[]) => {
    for (const n of ns) {
      out.push(n);
      if (n.children && n.children.length > 0) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

export function stateCounts(nodes: GraphConceptNode[]): StateCounts {
  const counts: StateCounts = { mastered: 0, learning: 0, shaky: 0, unknown: 0 };
  for (const n of flattenConcepts(nodes)) {
    const s: MasteryStateName = (STATE_ORDER as readonly string[]).includes(n.state)
      ? (n.state as MasteryStateName)
      : "unknown";
    counts[s] += 1;
  }
  return counts;
}

/** "3 mastered · 2 shaky · 14 unknown" — nonzero states only, never a percentage. */
export function summaryLine(counts: StateCounts): string {
  return STATE_ORDER.filter((s) => counts[s] > 0)
    .map((s) => `${counts[s]} ${s}`)
    .join(" · ");
}

/** Inferred-insight confidence as a qualifier WORD (Q10: visible, never a raw number). */
export function confidenceWord(confidence: number | null | undefined): "likely" | "tentative" {
  return confidence != null && confidence >= 0.7 ? "likely" : "tentative";
}

/** "Jun 10" — the timeline's date vocabulary (matches the calendar's short form). */
export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Humanize an evidence signal — overrides read as the student's own action. */
export function signalLabel(signal: string): string {
  if (signal === "override_known") return "you marked this known";
  if (signal === "override_unknown") return "you marked this never learned";
  return signal.replaceAll("_", " ");
}
