import { useState } from "react";
import { Spinner } from "../../components/Spinner.tsx";
import { Markdown } from "../../components/Markdown.tsx";
import { CameraCapture } from "../../components/CameraCapture.tsx";
import { MathInput } from "../../components/MathInput.tsx";
import { ConfirmButton } from "../../components/ConfirmButton.tsx";
import { toast } from "../../components/toast.ts";
import { StateChip } from "../progress/StateChip.tsx";
import { useCourseStore } from "../courses/store.ts";
import { useCourses } from "../courses/api.ts";
import { uploadFiles } from "../chat/attachments.ts";
import type {
  CalibrationFinishResponse,
  PracticeItem,
} from "../../api/types.ts";
import {
  useCalibrationStart,
  useCalibrationAnswer,
  useCalibrationFinish,
} from "./api.ts";
import {
  asStateRows,
  progressText,
  statesSummary,
  stateWord,
} from "./calibration.model.ts";
import "./calibration.css";

/** The live walk: a session key + the item on screen + where we are in the plan. */
interface Walk {
  sessionKey: string;
  item: PracticeItem;
  position: number;
  total: number;
}

/** One item: prompt (markdown) + a typed answer + an optional photo of work, plus a
 * Skip. Submitting (or skipping) posts to the answer endpoint; the parent advances. */
function CalibrationItem({
  item,
  position,
  total,
  pending,
  onAnswer,
  onSkip,
}: {
  item: PracticeItem;
  position: number;
  total: number;
  pending: boolean;
  onAnswer: (text: string, attachmentIds: string[]) => void;
  onSkip: () => void;
}) {
  const [text, setText] = useState("");
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  async function addPhotos(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const up = await uploadFiles(files);
      setAttachmentIds((ids) => [...ids, ...up.map((f) => f.id)]);
      toast.info(`Attached ${up.length} photo${up.length === 1 ? "" : "s"}.`);
    } catch {
      toast.error("Upload failed — file too large or unsupported.");
    } finally {
      setUploading(false);
    }
  }

  const busy = pending || uploading;
  const progress = progressText(position, total);

  return (
    <div className="calib-item">
      <div className="calib-item-head">
        <span className="calib-concept">{item.concept_name}</span>
        {progress && <span className="calib-progress">{progress}</span>}
      </div>

      <div className="calib-prompt">
        <Markdown>{item.prompt}</Markdown>
      </div>

      <textarea
        className="calib-answer"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Answer in your own words, or attach a photo of your work…"
        rows={4}
        aria-label="Your answer"
        disabled={busy}
      />

      {attachmentIds.length > 0 && (
        <p className="calib-attached" role="status">
          {attachmentIds.length} photo{attachmentIds.length === 1 ? "" : "s"} attached
        </p>
      )}

      <div className="calib-item-actions">
        <CameraCapture label="Photo of work" onAccept={(files) => void addPhotos(files)} />
        <MathInput onInsert={(eq) => setText((s) => (s ? s + " " : "") + eq)} />
        <button
          type="button"
          className="calib-skip"
          onClick={onSkip}
          disabled={busy}
        >
          Skip
        </button>
        <button
          type="button"
          className="calib-submit"
          onClick={() => onAnswer(text.trim(), attachmentIds)}
          disabled={busy || (text.trim() === "" && attachmentIds.length === 0)}
        >
          {pending ? "Checking…" : "Submit"}
        </button>
      </div>
    </div>
  );
}

