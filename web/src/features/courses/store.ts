import { create } from "zustand";

const ACTIVE_COURSE_KEY = "puttyu-active-course";

function readSavedCourse(): string | null {
  try {
    return localStorage.getItem(ACTIVE_COURSE_KEY);
  } catch {
    return null; // localStorage unavailable (private mode / SSR)
  }
}

/**
 * Which course tab is active (client/UI state — course DATA lives in TanStack Query).
 * `null` = Home. Persisted to localStorage so the user lands back on their course.
 * `onboardingSkipped` is per-load: "Skip for now" drops the F1 welcome step until
 * the next visit (a user with zero courses sees it again — that's intentional).
 */
interface CourseState {
  activeCourseId: string | null;
  onboardingSkipped: boolean;
  setActiveCourse: (id: string | null) => void;
  skipOnboarding: () => void;
}

export const useCourseStore = create<CourseState>((set) => ({
  activeCourseId: readSavedCourse(),
  onboardingSkipped: false,
  setActiveCourse: (id) => {
    try {
      if (id === null) localStorage.removeItem(ACTIVE_COURSE_KEY);
      else localStorage.setItem(ACTIVE_COURSE_KEY, id);
    } catch {
      /* ignore persistence failure */
    }
    set({ activeCourseId: id });
  },
  skipOnboarding: () => set({ onboardingSkipped: true }),
}));
