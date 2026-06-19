/**
 * CommandPalette.tsx — the ⌘/Ctrl-K global search palette (Phase-2 T5 vertical-5,
 * SPEC F11 "one keystroke finds anything", CONTRACT D6).
 *
 * A transient modal (not a tool window): mounted by Shell.tsx only while open. Results from
 * GET /api/cmdk (a flat list) are grouped client-side by kind into labeled sections; a flat
 * `activeIndex` walks the flattened list with ArrowUp/Down. Enter (or click) fires the door
 * for that kind and closes; Escape and a backdrop click close. Every door routes through an
 * existing single-door helper (no raw window/store reach-arounds), so the palette stays a
 * thin dispatcher — concept opens the trajectory (Progress), never the Gym.
 */
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Spinner } from "../../components/Spinner.tsx";
import { useCourseStore } from "../courses/store.ts";
import { useUiStore } from "../../lib/store.ts";
import { useWindowStore } from "../../app/windows/windowStore.ts";
import { openPdf } from "../library/pdfStore.ts";
import { progressForConcept } from "../progress/progressStore.ts";
import { toast } from "../../components/toast.ts";
import type { GlobalSearchResult } from "../../api/types.ts";
import { useGlobalSearch } from "./api.ts";
import "./search.css";

interface Props {
  onClose: () => void;
}

/** Display order + section labels for the six kinds (CONTRACT D2). */
const KIND_ORDER: GlobalSearchResult["kind"][] = [
  "course",
  "concept",
  "material",
  "note",
  "todo",
  "session",
];

const KIND_LABEL: Record<string, string> = {
  course: "Courses",
  concept: "Concepts",
  material: "Materials",
  note: "Notes",
  todo: "Todos",
  session: "Sessions",
};

export function CommandPalette({ onClose }: Props) {
  const [value, setValue] = useState("");
  const deferred = useDeferredValue(value);
  const { data, isFetching } = useGlobalSearch(deferred);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const navigate = useNavigate();

  // Autofocus the input when the palette mounts (it only mounts while open).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Group results by kind in display order, then flatten for a single keyboard cursor.
  const sections = useMemo(() => {
    const results = data?.results ?? [];
    return KIND_ORDER.map((kind) => ({
      kind,
      label: KIND_LABEL[kind] ?? kind,
      items: results.filter((r) => r.kind === kind),
    })).filter((s) => s.items.length > 0);
  }, [data]);

  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  const [activeIndex, setActiveIndex] = useState(0);
  // Keep the cursor in range as results change (e.g. a new query shrinks the list).
  useEffect(() => {
    setActiveIndex(0);
  }, [flat.length]);

  /** Dispatch a result to the surface that owns it, then close the palette (CONTRACT D6). */
  function pick(r: GlobalSearchResult) {
    switch (r.kind) {
      case "course":
        useCourseStore.getState().setActiveCourse(r.id);
        break;
      case "session":
        useUiStore.getState().setCurrentSession(r.id);
        navigate("/");
        break;
      case "material":
        openPdf(r.source_id ?? r.id, r.title, r.page ?? undefined);
        break;
      case "concept": {
        // The backend resolves the concept's owning course; fall back to the
        // active tab, and no-op (never activate an empty course) if neither exists.
        const cid = r.course_id ?? activeCourseId;
        if (!cid) {
          toast.info("Open this concept's course to see its trajectory.");
          break;
        }
        progressForConcept(cid, r.id);
        break;
      }
      case "todo":
        if (r.course_id) useCourseStore.getState().setActiveCourse(r.course_id);
        useWindowStore.getState().open("dashboard");
        break;
      case "note":
        useWindowStore.getState().open("notes");
        break;
    }
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (flat.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % flat.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = flat[activeIndex];
      if (r) pick(r);
    }
  }

  const tooShort = deferred.trim().length < 2;

  // The running flat index as we render sections, so a section-local item maps to the cursor.
  let cursor = -1;

  return (
    <div className="cmdk-backdrop" onClick={onClose}>
      <div
        className="cmdk-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          className="cmdk-input"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search courses, concepts, materials, notes, todos, sessions…"
          aria-label="Search query"
          autoComplete="off"
          spellCheck={false}
        />

        <div className="cmdk-results">
          {tooShort && (
            <p className="cmdk-hint">Type at least two characters to search.</p>
          )}
          {!tooShort && isFetching && <Spinner label="Searching…" />}
          {!tooShort && !isFetching && flat.length === 0 && (
            <p className="cmdk-empty">No results.</p>
          )}
          {!tooShort &&
            sections.map((section) => (
              <div key={section.kind} className="cmdk-section">
                <p className="cmdk-section-label">{section.label}</p>
                <ul className="cmdk-list">
                  {section.items.map((r) => {
                    cursor += 1;
                    const isActive = cursor === activeIndex;
                    const idx = cursor;
                    return (
                      <li key={`${r.kind}-${r.id}`}>
                        <button
                          type="button"
                          className={`cmdk-result${isActive ? " cmdk-result--active" : ""}`}
                          onMouseMove={() => setActiveIndex(idx)}
                          onClick={() => pick(r)}
                        >
                          <span className="cmdk-result-title">{r.title}</span>
                          {r.subtitle && (
                            <span className="cmdk-result-subtitle">{r.subtitle}</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
