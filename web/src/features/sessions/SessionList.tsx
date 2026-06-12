import { useEffect, useState, type FormEvent } from "react";
import { Spinner } from "../../components/Spinner.tsx";
import { useNavigate } from "react-router-dom";
import { useUiStore } from "../../lib/store.ts";
import { useSessions, useCreateSession, useRenameSession, useDeleteSession } from "./api.ts";
import { ConfirmButton } from "../../components/ConfirmButton.tsx";
import { toast } from "../../components/toast.ts";

const PencilIcon = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
  </svg>
);

/** Sidebar list of chats + "New chat". Selecting one sets the current session (client
 * state); the Chat screen reads that and loads the session's history (server state).
 * Each row gets hover actions: inline rename and a two-step delete. */
export function SessionList() {
  const { data: sessions, isLoading } = useSessions();
  const create = useCreateSession();
  const rename = useRenameSession();
  const remove = useDeleteSession();
  const navigate = useNavigate();
  const currentSessionId = useUiStore((s) => s.currentSessionId);
  const setCurrentSession = useUiStore((s) => s.setCurrentSession);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  // Auto-select the first session once loaded so the Chat screen isn't empty.
  useEffect(() => {
    if (!currentSessionId && sessions && sessions.length > 0) {
      setCurrentSession(sessions[0].id);
    }
  }, [currentSessionId, sessions, setCurrentSession]);

  // Selecting a chat always returns to the chat screen (e.g. from the Providers page).
  function select(id: string) {
    setCurrentSession(id);
    navigate("/");
  }

  async function onNew() {
    const created = await create.mutateAsync("New chat");
    select(created.id);
  }

  function startRename(id: string, name: string) {
    setEditingId(id);
    setEditName(name);
  }

  async function saveRename(e: FormEvent) {
    e.preventDefault();
    const id = editingId;
    const name = editName.trim();
    setEditingId(null);
    if (!id || !name) return;
    try {
      await rename.mutateAsync({ id, name });
    } catch {
      toast.error("Could not rename the chat.");
    }
  }

  async function onDelete(id: string) {
    try {
      await remove.mutateAsync(id);
      if (id === currentSessionId) setCurrentSession(null);
    } catch {
      toast.error("Could not delete the chat.");
    }
  }

  return (
    <div className="session-list">
      <button className="session-new" onClick={onNew} disabled={create.isPending}>
        + New chat
      </button>
      {isLoading && <p className="session-empty"><Spinner label="Loading…" /></p>}
      {sessions && sessions.length === 0 && <p className="session-empty">No chats yet.</p>}
      <ul>
        {sessions?.map((s) => (
          <li key={s.id} className="session-row">
            {editingId === s.id ? (
              <form className="session-rename" onSubmit={saveRename}>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={saveRename}
                  onKeyDown={(e) => e.key === "Escape" && setEditingId(null)}
                  aria-label="Chat name"
                  autoFocus
                />
              </form>
            ) : (
              <>
                <button
                  className={s.id === currentSessionId ? "session-item session-item--active" : "session-item"}
                  onClick={() => select(s.id)}
                  onDoubleClick={() => startRename(s.id, s.name || "")}
                >
                  {s.name || "Untitled"}
                </button>
                <span className="session-actions">
                  <button
                    type="button"
                    className="session-action"
                    onClick={() => startRename(s.id, s.name || "")}
                    aria-label={`Rename ${s.name || "Untitled"}`}
                    title="Rename"
                  >
                    {PencilIcon}
                  </button>
                  <ConfirmButton
                    className="session-action session-action--delete"
                    label="×"
                    confirmLabel="✓"
                    title={`Delete ${s.name || "Untitled"}`}
                    onConfirm={() => void onDelete(s.id)}
                  />
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
