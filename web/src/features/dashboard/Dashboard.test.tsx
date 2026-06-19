import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Spy on the navigate door (F3): the Resume card must navigate Home so Chat renders
// even when resumed from a non-index route (the Dashboard as a sidebar window).
const navigateSpy = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateSpy };
});

import { Dashboard } from "./Dashboard.tsx";
import {
  dueBucket,
  insightSentence,
  readingLine,
  reviewLine,
  sortTodos,
} from "./dashboard.model.ts";
import { useCourseStore } from "../courses/store.ts";
import { useUiStore } from "../../lib/store.ts";
import { useWindowStore } from "../../app/windows/windowStore.ts";
import { useGymStore } from "../practice/gymStore.ts";
import { renderWithProviders, jsonResponse, stubFetch, findCall } from "../../test/util.tsx";

/** Read a recorded openapi-fetch call's JSON body (the mock gets a Request object). */
async function requestJson(call: unknown[]): Promise<unknown> {
  return (call[0] as Request).clone().json();
}

const COURSES = { courses: [{ id: "c1", name: "AP Statistics", status: "active", settings: {} }] };

const DASHBOARD = {
  review_count: 3,
  weak_spots: [
    { concept_id: "n1", name: "Sampling error", state: "shaky", score: 0.8, heading_path: [], sources: [], course_id: "c1", effective_p: 0.3 },
  ],
  insights: [
    { id: "i1", relation: "tends_to", literal: "You reason well about averages but slip on variance.", confidence: 0.7, valid_from: "2026-06-18T00:00:00", concept_id: "n2", concept_name: "Variance" },
  ],
  reading: [
    { concept_id: "n1", concept_name: "Sampling error", source_id: "src1", title: "Stats Primer", heading: "Sampling", page_start: 12, citation: "Stats Primer — Sampling (p. 12)" },
  ],
};

const TODOS = {
  todos: [
    { id: "t1", text: "Finish problem set 3", course_id: "c1", due_date: "2000-01-01", done: false, done_at: null, source: "manual", provenance: null },
  ],
};

const EVENTS = {
  events: [
    { uid: "e1", summary: "Lecture: regression", dtstart: "2026-06-19T10:00:00", dtend: "2026-06-19T11:00:00", all_day: false, is_utc: false, description: "", location: "", rrule: "", calendar: "Lessons", calendar_href: "cal1", color: null, event_type: null, importance: "normal", is_recurrence: false, series_uid: "e1" },
  ],
};

const SESSIONS = [
  { id: "s1", name: "Older chat", model: "m", course_id: "c1", last_message_at: "2026-06-10T09:00:00", archived: false, has_documents: false, has_images: false, is_important: false, message_count: 1, rag: false, total_tokens: 0 },
  { id: "s2", name: "Newest chat", model: "m", course_id: "c1", last_message_at: "2026-06-19T09:00:00", archived: false, has_documents: false, has_images: false, is_important: false, message_count: 1, rag: false, total_tokens: 0 },
];

function mockDashboard(opts: { courses?: unknown; created?: unknown } = {}) {
  return stubFetch([
    ["/api/todos", () => jsonResponse(opts.created ?? TODOS)],
    ["/api/dashboard", () => jsonResponse(DASHBOARD)],
    ["/api/calendar/events", () => jsonResponse(EVENTS)],
    ["/api/sessions", () => jsonResponse(SESSIONS)],
    ["/api/courses", () => jsonResponse(opts.courses ?? COURSES)],
  ]);
}

