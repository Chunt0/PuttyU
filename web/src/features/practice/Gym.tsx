import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Spinner } from "../../components/Spinner.tsx";
import { Markdown } from "../../components/Markdown.tsx";
import { CameraCapture } from "../../components/CameraCapture.tsx";
import { MathInput } from "../../components/MathInput.tsx";
import { toast } from "../../components/toast.ts";
import { useCourseStore } from "../courses/store.ts";
import { useCourses } from "../courses/api.ts";
import { useConceptTree } from "../progress/api.ts";
import { flattenConcepts } from "../progress/model.ts";
import { isImage, thumbUrl, uploadFiles, type UploadedFile } from "../chat/attachments.ts";
import { openPdf } from "../library/pdfStore.ts";
import type {
  Citation,
  GymItemResponse,
  GymSetSummary,
  PracticeItem,
} from "../../api/types.ts";
import { useGymAnswer, useGymNext } from "./api.ts";
import { useGymStore } from "./gymStore.ts";
import {
  SEED_DIFFICULTY,
  clampDifficulty,
  difficultyLine,
  emptySummary,
  summaryLine,
} from "./gym.model.ts";
import "./gym.css";

/** A struggle's study door — one chip that opens the cited page (F3 "citations are doors"). */
function StudyChip({ citation }: { citation: Citation }) {
  const heading = citation.heading || citation.title || "source";
  const label = citation.page_start != null ? `${heading} · p. ${citation.page_start}` : heading;
  return (
    <button
      type="button"
      className="gym-study-chip"
      title={citation.citation || label}
      onClick={() => openPdf(citation.source_id, citation.title, citation.page_start)}
    >
      study: {label}
    </button>
  );
}

/** A graded verdict: the line, the short feedback, and (on a struggle) the study door. */
interface Graded {
  correct: boolean;
  verdict: string;
  feedback: string;
  studyCitation: Citation | null;
}

/**
 * The Gym (Phase-2 T4 — SPEC F8): weakness-first, adaptive drilling. Pick a concept
 * (or let the coach pick the shakiest with errors), then answer items whose difficulty
 * walks up/down with you. The set's running tally and the moving difficulty dial are the
 * only surfaces; a wrong answer hands back the page to study, never a score.
 */
