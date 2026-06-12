import { useRef, useState, type FormEvent } from "react";
import { Spinner } from "../../components/Spinner.tsx";
import { ConfirmButton } from "../../components/ConfirmButton.tsx";
import {
  usePersonalDocs,
  useUploadDocs,
  useDeleteDoc,
  useEmbeddingEndpoint,
  useActiveEmbeddingModel,
} from "./api.ts";

function formatSize(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Corpus: upload personal documents into the RAG index, list them, remove them. */
export function Corpus() {
  const docs = usePersonalDocs();
  const upload = useUploadDocs();
  const deleteDoc = useDeleteDoc();
  const endpoint = useEmbeddingEndpoint();
  const activeModel = useActiveEmbeddingModel();

  const [selected, setSelected] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const embeddingLabel = endpoint.data?.active
    ? `${endpoint.data.model || "custom endpoint"} (${endpoint.data.url})`
    : activeModel.data
      ? `${activeModel.data} (built-in)`
      : "built-in fastembed";

  async function onUpload(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (selected.length === 0) return;
    try {
      await upload.mutateAsync(selected);
      setSelected([]);
      if (fileInput.current) fileInput.current.value = "";
    } catch {
      setError("Upload failed — is the embedding service running?");
    }
  }

  return (
    <section className="corpus">
      <h1>Corpus</h1>
      <p className="corpus-embedding">
        Embeddings: <strong>{embeddingLabel}</strong>
      </p>

      <form className="corpus-upload" onSubmit={onUpload}>
        <h2>Add documents</h2>
        <input
          ref={fileInput}
          type="file"
          multiple
          aria-label="Documents"
          onChange={(e) => setSelected(Array.from(e.target.files ?? []))}
        />
        <button type="submit" disabled={selected.length === 0 || upload.isPending}>
          {upload.isPending ? "Indexing…" : `Upload${selected.length ? ` (${selected.length})` : ""}`}
        </button>
        {upload.data && (
          <p className="corpus-uploaded" role="status">
            Indexed {upload.data.indexed_count} chunk{upload.data.indexed_count === 1 ? "" : "s"}
            {upload.data.failed_count ? `, ${upload.data.failed_count} failed` : ""}.
          </p>
        )}
        {error && <p className="corpus-error" role="alert">{error}</p>}
      </form>

      <div className="corpus-list">
        <h2>Indexed documents ({docs.data?.length ?? 0})</h2>
        {docs.isLoading && <Spinner label="Loading documents…" />}
        {!docs.isLoading && (docs.data?.length ?? 0) === 0 && (
          <p className="corpus-empty">No documents indexed yet.</p>
        )}
        <ul>
          {docs.data?.map((f) => (
            <li key={f.path || f.name} className="corpus-row">
              <span className="corpus-name">{f.name}</span>
              <span className="corpus-size">{formatSize(f.size)}</span>
              <ConfirmButton
                className="corpus-delete"
                label="Remove"
                title={`Delete ${f.name}`}
                onConfirm={() => deleteDoc.mutate(f.path || f.name)}
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
