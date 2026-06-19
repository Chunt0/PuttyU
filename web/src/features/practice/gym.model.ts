/**
 * Pure helpers for the Gym screen (Phase-2 T4 — SPEC F8 "The Gym": weakness-first,
 * adaptive ZPD drilling).
 *
 * The gym's one visible number is *difficulty* — and even that reads as a word, not a
 * raw level — plus the honest running tally of the set. Nothing about the underlying
 * mastery probability ever surfaces (same discipline as Progress: §6 Q2).
 */
import type { GymSetSummary } from "../../api/types.ts";

/** The five difficulty rungs (1..5). The router clamps; we mirror that for labels. */
export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 5;
export const SEED_DIFFICULTY = 2;

const DIFFICULTY_WORDS: Record<number, string> = {
  1: "easiest",
  2: "easier",
  3: "steady",
  4: "harder",
  5: "hardest",
};

/** Clamp an arbitrary difficulty into the 1..5 rung range. */
export function clampDifficulty(d: number): number {
  if (Number.isNaN(d)) return SEED_DIFFICULTY;
  return Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, Math.round(d)));
}

/** A difficulty level as a word (1 → "easiest", 5 → "hardest"). Never a bare number. */
export function difficultyLabel(d: number): string {
  return DIFFICULTY_WORDS[clampDifficulty(d)] ?? "steady";
}

/** "level 3 of 5 · steady" — the adaptive dial, shown as it moves between items. */
export function difficultyLine(d: number): string {
  const c = clampDifficulty(d);
  return `level ${c} of ${MAX_DIFFICULTY} · ${difficultyLabel(c)}`;
}

/**
 * "4 right of 6 · level 3" — the honest running tally of the current set. Streak rides
 * along only once it's worth celebrating (calm, not gamified: no streak badge at 0/1).
 */
export function summaryLine(summary: GymSetSummary): string {
  const parts = [
    `${summary.correct} right of ${summary.attempted}`,
    `level ${clampDifficulty(summary.difficulty)}`,
  ];
  if (summary.streak >= 2) parts.push(`${summary.streak} in a row`);
  return parts.join(" · ");
}

/** Seed summary for a fresh set (mirrors the request defaults). */
export const emptySummary: GymSetSummary = {
  attempted: 0,
  correct: 0,
  difficulty: SEED_DIFFICULTY,
  streak: 0,
};
