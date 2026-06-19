import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Spinner } from "../../components/Spinner.tsx";
import { toast } from "../../components/toast.ts";
import { useUiStore } from "../../lib/store.ts";
import { useWindowStore } from "../../app/windows/windowStore.ts";
import { useCourseStore } from "../courses/store.ts";
import { useCourses } from "../courses/api.ts";
import { useSessions } from "../sessions/api.ts";
import { useEvents } from "../calendar/api.ts";
import { openPdf } from "../library/pdfStore.ts";
import { gymForConcept } from "../practice/gymStore.ts";
import type { DashboardInsight, DashboardReading, DueConcept } from "../../api/types.ts";
import { useDashboard, useTodos, useCreateTodo, useToggleTodo } from "./api.ts";
import {
  dueBucket,
  dueLabel,
  eventTime,
  insightSentence,
  readingLine,
  reviewLine,
  sortEvents,
  sortTodos,
  todayEndISO,
  todayStartISO,
} from "./dashboard.model.ts";
import "./dashboard.css";

/** A calm card shell: panel/border/radius primitive, sentence-case heading (D7). */
function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="dash-card">
      <h2 className="dash-card-title">{title}</h2>
      {children}
    </section>
  );
}

/** Today's calendar — earliest first; empty → a plain line. */
function TodayCard() {
  const events = useEvents(todayStartISO(), todayEndISO());
  const list = events.data ? sortEvents(events.data) : [];
  return (
    <Card title="Today">
      {events.isLoading && <Spinner label="Loading…" />}
      {events.data && list.length === 0 && <p className="dash-empty">Nothing scheduled today.</p>}
      <ul className="dash-list">
        {list.map((ev) => (
          <li key={ev.uid} className="dash-event">
            <span className="dash-event-time">{eventTime(ev)}</span>
            <span className="dash-event-summary">{ev.summary}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Open todos: due/overdue first, a quick-capture input, and a checkbox to complete. */
function TodosCard({ courseId }: { courseId: string | null }) {
  const todos = useTodos(courseId, false);
  const create = useCreateTodo();
  const toggle = useToggleTodo();
  const [text, setText] = useState("");
  const [due, setDue] = useState("");

  const list = todos.data ? sortTodos(todos.data) : [];

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || create.isPending) return;
    try {
      await create.mutateAsync({
        text: trimmed,
        course_id: courseId,
        ...(due ? { due_date: due } : {}),
      });
      setText("");
      setDue("");
    } catch {
      toast.error("Could not add that.");
    }
  }

  return (
    <Card title="Todos">
      <form className="dash-todo-add" onSubmit={onAdd}>
        <input
          className="dash-todo-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a todo…"
          aria-label="Todo text"
        />
        <input
          type="date"
          className="dash-todo-due"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          aria-label="Due date"
        />
        <button type="submit" disabled={create.isPending || !text.trim()} aria-label="Add todo">
          Add
        </button>
      </form>
      {todos.isLoading && <Spinner label="Loading…" />}
      {todos.data && list.length === 0 && (
        <p className="dash-empty">Nothing on the list — quietly add what's next.</p>
      )}
      <ul className="dash-list">
        {list.map((t) => {
          const bucket = dueBucket(t.due_date);
          const label = dueLabel(bucket);
          return (
            <li key={t.id} className="dash-todo">
              <label className="dash-todo-row">
                <input
                  type="checkbox"
                  checked={t.done}
                  onChange={() => toggle.mutate({ id: t.id, done: !t.done })}
                  aria-label={`Mark "${t.text}" done`}
                />
                <span className="dash-todo-label">{t.text}</span>
                {label && (
                  <span className={`dash-todo-due-chip dash-todo-due-chip--${bucket}`}>{label}</span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Review queue count — a pure read (never mints). Card opens the Review window. */
function ReviewCard({ count }: { count: number }) {
  const open = useWindowStore((s) => s.open);
  return (
    <Card title="Review">
      <button type="button" className="dash-action" onClick={() => open("review")}>
        {reviewLine(count)}
      </button>
    </Card>
  );
}

/** The shakiest concept → "Train <concept>" opens the Gym preloaded on it (F11). */
function WeakSpotCard({ weakSpot }: { weakSpot: DueConcept | undefined }) {
  if (!weakSpot) {
    return (
      <Card title="Weak spot">
        <p className="dash-empty">Nothing flagged yet — it surfaces as you practice.</p>
      </Card>
    );
  }
  return (
    <Card title="Weak spot">
      <button
        type="button"
        className="dash-action"
        onClick={() => weakSpot.course_id && gymForConcept(weakSpot.course_id, weakSpot.concept_id)}
        disabled={!weakSpot.course_id}
      >
        Train {weakSpot.name}
      </button>
    </Card>
  );
}

/** Momentum — recent tutor insights as plain sentences; click opens Progress. */
function MomentumCard({ insights }: { insights: DashboardInsight[] }) {
  const open = useWindowStore((s) => s.open);
  return (
    <Card title="Momentum">
      {insights.length === 0 && (
        <p className="dash-empty">No notes yet — the tutor's observations land here.</p>
      )}
      <ul className="dash-list">
        {insights.map((ins) => (
          <li key={ins.id}>
            <button type="button" className="dash-insight" onClick={() => open("progress")}>
              {insightSentence(ins)}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Reading recommendations — each opens its source PDF at the recommended page. */
function ReadingCard({ reading }: { reading: DashboardReading[] }) {
  return (
    <Card title="Reading">
      {reading.length === 0 && (
        <p className="dash-empty">No reading queued — link a textbook to a course.</p>
      )}
      <ul className="dash-list">
        {reading.map((r) => (
          <li key={`${r.source_id}:${r.concept_id}`}>
            <button
              type="button"
              className="dash-reading"
              title={r.citation}
              onClick={() => openPdf(r.source_id, r.title, r.page_start)}
            >
              {readingLine(r.title, r.heading, r.page_start)}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Most-recent chat → resume it in the chat surface (sets the current session AND
 * navigates Home, mirroring SessionList.select — so resuming from a non-index
 * route, e.g. the Dashboard opened as a sidebar window tool, renders Chat). */
function ResumeCard({ courseId }: { courseId: string | null }) {
  const sessions = useSessions(courseId);
  const setCurrentSession = useUiStore((s) => s.setCurrentSession);
  const navigate = useNavigate();
  const recent = sessions.data
    ? [...sessions.data].sort((a, b) =>
        (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""),
      )[0]
    : undefined;
  function resume(id: string) {
    setCurrentSession(id);
    navigate("/");
  }
  return (
    <Card title="Resume">
      {sessions.isLoading && <Spinner label="Loading…" />}
      {sessions.data && !recent && <p className="dash-empty">No chats yet — start one any time.</p>}
      {recent && (
        <button
          type="button"
          className="dash-action"
          onClick={() => resume(recent.id)}
        >
          {recent.name || "Untitled chat"}
        </button>
      )}
    </Card>
  );
}

/**
 * The Dashboard (Phase-2 T5 — SPEC F11): the calm landing surface. A card grid over the
 * read-only aggregator (review_count / weak_spots / insights / reading) plus directly-
 * composed sources (today's calendar, open todos, recent sessions). Course-scoped when a
 * course tab is active; spans all active courses on Home. Renders for a brand-new user
 * (zero courses → a friendly nudge) and for an active course — it never crashes on empty.
 */
export function Dashboard() {
  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const { data: courses } = useCourses();

  const activeCourse = courses?.find((c) => c.id === activeCourseId && c.status === "active");
  const courseId = activeCourse ? activeCourse.id : null;
  const dashboard = useDashboard(courseId);

  const hasActiveCourse = (courses ?? []).some((c) => c.status === "active");
  // The aggregator declares these arrays as open dicts on the wire (extra="allow"); they
  // are produced by DueConcept / recent_insights / reading_recs (see api/types.ts), so we
  // narrow through `unknown` to the hand-typed card shapes (CONTRACT D3/D4).
  const weakSpots = (dashboard.data?.weak_spots ?? []) as unknown as DueConcept[];
  const insights = (dashboard.data?.insights ?? []) as unknown as DashboardInsight[];
  const reading = (dashboard.data?.reading ?? []) as unknown as DashboardReading[];
  const reviewCount = dashboard.data?.review_count ?? 0;

  return (
    <section className="dashboard">
      <h1>Dashboard</h1>
      <p className="dash-scope">
        {activeCourse ? `${activeCourse.name} — what's next.` : "What's next, across everything."}
      </p>

      {courses && !hasActiveCourse && (
        <p className="dash-nudge">
          No courses yet. Add a course from the tab strip above to start building your map.
        </p>
      )}

      <div className="dashboard-grid">
        <TodayCard />
        <TodosCard courseId={courseId} />
        <ReviewCard count={reviewCount} />
        <WeakSpotCard weakSpot={weakSpots[0]} />
        <MomentumCard insights={insights} />
        <ReadingCard reading={reading} />
        <ResumeCard courseId={courseId} />
      </div>
    </section>
  );
}
