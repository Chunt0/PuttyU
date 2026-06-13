import { test, type Page } from "@playwright/test";

/**
 * UI snapshot capture — NOT a CI test. Run with:
 *   SNAPSHOTS=1 bunx playwright test snapshots --project=chromium
 * Walks every screen and interaction state of the new UI against a populated mock backend
 * and saves PNGs to <repo>/snapshots/ for human review.
 */

const OUT = "../snapshots";
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled" });

const MD_REPLY = [
  "Nice work getting this far — let's check it together.",
  "",
  "## Solving 2x + 6 = 14",
  "",
  "| step | operation | result |",
  "|------|-----------|--------|",
  "| 1 | subtract 6 from both sides | 2x = 8 |",
  "| 2 | divide both sides by 2 | **x = 4** |",
  "",
  "You can verify it in Python:",
  "",
  "```python",
  "x = 4",
  "assert 2 * x + 6 == 14  # checks out",
  "print(f\"x = {x}\")",
  "```",
  "",
  "Your only slip was in step 2 — you divided just the left side by 2. Want to try a similar one?",
].join("\n");

function thisMonth(day: number, time = ""): string {
  const now = new Date();
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return time ? `${d}T${time}` : d;
}

async function mockBackend(page: Page) {
  let authed = false;
  const history = [
    { role: "user", content: "can you check my work on this problem? 2x + 6 = 14, I got x = 8" },
    { role: "assistant", content: MD_REPLY },
  ];

  await page.route("**/api/auth/status", (r) => r.fulfill({ json: { authenticated: authed, username: authed ? "ada" : null, is_admin: true } }));
  await page.route("**/api/auth/login", (r) => { authed = true; return r.fulfill({ json: { ok: true, username: "ada" } }); });
  await page.route("**/api/sessions", (r) =>
    r.fulfill({ json: [
      { id: "s1", name: "Algebra — Sam", model: "llama3", rag: false, archived: false },
      { id: "s2", name: "Essay review", model: "llama3", rag: false, archived: false },
      { id: "s3", name: "Geometry homework", model: "llama3", rag: false, archived: false },
    ] }),
  );
  await page.route(/\/api\/history\/s1/, (r) => r.fulfill({ json: { history, model: "llama3", name: "Algebra — Sam" } }));
  await page.route(/\/api\/history\/s[23]/, (r) => r.fulfill({ json: { history: [], model: "llama3", name: "Essay review" } }));

  await page.route("**/api/upload?**", (r) => r.fulfill({ json: {} }));
  await page.route("**/api/upload", (r) =>
    r.fulfill({ json: { files: [{ id: "f1", name: "worksheet-page1.jpg", mime: "image/jpeg", size: 120000 }] } }),
  );
  await page.route("**/api/chat_stream", (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        'data: {"type":"tool_start","tool":"bash","command":"python check_answer.py","round":1}\n\n' +
        'data: {"type":"tool_output","tool":"bash","command":"python check_answer.py","output":"x = 4 verified","exit_code":0,"round":1}\n\n' +
        'data: {"delta":"I ran a quick check — x = 4 is correct."}\n\n' +
        "data: [DONE]\n\n",
    }),
  );

  // Notes / calendar / tasks / documents / memory / research — populated for review.
  await page.route("**/api/notes**", (r) => {
    const archived = r.request().url().includes("archived=true");
    return r.fulfill({ json: { notes: archived ? [] : [
      { id: "n1", title: "Sam — fractions", content: "Struggled with common denominators; bring visual examples next lesson.", note_type: "note", pinned: true, archived: false, repeat: "none", sort_order: 0 },
      { id: "n2", title: "Parent call", content: "Schedule progress update for Friday.", note_type: "note", pinned: false, archived: false, repeat: "none", sort_order: 1 },
    ] } });
  });
  await page.route("**/api/calendar/calendars", (r) => r.fulfill({ json: { calendars: [{ name: "Lessons", href: "cal1", color: "#5b8abf", source: "local" }] } }));
  await page.route("**/api/calendar/config", (r) => r.fulfill({ json: { url: "", username: "", has_password: false, local: true } }));
  await page.route("**/api/calendar/events**", (r) =>
    r.fulfill({ json: { events: [
      { uid: "e1", summary: "Algebra with Sam", dtstart: thisMonth(16, "16:00:00"), dtend: thisMonth(16, "17:00:00"), all_day: false, is_utc: false, description: "", location: "Library room 2", rrule: "FREQ=WEEKLY", calendar: "Lessons", calendar_href: "cal1", color: null, event_type: null, importance: "normal", is_recurrence: true, series_uid: "e1" },
      { uid: "e2", summary: "Mock exam — statistics", dtstart: thisMonth(20), dtend: thisMonth(20), all_day: true, is_utc: false, description: "", location: "", rrule: "", calendar: "Lessons", calendar_href: "cal1", color: null, event_type: null, importance: "high", is_recurrence: false, series_uid: "e2" },
    ] } }),
  );
  await page.route("**/api/tasks/meta/actions", (r) => r.fulfill({ json: { actions: [] } }));
  await page.route("**/api/tasks/meta/events", (r) => r.fulfill({ json: { events: [] } }));
  await page.route("**/api/tasks/meta/output-targets", (r) => r.fulfill({ json: { targets: [{ value: "session", label: "Session", description: "" }] } }));
  await page.route("**/api/tasks", (r) =>
    r.fulfill({ json: { tasks: [
      { id: "t1", name: "Summarize this week's lesson notes", task_type: "llm", action: null, schedule: "weekly", scheduled_time: "18:00", scheduled_day: 4, scheduled_date: null, cron_expression: null, trigger_type: "schedule", trigger_event: null, trigger_count: null, next_run: "2026-06-12T18:00:00Z", last_run: null, status: "active", output_target: "session", run_count: 3, webhook_token: null, is_builtin: false, prompt: "Summarize this week's lesson notes" },
      { id: "t2", name: "Daily practice reminder", task_type: "llm", action: null, schedule: "daily", scheduled_time: "09:00", scheduled_day: null, scheduled_date: null, cron_expression: null, trigger_type: "schedule", trigger_event: null, trigger_count: null, next_run: "2026-06-11T09:00:00Z", last_run: "2026-06-10T09:00:00Z", status: "paused", output_target: "session", run_count: 12, webhook_token: null, is_builtin: false, prompt: "Daily practice reminder" },
    ] } }),
  );
  await page.route("**/api/documents/library**", (r) =>
    r.fulfill({ json: { documents: [
      { id: "d1", title: "Lesson 1: fractions", language: "text", preview: "Intro to numerators and denominators…", version_count: 3, session_name: null, created_at: null, updated_at: null },
      { id: "d2", title: "Worksheet — linear equations", language: "text", preview: "10 practice problems with answer key…", version_count: 1, session_name: null, created_at: null, updated_at: null },
    ], total: 2, languages: {}, session_count: 0 } }),
  );
  await page.route("**/api/document/d1**", (r) => {
    if (r.request().method() === "PUT") return r.fulfill({ json: { ok: true } });
    return r.fulfill({ json: { id: "d1", title: "Lesson 1: fractions", language: "text", current_content: "Intro to numerators and denominators.\n\nPractice set A: 1/2 + 1/3, 3/4 - 1/8 …", version_count: 3, is_active: true, archived: false, session_id: null, created_at: null, updated_at: null } });
  });
  await page.route(/\/api\/memory(\/|\?|$)/, (r) =>
    r.fulfill({ json: { memory: [
      { id: "m1", text: "Sam is preparing for the June statistics exam", category: "goal", source: "user", timestamp: 1, uses: 4, owner: null },
      { id: "m2", text: "Prefers visual explanations over formal proofs", category: "preference", source: "extracted", timestamp: 2, uses: 9, owner: null },
      { id: "m3", text: "Weak spot: fraction arithmetic under time pressure", category: "fact", source: "extracted", timestamp: 3, uses: 2, owner: null },
    ] } }),
  );
  await page.route("**/api/personal", (r) =>
    r.fulfill({ json: { files: [{ name: "stats-textbook-ch1.pdf", size: 2048000, path: "/p/stats-textbook-ch1.pdf" }, { name: "exam-syllabus.pdf", size: 80000, path: "/p/exam-syllabus.pdf" }], directories: [] } }),
  );
  await page.route("**/api/embeddings/endpoint", (r) => r.fulfill({ json: { url: "", model: "", active: false } }));
  await page.route("**/api/embeddings/models", (r) => r.fulfill({ json: [{ model: "BAAI/bge-small-en-v1.5", active: true, downloaded: true }] }));
  await page.route("**/api/research/library", (r) =>
    r.fulfill({ json: { research: [{ id: "rp1", query: "best practices for teaching fractions to visual learners", category: "", source_count: 8, status: "done", duration: "2m 10s", rounds: 3, started_at: 1, completed_at: 2, archived: false }], total: 1 } }),
  );
  await page.route("**/api/model-endpoints", (r) =>
    r.fulfill({ json: [{ id: "ep1", name: "Ollama", base_url: "https://ollama.putty-ai.com/v1", has_key: false, is_enabled: true, models: ["llama3", "qwen2.5"], pinned_models: [], hidden_count: 0, online: true, status: "online", ping_error: null, model_type: "llm", supports_tools: true, endpoint_kind: "local", category: "local" }] }),
  );
  await page.route("**/api/models**", (r) => r.fulfill({ json: { hosts: [], items: [{ endpoint_id: "ep1", endpoint_name: "Ollama", url: "https://ollama.putty-ai.com/v1", models: ["llama3", "qwen2.5"], models_display: ["llama3", "qwen2.5"], category: "local", endpoint_kind: "local", model_type: "llm" }] } }));
  await page.route("**/api/default-chat", (r) => r.fulfill({ json: { endpoint_id: "ep1", endpoint_url: "https://ollama.putty-ai.com/v1", model: "llama3" } }));
}