export function Gym() {
  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const { data: courses } = useCourses();
  const activeCourse = courses?.find((c) => c.id === activeCourseId && c.status === "active");
  const courseId = activeCourse ? activeCourse.id : null;

  const tree = useConceptTree(courseId);
  const concepts = tree.data ? flattenConcepts(tree.data) : [];

  const gymNext = useGymNext();
  const gymAnswer = useGymAnswer();

  // The set carries its adaptive state across items, locally (the engine folds it server-side
  // but the screen owns the source of truth it sends back each turn).
  const [conceptId, setConceptId] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState(SEED_DIFFICULTY);
  const [summary, setSummary] = useState<GymSetSummary>(emptySummary);
  const [item, setItem] = useState<PracticeItem | null>(null);
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  // The current item's answer-in-progress.
  const [answerText, setAnswerText] = useState("");
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [graded, setGraded] = useState<Graded | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reset the whole set when the course changes out from under us.
  useEffect(() => {
    setStarted(false);
    setConceptId(null);
    setDifficulty(SEED_DIFFICULTY);
    setSummary(emptySummary);
    setItem(null);
    setEmptyMessage(null);
    setGraded(null);
    setAnswerText("");
    setAttachments([]);
  }, [courseId]);

  function applyItem(res: GymItemResponse) {
    const nextItem = res.item ?? null;
    setDifficulty(clampDifficulty(res.difficulty));
    setItem(nextItem);
    setEmptyMessage(nextItem ? null : res.message ?? "Nothing to drill right now.");
    setGraded(null);
    setAnswerText("");
    setAttachments([]);
  }

  async function requestNext(forConceptId: string | null, atDifficulty: number) {
    if (!courseId) return;
    try {
      const res = await gymNext.mutateAsync({
        course_id: courseId,
        ...(forConceptId != null ? { concept_id: forConceptId } : {}),
        difficulty: atDifficulty,
      });
      applyItem(res);
    } catch {
      toast.error("Couldn't load the next item — try again.");
    }
  }

  function start(pickConceptId: string | null) {
    setStarted(true);
    setConceptId(pickConceptId);
    setSummary(emptySummary);
    void requestNext(pickConceptId, SEED_DIFFICULTY);
  }

  // F11: a dashboard weak-spot card opens the Gym preloaded on its concept. Read the
  // target on mount (and on course switch), preselect+drill it, then CLEAR it so a later
  // manual open starts fresh. Only honored when the target matches the active course.
  const gymTarget = useGymStore((s) => s.target);
  const clearGymTarget = useGymStore((s) => s.setTarget);
  useEffect(() => {
    if (!gymTarget || !courseId || gymTarget.courseId !== courseId) return;
    clearGymTarget(null);
    start(gymTarget.conceptId);
    // start() is stable for this render; deps below cover the inputs that matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gymTarget, courseId]);

  async function addFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const up = await uploadFiles(files);
      setAttachments((a) => [...a, ...up]);
    } catch {
      toast.error("Upload failed — file too large or unsupported.");
    } finally {
      setUploading(false);
    }
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    void addFiles(Array.from(e.target.files ?? []));
    e.target.value = "";
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!item || gymAnswer.isPending || uploading) return;
    const text = answerText.trim();
    if (!text && attachments.length === 0) return;
    try {
      const res = await gymAnswer.mutateAsync({
        item_key: item.item_key,
        answer_text: text,
        attachment_ids: attachments.map((a) => a.id),
        difficulty,
        streak: summary.streak,
      });
      setGraded({
        correct: res.correct,
        verdict: res.verdict,
        feedback: res.feedback_short,
        studyCitation: res.study_citation ?? null,
      });
      // Adopt the engine's next difficulty + folded set summary as the new source of truth.
      setDifficulty(clampDifficulty(res.difficulty));
      if (res.summary) setSummary(res.summary);
    } catch {
      toast.error("Couldn't grade that — try again.");
    }
  }

  if (!activeCourse) {
    return (
      <section className="gym">
        <h1>The gym</h1>
        <p className="gym-empty">Open a course tab to start drilling.</p>
      </section>
    );
  }

  return (
    <section className="gym">
      <h1>The gym</h1>
      <p className="gym-scope">
        {activeCourse.name} — short, adaptive reps. The difficulty walks with you.
      </p>

      {!started && (
        <div className="gym-picker">
          {tree.isLoading && <Spinner label="Loading concepts…" />}
          <button
            type="button"
            className="gym-coach"
            onClick={() => start(null)}
            disabled={gymNext.isPending}
          >
            Coach's pick
          </button>
          <span className="gym-picker-or">or drill one concept</span>
          <select
            className="gym-concept-select"
            aria-label="Concept to drill"
            value={conceptId ?? ""}
            onChange={(e) => start(e.target.value || null)}
            disabled={gymNext.isPending || concepts.length === 0}
          >
            <option value="">Choose a concept…</option>
            {concepts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {started && (
        <div className="gym-set">
          <div className="gym-dials">
            <span className="gym-difficulty" data-testid="gym-difficulty">
              {difficultyLine(difficulty)}
            </span>
            <span className="gym-summary" data-testid="gym-summary">
              {summaryLine(summary)}
            </span>
            <button
              type="button"
              className="gym-quit"
              onClick={() => {
                setStarted(false);
                setItem(null);
                setGraded(null);
              }}
            >
              End set
            </button>
          </div>

          {gymNext.isPending && !item && <Spinner label="Finding your next rep…" />}

          {!gymNext.isPending && !item && emptyMessage !== null && (
            <div className="gym-card gym-card--empty">
              <p className="gym-empty">{emptyMessage}</p>
              <button type="button" className="gym-coach" onClick={() => start(null)}>
                Try the coach's pick
              </button>
            </div>
          )}

          {item && (
            <form className="gym-card" onSubmit={submit}>
              <div className="gym-prompt-meta">
                <span className="gym-concept-name">{item.concept_name}</span>
              </div>
              <div className="gym-prompt">
                <Markdown>{item.prompt}</Markdown>
              </div>

              {!graded && (
                <>
                  <textarea
                    className="gym-answer"
                    value={answerText}
                    onChange={(e) => setAnswerText(e.target.value)}
                    placeholder="Type your answer, or attach a photo of your work…"
                    rows={3}
                    aria-label="Your answer"
                  />

                  {attachments.length > 0 && (
                    <ul className="gym-attachments" data-testid="gym-attachments">
                      {attachments.map((f) => (
                        <li key={f.id} className="gym-attachment">
                          {isImage(f) && (
                            <img src={thumbUrl(f)} alt="" className="gym-attachment-thumb" />
                          )}
                          <span className="gym-attachment-name">{f.name}</span>
                          <button
                            type="button"
                            className="gym-attachment-remove"
                            onClick={() => setAttachments((a) => a.filter((x) => x.id !== f.id))}
                            aria-label={`Remove ${f.name}`}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="gym-actions">
                    <input
                      ref={fileRef}
                      type="file"
                      multiple
                      hidden
                      onChange={onPick}
                      aria-label="Attach files"
                    />
                    <button
                      type="button"
                      className="gym-attach"
                      onClick={() => fileRef.current?.click()}
                      disabled={uploading}
                      aria-label="Attach"
                    >
                      {uploading ? "…" : "Attach"}
                    </button>
                    <CameraCapture
                      label="Take photo"
                      onAccept={(files) => void addFiles(files)}
                    />
                    <MathInput
                      onInsert={(eq) => setAnswerText((s) => (s ? s + " " : "") + eq)}
                    />
                    <button
                      type="submit"
                      className="gym-submit"
                      disabled={
                        gymAnswer.isPending ||
                        uploading ||
                        (!answerText.trim() && attachments.length === 0)
                      }
                    >
                      {gymAnswer.isPending ? "Checking…" : "Check"}
                    </button>
                  </div>
                </>
              )}

              {graded && (
                <div
                  className={`gym-verdict ${graded.correct ? "gym-verdict--ok" : "gym-verdict--struggle"}`}
                  data-testid="gym-verdict"
                >
                  <span className="gym-verdict-line">
                    {graded.correct ? "Got it" : "Not quite"}
                  </span>
                  {graded.feedback && (
                    <div className="gym-feedback">
                      <Markdown>{graded.feedback}</Markdown>
                    </div>
                  )}
                  {graded.studyCitation && <StudyChip citation={graded.studyCitation} />}
                  <button
                    type="button"
                    className="gym-next"
                    onClick={() => void requestNext(conceptId, difficulty)}
                    disabled={gymNext.isPending}
                  >
                    {gymNext.isPending ? "Loading…" : "Next"}
                  </button>
                </div>
              )}
            </form>
          )}
        </div>
      )}
    </section>
  );
}
