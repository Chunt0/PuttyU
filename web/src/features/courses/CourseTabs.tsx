import { useEffect, useState, type FormEvent } from "react";
import { ConfirmButton } from "../../components/ConfirmButton.tsx";
import { toast } from "../../components/toast.ts";
import { useUiStore } from "../../lib/store.ts";
import { useArchiveCourse, useCourses, useCreateCourse, useUnarchiveCourse } from "./api.ts";
import { useCourseStore } from "./store.ts";

/**
 * The course tab strip (F1): Home + one tab per active course + a "+" menu with
 * an add-course input and the manage-courses view (archived list + unarchive).
 * Clicking a tab scopes the workspace to that course (ADR 0004).
 */
export function CourseTabs() {
  const { data: courses } = useCourses();
  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const setActiveCourse = useCourseStore((s) => s.setActiveCourse);
  const setCurrentSession = useUiStore((s) => s.setCurrentSession);
  const archive = useArchiveCourse();
  const [menuOpen, setMenuOpen] = useState(false);

  const active = (courses ?? []).filter((c) => c.status === "active");

  // If the active course vanished (archived elsewhere / stale localStorage), go Home.
  useEffect(() => {
    if (courses && activeCourseId && !active.some((c) => c.id === activeCourseId)) {
      setActiveCourse(null);
    }
  }, [courses, active, activeCourseId, setActiveCourse]);

  function selectCourse(id: string | null) {
    setActiveCourse(id);
    // Selecting a course shows its landing pane, not a stale cross-course chat.
    if (id !== null) setCurrentSession(null);
  }

  async function onArchive(id: string) {
    try {
      await archive.mutateAsync(id);
      if (id === activeCourseId) setActiveCourse(null);
    } catch {
      toast.error("Could not archive the course.");
    }
  }

  return (
    <div className="course-tabs">
      <div className="course-tabs-strip" role="tablist" aria-label="Courses">
        <button
          role="tab"
          aria-selected={activeCourseId === null}
          className={activeCourseId === null ? "course-tab course-tab--active" : "course-tab"}
          onClick={() => selectCourse(null)}
        >
          Home
        </button>
        {active.map((c) => (
          <span
            key={c.id}
            className={c.id === activeCourseId ? "course-tab course-tab--active" : "course-tab"}
          >
            <button role="tab" aria-selected={c.id === activeCourseId} onClick={() => selectCourse(c.id)}>
              {c.name}
            </button>
            <ConfirmButton
              className="course-tab-action"
              label="×"
              confirmLabel="✓"
              title={`Archive ${c.name}`}
              onConfirm={() => void onArchive(c.id)}
            />
          </span>
        ))}
        <button
          className="course-tab course-tab--add"
          aria-label="Add course"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          +
        </button>
      </div>
      {menuOpen && <CourseMenu onDone={() => setMenuOpen(false)} />}
    </div>
  );
}

/** The "+" menu: create a course, and manage (unarchive) archived ones. */
function CourseMenu({ onDone }: { onDone: () => void }) {
  const { data: courses } = useCourses();
  const create = useCreateCourse();
  const unarchive = useUnarchiveCourse();
  const setActiveCourse = useCourseStore((s) => s.setActiveCourse);
  const setCurrentSession = useUiStore((s) => s.setCurrentSession);
  const [name, setName] = useState("");

  const archived = (courses ?? []).filter((c) => c.status === "archived");

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const created = await create.mutateAsync(trimmed);
      setActiveCourse(created.id);
      setCurrentSession(null);
      setName("");
      onDone();
    } catch {
      toast.error("Could not create the course.");
    }
  }

  async function onUnarchive(id: string) {
    try {
      await unarchive.mutateAsync(id);
    } catch {
      toast.error("Could not unarchive the course.");
    }
  }

  return (
    <div className="course-menu">
      <form className="course-menu-add" onSubmit={onCreate}>
        <input
          aria-label="New course name"
          placeholder="e.g. AP Statistics"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <button type="submit" disabled={create.isPending || !name.trim()}>
          Create
        </button>
      </form>
      <div className="course-menu-manage">
        <h3>Manage courses</h3>
        {archived.length === 0 && <p className="course-menu-empty">No archived courses.</p>}
        <ul>
          {archived.map((c) => (
            <li key={c.id}>
              <span>{c.name}</span>
              <button onClick={() => void onUnarchive(c.id)} disabled={unarchive.isPending}>
                Unarchive
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
