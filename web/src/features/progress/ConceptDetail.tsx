import { useState, type FormEvent } from "react";
import { Spinner } from "../../components/Spinner.tsx";
import { ConfirmButton } from "../../components/ConfirmButton.tsx";
import { toast } from "../../components/toast.ts";
import type { GraphAssertion, GraphConceptDetail, GraphEvidence } from "../../api/types.ts";
import { useChallengeAssertion, useConceptDetail, useOverrideConcept } from "./api.ts";
import { StateChip } from "./StateChip.tsx";
import { confidenceWord, fmtDay, signalLabel } from "./model.ts";

/** The merged trajectory: mastery evidence + assertions, newest first. Invalidated
 * assertions ride along — the arc is the value, so they are dimmed, never hidden. */
type TimelineEntry =
  | { type: "evidence"; at: string; ev: GraphEvidence }
  | { type: "assertion"; at: string; a: GraphAssertion };

function timeline(detail: GraphConceptDetail): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const ev of detail.evidence ?? []) out.push({ type: "evidence", at: ev.created_at ?? "", ev });
  for (const a of detail.assertions ?? []) out.push({ type: "assertion", at: a.valid_from ?? "", a });
  out.sort((x, y) => y.at.localeCompare(x.at));
  return out;
}

function EvidenceRow({ ev }: { ev: GraphEvidence }) {
  return (
    <li className="timeline-row timeline-row--evidence">
      <span className="timeline-body">
        {signalLabel(ev.signal)}
        {ev.source ? ` — ${ev.source}` : ""}
        {ev.indirect ? " (indirect)" : ""}
        {ev.note ? ` · ${ev.note}` : ""}
      </span>
      <span className="timeline-date">{fmtDay(ev.created_at)}</span>
    </li>
  );
}

/** One assertion row. Stated → the verbatim quote; inferred → statement + a
 * confidence WORD (likely/tentative — Q10: no raw numbers) and the challenge
 * door ("That's not right" → inline correction → POST challenge). */
function AssertionRow({ a }: { a: GraphAssertion }) {
  const challenge = useChallengeAssertion();
  const [challenging, setChallenging] = useState(false);
  const [correction, setCorrection] = useState("");
  const invalidated = a.invalidated_at != null;
  const stated = a.kind === "stated";

  async function onChallenge(e: FormEvent) {
    e.preventDefault();
    const text = correction.trim();
    if (!text) return;
    try {
      await challenge.mutateAsync({ assertionId: a.id, correction: text });
      setChallenging(false);
      setCorrection("");
    } catch {
      toast.error("Could not record the correction.");
    }
  }

  return (
    <li
      className={`timeline-row timeline-row--assertion${
        invalidated ? " timeline-row--invalidated" : ""
      }`}
    >
      <div className="timeline-body">
        {stated ? (
          <blockquote className="assertion-quote">{a.quote || a.statement}</blockquote>
        ) : (
          <span>
            {a.statement} <span className="qualifier">({confidenceWord(a.confidence)})</span>
          </span>
        )}
      </div>
      <span className="timeline-date">
        {stated ? "you said" : "tutor insight"} · {fmtDay(a.valid_from)}
        {invalidated && ` · invalidated ${fmtDay(a.invalidated_at)}`}
      </span>
      {!stated && !invalidated && !challenging && (
        <button
          type="button"
          className="challenge-toggle"
          onClick={() => setChallenging(true)}
          aria-label={`Challenge: ${a.statement}`}
        >
          That&rsquo;s not right
        </button>
      )}
      {challenging && (
        <form className="challenge-form" onSubmit={(e) => void onChallenge(e)}>
          <input
            aria-label={`Correction for: ${a.statement}`}
            value={correction}
            onChange={(e) => setCorrection(e.target.value)}
            placeholder="What's actually true?"
          />
          <button type="submit" disabled={challenge.isPending || !correction.trim()}>
            Send correction
          </button>
          <button type="button" onClick={() => setChallenging(false)}>
            Cancel
          </button>
        </form>
      )}
    </li>
  );
}

/**
 * The concept detail panel (F5 "tap a node to see the evidence behind its state"):
 * name + state, the override doors, and the merged trajectory timeline.
 */
export function ConceptDetail({ conceptId, onClose }: { conceptId: string; onClose: () => void }) {
  const detail = useConceptDetail(conceptId);
  const override = useOverrideConcept();

  async function onOverride(known: boolean) {
    try {
      await override.mutateAsync({ conceptId, known });
    } catch {
      toast.error("Could not record the override.");
    }
  }

  return (
    <aside className="concept-detail" aria-label="Concept detail">
      {detail.isLoading && <Spinner label="Loading concept…" />}
      {detail.data && (
        <>
          <header className="concept-detail-head">
            <h2>{detail.data.name}</h2>
            <StateChip state={detail.data.state} />
            <button type="button" className="concept-detail-close" onClick={onClose}>
              Close
            </button>
          </header>
          <div className="override-row">
            <button
              type="button"
              onClick={() => void onOverride(true)}
              disabled={override.isPending}
            >
              I know this
            </button>
            <ConfirmButton
              label="I never learned this"
              confirmLabel="Reset it?"
              className="override-unknown"
              title="I never learned this"
              disabled={override.isPending}
              onConfirm={() => void onOverride(false)}
            />
          </div>
          <h3>Trajectory</h3>
          {timeline(detail.data).length === 0 && (
            <p className="progress-empty">No evidence yet — the story starts when you start working.</p>
          )}
          <ul className="timeline">
            {timeline(detail.data).map((e) =>
              e.type === "evidence" ? (
                <EvidenceRow key={`e-${e.ev.id}`} ev={e.ev} />
              ) : (
                <AssertionRow key={`a-${e.a.id}`} a={e.a} />
              ),
            )}
          </ul>
        </>
      )}
    </aside>
  );
}
