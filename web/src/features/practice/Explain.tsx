import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Spinner } from "../../components/Spinner.tsx";
import { Markdown } from "../../components/Markdown.tsx";
import { MathInput } from "../../components/MathInput.tsx";
import { toast } from "../../components/toast.ts";
import { useCourseStore } from "../courses/store.ts";
import { useCourses } from "../courses/api.ts";
import { useConceptTree } from "../progress/api.ts";
import { flattenConcepts } from "../progress/model.ts";
import { streamChat } from "../../api/streaming.ts";
import { useExplainStart } from "./api.ts";
import {
  appendDelta,
  openingPrompt,
  startTurn,
  type ExplainTurn,
} from "./explain.model.ts";
import "./explain.css";

/** The active explain conversation, bound to one server session id. */
interface Conversation {
  sessionId: string;
  conceptName: string | null;
  turns: ExplainTurn[];
}

/**
 * The Explain panel (Phase-2 T4 — SPEC F8 "Explain it back"): the user picks a
 * concept and teaches it back in their own words; the tutor plays the curious
 * student, asking the questions that find the gaps. Picking a concept opens an
 * explain-mode chat session (server-side) and the surface becomes a lean two-party
 * conversation bound to that session — a turn list + a composer, streamed through
 * the same chat door as the main chat. Gated on an active course like Progress.
 */
export function Explain() {
  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const { data: courses } = useCourses();
  const activeCourse = courses?.find((c) => c.id === activeCourseId && c.status === "active");
  const courseId = activeCourse ? activeCourse.id : null;

  const tree = useConceptTree(courseId);
  const concepts = tree.data ? flattenConcepts(tree.data) : [];

  const explainStart = useExplainStart();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Cancel any in-flight stream on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Drop the conversation when the course changes out from under us.
  useEffect(() => {
    abortRef.current?.abort();
    setConversation(null);
    setInput("");
    setError(null);
    setStreaming(false);
  }, [courseId]);

  // Keep the newest turn in view while teaching.
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversation?.turns]);

  async function pickConcept(conceptId: string) {
    if (!courseId || explainStart.isPending) return;
    setError(null);
    try {
      const res = await explainStart.mutateAsync({ course_id: courseId, concept_id: conceptId });
      setConversation({
        sessionId: res.session_id,
        conceptName: res.concept_name ?? null,
        turns: [{ role: "assistant", content: openingPrompt(res.message, res.concept_name) }],
      });
    } catch {
      toast.error("Couldn't start that — try again.");
    }
  }

  async function sendTurn() {
    const convo = conversation;
    const text = input.trim();
    if (!convo || !text || streaming) return;

    setError(null);
    setInput("");
    setStreaming(true);
    setConversation({ ...convo, turns: startTurn(convo.turns, text) });
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const req = {
        message: text,
        session: convo.sessionId,
        ...(courseId ? { course_id: courseId } : {}),
      };
      for await (const ev of streamChat(req, ac.signal)) {
        if (ev.kind === "delta") {
          setConversation((c) => (c ? { ...c, turns: appendDelta(c.turns, ev.text) } : c));
        } else if (ev.kind === "control" && ev.event === "error") {
          setError(
            typeof ev.payload.error === "string" ? ev.payload.error : "The response ended early.",
          );
        } else if (ev.kind === "done") {
          break;
        }
      }
    } catch {
      if (!ac.signal.aborted) {
        setError("Could not get a response. Check your provider configuration (Providers).");
      }
    } finally {
      setStreaming(false);
    }
  }

  function onComposerKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendTurn();
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void sendTurn();
  }

  function endSession() {
    abortRef.current?.abort();
    setConversation(null);
    setInput("");
    setError(null);
    setStreaming(false);
  }

  if (!activeCourse) {
    return (
      <section className="explain">
        <h1>Explain it back</h1>
        <p className="explain-empty">Open a course tab to teach a concept back.</p>
      </section>
    );
  }

  return (
    <section className="explain">
      <h1>Explain it back</h1>
      <p className="explain-scope">
        {activeCourse.name} — teach a concept in your own words. The tutor plays the curious
        student and asks where it gets fuzzy.
      </p>

      {conversation === null ? (
        <div className="explain-picker">
          {tree.isLoading && <Spinner label="Loading concepts…" />}
          {tree.data && concepts.length === 0 && (
            <p className="explain-empty">No concepts yet — link a textbook to this course.</p>
          )}
          {concepts.length > 0 && (
            <>
              <label className="explain-picker-label" htmlFor="explain-concept">
                Pick a concept to teach back
              </label>
              <select
                id="explain-concept"
                className="explain-concept-select"
                aria-label="Concept to explain"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) void pickConcept(e.target.value);
                }}
                disabled={explainStart.isPending}
              >
                <option value="">Choose a concept…</option>
                {concepts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {explainStart.isPending && <Spinner label="Opening the session…" />}
            </>
          )}
        </div>
      ) : (
        <div className="explain-session">
          <div className="explain-session-head">
            <span className="explain-concept-name">
              {conversation.conceptName ?? "this concept"}
            </span>
            <button type="button" className="explain-end" onClick={endSession}>
              Pick another
            </button>
          </div>

          <div className="explain-transcript" data-testid="explain-transcript" ref={transcriptRef}>
            {conversation.turns.map((t, i) => (
              <div key={i} className={`explain-turn explain-turn--${t.role}`}>
                <span className="explain-turn-role">
                  {t.role === "assistant" ? "tutor" : "you"}
                </span>
                {t.content ? (
                  <div className="explain-turn-content">
                    <Markdown>{t.content}</Markdown>
                  </div>
                ) : (
                  streaming && (
                    <div className="explain-thinking" aria-label="Thinking">
                      <span className="explain-dot" />
                      <span className="explain-dot" />
                      <span className="explain-dot" />
                    </div>
                  )
                )}
              </div>
            ))}
            {error && (
              <p className="explain-error" role="alert">
                {error}
              </p>
            )}
          </div>

          <form className="explain-composer" onSubmit={onSubmit}>
            <textarea
              className="explain-textarea"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder="Teach it back here — explain it like I've never seen it…"
              rows={3}
              aria-label="Your explanation"
              disabled={streaming}
            />
            <MathInput onInsert={(eq) => setInput((s) => (s ? s + " " : "") + eq)} />
            <button type="submit" className="explain-send" disabled={!input.trim() || streaming}>
              {streaming ? "…" : "Send"}
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
