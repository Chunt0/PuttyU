/**
 * minerStore.ts — which material the schedule miner should review when it opens
 * (F2 "the syllabus autofills the calendar"), plus a per-source cache of the
 * mine result and the user's in-progress edits.
 *
 * The window manager's tool registry is static, so the Miner tool reads its target from
 * this store; `openMiner` is the single door the Library material rows use — it sets the
 * target and raises the (hidden) Miner window. The target persists until `clear()` is
 * called (wired to the Miner window's close, so a later open with no target shows the calm
 * empty state).
 *
 * F4 — minimizing a tool window UNMOUNTS it (WindowLayer drops minimized windows); restoring
 * remounts it. Without a cache that remount would (a) auto-re-mine (a wasted LLM call) and
 * (b) reset every row edit, including resolved ambiguous dates (lost user work). So we cache
 * the read-only `mine` result AND the per-row edits keyed by sourceId: a remount RESTORES
 * them instead of re-mining. Untrusted-content stays intact — the cache holds only proposals
 * (nothing is written until the user commits via apply).
 *
 * Mirrors pdfStore.ts / gymStore.ts.
 */
import { create } from "zustand";
import { useWindowStore } from "../../app/windows/windowStore.ts";
import type { MineResponse } from "../../api/types.ts";
import type { RowEdit } from "./miner.model.ts";

export interface MinerTarget {
  sourceId: string;
  title: string;
}

/** The cached state of one mining session: the read-only result + the row edits so far. */
export interface MinerCacheEntry {
  result: MineResponse;
  edits: Record<string, RowEdit>;
}

interface MinerState {
  target: MinerTarget | null;
  /** Per-sourceId cache so a remount (e.g. after minimize) restores, not re-mines. */
  cache: Record<string, MinerCacheEntry>;
  openMiner: (sourceId: string, title: string) => void;
  /** Save a fresh mine result for a source (seeds an empty edits map). */
  cacheResult: (sourceId: string, result: MineResponse) => void;
  /** Persist the user's in-progress edits for a source (survives a remount). */
  cacheEdits: (sourceId: string, edits: Record<string, RowEdit>) => void;
  /** Forget one source's cached session (called on commit — the rows are now applied). */
  clearSource: (sourceId: string) => void;
  /** Drop the target so a later open with no target shows the calm empty state. */
  clear: () => void;
}

export const useMinerStore = create<MinerState>((set) => ({
  target: null,
  cache: {},
  openMiner: (sourceId, title) => {
    set({ target: { sourceId, title } });
    useWindowStore.getState().open("miner");
  },
  cacheResult: (sourceId, result) =>
    set((s) => ({ cache: { ...s.cache, [sourceId]: { result, edits: {} } } })),
  cacheEdits: (sourceId, edits) =>
    set((s) => {
      const entry = s.cache[sourceId];
      if (!entry) return s;
      return { cache: { ...s.cache, [sourceId]: { ...entry, edits } } };
    }),
  clearSource: (sourceId) =>
    set((s) => {
      const next = { ...s.cache };
      delete next[sourceId];
      return { cache: next };
    }),
  clear: () => set({ target: null, cache: {} }),
}));

// F5: wire clear() to the Miner window's CLOSE (not minimize). Minimizing keeps
// the window in the store (minimized:true) so the cache survives the remount
// (F4); closing removes it entirely → forget the target + cache so a later open
// with no target shows the calm empty state. Subscribing here (rather than from
// the unmounting <Miner /> node) is the only place that can tell close from
// minimize, and keeps the lifecycle localized to the schedule feature.
let _minerWasOpen = "miner" in useWindowStore.getState().windows;
useWindowStore.subscribe((s) => {
  const isOpen = "miner" in s.windows;
  if (_minerWasOpen && !isOpen) useMinerStore.getState().clear();
  _minerWasOpen = isOpen;
});
