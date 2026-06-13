import { usePdfStore } from "./pdfStore.ts";

/**
 * The PDF viewer tool window: the browser-native viewer in an iframe pointed at the
 * backend's original-file endpoint (`/api/corpus/sources/{id}/pdf`), with `#page=N`
 * steering it to the cited page (F2 "citations are doors"). The header shows the
 * source title + page; the iframe is keyed on the URL so a new target re-navigates
 * even when only the page anchor changed.
 */
export function PdfViewer() {
  const target = usePdfStore((s) => s.target);

  if (!target) {
    return <p className="pdf-empty">Open a PDF from the library, or click a citation in chat.</p>;
  }

  const src =
    `/api/corpus/sources/${encodeURIComponent(target.sourceId)}/pdf` +
    (target.page != null ? `#page=${target.page}` : "");

  return (
    <div className="pdf-viewer">
      <header className="pdf-head">
        <span className="pdf-title">{target.title || "PDF"}</span>
        {target.page != null && <span className="pdf-page">p. {target.page}</span>}
      </header>
      <iframe key={src} src={src} title={target.title || "PDF"} className="pdf-frame" />
    </div>
  );
}
