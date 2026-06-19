import { useEffect, useMemo, useState } from "react";
import { Spinner } from "../../components/Spinner.tsx";
import { ConfirmButton } from "../../components/ConfirmButton.tsx";
import { toast } from "../../components/toast.ts";
import { openPdf } from "../library/pdfStore.ts";
import { useWindowStore } from "../../app/windows/windowStore.ts";
import type { MineResponse, ScheduleProposal } from "../../api/types.ts";
import { useMinerStore, type MinerTarget } from "./minerStore.ts";
import { ScheduleError, useApplyProposals, useMineSchedule } from "./api.ts";
import {
  defaultChecked,
  fallbackSummary,
  isCommittable,
  isResolved,
  toApplyItem,
  type RowEdit,
} from "./miner.model.ts";
import "./miner.css";

/** The status chip wording — calm and plain (CONTRACT D8). */
const STATUS_LABEL: Record<ScheduleProposal["status"], string> = {
  new: "new",
  changed: "changed",
  unchanged: "already added",
  stale: "removed",
};

/** Seed a row's local edit state from its proposal (default include/prune by status). */
function seedEdit(p: ScheduleProposal): RowEdit {
  return {
    checked: defaultChecked(p.status),
    title: p.title,
    date: p.date ?? "",
    allDay: p.all_day,
  };
}

/** One proposal row: checkbox, title/date/status/kind, provenance chip, edit + ambiguity resolve. */
function ProposalRow({
  p,
  edit,
  sourceId,
  title,
  onEdit,
}: {
  p: ScheduleProposal;
  edit: RowEdit;
  /** The source id + title (for the provenance chip's "open PDF" door). */
  sourceId: string;
  title: MinerTarget["title"];
  onEdit: (next: RowEdit) => void;
}) {
  const [open, setOpen] = useState(false);
  const resolved = isResolved(p, edit);

  return (
    <li className={`miner-row miner-row--${p.status}${resolved ? "" : " miner-row--unresolved"}`}>
      <label className="miner-check">
        <input
          type="checkbox"
          checked={edit.checked && resolved}
          disabled={!resolved}
          aria-label={`Include ${edit.title}`}
          onChange={(e) => onEdit({ ...edit, checked: e.target.checked })}
        />
      </label>

      <div className="miner-main">
        <div className="miner-line">
          <span className="miner-title">{edit.title}</span>
          <span className={`miner-chip miner-chip--${p.status}`}>{STATUS_LABEL[p.status]}</span>
          <span className="miner-kind">{p.kind === "event" ? "event" : "todo"}</span>
        </div>
        <div className="miner-meta">
          <span className="miner-date">{edit.date || (p.ambiguous ? "no date yet" : "no date")}</span>
          {p.page != null && (
            <button
              type="button"
              className="miner-prov"
              onClick={() => openPdf(sourceId, title, p.page)}
            >
              from syllabus p. {p.page}
            </button>
          )}
          {!p.ambiguous && (
            <button
              type="button"
              className="miner-edit-toggle"
              onClick={() => setOpen((v) => !v)}
              aria-label={`Edit ${edit.title}`}
            >
              {open ? "Done" : "Edit"}
            </button>
          )}
        </div>

        {/* Ambiguity: ask, don't guess. Show the question + an inline date the user supplies. */}
        {p.ambiguous && (
          <div className="miner-ambiguous" role="group" aria-label={`Resolve ${p.title}`}>
            <p className="miner-question">{p.question || "Couldn't resolve this date — when is it?"}</p>
            <label className="miner-field">
              Date
              <input
                type="date"
                value={edit.date}
                aria-label={`Date for ${p.title}`}
                onChange={(e) => onEdit({ ...edit, date: e.target.value })}
              />
            </label>
          </div>
        )}

        {/* Inline edit (non-ambiguous rows): local-only until commit. */}
        {open && !p.ambiguous && (
          <div className="miner-editor">
            <label className="miner-field">
              Title
              <input
                value={edit.title}
                aria-label={`Title for ${p.title}`}
                onChange={(e) => onEdit({ ...edit, title: e.target.value })}
              />
            </label>
            <label className="miner-field">
              Date
              <input
                type="date"
                value={edit.date}
                aria-label={`Edit date for ${p.title}`}
                onChange={(e) => onEdit({ ...edit, date: e.target.value })}
              />
            </label>
            <label className="miner-field miner-field--check">
              <input
                type="checkbox"
                checked={edit.allDay}
                aria-label={`All day for ${p.title}`}
                onChange={(e) => onEdit({ ...edit, allDay: e.target.checked })}
              />
              All day
            </label>
          </div>
        )}
      </div>
    </li>
  );
}

