import { useEffect, useState } from "react";
import { Spinner } from "../../components/Spinner.tsx";
import { useDocument, useUpdateDoc, useDeleteDoc, useArchiveDoc, useVersions, useRestoreVersion } from "./api.ts";
import { ConfirmButton } from "../../components/ConfirmButton.tsx";
import { toast } from "../../components/toast.ts";

/** The selected document: edit content (versioned save), view/restore versions, archive, delete. */
export function DocEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const doc = useDocument(id);
  const update = useUpdateDoc();
  const del = useDeleteDoc();
  const archive = useArchiveDoc();
  const restore = useRestoreVersion();
  const [content, setContent] = useState("");
  const [showVersions, setShowVersions] = useState(false);
  const versions = useVersions(id, showVersions);

  const loaded = doc.data;
  useEffect(() => {
    if (loaded) setContent(loaded.current_content ?? "");
  }, [loaded]);

  async function onDelete() {
    await del.mutateAsync(id);
    onClose();
  }

  if (doc.isLoading) return <div className="doc-editor"><Spinner label="Loading…" /></div>;
  if (!loaded) return <div className="doc-editor">Not found.</div>;

  const dirty = content !== (loaded.current_content ?? "");

  return (
    <div className="doc-editor" data-testid={`editor-${id}`}>
      <div className="doc-editor-head">
        <h2>{loaded.title || "(untitled)"}</h2>
        <button aria-label="Close document" onClick={onClose}>
          Close
        </button>
      </div>

      <textarea aria-label="Document content" value={content} onChange={(e) => setContent(e.target.value)} rows={14} />

      <div className="doc-editor-actions">
        <button
          onClick={() =>
            update.mutate(
              { id, content },
              { onSuccess: () => toast.success("Saved"), onError: () => toast.error("Save failed") },
            )
          }
          disabled={!dirty || update.isPending}
        >
          {update.isPending ? "Saving…" : "Save"}
        </button>
        <button onClick={() => setShowVersions((v) => !v)}>
          {showVersions ? "Hide versions" : `Versions (${loaded.version_count})`}
        </button>
        <button onClick={() => archive.mutate({ id, archived: !loaded.archived })}>
          {loaded.archived ? "Unarchive" : "Archive"}
        </button>
        <ConfirmButton className="doc-delete" title="Delete document" onConfirm={() => void onDelete()} />
      </div>

      {showVersions && (
        <div className="doc-versions" data-testid="doc-versions">
          {versions.isLoading && <p>Loading versions…</p>}
          <ul>
            {versions.data?.map((v) => (
              <li key={v.id} className="doc-version">
                <span className="doc-version-n">v{v.version_number}</span>
                <span className="doc-version-src">{v.source}</span>
                <span className="doc-version-sum">{v.summary || ""}</span>
                <button aria-label={`Restore version ${v.version_number}`} onClick={() => restore.mutate({ id, num: v.version_number })}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
