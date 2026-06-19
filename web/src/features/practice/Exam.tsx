import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Spinner } from "../../components/Spinner.tsx";
import { Markdown } from "../../components/Markdown.tsx";
import { CameraCapture } from "../../components/CameraCapture.tsx";
import { toast } from "../../components/toast.ts";
import { useCourseStore } from "../courses/store.ts";
import { useCourses } from "../courses/api.ts";
import { isImage, thumbUrl, uploadFiles, type UploadedFile } from "../chat/attachments.ts";
import { openPdf } from "../library/pdfStore.ts";
import type {
  Citation,
  ExamItemPrompt,
  ExamItemVerdict,
  ExamStartResponse,
  ExamSubmitResponse,
} from "../../api/types.ts";
import { useExamStart, useExamSubmit } from "./api.ts";
import {
  DEFAULT_DURATION_MINUTES,
  DEFAULT_N_ITEMS,
  clampInt,
  debriefSummary,
  formatClock,
  remainingSeconds,
} from "./exam.model.ts";
import "./exam.css";

/** Per-item answer-in-progress, keyed by item_key — text + the photo/file uploads. */
interface ItemAnswer {
  text: string;
  attachments: UploadedFile[];
}

/** A study door for a debrief item — one chip that opens the cited page (F3 "citations are doors"). */
function StudyChip({ citation }: { citation: Citation }) {
  const heading = citation.heading || citation.title || "source";
  const label = citation.page_start != null ? `${heading} · p. ${citation.page_start}` : heading;
  return (
    <button
      type="button"
      className="exam-study-chip"
      data-testid="exam-citation"
      title={citation.citation || label}
      onClick={() => openPdf(citation.source_id, citation.title, citation.page_start)}
    >
      study: {label}
    </button>
  );
}

/** One debrief row: the verdict word, the short feedback, and (when present) the study door. */
function VerdictRow({ v }: { v: ExamItemVerdict }) {
  const tone = v.correct ? "ok" : v.verdict === "skipped" ? "skipped" : "miss";
  const word =
    v.verdict === "skipped"
      ? "Skipped"
      : v.correct
        ? "Correct"
        : v.verdict === "partial"
          ? "Partly there"
          : "Not yet";
  const citation: Citation | null = v.citation ?? null;
  return (
    <li className="exam-verdict" data-testid="exam-verdict">
      <div className="exam-verdict-head">
        <span className={`exam-verdict-word exam-verdict-word--${tone}`}>{word}</span>
        {v.concept_name && <span className="exam-verdict-concept">{v.concept_name}</span>}
      </div>
      {v.prompt && (
        <div className="exam-verdict-prompt">
          <Markdown>{v.prompt}</Markdown>
        </div>
      )}
      {v.feedback_short && (
        <div className="exam-verdict-feedback">
          <Markdown>{v.feedback_short}</Markdown>
        </div>
      )}
      {citation && <StudyChip citation={citation} />}
    </li>
  );
}

/**
 * Exam simulation (Phase-2 T4 — SPEC F8): a timed, SILENT sitting followed by a debrief.
 * Set a duration + item count, then answer every item under a client countdown with NO
 * mid-exam grading (test conditions). Submitting (or the clock hitting 0) grades the whole
 * paper at once and reveals the per-item verdicts, the bucket counts, and a readiness line.
 */
