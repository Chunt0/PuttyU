/**
 * progressStore.ts — which concept the Progress panel should preselect when it opens
 * (F11 "concept → trajectory": a Cmd-K concept hit opens its trajectory, NOT the Gym).
 *
 * The window manager's tool registry is static, so the Progress tool reads its target from
 * this store; `progressForConcept` is the single door Cmd-K uses — it activates the course,
 * sets the target, and raises the Progress window. Progress reads the target on mount,
 * selects that concept, then CLEARS it so a later manual open starts fresh. Mirrors gymStore.ts.
 */
import { create } from "zustand";
import { useWindowStore } from "../../app/windows/windowStore.ts";
import { useCourseStore } from "../courses/store.ts";

export interface ProgressTarget {
  conceptId: string;
}

interface ProgressState {
  target: ProgressTarget | null;
  setTarget: (t: ProgressTarget | null) => void;
  clear: () => void;
}

export const useProgressStore = create<ProgressState>((set) => ({
  target: null,
  setTarget: (target) => set({ target }),
  clear: () => set({ target: null }),
}));

/**
 * Open (or refocus) the Progress window with `conceptId` preselected in `courseId`. Progress
 * is course-scoped, so we also activate that course tab — without it a Home view (no tab
 * selected) would show Progress's "open a course tab" gate instead of the trajectory.
 */
export function progressForConcept(courseId: string, conceptId: string): void {
  useCourseStore.getState().setActiveCourse(courseId);
  useProgressStore.getState().setTarget({ conceptId });
  useWindowStore.getState().open("progress");
}
