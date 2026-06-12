import { useRef, useState, type FormEvent } from "react";
import { Spinner } from "../../components/Spinner.tsx";
import { useLibrary, useCreateDoc, useImportPdf } from "./api.ts";
import { DocEditor } from "./DocEditor.tsx";

/** Documents: a library of lesson materials + student work. Create text docs, import PDFs
 * (scanned/handwritten work gets VL text extraction), open to edit with version history. */
export function Documents() {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const library = useLibrary(search);
  const create = useCreateDoc();
  const importPdf = useImportPdf();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim() && !content.trim()) {
      setError("Add a title or some content.");
      return;
    }
    try {
      const doc = await create.mutateAsync({ title: title.trim() || "Untitled", content: content.trim() });
      setTitle("");
      setContent("");
      setSelectedId(doc.id);
    } catch {
      setError("Could not create the document.");
    }
  }

  async function onImport(file: File) {
    setError(null);
    try {
      const doc = await importPdf.mutateAsync(file);
      setSelectedId(doc.id);
    } catch {
      setError("Could not import that PDF.");
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <section className="documents">
      <h1>Documents</h1>

      <form className="doc-create" onSubmit={onCreate}>
        <h2>New document</h2>
        <input aria-label="Document title" placeholder="Worksheet: fractions" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea aria-label="New document content" placeholder="Contents…" value={content} onChange={(e) => setContent(e.target.value)} rows={3} />
        <div className="doc-create-actions">
          <button type="submit" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create"}
          </button>
          <label className="doc-import">
            {importPdf.isPending ? "Importing…" : "Import PDF"}
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf"
              aria-label="Import PDF"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onImport(f);
              }}
            />
          </label>
        </div>
        {error && <p className="doc-error" role="alert">{error}</p>}
      </form>

      <div className="doc-search">
        <input aria-label="Search documents" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="doc-list">
        <h2>Library ({library.data?.length ?? 0})</h2>
        {library.isLoading && <Spinner label="Loading documents…" />}
        {!library.isLoading && (library.data?.length ?? 0) === 0 && <p className="doc-empty">No documents yet.</p>}
        <ul>
          {library.data?.map((d) => (
            <li key={d.id} className={`doc-card${selectedId === d.id ? " doc-card--active" : ""}`}>
              <button className="doc-open" onClick={() => setSelectedId(d.id)}>
                <span className="doc-card-title">{d.title || "(untitled)"}</span>
                <span className="doc-card-lang">{d.language}</span>
                <span className="doc-card-preview">{d.preview}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {selectedId && <DocEditor id={selectedId} onClose={() => setSelectedId(null)} />}
    </section>
  );
}
