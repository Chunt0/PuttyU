import { useState, type FormEvent } from "react";
import { toast } from "../../components/toast.ts";
import { useCreateCourse } from "./api.ts";
import { useCourseStore } from "./store.ts";

/**
 * F1 welcome step — shown when the user is authed but has no courses yet.
 * Free-form name (no fixed catalog), skippable to Home.
 */
export function Onboarding() {
  const create = useCreateCourse();
  const setActiveCourse = useCourseStore((s) => s.setActiveCourse);
  const skipOnboarding = useCourseStore((s) => s.skipOnboarding);
  const [name, setName] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const created = await create.mutateAsync(trimmed);
      setActiveCourse(created.id);
    } catch {
      toast.error("Could not create the course.");
    }
  }

  return (
    <div className="onboarding">
      <img src="/putty-blob.svg" alt="" width={40} height={40} />
      <h2>What are you studying right now?</h2>
      <p>
        Name a course — anything you're learning, in your own words. Every chat, note and
        plan will organize itself around it.
      </p>
      <form className="onboarding-form" onSubmit={onSubmit}>
        <input
          aria-label="Course name"
          placeholder="e.g. AP Statistics"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <button type="submit" disabled={create.isPending || !name.trim()}>
          Create course
        </button>
      </form>
      <button className="onboarding-skip" onClick={skipOnboarding}>
        Skip for now
      </button>
    </div>
  );
}
