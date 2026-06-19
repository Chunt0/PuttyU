/**
 * Pure helpers for the schedule miner review sheet (Phase-2 T5 vertical-2 — SPEC F2).
 *
 * Three pure functions, unit-tested in isolation from the screen:
 *  - `defaultChecked`   — the include/prune default per proposal status.
 *  - `fallbackSummary`  — the calm "Found N homework, M exams …" header when the server
 *                          summary is empty.
 *  - `toApplyItem`      — proposal (+ the row's local edits) → the MineApplyItem the only
 *                          writer consumes.
 * Plus `isResolved`/`isCommittable` — the ask-don't-guess gate (an ambiguous row with no
 * date can never be committed).
 */
import type { MineApplyItem, ScheduleProposal } from "../../api/types.ts";

/** The local, possibly-edited state of one review row (everything the user can change). */
export interface RowEdit {
  checked: boolean;
  title: string;
  /** ISO date ("YYYY-MM-DD") or "" when unresolved. For ambiguous rows this is the answer. */
  date: string;
  allDay: boolean;
}

/**
 * The default checkbox state: include genuinely new and changed items, leave the already-
 * applied (`unchanged`) and the gone (`stale`) rows unchecked. Ambiguous rows still start
 * here but the screen disables their checkbox until a date is supplied (see isCommittable).
 */
export function defaultChecked(status: ScheduleProposal["status"]): boolean {
  return status === "new" || status === "changed";
}

/** An ambiguous proposal is resolved once a date is supplied; non-ambiguous rows are always "resolved". */
export function isResolved(p: ScheduleProposal, edit: RowEdit): boolean {
  if (!p.ambiguous) return true;
  return edit.date.trim().length > 0;
}

/**
 * A row may be committed only when it's checked AND resolved. This is the ask-don't-guess
 * gate: an ambiguous row with no date can never end up in the apply body, even if checked.
 */
export function isCommittable(p: ScheduleProposal, edit: RowEdit): boolean {
  return edit.checked && isResolved(p, edit);
}

const KIND_NOUNS: Record<string, [string, string]> = {
  exam: ["exam", "exams"],
  quiz: ["quiz", "quizzes"],
  homework: ["homework item", "homework items"],
  assignment: ["assignment", "assignments"],
  reading: ["reading", "readings"],
  project: ["project", "projects"],
  lecture: ["lecture", "lectures"],
  lab: ["lab", "labs"],
};

function pluralize(type: string, n: number): string {
  const pair = KIND_NOUNS[type.toLowerCase()];
  if (pair) return n === 1 ? pair[0] : pair[1];
  // Unknown type → generic "N events"/"N todos" handled by the caller; here, naive plural.
  return n === 1 ? type : `${type}s`;
}

/**
 * The calm header when the server didn't send one: "Found 11 homework items, 3 exams —
 * add to calendar and todos?" Counts by `type` (falling back to kind), drops empties, and
 * never invents urgency. An empty proposal set yields "" (the screen shows its own empty state).
 */
export function fallbackSummary(proposals: ScheduleProposal[]): string {
  if (proposals.length === 0) return "";
  const counts = new Map<string, { n: number; type: string }>();
  for (const p of proposals) {
    const type = (p.type || p.kind).trim() || p.kind;
    const key = type.toLowerCase();
    const cur = counts.get(key);
    if (cur) cur.n += 1;
    else counts.set(key, { n: 1, type });
  }
  const phrases = [...counts.values()]
    .sort((a, b) => b.n - a.n)
    .map(({ n, type }) => `${n} ${pluralize(type, n)}`);
  return `Found ${phrases.join(", ")} — add to calendar and todos?`;
}

/**
 * Map a confirmed (checked, edited, resolved) proposal to the apply item. Carries the
 * proposal key, kind, the edited title/date/all-day, the source page, and `existing_id`
 * (so a `changed` item updates in place instead of cloning). `accepted` is always true —
 * only committable rows reach this mapper.
 */
export function toApplyItem(p: ScheduleProposal, edit: RowEdit): MineApplyItem {
  const item: MineApplyItem = {
    accepted: true,
    key: p.key,
    kind: p.kind,
    title: edit.title.trim() || p.title,
    date: edit.date.trim() || p.date || null,
    all_day: edit.allDay,
  };
  if (p.end_date != null) item.end_date = p.end_date;
  if (p.page != null) item.page = p.page;
  if (p.existing_id != null) item.existing_id = p.existing_id;
  return item;
}
