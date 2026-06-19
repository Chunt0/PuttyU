import { Chat } from "../chat/Chat.tsx";
import { useUiStore } from "../../lib/store.ts";
import { useCourses } from "./api.ts";
import { useCourseStore } from "./store.ts";
import { CourseLanding } from "./CourseLanding.tsx";
import { Onboarding } from "./Onboarding.tsx";
import { Dashboard } from "../dashboard/Dashboard.tsx";

/**
 * The index screen, course-aware (F1 + T5 CONTRACT D5):
 *  - no courses yet (and not skipped) → the onboarding welcome step;
 *  - a course tab active with no chat selected → that course's landing pane;
 *  - a chat selected (Home or inside a course) → Chat;
 *  - otherwise (Home, nothing selected) → the Dashboard landing surface.
 * If the courses query errs (backend down), the Dashboard still renders (it degrades
 * gracefully) — never block.
 */
export function Home() {
  const { data: courses } = useCourses();
  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const onboardingSkipped = useCourseStore((s) => s.onboardingSkipped);
  const currentSessionId = useUiStore((s) => s.currentSessionId);

  if (courses && courses.length === 0 && !onboardingSkipped) return <Onboarding />;

  // An explicitly-selected chat always wins (the Resume card, the sidebar, a course chat).
  if (currentSessionId) return <Chat />;

  const activeCourse = courses?.find((c) => c.id === activeCourseId && c.status === "active");
  if (activeCourse) return <CourseLanding course={activeCourse} />;

  return <Dashboard />;
}
