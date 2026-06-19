import { useRef, useState } from "react";
import { Spinner } from "../../components/Spinner.tsx";
import { Markdown } from "../../components/Markdown.tsx";
import { CameraCapture } from "../../components/CameraCapture.tsx";
import { toast } from "../../components/toast.ts";
import { useCourseStore } from "../courses/store.ts";
import { useCourses } from "../courses/api.ts";
import { uploadFiles, isImage, thumbUrl, type UploadedFile } from "../chat/attachments.ts";
import { CitationChips } from "../chat/CitationChips.tsx";
import { StateChip } from "../progress/StateChip.tsx";
import { verdictDisplay } from "../practice/review.model.ts";
import type { Citation, WorksheetGradeResponse, WorksheetProblemVerdict } from "../../api/types.ts";
import { useGradeWorksheet } from "./api.ts";
import "./worksheet.css";

/**
 * One graded problem (SPEC F4): the calm verdict word, what's right, the FIRST error,
 * the nudge question (guide mode only), the concept + its resulting mastery state, and
 * the mistaken section as a clickable citation door. Never a score — the verdict tone
 * is reused from the Review screen so the two grading surfaces read identically.
 */
function ProblemCard({ problem, guide }: { problem: WorksheetProblemVerdict; guide: boolean }) {
  const verdict = verdictDisplay(problem.verdict);
  const citation = problem.study_citation as Citation | null | undefined;
  return (
    <article className="worksheet-problem" data-testid="worksheet-problem">
      <p className="worksheet-problem-head">
        {problem.problem_label && (
          <span className="worksheet-problem-label">{problem.problem_label}</span>
        )}
        <span className={`worksheet-verdict worksheet-verdict--${verdict.tone}`}>
          <span className="worksheet-verdict-dot" aria-hidden="true" />
          {verdict.label}
        </span>
      </p>

      {problem.whats_right && (
        <div className="worksheet-line">
          <span className="worksheet-line-label">What's right</span>
          <Markdown>{problem.whats_right}</Markdown>
        </div>
      )}

      {problem.first_error && (
        <div className="worksheet-line">
          <span className="worksheet-line-label">First thing to look at</span>
          <Markdown>{problem.first_error}</Markdown>
        </div>
      )}

      {guide && problem.nudge_question && (
        <div className="worksheet-line worksheet-line--nudge">
          <span className="worksheet-line-label">Something to ask yourself</span>
          <Markdown>{problem.nudge_question}</Markdown>
        </div>
      )}

      {(problem.concept_name || problem.state) && (
        <p className="worksheet-concept">
          {problem.concept_name && (
            <span className="worksheet-concept-name">{problem.concept_name}</span>
          )}
          {problem.state && <StateChip state={problem.state} />}
        </p>
      )}

      {citation != null && (
        <CitationChips items={[{ ...citation, page_start: citation.page_start ?? null }]} />
      )}
    </article>
  );
}

/**
 * The Worksheet panel (SPEC F4 — "the webcam is a scanner"): photograph or upload a
 * page (or several, for a multi-page worksheet), then "check my work" → each problem
 * comes back with what's right, where the FIRST error is, and — in guide mode — a
 * nudging question instead of the answer. The graded feedback is the confirmable
 * artifact (untrusted-content invariant); the evidence the backend writes rides the
 * existing mastery model. Calm by directive — no scores, no streaks. Gated on an active
 * course exactly like Review/Progress.
 */
export function Worksheet() {
  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const { data: courses } = useCourses();

  const activeCourse = courses?.find((c) => c.id === activeCourseId && c.status === "active");

  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [guide, setGuide] = useState(true);
  const [result, setResult] = useState<WorksheetGradeResponse | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const grade = useGradeWorksheet();

  async function addPhotos(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const up = await uploadFiles(files);
      // De-dup by id: identical bytes return the same upload id, which would
      // otherwise collide (duplicate React key, remove-both, doubled POST id).
      setAttachments((a) => {
        const seen = new Set(a.map((f) => f.id));
        return [...a, ...up.filter((f) => !seen.has(f.id))];
      });
    } catch {
      toast.error("Upload failed — file too large or unsupported.");
    } finally {
      setUploading(false);
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    void addPhotos(files);
  }

  function reset() {
    setResult(null);
    setAttachments([]);
  }

  async function check() {
    if (uploading || grade.isPending || !activeCourse || attachments.length === 0) return;
    try {
      const res = await grade.mutateAsync({
        course_id: activeCourse.id,
        attachment_ids: attachments.map((a) => a.id),
        guide,
      });
      setResult(res);
    } catch {
      toast.error("Couldn't grade that — try again.");
    }
  }

  if (!activeCourse) {
    return (
      <section className="worksheet">
        <h1>Worksheet</h1>
        <p className="worksheet-empty">Open a course tab to check a worksheet against it.</p>
      </section>
    );
  }

  const problems = result?.problems ?? [];

  return (
    <section className="worksheet">
      <h1>Worksheet</h1>
      <p className="worksheet-scope">
        {activeCourse.name} — photograph your written work and check it against the course.
      </p>

      {result === null ? (
        <div className="worksheet-input">
          {attachments.length > 0 && (
            <ul className="worksheet-attachments" data-testid="worksheet-attachments">
              {attachments.map((f) => (
                <li key={f.id} className="worksheet-attachment">
                  {isImage(f) && <img src={thumbUrl(f)} alt="" className="worksheet-attachment-thumb" />}
                  <span className="worksheet-attachment-name">{f.name}</span>
                  <button
                    type="button"
                    className="worksheet-attachment-remove"
                    onClick={() => setAttachments((a) => a.filter((x) => x.id !== f.id))}
                    aria-label={`Remove ${f.name}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          <label className="worksheet-guide">
            <input
              type="checkbox"
              checked={guide}
              onChange={(e) => setGuide(e.target.checked)}
            />
            Guide me — hints, not answers
          </label>

          <div className="worksheet-actions">
            <CameraCapture multi label="Take photo" onAccept={(files) => void addPhotos(files)} />
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={onPick}
              aria-label="Upload photos"
            />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? "Uploading…" : "Upload photo"}
            </button>
            <button
              type="button"
              onClick={() => void check()}
              disabled={uploading || grade.isPending || attachments.length === 0}
            >
              {grade.isPending ? "Checking…" : "Check my work"}
            </button>
          </div>

          {grade.isPending && <Spinner label="Reading your work…" />}
        </div>
      ) : (
        <div className="worksheet-result">
          {result.setup_hint ? (
            <div className="worksheet-hint" role="note">
              <Markdown>{result.setup_hint}</Markdown>
            </div>
          ) : problems.length === 0 ? (
            <p className="worksheet-empty">
              No problems found in that image — try a clearer photo of the page.
            </p>
          ) : (
            <div className="worksheet-problems">
              {problems.map((p, i) => (
                <ProblemCard key={`${p.problem_label}-${i}`} problem={p} guide={guide} />
              ))}
            </div>
          )}

          <div className="worksheet-actions">
            <button type="button" onClick={reset}>
              Check another
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
