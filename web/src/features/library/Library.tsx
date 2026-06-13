import { useState } from "react";
import { Spinner } from "../../components/Spinner.tsx";
import { useCourseStore } from "../courses/store.ts";
import { useCourses, useCourseSources } from "../courses/api.ts";
import type { CorpusSource, CorpusTocNode } from "../../api/types.ts";
import { useCorpusSources, useSourceToc } from "./api.ts";
import { Materials } from "./Materials.tsx";
import { openPdf } from "./pdfStore.ts";

/** Recursive heading tree. A node with a page opens the PDF viewer at that page;
 * one without still opens the document from the top. */
function TocTree({ source, nodes }: { source: CorpusSource; nodes: CorpusTocNode[] }) {
  if (nodes.length === 0) return null;
  return (
    <ul className="toc-tree">
      {nodes.map((n, i) => (
        <li key={`${n.heading}-${i}`}>
          <button
            type="button"
            className="toc-node"
            onClick={() => openPdf(source.id, source.title, n.page_start)}
          >
            <span className="toc-heading">{n.heading}</span>
            {n.page_start != null && <span className="toc-page">p. {n.page_start}</span>}
          </button>
          {n.children && n.children.length > 0 && <TocTree source={source} nodes={n.children} />}
        </li>
      ))}
    </ul>
  );
}

function LibraryRow({ source }: { source: CorpusSource }) {
  const [expanded, setExpanded] = useState(false);
  const toc = useSourceToc(expanded ? source.id : null);

  return (
    <li className="library-row">
      <div className="library-row-head">
        <span className="source-kind source-kind--library">library</span>
        <span className="library-title">{source.title}</span>
        {source.authors && <span className="library-authors">{source.authors}</span>}
        {source.source_type && <span className="library-type">{source.source_type}</span>}
        <button
          type="button"
          className="library-toc-toggle"
          aria-expanded={expanded}
          aria-label={`Contents of ${source.title}`}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Hide contents" : "Contents"}
        </button>
        {source.has_pdf && (
          <button
            type="button"
            className="library-open"
            aria-label={`Open PDF of ${source.title}`}
            onClick={() => openPdf(source.id, source.title)}
          >
            Open PDF
          </button>
        )}
      </div>
      {expanded && (
        <div className="library-toc">
          {toc.isLoading && <Spinner label="Loading contents…" />}
          {toc.data && toc.data.length === 0 && <p className="library-empty">No contents indexed.</p>}
          {toc.data && <TocTree source={source} nodes={toc.data} />}
        </div>
      )}
    </li>
  );
}

/**
 * The Library panel (SPEC F2): the shared, admin-curated, read-only sources the tutor
 * cites — scoped to the active course's linked sources when a course tab is active —
 * plus the user's own course materials below. Citations and TOC nodes open the PDF
 * viewer window at the cited page.
 */
export function Library() {
  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const { data: courses } = useCourses();
  const sources = useCorpusSources();
  const courseSources = useCourseSources(activeCourseId);

  const activeCourse = courses?.find((c) => c.id === activeCourseId && c.status === "active");
  const linkedIds = courseSources.data?.source_ids ?? [];

  const librarySources = (sources.data ?? []).filter((s) => s.kind === "library");
  const shown = activeCourse ? librarySources.filter((s) => linkedIds.includes(s.id)) : librarySources;

  return (
    <section className="library">
      <h1>Library</h1>
      <p className="library-scope">
        {activeCourse
          ? `Sources linked to ${activeCourse.name}`
          : "All sources (open a course tab to scope)"}
      </p>

      {sources.isLoading && <Spinner label="Loading library…" />}
      {!sources.isLoading && shown.length === 0 && (
        <p className="library-empty">
          {activeCourse
            ? "No library sources linked to this course yet."
            : "The library is empty — sources are imported by the admin."}
        </p>
      )}
      <ul className="library-list">
        {shown.map((s) => (
          <LibraryRow key={s.id} source={s} />
        ))}
      </ul>

      <Materials courseId={activeCourse ? activeCourse.id : null} />
    </section>
  );
}
