import { useEffect, useState, type FormEvent } from "react";
import { Spinner } from "../../components/Spinner.tsx";
import { useNotes, useCreateNote, useUpdateNote, useDeleteNote, usePinNote, useArchiveNote } from "./api.ts";
import { ConfirmButton } from "../../components/ConfirmButton.tsx";
import type { Note } from "../../api/types.ts";

/** Notes: lesson notes + reminders. Create/edit/delete, pin, archive; active/archived views. */
export function Notes() {
  const [showArchived, setShowArchived] = useState(false);
  const notes = useNotes(showArchived);
  const create = useCreateNote();
  const update = useUpdateNote();
  const del = useDeleteNote();
  const pin = usePinNote();
  const archive = useArchiveNote();

  const [editing, setEditing] = useState<Note | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setTitle(editing.title ?? "");
    setContent(editing.content ?? "");
  }, [editing]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim() && !content.trim()) {
      setError("Add a title or some content.");
      return;
    }
    const input = { title: title.trim(), content: content.trim() };
    try {
      if (editing) await update.mutateAsync({ id: editing.id, input });
      else await create.mutateAsync(input);
      setTitle("");
      setContent("");
      setEditing(null);
    } catch {
      setError("Could not save the note.");
    }
  }

  function cancelEdit() {
    setEditing(null);
    setTitle("");
    setContent("");
  }

  return (
    <section className="notes">
      <div className="notes-head">
        <h1>Notes</h1>
        <div className="notes-views">
          <button className={!showArchived ? "active" : ""} onClick={() => setShowArchived(false)}>
            Active
          </button>
          <button className={showArchived ? "active" : ""} onClick={() => setShowArchived(true)}>
            Archived
          </button>
        </div>
      </div>

      {!showArchived && (
        <form className="note-form" onSubmit={onSubmit}>
          <h2>{editing ? "Edit note" : "New note"}</h2>
          <input aria-label="Note title" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea aria-label="Note content" placeholder="Take a note…" value={content} onChange={(e) => setContent(e.target.value)} rows={3} />
          <div className="note-form-actions">
            <button type="submit" disabled={create.isPending || update.isPending}>
              {editing ? "Save changes" : "Add note"}
            </button>
            {editing && (
              <button type="button" onClick={cancelEdit}>
                Cancel
              </button>
            )}
          </div>
          {error && <p className="note-error" role="alert">{error}</p>}
        </form>
      )}

      <div className="note-list">
        {notes.isLoading && <Spinner label="Loading notes…" />}
        {!notes.isLoading && (notes.data?.length ?? 0) === 0 && (
          <p className="note-empty">{showArchived ? "No archived notes." : "No notes yet."}</p>
        )}
        <ul>
          {notes.data?.map((n) => (
            <li key={n.id} className={`note-card${n.pinned ? " note-card--pinned" : ""}`}>
              <div className="note-card-body">
                {n.title && <span className="note-title">{n.title}</span>}
                {n.content && <span className="note-content">{n.content}</span>}
              </div>
              <div className="note-actions">
                {!showArchived && (
                  <button aria-label={`Pin ${n.title || n.id}`} className={n.pinned ? "note-pinned" : ""} onClick={() => pin.mutate(n.id)} title={n.pinned ? "Unpin" : "Pin"}>
                    ★
                  </button>
                )}
                <button aria-label={`${n.archived ? "Unarchive" : "Archive"} ${n.title || n.id}`} onClick={() => archive.mutate(n.id)}>
                  {n.archived ? "Unarchive" : "Archive"}
                </button>
                {!showArchived && (
                  <button aria-label={`Edit ${n.title || n.id}`} onClick={() => setEditing(n)}>
                    Edit
                  </button>
                )}
                <ConfirmButton
                  className="note-delete"
                  title={`Delete ${n.title || n.id}`}
                  onConfirm={() => del.mutate(n.id)}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