/** The review sheet body once a mine has returned proposals (or "no schedule found"). */
function ReviewSheet({ data, title }: { data: MineResponse; title: MinerTarget["title"] }) {
  const apply = useApplyProposals();
  const cacheEdits = useMinerStore((s) => s.cacheEdits);
  const clearSource = useMinerStore((s) => s.clearSource);
  // Per-row edit state keyed by the proposal key. Seeded from the response on a
  // FRESH mine, but restored from the per-source cache when present (F4: a
  // remount after minimize must not lose the user's resolved dates / edits).
  const [edits, setEdits] = useState<Record<string, RowEdit>>(() => {
    const cached = useMinerStore.getState().cache[data.source_id]?.edits;
    if (cached && Object.keys(cached).length > 0) return cached;
    const seed: Record<string, RowEdit> = {};
    for (const p of data.proposals) seed[p.key] = seedEdit(p);
    return seed;
  });

  const header = data.summary.trim() || fallbackSummary(data.proposals);
  const committable = useMemo(
    () => data.proposals.filter((p) => isCommittable(p, edits[p.key] ?? seedEdit(p))),
    [data.proposals, edits],
  );

  function setEdit(key: string, next: RowEdit) {
    setEdits((cur) => {
      const updated = { ...cur, [key]: next };
      // F4: persist to the cache so a minimize→restore remount keeps the edit.
      cacheEdits(data.source_id, updated);
      return updated;
    });
  }

  /** Bulk: check every resolvable, non-ambiguous-unresolved row (or uncheck all). */
  function selectAll(checked: boolean) {
    setEdits((cur) => {
      const next = { ...cur };
      for (const p of data.proposals) {
        const e = cur[p.key] ?? seedEdit(p);
        // Skip ambiguous-unresolved on select-all (can't be committed anyway).
        if (checked && p.ambiguous && !isResolved(p, e)) continue;
        next[p.key] = { ...e, checked };
      }
      cacheEdits(data.source_id, next);  // F4: survive a minimize→restore remount
      return next;
    });
  }

  async function onCommit() {
    const items = data.proposals
      .filter((p) => isCommittable(p, edits[p.key] ?? seedEdit(p)))
      .map((p) => toApplyItem(p, edits[p.key] ?? seedEdit(p)));
    if (items.length === 0) return;
    try {
      const res = await apply.mutateAsync({ sourceId: data.source_id, items });
      const parts: string[] = [];
      if (res.created_events) parts.push(`${res.created_events} events`);
      if (res.created_todos) parts.push(`${res.created_todos} todos`);
      if (res.updated) parts.push(`${res.updated} updated`);
      toast.success(parts.length ? `Added ${parts.join(", ")}.` : "Nothing to add.");
      clearSource(data.source_id);  // applied → drop the stale cached session
      useWindowStore.getState().close("miner");
    } catch {
      toast.error("Couldn't add these — try again.");
    }
  }

  if (data.proposals.length === 0) {
    return (
      <section className="miner">
        <h1>Schedule miner</h1>
        <p className="miner-empty">No schedule found in this material — nothing to add.</p>
      </section>
    );
  }

  return (
    <section className="miner">
      <h1>Schedule miner</h1>
      <p className="miner-summary" data-testid="miner-summary">{header}</p>
      <p className="miner-hint">Nothing is written until you confirm. Review, prune, or edit first.</p>

      <div className="miner-bulk">
        <button type="button" className="miner-bulk-btn" onClick={() => selectAll(true)}>
          Select all
        </button>
        <button type="button" className="miner-bulk-btn" onClick={() => selectAll(false)}>
          Select none
        </button>
      </div>

      <ul className="miner-list">
        {data.proposals.map((p) => (
          <ProposalRow
            key={p.key}
            p={p}
            edit={edits[p.key] ?? seedEdit(p)}
            sourceId={data.source_id}
            title={title}
            onEdit={(next) => setEdit(p.key, next)}
          />
        ))}
      </ul>

      <div className="miner-actions">
        <ConfirmButton
          className="miner-commit"
          label={`Add to calendar + todos (${committable.length})`}
          confirmLabel="Confirm — add now"
          disabled={committable.length === 0 || apply.isPending}
          onConfirm={() => void onCommit()}
        />
      </div>
    </section>
  );
}