beforeEach(() => {
  useCourseStore.setState({ activeCourseId: "c1", onboardingSkipped: false });
  useUiStore.setState({ currentSessionId: null });
  useWindowStore.setState({ windows: {}, nextZ: 1 });
  useGymStore.setState({ target: null });
  navigateSpy.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Dashboard model helpers", () => {
  it("buckets due dates relative to today", () => {
    expect(dueBucket("2000-01-01", "2026-06-19")).toBe("overdue");
    expect(dueBucket("2026-06-19", "2026-06-19")).toBe("today");
    expect(dueBucket("2030-01-01", "2026-06-19")).toBe("later");
    expect(dueBucket(null)).toBe("none");
  });

  it("sorts overdue → today → later → undated", () => {
    const ordered = sortTodos(
      [
        { id: "a", text: "later", course_id: null, due_date: "2030-01-01", done: false, done_at: null, source: "manual", provenance: null },
        { id: "b", text: "overdue", course_id: null, due_date: "2000-01-01", done: false, done_at: null, source: "manual", provenance: null },
        { id: "c", text: "today", course_id: null, due_date: "2026-06-19", done: false, done_at: null, source: "manual", provenance: null },
      ],
      "2026-06-19",
    );
    expect(ordered.map((t) => t.text)).toEqual(["overdue", "today", "later"]);
  });

  it("writes calm, narrative card lines (no scores)", () => {
    expect(reviewLine(0)).toMatch(/Nothing due/);
    expect(reviewLine(1)).toBe("1 item due");
    expect(reviewLine(3)).toBe("3 items due");
    expect(insightSentence({ id: "x", relation: "tends_to", literal: "You overcount." })).toBe("You overcount.");
    expect(insightSentence({ id: "y", relation: "struggles_with", literal: null, concept_name: "Variance" })).toBe("struggles with Variance");
    expect(readingLine("Stats Primer", "Sampling", 12)).toBe("Stats Primer §Sampling p. 12");
  });
});

describe("Dashboard", () => {
  it("renders the calm card grid for an active course", async () => {
    mockDashboard();
    renderWithProviders(<Dashboard />);

    // Cards render with their data.
    expect(await screen.findByText("Lecture: regression")).toBeInTheDocument(); // Today
    expect(await screen.findByText("Finish problem set 3")).toBeInTheDocument(); // Todos
    expect(await screen.findByText("3 items due")).toBeInTheDocument(); // Review count (pure read)
    expect(await screen.findByText("Train Sampling error")).toBeInTheDocument(); // Weak spot
    expect(await screen.findByText(/slip on variance/)).toBeInTheDocument(); // Momentum
    expect(await screen.findByText("Stats Primer §Sampling p. 12")).toBeInTheDocument(); // Reading
    expect(await screen.findByText("Newest chat")).toBeInTheDocument(); // Resume = most recent
  });

  it("quick-adds a todo: POSTs {text, course_id} to /api/todos", async () => {
    const fetchMock = mockDashboard();
    renderWithProviders(<Dashboard />);

    await userEvent.type(await screen.findByLabelText("Todo text"), "Read chapter 4");
    await userEvent.click(screen.getByRole("button", { name: "Add todo" }));

    await waitFor(() => expect(findCall(fetchMock, "/api/todos", "POST")).toBeTruthy());
    const body = await requestJson(findCall(fetchMock, "/api/todos", "POST")!);
    expect(body).toMatchObject({ text: "Read chapter 4", course_id: "c1" });
  });

  it("weak-spot card opens the Gym preloaded on the concept (F11 deep-link)", async () => {
    mockDashboard();
    renderWithProviders(<Dashboard />);

    await userEvent.click(await screen.findByText("Train Sampling error"));
    // The gym store holds the target and the gym window is open.
    expect(useGymStore.getState().target).toEqual({ courseId: "c1", conceptId: "n1" });
    expect(useWindowStore.getState().windows.gym).toBeTruthy();
  });

  it("review card opens the Review window (count is the pure read, never minted)", async () => {
    mockDashboard();
    renderWithProviders(<Dashboard />);

    await userEvent.click(await screen.findByText("3 items due"));
    expect(useWindowStore.getState().windows.review).toBeTruthy();
  });

  it("resume card selects the most-recent session AND navigates Home (so Chat renders)", async () => {
    mockDashboard();
    renderWithProviders(<Dashboard />);

    // Let every card's query settle first so the resume button isn't swapped out from
    // under the click by a concurrent re-render.
    await screen.findByText("Train Sampling error");
    await screen.findByText("Stats Primer §Sampling p. 12");
    await userEvent.click(screen.getByRole("button", { name: "Newest chat" }));
    await waitFor(() => expect(useUiStore.getState().currentSessionId).toBe("s2"));
    // F3: mirror SessionList.select — navigate Home so the chat renders regardless
    // of the current route (the Dashboard is also a sidebar window tool).
    expect(navigateSpy).toHaveBeenCalledWith("/");
  });

  it("renders for a brand-new user with no courses (a nudge, not a crash)", async () => {
    useCourseStore.setState({ activeCourseId: null });
    mockDashboard({ courses: { courses: [] } });
    renderWithProviders(<Dashboard />);

    expect(await screen.findByText(/No courses yet/)).toBeInTheDocument();
    // Cards still mount with calm empty states.
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });
});
