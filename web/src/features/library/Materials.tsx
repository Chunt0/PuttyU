import { useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent } from "react";
import { Spinner } from "../../components/Spinner.tsx";
import { ConfirmButton } from "../../components/ConfirmButton.tsx";
import { CameraCapture } from "../../components/CameraCapture.tsx";
import { toast } from "../../components/toast.ts";
import type { CorpusSource } from "../../api/types.ts";
import { useCorpusSources, useDeleteMaterial, useReplaceTags, useUploadMaterial } from "./api.ts";
import { openPdf } from "./pdfStore.ts";

/** Inline tag editor: chips with remove, plus a free-form add box (Enter to add).
 * Every change PATCHes the whole list — the backend stores tags atomically. */
function TagEditor({ material }: { material: CorpusSource }) {
  const replaceTags = useReplaceTags();
  const [draft, setDraft] = useState("");
  const tags = material.tags ?? [];

  function commit(next: string[]) {
    replaceTags.mutate(
      { sourceId: material.id, tags: next },
      { onError: () => toast.error("Could not update tags.") },
    );
  }

  function onAdd() {
    const t = draft.trim();
    if (!t) return;
    setDraft("");
    if (tags.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    commit([...tags, t]);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      onAdd();
    }
  }

  return (
    <span className="material-tags">
      {tags.map((t) => (
        <span key={t} className="tag-chip">
          {t}
          <button
            type="button"
            className="tag-remove"
            aria-label={`Remove tag ${t} from ${material.title}`}
            onClick={() => commit(tags.filter((x) => x !== t))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="tag-add"
        value={draft}
        placeholder="add tag"
        aria-label={`Add tag to ${material.title}`}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onAdd}
      />
    </span>
  );
}

/**
 * Course materials (SPEC F2 second block): the user's own uploads — syllabi, homework
 * sheets, any PDF or photographed pages — beside, never inside, the shared library.
 * Upload (file pick, drag-drop, or multi-shot webcam capture → ONE material), tag,
 * filter by tag, delete. Shared by the Library window and the course landing pane.
 */
export function Materials({ courseId }: { courseId: string | null }) {
  const sources = useCorpusSources();
  const upload = useUploadMaterial();
  const deleteMaterial = useDeleteMaterial();

  const [selected, setSelected] = useState<File[]>([]);
  const [tagFilter, setTagFilter] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const materials = useMemo(() => {
    const all = (sources.data ?? []).filter((s) => s.kind === "material");
    return courseId ? all.filter((s) => s.course_id === courseId) : all;
  }, [sources.data, courseId]);

  const allTags = useMemo(
    () => [...new Set(materials.flatMap((m) => m.tags ?? []))].sort(),
    [materials],
  );
  const visible = tagFilter ? materials.filter((m) => (m.tags ?? []).includes(tagFilter)) : materials;

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    try {
      const res = await upload.mutateAsync({ files, courseId });
      if (!res.created) toast.info("Already in your materials — nothing re-imported.");
      else if (res.needs_ocr) toast.info("Added, but the pages had no extractable text yet.");
      else toast.success(`Added "${res.source.title}" (${res.chunks} chunks).`);
    } catch {
      toast.error("Upload failed — PDFs and images only.");
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const files = selected;
    setSelected([]);
    if (fileInput.current) fileInput.current.value = "";
    void uploadFiles(files);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void uploadFiles(Array.from(e.dataTransfer.files));
  }

  return (
    <div className="materials">
      <h2>Course materials</h2>
      <p className="materials-hint">
        Your own uploads — syllabi, homework sheets, any PDF or photographed pages. Multiple
        images become one material.
      </p>

      <form
        className={`materials-upload ${dragging ? "materials-upload--drag" : ""}`.trim()}
        onSubmit={onSubmit}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          ref={fileInput}
          type="file"
          multiple
          accept="application/pdf,image/*"
          aria-label="Material files"
          onChange={(e) => setSelected(Array.from(e.target.files ?? []))}
        />
        <button type="submit" disabled={selected.length === 0 || upload.isPending}>
          {upload.isPending ? "Ingesting…" : `Upload${selected.length ? ` (${selected.length})` : ""}`}
        </button>
        <CameraCapture multi label="Take photos" onAccept={(files) => void uploadFiles(files)} />
      </form>

      {allTags.length > 0 && (
        <div className="materials-filter">
          <label>
            Filter by tag
            <select
              aria-label="Filter by tag"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
            >
              <option value="">All tags</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {sources.isLoading && <Spinner label="Loading materials…" />}
      {!sources.isLoading && visible.length === 0 && (
        <p className="materials-empty">
          {tagFilter ? "No materials carry that tag." : "No materials yet."}
        </p>
      )}
      <ul className="materials-list">
        {visible.map((m) => (
          <li key={m.id} className="material-row">
            <span className="source-kind source-kind--material">material</span>
            <span className="material-title">{m.title}</span>
            <TagEditor material={m} />
            {m.has_pdf && (
              <button type="button" className="material-open" onClick={() => openPdf(m.id, m.title)}>
                Open PDF
              </button>
            )}
            <ConfirmButton
              className="material-delete"
              label="Delete"
              title={`Delete ${m.title}`}
              onConfirm={() =>
                deleteMaterial.mutate(m.id, { onError: () => toast.error("Delete failed.") })
              }
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
