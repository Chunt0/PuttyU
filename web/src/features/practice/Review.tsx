import { useEffect, useState } from "react";
import { Spinner } from "../../components/Spinner.tsx";
import { Markdown } from "../../components/Markdown.tsx";
import { CameraCapture } from "../../components/CameraCapture.tsx";
import { MathInput } from "../../components/MathInput.tsx";
import { toast } from "../../components/toast.ts";
import { useCourseStore } from "../courses/store.ts";
import { useCourses } from "../courses/api.ts";
import { uploadFiles, isImage, thumbUrl, type UploadedFile } from "../chat/attachments.ts";
import { CitationChips } from "../chat/CitationChips.tsx";
import { StateChip } from "../progress/StateChip.tsx";
import type { AnswerResponse, Citation, PracticeItem } from "../../api/types.ts";
import { useReviewQueue, useAnswerQueueItem } from "./api.ts";
import { verdictDisplay, queueProgress, emptyLine, itemLabel } from "./review.model.ts";
import "./review.css";

/**
 * One queued item: its label, the prompt, an answer surface (typed + photo), and —
 * once graded — the calm verdict, feedback, the study citation as a door, and the
 * resulting mastery state. Local state resets per item via the `key` on the parent.
 */
function ReviewCard({
  item,
  courseName,
  onNext,
  hasNext,
}: {
  item: PracticeItem;
  courseName: string | null | undefined;
  onNext: () => void;
  hasNext: boolean;
}) {
  const [answer, setAnswer] = useState("");
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<AnswerResponse | null>(null);
  const grade = useAnswerQueueItem();

  async function addPhotos(files: File[]) {
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

  async function submit() {
    if (uploading || grade.isPending || result) return;
    if (!answer.trim() && attachments.length === 0) return;
    try {
      const res = await grade.mutateAsync({
        item_key: item.item_key,
        answer_text: answer.trim(),
        attachment_ids: attachments.map((a) => a.id),
      });
      setResult(res);
    } catch {
      toast.error("Couldn't grade that — try again.");
    }
  }

  const studyCitation = result?.study_citation as Citation | null | undefined;
  const verdict = result ? verdictDisplay(result.verdict) : null;

  return (
    <article className="review-card">
      <p className="review-label">{itemLabel(item.concept_name, courseName)}</p>

      <div className="review-prompt">
        <Markdown>{item.prompt}</Markdown>
      </div>

      {result === null ? (
        <form
          className="review-answer"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <textarea
            className="review-textarea"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Work it out here, or take a photo of your written work…"
            rows={4}
            aria-label="Your answer"
          />

          {attachments.length > 0 && (
            <ul className="review-attachments" data-testid="review-attachments">
              {attachments.map((f) => (
                <li key={f.id} className="review-attachment">
                  {isImage(f) && <img src={thumbUrl(f)} alt="" className="review-attachment-thumb" />}
                  <span className="review-attachment-name">{f.name}</span>
                  <button
                    type="button"
                    className="review-attachment-remove"
                    onClick={() => setAttachments((a) => a.filter((x) => x.id !== f.id))}
                    aria-label={`Remove ${f.name}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="review-actions">
            <CameraCapture label="Take photo" onAccept={(files) => void addPhotos(files)} />
            <MathInput onInsert={(eq) => setAnswer((s) => (s ? s + " " : "") + eq)} />
            <button
              type="submit"
              disabled={uploading || grade.isPending || (!answer.trim() && attachments.length === 0)}
            >
              {grade.isPending ? "Checking…" : "Submit"}
            </button>
          </div>
        </form>
      ) : (
        <div className="review-result">
          <p className={`review-verdict review-verdict--${verdict?.tone}`}>
            <span className="review-verdict-dot" aria-hidden="true" />
            {verdict?.label}
          </p>

          {result.feedback_short && (
            <div className="review-feedback">
              <Markdown>{result.feedback_short}</Markdown>
            </div>
          )}

          {studyCitation != null && (
            <CitationChips
              items={[{ ...studyCitation, page_start: studyCitation.page_start ?? null }]}
            />
          )}

          {(result.concept_name || result.state) && (
            <p className="review-mastery">
              {result.concept_name && <span className="review-mastery-name">{result.concept_name}</span>}
              {result.state && <StateChip state={result.state} />}
            </p>
          )}

          <div className="review-actions">
            <button type="button" onClick={onNext}>
              {hasNext ? "Next" : "Done"}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

/**
 * The Review panel (SPEC F8 — "the user works the queue"): today's spaced-review
 * queue, worked ONE item at a time. Calm by directive — no streaks, no score, just
 * a neutral position line and verdict words. When the queue is empty or exhausted,
 * a quiet line tells the user what's waiting for later. Gated on an active course
 * exactly like Progress (the queue can span courses, but the screen is course-scoped).
 */
export function Review() {
  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const { data: courses } = useCourses();

  const activeCourse = courses?.find((c) => c.id === activeCourseId && c.status === "active");
  const courseId = activeCourse ? activeCourse.id : null;
  const queue = useReviewQueue(courseId);

  const [index, setIndex] = useState(0);
  // A fresh queue (course switch / refetch) restarts the walk at the top.
  useEffect(() => setIndex(0), [courseId, queue.data]);

  if (!activeCourse) {
    return (
      <section className="review">
        <h1>Review</h1>
        <p className="review-empty">Open a course tab to work its review queue.</p>
      </section>
    );
  }

  const items = queue.data?.items ?? [];
  const dueCount = queue.data?.due.length ?? 0;
  const total = items.length;
  const current = items[index] ?? null;

  return (
    <section className="review">
      <h1>Review</h1>
      <p className="review-scope">{activeCourse.name} — what's due to come back to today.</p>

      {queue.isLoading && <Spinner label="Building your queue…" />}
      {queue.isError && (
        <p className="review-empty review-error">Couldn't load the queue — try again in a moment.</p>
      )}

      {queue.data && (total === 0 || current === null) ? (
        <p className="review-empty">{emptyLine(dueCount)}</p>
      ) : (
        current !== null && (
          <>
            <p className="review-position">{queueProgress(index, total)}</p>
            <ReviewCard
              key={current.item_key}
              item={current}
              courseName={activeCourse.name}
              hasNext={index + 1 < total}
              onNext={() => setIndex((i) => i + 1)}
            />
          </>
        )
      )}
    </section>
  );
}
