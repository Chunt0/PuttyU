import { useUpdateCourse } from "./api.ts";
import { toast } from "../../components/toast.ts";
import type { Course } from "../../api/types.ts";

/**
 * The per-course adaptivity dial (SPEC F10): scaffolding / pace / tone, plus the
 * course type that shapes the tutor's default lean. The values are read by the
 * backend tutor persona (src/tutor_persona.py) on every course-bound turn.
 *
 * The PATCH route replaces course.settings wholesale, so each change MERGES the
 * dial key into the full current settings (preserving coupling_mutes,
 * calibrated_at, etc.) before saving. Unset axes fall back to the calm defaults
 * the persona uses (guide / gentle / warm), so this needs zero configuration.
 */

type DialAxis = { key: string; label: string; hint: string; options: [string, string][] };

const AXES: DialAxis[] = [
  {
    key: "scaffolding",
    label: "Scaffolding",
    hint: "How much the tutor guides vs. just answers",
    options: [
      ["guide", "Guide me (Socratic)"],
      ["balanced", "Balanced"],
      ["direct", "Direct answers"],
    ],
  },
  {
    key: "pace",
    label: "Pace",
    hint: "How fast the tutor moves",
    options: [
      ["gentle", "Gentle"],
      ["balanced", "Steady"],
      ["intense", "Intense"],
    ],
  },
  {
    key: "tone",
    label: "Tone",
    hint: "How the tutor sounds",
    options: [
      ["warm", "Warm"],
      ["balanced", "Friendly"],
      ["matter-of-fact", "Matter-of-fact"],
    ],
  },
  {
    key: "course_type",
    label: "Course type",
    hint: "Shapes the tutor's default approach",
    options: [
      ["", "Auto (from the course)"],
      ["problem", "Problem-based"],
      ["discussion", "Discussion / reading"],
      ["language", "Language"],
    ],
  },
];

const DEFAULTS: Record<string, string> = {
  scaffolding: "guide",
  pace: "gentle",
  tone: "warm",
  course_type: "",
};

export function CourseSettings({ course }: { course: Course }) {
  const update = useUpdateCourse();
  const settings = (course.settings ?? {}) as Record<string, unknown>;

  function valueFor(key: string): string {
    const v = settings[key];
    return typeof v === "string" ? v : DEFAULTS[key] ?? "";
  }

  async function onChange(key: string, value: string) {
    // Merge into the FULL settings object (the route replaces, not merges).
    const merged = { ...settings, [key]: value };
    try {
      await update.mutateAsync({ id: course.id, settings: merged });
    } catch {
      toast.error("Could not save tutor settings.");
    }
  }

  return (
    <div className="course-dial">
      <p className="course-dial-intro">
        Tune how this course's tutor works. Changes apply to your next message.
      </p>
      <div className="course-dial-grid">
        {AXES.map((axis) => (
          <label key={axis.key} className="course-dial-field">
            <span className="course-dial-label">{axis.label}</span>
            <select
              value={valueFor(axis.key)}
              disabled={update.isPending}
              onChange={(e) => void onChange(axis.key, e.target.value)}
            >
              {axis.options.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
            <span className="course-dial-hint">{axis.hint}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
