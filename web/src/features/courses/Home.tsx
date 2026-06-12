import { Chat } from "../chat/Chat.tsx";
import { useUiStore } from "../../lib/store.ts";
import { useCourses } from "./api.ts";
import { useCourseStore } from "./store.ts";
import { CourseLanding } from "./CourseLanding.tsx";
import { Onboarding } from "./Onboarding.tsx";

/**
 * The index screen, course-aware (F1):
 *  - no courses yet (and not skipped) → the onboarding welcome step;
 *  - a course tab active with no chat selected → that course's landing pane;
 *  - otherwise → Chat (Home tab, or a selected chat inside a course).
 * If the courses query errs (backend down), fall through to Chat — never block.
 */
export function Home() {
  const { data: courses } = useCourses();
  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const onboardingSkipped = useCourseStore((s) => s.onboardingSkipped);
  const currentSessionId = useUiStore((s) => s.currentSessionId);

  if (courses && courses.length === 0 && !onboardingSkipped) return <Onboarding />;

  const activeCourse = courses?.find((c) => c.id === activeCourseId && c.status === "active");
  if (activeCourse && !currentSessionId) return <CourseLanding course={activeCourse} />;

  return <Chat />;
}
