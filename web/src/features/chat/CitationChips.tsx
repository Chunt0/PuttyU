import type { Citation } from "../../api/streaming.ts";
import { openPdf } from "../library/pdfStore.ts";

/** The last heading-path segment, like the backend's citation_label. */
function shortHeading(heading: string): string {
  const parts = heading.split(" > ");
  return parts[parts.length - 1] ?? heading;
}

function chipLabel(c: Citation): string {
  const h = shortHeading(c.heading);
  let label = h && h !== c.title ? `${c.title} §${h}` : c.title || "source";
  if (c.page_start != null) label += ` · p. ${c.page_start}`;
  return label;
}

/**
 * Compact grounding chips for a chat turn (SPEC F3 — "citations are doors"). One chip per
 * retrieved excerpt; clicking opens the PDF viewer at the cited page. Rendered for the
 * live turn only — history doesn't persist citations (same contract as agent tool steps).
 */
export function CitationChips({ items }: { items: Citation[] }) {
  if (items.length === 0) return null;
  const sourceCount = new Set(items.map((c) => c.source_id)).size;
  return (
    <div className="citation-chips" data-testid="citations">
      <span className="citation-count">
        grounded in {sourceCount} source{sourceCount === 1 ? "" : "s"}
      </span>
      {items.map((c) => (
        <button
          key={c.chunk_id || `${c.source_id}-${c.page_start}`}
          type="button"
          className="citation-chip"
          title={c.citation || chipLabel(c)}
          onClick={() => openPdf(c.source_id, c.title, c.page_start)}
        >
          {chipLabel(c)}
        </button>
      ))}
    </div>
  );
}
