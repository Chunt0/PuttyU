import { Spinner } from "../../components/Spinner.tsx";
import { toast } from "../../components/toast.ts";
import { useUiStore } from "../../lib/store.ts";
import { useCreateSession, useSessions } from "../sessions/api.ts";
import { useCourseSources } from "./api.ts";
import type { Course } from "../../api/types.ts";

/**
 * Course landing pane (F1, interim): course name, the honest library-coverage
 * chip, and the course's chats. The full course workspace arrives in later
 * slices — this view just makes a fresh course usable immediately.
 */
export function CourseLanding({ course }: { course: Course }) {
  const sources = useCourseSources(course.id);
  const { data: sessions, isLoading } = useSessions(course.id);
  const create = useCreateSession();
  const setCurrentSession = useUiStore((s) => s.setCurrentSession);

  // Honest about coverage: no linked sources = built-in knowledge only.
  const noSources = sources.data != null && (sources.data.source_ids ?? []).length === 0;

  async function onNewChat() {
    try {
      const created = await create.mutateAsync("New chat");
      setCurrentSession(created.id);
    } catch {
      toast.error("Could not start a chat.");
    }
  }

  return (
    <div className="course-landing">
      <header className="course-landing-head">
        <h2>{course.name}</h2>
        {noSources && (
          <span className="course-chip" role="status">
            No library sources linked — tutor is using built-in knowledge only
          </span>
        )}
      </header>
      <section>
        <div className="course-landing-row">
          <h3>Chats</h3>
          <button onClick={() => void onNewChat()} disabled={create.isPending}>
            + New chat
          </button>
        </div>
        {isLoading && <Spinner label="Loading…" />}
        {sessions && sessions.length === 0 && (
          <p className="course-landing-empty">No chats in this course yet.</p>
        )}
        <ul className="course-landing-sessions">
          {sessions?.map((s) => (
            <li key={s.id}>
              <button onClick={() => setCurrentSession(s.id)}>{s.name || "Untitled"}</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