/**
 * One mining session for a fixed material. On mount it RESTORES a cached result for this
 * source if one exists (F4: a remount after minimize must not re-mine — that's a wasted LLM
 * call — nor lose the user's edits); otherwise it kicks the read-only `mine` once (proposes,
 * writes nothing) and caches the result. Keyed on the source id by the parent, so switching
 * materials fully remounts. The auto-kick is idempotent: mine is read-only, so a stray repeat
 * (e.g. React StrictMode's dev double-mount) is harmless.
 */
function MinerSession({ target }: { target: MinerTarget }) {
  const mine = useMineSchedule();
  const { mutate } = mine;
  const cacheResult = useMinerStore((s) => s.cacheResult);
  // The cached result for THIS source, if any (captured once per mount).
  const cached = useMinerStore((s) => s.cache[target.sourceId]?.result);
  const [restored] = useState<MineResponse | undefined>(() => cached);

  useEffect(() => {
    // Restored from cache → no re-mine (untrusted-content + cost: mine is the
    // only read, and it already ran for this source).
    if (restored) return;
    mutate(
      { sourceId: target.sourceId },
      {
        onSuccess: (data) => cacheResult(target.sourceId, data),
        onError: (err) => {
          if (err instanceof ScheduleError && err.status === 503) {
            toast.error("No model is configured for extraction — set one up in Providers.");
          } else {
            toast.error("Couldn't read this material — try again.");
          }
        },
      },
    );
  }, [mutate, target.sourceId, restored, cacheResult]);

  // A restored session skips the mine mutation entirely → render its cached sheet.
  const data = restored ?? mine.data;
  if (!restored && (mine.isPending || mine.isIdle)) {
    return (
      <section className="miner">
        <h1>Schedule miner</h1>
        <Spinner label={`Reading ${target.title} for dates…`} />
      </section>
    );
  }

  if (!data) {
    const noModel = mine.error instanceof ScheduleError && mine.error.status === 503;
    return (
      <section className="miner">
        <h1>Schedule miner</h1>
        <p className="miner-empty">
          {noModel
            ? "No model is configured for schedule extraction yet — set one up in Providers, then try again."
            : "Couldn't read this material for a schedule. Try again."}
        </p>
      </section>
    );
  }

  return <ReviewSheet data={data} title={target.title} />;
}

/**
 * The schedule miner review sheet (Phase-2 T5 vertical-2 — SPEC F2 "the syllabus autofills
 * the calendar"). Opened (hidden window) from a Library material row via minerStore. Reads
 * the target; with none it shows a calm empty state, otherwise it mounts a MinerSession
 * keyed on the source id (which kicks the read-only mine and renders the review sheet).
 */
export function Miner() {
  const target = useMinerStore((s) => s.target);

  if (!target) {
    return (
      <section className="miner">
        <h1>Schedule miner</h1>
        <p className="miner-empty">
          Open a material from the Library and choose &ldquo;Mine schedule&rdquo; to pull its
          dates into your calendar and todos.
        </p>
      </section>
    );
  }

  return <MinerSession key={target.sourceId} target={target} />;
}
