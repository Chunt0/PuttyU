import { test, expect, type Page } from "@playwright/test";

/**
 * Phase-2 T5 / F11 flow (ADR 0002 Gate 3): login lands on the Dashboard (not an
 * auto-opened chat) → its cards render → quick-add a todo (asserts the POST /api/todos
 * body) → a weak-spot card deep-links into the Gym preloaded on its concept, and the
 * review card opens the Review window. Backend fully mocked; todos are stateful.
 */

type Todo = {
  id: string; text: string; course_id: string | null; due_date: string | null;
  done: boolean; done_at: string | null; source: string; provenance: null;
};

async function mockBackend(page: Page, captured: { todoPost: string | null }) {
  let authed = false;
  const todos: Todo[] = [
    { id: "t1", text: "Finish problem set 3", course_id: "c1", due_date: "2000-01-01", done: false, done_at: null, source: "manual", provenance: null },
  ];

  await page.route("**/api/auth/status", (r) =>
    r.fulfill({ json: { authenticated: authed, username: authed ? "ada" : null, is_admin: true } }));
  await page.route("**/api/auth/login", (r) => {
    authed = true;
    return r.fulfill({ json: { ok: true, username: "ada" } });
  });

  await page.route("**/api/sessions**", (r) =>
    r.fulfill({ json: [
      { id: "s1", name: "Older chat", model: "m", course_id: "c1", last_message_at: "2026-06-10T09:00:00", archived: false, rag: false },
      { id: "s2", name: "Newest chat", model: "m", course_id: "c1", last_message_at: "2026-06-19T09:00:00", archived: false, rag: false },
    ] }));
  await page.route("**/api/default-chat", (r) => r.fulfill({ json: {} }));
  await page.route("**/api/courses**", (r) =>
    r.fulfill({ json: { courses: [{ id: "c1", name: "AP Statistics", status: "active", settings: {} }] } }));
  await page.route("**/api/courses/*/sources", (r) =>
    r.fulfill({ json: { course_id: "c1", source_ids: ["s1"] } }));
  await page.route("**/api/calendar/events**", (r) =>
    r.fulfill({ json: { events: [
      { uid: "e1", summary: "Lecture: regression", dtstart: "2026-06-19T10:00:00", dtend: "2026-06-19T11:00:00", all_day: false, is_utc: false, description: "", location: "", rrule: "", calendar: "Lessons", calendar_href: "cal1", color: null, event_type: null, importance: "normal", is_recurrence: false, series_uid: "e1" },
    ] } }));

  // The aggregator: a pure read of review_count + weak_spots + insights + reading.
  await page.route("**/api/dashboard**", (r) =>
    r.fulfill({ json: {
      review_count: 3,
      weak_spots: [
        { concept_id: "n1", name: "Sampling error", state: "shaky", score: 0.8, heading_path: [], sources: [], course_id: "c1", effective_p: 0.3 },
      ],
      insights: [
        { id: "i1", relation: "tends_to", literal: "You reason well about averages but slip on variance.", confidence: 0.7, valid_from: "2026-06-18T00:00:00" },
      ],
      reading: [
        { concept_id: "n1", concept_name: "Sampling error", source_id: "src1", title: "Stats Primer", heading: "Sampling", page_start: 12, citation: "Stats Primer — Sampling (p. 12)" },
      ],
    } }));

  // Todos: GET lists open ones; POST appends (capturing the body).
  await page.route("**/api/todos**", (r) => {
    if (r.request().method() === "POST") {
      captured.todoPost = r.request().postData();
      const b = JSON.parse(captured.todoPost ?? "{}");
      const t: Todo = { id: "t2", text: b.text, course_id: b.course_id ?? null, due_date: b.due_date ?? null, done: false, done_at: null, source: "manual", provenance: null };
      todos.push(t);
      return r.fulfill({ json: t });
    }
    return r.fulfill({ json: { todos: todos.filter((t) => !t.done) } });
  });

  // The concept tree the Gym's picker reads (so the preloaded gym can mint).
  await page.route("**/api/graph/concepts**", (r) =>
    r.fulfill({ json: { course_id: "c1", concepts: [
      { id: "n1", name: "Sampling error", state: "shaky", p_known: null, evidence_count: 3, children: [] },
    ] } }));
  await page.route("**/api/practice/gym/next", (r) =>
    r.fulfill({ json: {
      difficulty: 2,
      item: { item_key: "g1", concept_id: "n1", concept_name: "Sampling error", course_id: "c1", difficulty: 2, mode: "short", prompt: "Why does a larger sample shrink sampling error?", source: "library", citation: null },
      message: null,
    } }));
}

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill("ada");
  await page.getByLabel("Password").fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("F11: login lands on the dashboard; cards render; quick-add a todo; deep-links open", async ({ page }) => {
  const captured = { todoPost: null as string | null };
  await mockBackend(page, captured);
  await login(page);

  // Lands on the Dashboard (NOT an auto-opened chat) with its calm cards.
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Lecture: regression")).toBeVisible();        // Today
  await expect(page.getByText("Finish problem set 3")).toBeVisible();        // Todos
  await expect(page.getByText("3 items due")).toBeVisible();                 // Review count (pure read)
  await expect(page.getByText("Train Sampling error")).toBeVisible();        // Weak spot
  await expect(page.getByText(/slip on variance/)).toBeVisible();            // Momentum
  await expect(page.getByText("Stats Primer §Sampling p. 12")).toBeVisible();// Reading
  // Resume = the most-recent session; scope to the main pane (the sidebar lists it too).
  await expect(page.getByRole("main").getByRole("button", { name: "Newest chat" })).toBeVisible();

  // Quick-add a todo → POST /api/todos with {text, course_id}.
  await page.getByLabel("Todo text").fill("Read chapter 4");
  await page.getByRole("button", { name: "Add todo" }).click();
  await expect.poll(() => captured.todoPost ?? "").toContain("Read chapter 4");
  const body = JSON.parse(captured.todoPost ?? "{}");
  expect(body.text).toBe("Read chapter 4");
  // The landing dashboard is the cross-course Home view (no tab selected), so the todo is
  // course-less (course_id null = Home) — exactly what the Todos card scopes to.
  expect(body.course_id).toBeNull();
  await expect(page.getByText("Read chapter 4")).toBeVisible();

  // Review deep-link opens the Review window; close it so it doesn't cover the grid.
  await page.getByRole("button", { name: "3 items due" }).click();
  await expect(page.getByTestId("window-review")).toBeVisible();
  await page.getByRole("button", { name: "Close Review" }).click();

  // Weak-spot deep-link opens the Gym preloaded — it mints the concept's item directly.
  await page.getByRole("button", { name: "Train Sampling error" }).click();
  const gym = page.getByTestId("window-gym");
  await expect(gym).toBeVisible();
  await expect(gym.getByText("Why does a larger sample shrink sampling error?")).toBeVisible();
});