/** The calm end-of-walk summary: a one-line states roll-up + a per-concept list. */
function CalibrationSummary({
  result,
  onClose,
}: {
  result: CalibrationFinishResponse;
  onClose: () => void;
}) {
  const rows = asStateRows(result.states);
  const summary = statesSummary(rows);
  return (
    <div className="calib-summary">
      <h2>You&apos;re warmed up</h2>
      {result.message && <p className="calib-summary-msg">{result.message}</p>}
      {summary && <p className="calib-summary-line">{summary}</p>}
      {rows.length > 0 && (
        <ul className="calib-state-list">
          {rows.map((r) => (
            <li key={r.concept_id ?? r.concept_name ?? Math.random()} className="calib-state-row">
              <span className="calib-state-name">{r.concept_name ?? "a concept"}</span>
              <StateChip state={stateWord(r.state)} />
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="calib-done" onClick={onClose}>
        Done
      </button>
    </div>
  );
}

/**
 * Calibration — the optional cold-start warm-up (SPEC F1, D8). A skippable ~10-minute
 * walk across a course's library concepts that gives the tutor a starting read on
 * where the student is. Three terminal shapes: a "no library concepts yet" card (the
 * graph hasn't warmed up), the walk itself (one item at a time, skip anytime), and a
 * calm summary of the warmed-up states. Nothing numeric ever surfaces (§6 Q2).
 */
export function Calibration() {
  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const { data: courses } = useCourses();
  const activeCourse = courses?.find((c) => c.id === activeCourseId && c.status === "active");

  const start = useCalibrationStart();
  const answer = useCalibrationAnswer();
  const finish = useCalibrationFinish();

  const [walk, setWalk] = useState<Walk | null>(null);
  const [noRegion, setNoRegion] = useState<string | null>(null);
  const [summary, setSummary] = useState<CalibrationFinishResponse | null>(null);

  function resetToIntro() {
    setWalk(null);
    setNoRegion(null);
    setSummary(null);
  }

  async function onStart() {
    if (!activeCourse) return;
    setNoRegion(null);
    setSummary(null);
    try {
      const res = await start.mutateAsync({ course_id: activeCourse.id });
      if (res.status === "no_region" || !res.session_key || !res.item) {
        setNoRegion(
          res.message ??
            "No library concepts to calibrate yet — the graph warms up as you study.",
        );
        return;
      }
      setWalk({
        sessionKey: res.session_key,
        item: res.item,
        position: res.position,
        total: res.total,
      });
    } catch {
      toast.error("Could not start calibration — try again.");
    }
  }

  async function onFinish(sessionKey: string) {
    try {
      const res = await finish.mutateAsync({ session_key: sessionKey });
      setWalk(null);
      setSummary(res);
    } catch {
      toast.error("Could not save calibration — try again.");
    }
  }

  async function step(text: string, attachmentIds: string[], skip: boolean) {
    if (!walk) return;
    try {
      const res = await answer.mutateAsync({
        session_key: walk.sessionKey,
        item_key: walk.item.item_key,
        answer_text: skip ? null : text,
        attachment_ids: attachmentIds.length > 0 ? attachmentIds : null,
        skip,
      });
      if (res.done || !res.next_item) {
        await onFinish(walk.sessionKey);
        return;
      }
      setWalk({
        sessionKey: walk.sessionKey,
        item: res.next_item,
        position: res.position,
        total: res.total,
      });
    } catch {
      toast.error("Could not record that step — try again.");
    }
  }

  // ── No active course ───────────────────────────────────────────────────────
  if (!activeCourse) {
    return (
      <section className="calibration">
        <h1>Warm-up</h1>
        <p className="calib-empty">Open a course tab to warm up on it.</p>
      </section>
    );
  }

  return (
    <section className="calibration">
      <h1>Warm-up</h1>

      {/* A persistent exit: skip the whole walk / finish early, available throughout. */}
      {walk && (
        <div className="calib-bar">
          <ConfirmButton
            className="calib-exit"
            onConfirm={() => void onFinish(walk.sessionKey)}
            label="Skip / finish anytime"
            confirmLabel="Finish now?"
          />
        </div>
      )}

      {/* Intro card — only when nothing else is on screen. */}
      {!walk && !summary && !noRegion && (
        <div className="calib-intro">
          <p className="calib-intro-lead">Show me where you are.</p>
          <p className="calib-intro-sub">
            About 10 minutes, skip anytime. A few quick questions across {activeCourse.name} so
            the tutor has a starting read on what you already know.
          </p>
          <button
            type="button"
            className="calib-start"
            onClick={() => void onStart()}
            disabled={start.isPending}
          >
            {start.isPending ? "Starting…" : "Start warm-up"}
          </button>
          {start.isPending && <Spinner label="Setting up…" />}
        </div>
      )}

      {/* No region — friendly terminal card. */}
      {noRegion && (
        <div className="calib-terminal">
          <p className="calib-terminal-msg">{noRegion}</p>
          <button type="button" className="calib-start" onClick={resetToIntro}>
            Back
          </button>
        </div>
      )}

      {/* The walk. */}
      {walk && (
        <CalibrationItem
          key={walk.item.item_key}
          item={walk.item}
          position={walk.position}
          total={walk.total}
          pending={answer.isPending || finish.isPending}
          onAnswer={(text, ids) => void step(text, ids, false)}
          onSkip={() => void step("", [], true)}
        />
      )}

      {/* The calm summary. */}
      {summary && <CalibrationSummary result={summary} onClose={resetToIntro} />}
    </section>
  );
}