export function Exam() {
  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const { data: courses } = useCourses();
  const activeCourse = courses?.find((c) => c.id === activeCourseId && c.status === "active");
  const courseId = activeCourse ? activeCourse.id : null;

  const examStart = useExamStart();
  const examSubmit = useExamSubmit();

  // Start-form inputs (kept as strings so the fields can be cleared while typing).
  const [minutes, setMinutes] = useState(String(DEFAULT_DURATION_MINUTES));
  const [nItems, setNItems] = useState(String(DEFAULT_N_ITEMS));

  // The live exam (null until started); the empty-paper message rides separately.
  const [exam, setExam] = useState<ExamStartResponse | null>(null);
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, ItemAnswer>>({});
  const [remaining, setRemaining] = useState(0);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pickingFor = useRef<string | null>(null);

  // The debrief (null until submitted).
  const [debrief, setDebrief] = useState<ExamSubmitResponse | null>(null);

  const items: ExamItemPrompt[] = exam?.items ?? [];
  const inExam = exam !== null && items.length > 0 && debrief === null;

  // Reset everything if the active course changes out from under a sitting.
  useEffect(() => {
    setExam(null);
    setEmptyMessage(null);
    setAnswers({});
    setDebrief(null);
    setRemaining(0);
  }, [courseId]);

  // Collect the locally-held answers into the submit shape.
  function collectAnswers() {
    return items.map((it) => ({
      item_key: it.item_key,
      answer_text: answers[it.item_key]?.text ?? "",
      attachment_ids: (answers[it.item_key]?.attachments ?? []).map((a) => a.id),
    }));
  }

  // Submit guarded against double-fire (auto-submit + a click can race).
  const submittedRef = useRef(false);
  async function doSubmit() {
    if (!exam || submittedRef.current || examSubmit.isPending) return;
    submittedRef.current = true;
    try {
      const res = await examSubmit.mutateAsync({
        exam_key: exam.exam_key,
        answers: collectAnswers(),
      });
      setDebrief(res);
    } catch {
      submittedRef.current = false;
      toast.error("Couldn't submit the exam — try again.");
    }
  }

  // Keep the timer's auto-submit pointing at the latest closure (which reads live
  // answers) without re-arming the interval every render.
  const submitRef = useRef(doSubmit);
  submitRef.current = doSubmit;

  // The countdown: tick once a second; auto-submit when it reaches 0. Keyed on the
  // exam's identity so it arms once per sitting.
  const examKey = exam?.exam_key ?? null;
  const startedAt = exam?.started_at ?? null;
  const durationSeconds = exam?.duration_seconds ?? 0;
  useEffect(() => {
    if (!inExam || startedAt === null) return;
    setRemaining(remainingSeconds(startedAt, durationSeconds));
    const id = setInterval(() => {
      const left = remainingSeconds(startedAt, durationSeconds);
      setRemaining(left);
      if (left <= 0) void submitRef.current();
    }, 1000);
    return () => clearInterval(id);
  }, [inExam, examKey, startedAt, durationSeconds]);

  async function start(e: FormEvent) {
    e.preventDefault();
    if (!courseId || examStart.isPending) return;
    const durationSeconds = clampInt(minutes, 1, 240, DEFAULT_DURATION_MINUTES) * 60;
    const n = clampInt(nItems, 1, 50, DEFAULT_N_ITEMS);
    try {
      const res = await examStart.mutateAsync({
        course_id: courseId,
        duration_seconds: durationSeconds,
        n_items: n,
      });
      submittedRef.current = false;
      setAnswers({});
      setDebrief(null);
      if (res.items.length === 0) {
        setExam(null);
        setEmptyMessage(res.message ?? "No exam items yet — link a textbook to this course.");
      } else {
        setEmptyMessage(null);
        setExam(res);
      }
    } catch {
      toast.error("Couldn't start the exam — try again.");
    }
  }

  function setText(itemKey: string, text: string) {
    setAnswers((a) => ({
      ...a,
      [itemKey]: { text, attachments: a[itemKey]?.attachments ?? [] },
    }));
  }

  async function addFiles(itemKey: string, files: File[]) {
    if (files.length === 0) return;
    setUploadingFor(itemKey);
    try {
      const up = await uploadFiles(files);
      setAnswers((a) => ({
        ...a,
        [itemKey]: {
          text: a[itemKey]?.text ?? "",
          attachments: [...(a[itemKey]?.attachments ?? []), ...up],
        },
      }));
    } catch {
      toast.error("Upload failed — file too large or unsupported.");
    } finally {
      setUploadingFor(null);
    }
  }

  function removeAttachment(itemKey: string, id: string) {
    setAnswers((a) => ({
      ...a,
      [itemKey]: {
        text: a[itemKey]?.text ?? "",
        attachments: (a[itemKey]?.attachments ?? []).filter((x) => x.id !== id),
      },
    }));
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const key = pickingFor.current;
    if (key) void addFiles(key, Array.from(e.target.files ?? []));
    e.target.value = "";
    pickingFor.current = null;
  }

  function openPicker(itemKey: string) {
    pickingFor.current = itemKey;
    fileRef.current?.click();
  }

  if (!activeCourse) {
    return (
      <section className="exam">
        <h1>Exam simulation</h1>
        <p className="exam-empty">Open a course tab to sit a practice exam.</p>
      </section>
    );
  }

  // ── The debrief (after submit) ─────────────────────────────────────────────
  if (debrief) {
    return (
      <section className="exam">
        <h1>Exam simulation</h1>
        <div className="exam-debrief" data-testid="exam-debrief">
          <p className="exam-debrief-summary">{debriefSummary(debrief)}</p>
          {debrief.readiness && (
            <div className="exam-readiness" data-testid="exam-readiness">
              <Markdown>{debrief.readiness}</Markdown>
            </div>
          )}
          <ul className="exam-verdicts">
            {debrief.verdicts.map((v) => (
              <VerdictRow key={v.item_key} v={v} />
            ))}
          </ul>
          <button type="button" className="exam-restart" onClick={() => setExam(null)}>
            New exam
          </button>
        </div>
      </section>
    );
  }

  // ── The timed, silent sitting ──────────────────────────────────────────────
  if (inExam && exam) {
    return (
      <section className="exam">
        <div className="exam-bar">
          <h1>Exam simulation</h1>
          <span
            className={`exam-clock${remaining <= 30 ? " exam-clock--low" : ""}`}
            data-testid="exam-clock"
            role="timer"
            aria-label="Time remaining"
          >
            {formatClock(remaining)}
          </span>
        </div>
        <p className="exam-scope">
          {activeCourse.name} — {items.length} item{items.length === 1 ? "" : "s"}, test conditions.
          You'll see how you did when you submit.
        </p>

        <input ref={fileRef} type="file" multiple hidden onChange={onPick} aria-label="Attach files" />

        <ol className="exam-items">
          {items.map((it, i) => {
            const ans = answers[it.item_key];
            const atts = ans?.attachments ?? [];
            return (
              <li key={it.item_key} className="exam-item">
                <div className="exam-item-head">
                  <span className="exam-item-num">Question {i + 1}</span>
                  {it.concept_name && (
                    <span className="exam-item-concept">{it.concept_name}</span>
                  )}
                </div>
                <div className="exam-item-prompt">
                  <Markdown>{it.prompt}</Markdown>
                </div>
                <textarea
                  className="exam-answer"
                  value={ans?.text ?? ""}
                  onChange={(e) => setText(it.item_key, e.target.value)}
                  placeholder="Type your answer, or attach a photo of your work…"
                  rows={3}
                  aria-label={`Answer for question ${i + 1}`}
                />
                {atts.length > 0 && (
                  <ul className="exam-attachments">
                    {atts.map((f) => (
                      <li key={f.id} className="exam-attachment">
                        {isImage(f) && (
                          <img src={thumbUrl(f)} alt="" className="exam-attachment-thumb" />
                        )}
                        <span className="exam-attachment-name">{f.name}</span>
                        <button
                          type="button"
                          className="exam-attachment-remove"
                          onClick={() => removeAttachment(it.item_key, f.id)}
                          aria-label={`Remove ${f.name}`}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="exam-item-actions">
                  <button
                    type="button"
                    className="exam-attach"
                    onClick={() => openPicker(it.item_key)}
                    disabled={uploadingFor === it.item_key}
                    aria-label={`Attach to question ${i + 1}`}
                  >
                    {uploadingFor === it.item_key ? "…" : "Attach"}
                  </button>
                  <CameraCapture
                    label="Take photo"
                    onAccept={(files) => void addFiles(it.item_key, files)}
                  />
                </div>
              </li>
            );
          })}
        </ol>

        <div className="exam-submit-row">
          <button
            type="button"
            className="exam-submit"
            onClick={() => void doSubmit()}
            disabled={examSubmit.isPending}
          >
            {examSubmit.isPending ? "Submitting…" : "Submit exam"}
          </button>
        </div>
      </section>
    );
  }

  // ── The start form ─────────────────────────────────────────────────────────
  return (
    <section className="exam">
      <h1>Exam simulation</h1>
      <p className="exam-scope">
        {activeCourse.name} — a timed, mixed-topic sitting under test conditions. No feedback
        until you submit.
      </p>

      <form className="exam-start" onSubmit={start}>
        <label className="exam-field">
          <span>Duration (minutes)</span>
          <input
            type="number"
            min={1}
            max={240}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            aria-label="Duration in minutes"
          />
        </label>
        <label className="exam-field">
          <span>Questions</span>
          <input
            type="number"
            min={1}
            max={50}
            value={nItems}
            onChange={(e) => setNItems(e.target.value)}
            aria-label="Number of questions"
          />
        </label>
        <button type="submit" className="exam-begin" disabled={examStart.isPending}>
          {examStart.isPending ? "Assembling…" : "Start exam"}
        </button>
      </form>

      {examStart.isPending && <Spinner label="Assembling your exam…" />}
      {emptyMessage !== null && <p className="exam-empty">{emptyMessage}</p>}
    </section>
  );
}
