/**
 * Pure helpers for the Explain screen (Phase-2 T4 — SPEC F8 "Explain it back":
 * the user teaches the concept in their own words and the tutor plays a curious
 * student, asking the questions that surface the gaps).
 *
 * The conversation surface is deliberately lean (a turn list + a composer), so the
 * only logic worth isolating is message bookkeeping: turn shape, appending a fresh
 * user turn, opening the tutor's reply, and merging streamed deltas into it.
 */

/** One turn on the explain surface. `assistant` turns render via <Markdown>. */
export interface ExplainTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * The tutor's opening prompt. The backend supplies the line ("Teach me <concept>
 * in your own words…"); this is the fallback when it doesn't, so the surface always
 * opens with something to react to.
 */
export function openingPrompt(
  message: string | null | undefined,
  conceptName: string | null | undefined,
): string {
  if (message && message.trim()) return message;
  const name = conceptName && conceptName.trim() ? conceptName : "this concept";
  return `Teach me ${name} in your own words — I'm listening, and I'll ask if I get lost.`;
}

/** Append a user turn followed by an empty assistant turn (the in-flight reply). */
export function startTurn(turns: ExplainTurn[], userText: string): ExplainTurn[] {
  return [...turns, { role: "user", content: userText }, { role: "assistant", content: "" }];
}

/** Append a streamed delta to the last turn (must be the open assistant reply). */
export function appendDelta(turns: ExplainTurn[], delta: string): ExplainTurn[] {
  if (turns.length === 0) return turns;
  const last = turns[turns.length - 1];
  if (last.role !== "assistant") return turns;
  return [...turns.slice(0, -1), { ...last, content: last.content + delta }];
}