test.use({ viewport: { width: 1440, height: 900 } });

test("capture UI snapshots", async ({ page }) => {
  test.skip(!process.env.SNAPSHOTS, "snapshot capture only — run with SNAPSHOTS=1");
  test.setTimeout(120_000);
  await mockBackend(page);

  // 01 — login
  await page.goto("/");
  await page.getByLabel("Username").waitFor();
  await shot(page, "01-login");

  await page.getByLabel("Username").fill("ada");
  await page.getByLabel("Password").fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();

  // 02 — chat with a markdown reply (table + highlighted code), session header
  await page.getByRole("heading", { name: "Solving 2x + 6 = 14" }).waitFor();
  await shot(page, "02-chat-markdown");

  // 03 — code-block copy button (hover state)
  await page.locator(".codeblock").hover();
  await shot(page, "03-chat-code-copy-hover");

  // 04 — tutor welcome on an empty session
  await page.getByRole("button", { name: "Essay review", exact: true }).click();
  await page.getByText("What are we working on today?").waitFor();
  await shot(page, "04-chat-welcome");

  // 05 — attachment chip in the composer
  await page.getByLabel("Attach files").setInputFiles({ name: "worksheet-page1.jpg", mimeType: "image/jpeg", buffer: Buffer.from("x") });
  await page.getByTestId("attachments").waitFor();
  await shot(page, "05-chat-attachment");

  // 06 — agent turn with tool steps (send in agent mode; steps stay as the turn footer)
  await page.getByLabel("Agent mode").check();
  await page.getByLabel("Message").fill("verify my answer with python");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("python check_answer.py").waitFor();
  await shot(page, "06-chat-agent-steps");

  // 07 — inline session rename
  await page.getByRole("button", { name: "Geometry homework", exact: true }).hover();
  await page.getByRole("button", { name: "Rename Geometry homework" }).click();
  await page.getByLabel("Chat name").waitFor();
  await shot(page, "07-session-rename");
  await page.keyboard.press("Escape");

  // 08 — armed two-step session delete (destructive state)
  await page.getByRole("button", { name: "Geometry homework", exact: true }).hover();
  await page.getByRole("button", { name: "Delete Geometry homework" }).click();
  await shot(page, "08-session-delete-armed");
  await page.getByLabel("Message").click(); // disarm via blur

  // 09 — floating window over the chat
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByTestId("window-notes").waitFor();
  await shot(page, "09-window-floating-notes");

  // 10 — snap preview mid-drag near the right edge
  const header = page.getByTestId("window-notes").locator(".window-header");
  await header.hover({ position: { x: 80, y: 12 } });
  await page.mouse.down();
  await page.mouse.move(1432, 400, { steps: 6 });
  await shot(page, "10-window-snap-preview");
  await page.mouse.up();

  // 11 — docked right panel; chat shrank to make room
  await page.getByTestId("window-notes").locator(".window-header").waitFor();
  await shot(page, "11-window-docked-right");

  // 12 — armed two-step delete inside a tool ("Sure?")
  await page.getByRole("button", { name: "Delete Sam — fractions" }).click();
  await shot(page, "12-confirm-armed-note");
  await page.getByLabel("Message").click();

  // 13 — second tool floating while Notes stays docked + dock bar with a minimized chip
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await page.getByTestId("window-calendar").waitFor();
  await shot(page, "13-windows-docked-plus-floating");
  await page.getByRole("button", { name: "Minimize Calendar" }).click();
  await page.getByTestId("dock-bar").waitFor();
  await shot(page, "14-dock-bar-minimized");
  await page.getByTestId("dock-bar").getByRole("button", { name: "Calendar" }).click();
  await page.getByRole("button", { name: "Close Calendar" }).click();
  await page.getByRole("button", { name: "Close Notes" }).click();

  // 15 — documents window: editor + save toast
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await page.getByRole("button", { name: /Lesson 1: fractions/ }).first().click();
  await page.getByTestId("editor-d1").waitFor();
  await page.getByLabel("Document content", { exact: true }).fill("Intro to numerators and denominators.\n\nPractice set A + extra drill.");
  await page.getByRole("button", { name: "Save" }).click();
  await page.locator(".toast--success").waitFor();
  await shot(page, "15-documents-editor-save-toast");
  await page.getByRole("button", { name: "Close Documents" }).click();

  // 16-19 — populated tool screens (calendar agenda, tasks, memory, research)
  for (const [name, file] of [["Calendar", "16-calendar"], ["Tasks", "17-tasks"], ["Memory", "18-memory"], ["Research", "19-research"]] as const) {
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByTestId(`window-${name.toLowerCase()}`).waitFor();
    await page.waitForTimeout(250); // let the list queries paint
    await shot(page, file);
    await page.getByRole("button", { name: `Close ${name}` }).click();
  }

  // 20 — providers screen (endpoint online, default model picked)
  await page.getByRole("button", { name: "Providers", exact: true }).click();
  await page.getByText("ollama.putty-ai.com").first().waitFor();
  await shot(page, "20-providers");
  await page.getByRole("button", { name: "Close Providers" }).click();

  // 21-22 — two alternate themes on the chat screen
  await page.getByRole("button", { name: "Algebra — Sam", exact: true }).click();
  await page.getByRole("heading", { name: "Solving 2x + 6 = 14" }).waitFor();
  await page.getByLabel("Theme").selectOption("putty-light");
  await shot(page, "21-theme-putty-light");
  await page.getByLabel("Theme").selectOption("midnight");
  await shot(page, "22-theme-midnight");
  await page.getByLabel("Theme").selectOption("putty");
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase-2 tutoring screens (courses · grounded chat · library · progress graph).
// A second self-contained capture against a mock backend seeded with a course,
// a linked library source, a populated concept graph, and a grounded reply.
// ─────────────────────────────────────────────────────────────────────────────

type GraphAssertion = {
  id: string; kind: string; relation: string; statement: string; quote: string | null;
  confidence: number | null; subject_type: string; object_type: string | null;
  object_id: string | null; object_name: string | null; valid_from: string;
  invalidated_at: string | null; invalidation_reason: string | null; episode_refs: unknown[];
};

async function mockTutoringBackend(page: Page) {
  let authed = false;
  const sessions: { id: string; name: string; model: string; course_id: string | null }[] = [];
  const history: { role: string; content: string }[] = [];

  const assertions: GraphAssertion[] = [
    { id: "a1", kind: "stated", relation: "states",
      statement: "I always mix up sampling error and bias",
      quote: "I always mix up sampling error and bias", confidence: null,
      subject_type: "user", object_type: "concept", object_id: "n2",
      object_name: "Sampling error", valid_from: "2026-06-08T10:00:00Z",
      invalidated_at: null, invalidation_reason: null, episode_refs: [] },
    { id: "a2", kind: "inferred", relation: "struggles_with", statement: "rushes the setup before reading the whole problem",
      quote: null, confidence: 0.55, subject_type: "user", object_type: "concept",
      object_id: "n2", object_name: "Sampling error", valid_from: "2026-05-20T10:00:00Z",
      invalidated_at: null, invalidation_reason: null, episode_refs: [] },
    { id: "a3", kind: "inferred", relation: "confuses",
      statement: "confuses standard deviation with standard error", quote: null, confidence: 0.8,
      subject_type: "user", object_type: "concept", object_id: "n2", object_name: "Sampling error",
      valid_from: "2026-05-02T10:00:00Z", invalidated_at: "2026-06-02T10:00:00Z",
      invalidation_reason: "contradicted", episode_refs: [] },
  ];

  await page.route("**/api/auth/status", (r) =>
    r.fulfill({ json: { authenticated: authed, username: authed ? "ada" : null, is_admin: true } }));
  await page.route("**/api/auth/login", (r) => { authed = true; return r.fulfill({ json: { ok: true, username: "ada" } }); });

  await page.route("**/api/sessions**", (r) => {
    const cid = new URL(r.request().url()).searchParams.get("course_id");
    return r.fulfill({ json: cid ? sessions.filter((s) => s.course_id === cid) : sessions });
  });
  await page.route("**/api/default-chat", (r) => r.fulfill({ json: {} }));
  await page.route("**/api/session", (r) => {
    const s = { id: "s1", name: "New chat", model: "llama3", course_id: "c1" };
    if (!sessions.find((x) => x.id === "s1")) sessions.push(s);
    return r.fulfill({ json: s });
  });
  await page.route(/\/api\/history\/s1/, (r) =>
    r.fulfill({ json: { history, model: "llama3", name: "New chat", course_id: "c1" } }));

  // Two courses so the focus/periphery story (Calculus ↔ calc-based Physics) reads.
  await page.route("**/api/courses**", (r) =>
    r.fulfill({ json: { courses: [
      { id: "c1", name: "AP Statistics", status: "active", settings: {} },
      { id: "c2", name: "Physics — Mechanics", status: "active", settings: {} },
    ] } }));
  await page.route("**/api/courses/*/sources", (r) =>
    r.fulfill({ json: { course_id: "c1", source_ids: ["s1"] } }));

  // Library sources + the user's own materials (the Materials list filters
  // /api/corpus/sources by kind=material). General route first; the TOC and PDF
  // sub-paths registered AFTER so they win (Playwright: last matching route wins).
  await page.route("**/api/corpus/sources**", (r) =>
    r.fulfill({ json: { sources: [
      { id: "s1", kind: "library", title: "Introductory Statistics", source_type: "textbook",
        subject: "statistics", authors: "OpenStax", status: "ready", course_id: null,
        tags: [], has_pdf: true, chunk_count: 642 },
      { id: "s2", kind: "library", title: "University Physics Vol. 1", source_type: "textbook",
        subject: "physics", authors: "OpenStax", status: "ready", course_id: null,
        tags: [], has_pdf: true, chunk_count: 880 },
      { id: "m1", kind: "material", title: "Week 3 — sampling worksheet", source_type: "material",
        subject: null, authors: null, status: "ready", course_id: "c1",
        tags: ["homework", "exam-prep"], has_pdf: true, chunk_count: 4 },
      { id: "m2", kind: "material", title: "Course syllabus", source_type: "material",
        subject: null, authors: null, status: "ready", course_id: "c1",
        tags: ["syllabus"], has_pdf: true, chunk_count: 2 },
    ] } }));
  await page.route("**/api/corpus/sources/s1/toc", (r) =>
    r.fulfill({ json: { source_id: "s1", toc: [
      { heading: "Ch 1 Sampling and data", ordinal: 0, page_start: 9, children: [
        { heading: "1.1 Definitions of statistics", ordinal: 1, page_start: 9, children: [] },
        { heading: "1.3 Sampling error and bias", ordinal: 2, page_start: 22, children: [] },
      ] },
      { heading: "Ch 2 Descriptive statistics", ordinal: 3, page_start: 70, children: [
        { heading: "2.3 Two kinds of data", ordinal: 4, page_start: 87, children: [] },
      ] },
    ] } }));
  await page.route("**/api/corpus/sources/*/pdf**", (r) =>
    r.fulfill({ status: 200, contentType: "application/pdf", body: "%PDF-1.4 fake" }));
  await page.route("**/api/corpus/materials**", (r) => r.fulfill({ json: { sources: [] } }));

  // The ensemble graph: a state-colored concept tree + one concept's trajectory.
  // General concepts route first; the per-concept detail/override registered AFTER.
  await page.route("**/api/graph/observations**", (r) =>
    r.fulfill({ json: { observations: [] } }));
  await page.route("**/api/graph/concepts**", (r) =>
    r.fulfill({ json: { course_id: "c1", concepts: [
      { id: "h1", name: "Ch 1 Sampling and data", state: "unknown", p_known: null, evidence_count: 0, children: [
        { id: "n1", name: "Populations and samples", state: "mastered", p_known: 0.91, evidence_count: 6, children: [] },
        { id: "n2", name: "Sampling error", state: "shaky", p_known: 0.31, evidence_count: 5, children: [] },
        { id: "n4", name: "Bias", state: "learning", p_known: 0.48, evidence_count: 3, children: [] },
      ] },
      { id: "h2", name: "Ch 2 Descriptive statistics", state: "unknown", p_known: null, evidence_count: 0, children: [
        { id: "n5", name: "Measures of center", state: "mastered", p_known: 0.88, evidence_count: 4, children: [] },
        { id: "n6", name: "Standard deviation", state: "learning", p_known: 0.52, evidence_count: 3, children: [] },
        { id: "n7", name: "Box plots", state: "unknown", p_known: null, evidence_count: 0, children: [] },
      ] },
    ] } }));
  await page.route("**/api/graph/concepts/n2", (r) =>
    r.fulfill({ json: {
      id: "n2", name: "Sampling error", heading_path: ["Ch 1 Sampling and data", "Sampling error"],
      state: "shaky", p_known: 0.31,
      evidence: [
        { id: "e1", signal: "correct", weight: 1, created_at: "2026-06-10T15:00:00Z", source: "gym", note: null, indirect: false, episode_ref: null },
        { id: "e2", signal: "incorrect", weight: 1, created_at: "2026-06-04T15:00:00Z", source: "review", note: null, indirect: false, episode_ref: null },
      ],
      assertions,
    } }));
  await page.route("**/api/graph/concepts/n2/override", (r) =>
    r.fulfill({ json: { id: "n2", state: "mastered", p_known: 0.95, evidence_count: 4 } }));

  // A grounded reply: a `citations` control event precedes the tokens.
  const GROUNDED = "A **parameter** describes a whole population (a fixed number you usually can't observe); a **statistic** is what you compute from a sample to estimate it. Because samples vary, a statistic carries *sampling error*. [Introductory Statistics §1.1 Definitions, p. 9]";
  await page.route("**/api/chat_stream", (r) => {
    history.push(
      { role: "user", content: "what's the difference between a parameter and a statistic?" },
      { role: "assistant", content: GROUNDED },
    );
    return r.fulfill({ status: 200, contentType: "text/event-stream",
      body:
        'data: {"type":"citations","data":[{"chunk_id":"ch1","source_id":"s1","title":"Introductory Statistics","heading":"Ch 1 > 1.1 Definitions","page_start":9,"citation":"[Introductory Statistics §1.1 Definitions, p. 9]"}]}\n\n' +
        `data: {"delta":${JSON.stringify(GROUNDED)}}\n\n` +
        "data: [DONE]\n\n" });
  });
}

test("capture tutoring snapshots", async ({ page }) => {
  test.skip(!process.env.SNAPSHOTS, "snapshot capture only — run with SNAPSHOTS=1");
  test.setTimeout(120_000);
  await mockTutoringBackend(page);

  await page.goto("/");
  await page.getByLabel("Username").fill("ada");
  await page.getByLabel("Password").fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();

  // 23 — course landing: coverage chip, the mastery progress strip, materials with tags
  await page.getByRole("tab", { name: "AP Statistics" }).click();
  await page.getByText("Week 3 — sampling worksheet").waitFor();
  await page.waitForTimeout(300);
  await shot(page, "23-course-landing");

  // 24 — grounded chat: the reply streams citation chips ("grounded in N sources")
  await page.getByRole("main").getByRole("button", { name: "+ New chat" }).click();
  await page.getByLabel("Message").fill("what's the difference between a parameter and a statistic?");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("grounded in 1 source").waitFor();
  await page.getByRole("button", { name: /Introductory Statistics §1.1 Definitions/ }).waitFor();
  await page.waitForTimeout(300);
  await shot(page, "24-grounded-chat");

  // 25 — the library: a real source's table of contents, a click opens the PDF at the page
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const lib = page.getByTestId("window-library");
  await lib.getByText("Introductory Statistics").first().waitFor();
  await lib.getByRole("button", { name: "Contents of Introductory Statistics" }).click();
  await lib.getByText("1.3 Sampling error and bias").waitFor();
  await page.waitForTimeout(300);
  await shot(page, "25-library-toc");
  await page.getByRole("button", { name: "Close Library" }).click();

  // 26 — Progress: the state-colored concept tree (4-state vocabulary, evidence counts)
  await page.getByRole("button", { name: "Progress", exact: true }).click();
  const prog = page.getByTestId("window-progress");
  await prog.getByRole("button", { name: "Sampling error" }).waitFor();
  await page.waitForTimeout(300);
  await shot(page, "26-progress-tree");

  // 27 — a concept's trajectory: verbatim stated quote + struck-through invalidated insight
  await prog.getByRole("button", { name: "Sampling error" }).click();
  await prog.getByText("I always mix up sampling error and bias").waitFor();
  await page.waitForTimeout(300);
  await shot(page, "27-concept-trajectory");
});
