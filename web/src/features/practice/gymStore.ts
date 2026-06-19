/**
 * gymStore.ts — which concept the Gym should preselect when it opens (F11 "the
 * weak-spot card opens the Gym preloaded").
 *
 * The window manager's tool registry is static, so the Gym tool reads its target from
 * this store; `gymForConcept` is the single door dashboard weak-spot cards use — it sets
 * the target and raises the Gym window. The Gym reads the target on mount, preselects
 * that concept, then CLEARS it so a later manual open starts fresh. Mirrors pdfStore.ts.
 */
import { create } from "zustand";
import { useWindowStore } from "../../app/windows/windowStore.ts";
import { useCourseStore } from "../courses/store.ts";

export interface GymTarget {
  courseId: string;
  conceptId: string;
}

interface GymState {
  target: GymTarget | null;
  setTarget: (t: GymTarget | null) => void;
}

export const useGymStore = create<GymState>((set) => ({
  target: null,
  setTarget: (target) => set({ target }),
}));

/**
 * Open (or refocus) the Gym window preloaded to drill `conceptId` in `courseId`. The Gym is
 * course-scoped, so we also activate that course tab — without it a Home-dashboard weak-spot
 * (no tab selected) would open the Gym's "open a course tab" gate instead of the concept.
 */
export function gymForConcept(courseId: string, conceptId: string): void {
  useCourseStore.getState().setActiveCourse(courseId);
  useGymStore.getState().setTarget({ courseId, conceptId });
  useWindowStore.getState().open("gym");
}
