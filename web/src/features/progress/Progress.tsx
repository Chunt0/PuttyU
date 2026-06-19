import { useEffect, useState } from "react";
import { Spinner } from "../../components/Spinner.tsx";
import { useWindowStore } from "../../app/windows/windowStore.ts";
import { useCourseStore } from "../courses/store.ts";
import { useCourses } from "../courses/api.ts";
import type { GraphAssertion, GraphConceptNode } from "../../api/types.ts";
import { useConceptTree, useObservations } from "./api.ts";
import { useProgressStore } from "./progressStore.ts";
import { ConceptDetail } from "./ConceptDetail.tsx";
import { StateChip } from "./StateChip.tsx";
import { fmtDay } from "./model.ts";

/** One tree node: name (click → detail), state chip, evidence count. Nodes with
 * children get a collapse toggle — sections fold, leaves don't. */
function ConceptRow({
  node,
  selectedId,
  onSelect,
}: {
  node: GraphConceptNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const kids = node.children ?? [];

  return (
    <li>
      <div className={`concept-row${selectedId === node.id ? " concept-row--selected" : ""}`}>
        {kids.length > 0 && (
          <button
            type="button"
            className="concept-toggle"
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? "Expand" : "Collapse"} ${node.name}`}
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed ? "▸" : "▾"}
          </button>
        )}
        <button type="button" className="concept-name" onClick={() => onSelect(node.id)}>
          {node.name}
        </button>
        <StateChip state={node.state} />
        <span className="concept-evidence">{node.evidence_count} evidence</span>
      </div>
      {kids.length > 0 && !collapsed && (
        <ul className="concept-children">
          {kids.map((c) => (
            <ConceptRow key={c.id} node={c} selectedId={selectedId} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** One stated observation: the verbatim quote + date; anchored ones link to their
 * concept. Invalidated observations stay visible, struck through. */
function ObservationRow({
  a,
  onJump,
}: {
  a: GraphAssertion;
  onJump: (conceptId: string) => void;
}) {
  const invalidated = a.invalidated_at != null;
  const conceptId = a.object_type === "concept" ? a.object_id : null;
  return (
    <li className={`timeline-row${invalidated ? " timeline-row--invalidated" : ""}`}>
      <div className="timeline-body">
        <blockquote className="assertion-quote">{a.quote || a.statement}</blockquote>
      </div>
      <span className="timeline-date">
        {fmtDay(a.valid_from)}
        {invalidated && ` · invalidated ${fmtDay(a.invalidated_at)}`}
      </span>
      {conceptId != null && (
        <button
          type="button"
          className="concept-jump"
          onClick={() => onJump(conceptId)}
          aria-label={`Go to concept ${a.object_name ?? conceptId}`}
        >
          {a.object_name ?? "view concept"}
        </button>
      )}
    </li>
  );
}

/**
 * The Progress panel (Phase-2 T3b — SPEC F5 "the user can see — and correct —
 * their own map"): a state-colored concept TREE for the active course (§6 Q6 —
 * a tree, not a node-graph render; §6 Q2 — four states, no percentages), a
 * trajectory detail panel per concept, and the "about you" stated observations.
 */
export function Progress() {
  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const { data: courses } = useCourses();
  const openWindow = useWindowStore((s) => s.open);

  const activeCourse = courses?.find((c) => c.id === activeCourseId && c.status === "active");
  const courseId = activeCourse ? activeCourse.id : null;
  const tree = useConceptTree(courseId);
  const observations = useObservations(courseId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => setSelectedId(null), [courseId]);

  // F11 (CONTRACT D7): a Cmd-K concept hit deep-links here via progressForConcept, which
  // activates the course AND sets a preselect target. Read the target on mount (and when it
  // changes), select that concept, then CLEAR it so a later manual open starts fresh. This
  // effect is ordered AFTER the course-reset above so activating the course (which nulls the
  // selection) doesn't clobber the preselected concept — this wins on the same render.
  const target = useProgressStore((s) => s.target);
  const clearTarget = useProgressStore((s) => s.clear);
  useEffect(() => {
    // Wait until the course context is resolved before consuming the target — a
    // late-resolving useCourses() flips courseId null->Y and the [courseId] reset
    // above would otherwise null the selection AFTER we'd already cleared the
    // target. Keyed on courseId so this fires (and wins, being declared after the
    // reset) once the course is ready.
    if (!target || !courseId) return;
    setSelectedId(target.conceptId);
    clearTarget();
  }, [target, courseId, clearTarget]);

  if (!activeCourse) {
    return (
      <section className="progress">
        <h1>Progress</h1>
        <p className="progress-empty">Open a course tab to see your map of it.</p>
      </section>
    );
  }

  return (
    <section className="progress">
      <h1>Progress</h1>
      <p className="progress-scope">
        {activeCourse.name} — what you know, concept by concept. Pick one for the story behind it.
      </p>

      {tree.isLoading && <Spinner label="Loading concepts…" />}
      {tree.data && tree.data.length === 0 && (
        <p className="progress-empty">
          No concepts yet — link a textbook to this course.{" "}
          <button type="button" className="progress-link" onClick={() => openWindow("library")}>
            Open library
          </button>
        </p>
      )}

      <div className="progress-layout">
        {tree.data && tree.data.length > 0 && (
          <ul className="concept-tree">
            {tree.data.map((n) => (
              <ConceptRow key={n.id} node={n} selectedId={selectedId} onSelect={setSelectedId} />
            ))}
          </ul>
        )}
        {selectedId !== null && (
          <ConceptDetail conceptId={selectedId} onClose={() => setSelectedId(null)} />
        )}
      </div>

      <section className="about-you">
        <h2>About you</h2>
        {observations.data && observations.data.length === 0 && (
          <p className="progress-empty">
            Nothing recorded yet — things you tell the tutor land here, verbatim.
          </p>
        )}
        <ul className="timeline">
          {observations.data?.map((a) => (
            <ObservationRow key={a.id} a={a} onJump={setSelectedId} />
          ))}
        </ul>
      </section>
    </section>
  );
}
