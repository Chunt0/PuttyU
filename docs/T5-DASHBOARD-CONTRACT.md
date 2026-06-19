# T5 vertical-1 contract — Todos + Dashboard (authoritative for this slice)

> Working build doc for **T5 vertical 1** (SPEC F11 dashboard + the ADR-0004 §Q12
> todo model). Read order: `CLAUDE.md` → `docs/PHASE-2-BUILD-PLAN.md` §5 → this file.
> Seam APIs verified against live code 2026-06-19; `grep` to confirm line moves.
> Every gate stays green after each chunk. Use `.venv/bin/python`; `mkdir -p data`.

Scope of THIS vertical: the `todo` table + CRUD, the Dashboard landing surface and
its cards (today's calendar, due/overdue todos + quick capture, review-queue count,
weak-spot → Gym, momentum, reading recommendations, resume session). **Deferred to
later T5 verticals: Cmd-K global search (needs a new search backend — unwired today),
schedule miner, persona/dial, cost meter, session-summary notes, typed math.**

---

## 0. Pinned decisions (frozen)

- **D1 — Todo table.** Add `Todo(TimestampMixin, Base)` to `core/database.py` after
  `CourseSource` (~:1365): `id` (pk), `owner` (nullable, indexed — Gate-5 seam),
  `course_id` (nullable, indexed; NULL = Home), `text` (Text, required), `due_date`
  (String, ISO date — mirrors `Note.due_date`), `done_at` (DateTime nullable; NULL =
  open), `source` (String, default `"manual"`; manual|miner|tutor), `provenance`
  (Text, JSON-as-text `{source_id, page}` for miner rows). **No `_migrate_*` — the
  table is created by `create_all` in `init_db` automatically.** Also add `"todos"`
  to the `tables` list in `_migrate_assign_legacy_owner` (~:910) so pre-auth rows get
  stamped to the admin owner.
- **D2 — Todo models + routes.** Pydantic `TodoCreateRequest/TodoUpdateRequest/
  TodoResponse/TodoListResponse` go in `src/request_models.py` (649/800 — has room;
  mirror the `Course*` block, all `ConfigDict(extra="allow")`). `routes/todo_routes.py`
  = `setup_todo_routes()` mirroring `course_routes.py`: `GET /api/todos?course_id=&done=`,
  `POST /api/todos`, `PATCH /api/todos/{id}`, `POST /api/todos/{id}/done?done=`,
  `DELETE /api/todos/{id}` — each `owner_scoped`, typed body, `response_model`,
  `get_current_user`, `SessionLocal` try/finally. Wire in `app.py` after the courses
  block; add the 5 lines to `.fitness/ui-contract-endpoints.txt`.
- **D3 — Dashboard aggregator.** `routes/dashboard_routes.py` = `setup_dashboard_routes()`
  with one **read-only** route `GET /api/dashboard?course_id=` → `DashboardResponse`
  `{review_count: int, weak_spots: list, insights: list, reading: list}`. It **degrades
  per-section** (mirror `student_context`'s never-raise contract: each section in its own
  try/except, failures → empty, the route never 500s). owner_scoped. One `response_model`.
  - `review_count` = `len(items.due_concepts(db, user, course_id, limit=DAILY_CAP))` —
    a PURE read. **NEVER call `/api/practice/queue` for the count (it mints items / hits
    the LLM).**
  - `weak_spots` = top ~3 of `items.due_concepts(...)` (each carries concept_id, name,
    state, course_id → deep-links Gym).
  - `insights` = `queries.recent_insights(db, user, course_id, limit=5)` (see D4).
  - `reading` = for the top ~2 frontier concepts, join concept → source/heading →
    page via `queries.region_concepts` + `src/corpus/course_search.toc_tree` →
    `{concept_id, concept_name, source_id, title, heading, page_start, citation}`
    (page_end best-effort; degrade to page_start only). Helper may live in the route
    or a small `src/dashboard.py`.
  - **Gate 6f:** the route must reach the graph ONLY through `src/graph/queries` /
    `src/student_context` / `items` (which uses queries) — NEVER raw `Assertion`/graph
    ORM or SQL. Corpus reads via `src/corpus/course_search` are fine.
- **D4 — new graph door.** Add `recent_insights(db, owner, course_id=None, limit=5)
  -> list[dict]` to `src/graph/queries.py` (the public graph API). Returns inferred
  insights (the `student_context._focus_lines` filter: `kind="inferred",
  subject_type="student", invalidated_at IS NULL`, newest by `valid_from`), as plain
  dicts `{id, relation, literal, confidence, valid_from, concept_id?, concept_name?}`.
  Owner-scoped. This is the ONLY new graph read; the aggregator consumes it.
- **D5 — login lands on Dashboard.** Login → `/` → the index route (currently
  `Home.tsx`: zero-courses→Onboarding; active-course+no-chat→CourseLanding; else→Chat).
  Make the landing the Dashboard while PRESERVING Onboarding (zero courses) and keeping
  course-tab→chat reachable. Lowest-risk: in `web/src/features/courses/Home.tsx` return
  `<Dashboard/>` for the default/no-active-course path (the branch that currently falls
  to `<Chat/>`). Prove it with a test asserting login lands on the Dashboard.
- **D6 — deep-links.** Review-count card → `useWindowStore.open("review")`. Reading rec
  → `openPdf(source_id, title, page_start)` (`features/library/pdfStore.ts`). Momentum
  → `open("progress")` (no per-concept preselect in v1 — note it). Resume → open the
  most-recent session in chat (reuse the existing session-select mechanism; inspect
  `features/sessions`). **Weak-spot → Gym preloaded** needs a NEW `useGymStore` (mirror
  `pdfStore.ts`: `target` + `gymForConcept(courseId, conceptId)` that sets target then
  `open("gym")`); edit `Gym.tsx` to read+clear it on mount (seed the concept dropdown).
- **D7 — calm.** No streaks/XP/scores. Empty day states plainly ("Nothing due — the
  review queue has N when you're ready"). Sentence-case headings, coral-only accent,
  var(--token)s, no emoji-as-UI, no gradients.
- **D8 — untrusted-content.** This vertical builds only `source="manual"` todos + CRUD.
  miner/tutor-proposed todos are a later vertical (they land only as confirmed proposals).

---

## 1. Condensed seam APIs

### Todo backend (mirror `routes/course_routes.py`)
- Model style: `core/database.py:1336` (Course), `TimestampMixin` :22, `utcnow_naive()` :17.
- Route patterns: `_get_owned_course`/`_course_to_dict` (`course_routes.py:37-62`),
  `owner_scoped` (`src/auth_helpers.py:130`), `get_current_user` (:8). Serialize
  `provenance` via `json.loads`/`json.dumps` like `Course.settings`.
- Contract regen after the route: `.venv/bin/python scripts/openapi-export.py &&
  (cd web && bun run gen:api)` → commit `web/src/api/schema.d.ts` (openapi.json is gitignored).

### Dashboard data sources (frontend composes these directly; only the aggregator is new)
- Today's calendar: `useEvents(start, end)` (`web/src/features/calendar/api.ts:18`,
  hand-typed `CalendarEvent` from `features/calendar/types.ts`). Pass today's ISO bounds.
- Recent sessions: `useSessions(null)` (`web/src/features/sessions/api.ts:12`) → sort by
  `last_message_at` desc → [0] is "resume".
- Courses: `useCourses()` (`web/src/features/courses/api.ts:9`), filter `status==="active"`.
- The aggregator (review_count/weak_spots/insights/reading): NEW `GET /api/dashboard`.
- Todos: NEW `useTodos(courseId)`, `useCreateTodo()`, `useToggleTodo()`, `useUpdateTodo()`,
  `useDeleteTodo()` in `web/src/features/dashboard/api.ts` (TanStack over the typed client,
  mirror `features/practice/api.ts`).
- Deep-link doors: `useWindowStore.open(key)` (`app/windows/windowStore.ts:76`),
  `openPdf(sourceId,title,page?)` (`features/library/pdfStore.ts:28`).

### Frontend registration + landing
- Register Dashboard as the index route in `web/src/app/router.tsx` and/or via
  `Home.tsx` (D5). Optionally also a `WINDOW_TOOLS` entry (`app/windows/tools.tsx`) so
  it's reachable as a tool — but its primary role is the landing route, NOT a hidden tool.
- Card primitive (copy): `background:var(--panel); border:1px solid var(--border);
  border-radius:8px; padding:12px 14px;` hover `border-color:var(--accent)`. Add a
  `.dashboard-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr));
  gap:16px; }`. Tokens at `shell.css:8-32`. Mirror `Progress.tsx` + `CourseLanding.tsx:50`.

---

## 2. File ownership / build phases
- **Phase A — backend (one agent):** `core/database.py` (Todo model + legacy-owner list),
  `src/request_models.py` (4 todo models), `routes/todo_routes.py` (new), `src/graph/queries.py`
  (`recent_insights`), `routes/dashboard_routes.py` (new, + optional `src/dashboard.py` helper),
  `app.py` (wire both routers), `.fitness/ui-contract-endpoints.txt`, regen contract.
  Tests: `tests/test_todo_routes.py` (TestClient CRUD + owner_scoped + done-toggle),
  `tests/test_dashboard_route.py` (aggregator shape + per-section degradation + review_count
  is a pure read), `tests/test_queries_insights.py` (recent_insights filter).
- **Phase B — frontend (one agent):** `web/src/features/dashboard/` (Dashboard.tsx, api.ts,
  dashboard.model.ts, dashboard.css, Dashboard.test.tsx), `web/src/api/types.ts` (todo +
  dashboard aliases), a new `web/src/features/practice/gymStore.ts` (`useGymStore` +
  `gymForConcept`) + a small edit to `Gym.tsx` (read/clear on mount), the landing change
  (`Home.tsx`/`router.tsx`), registration. Tests: vitest + `web/e2e/dashboard.spec.ts`
  (login lands on dashboard; cards render; quick-add a todo; a deep-link fires).

## 3. Invariant checklist (every agent)
- [ ] graph access only via `src/graph/queries` / `student_context` / `items` (Gate 6f) —
      the dashboard route adds `recent_insights` to queries rather than touching Assertion
- [ ] `owner_scoped` on every todo/dashboard table read (Gate 5); no new ad-hoc owner filters
- [ ] new UI routes: `response_model` + typed body (no `request.json()`, Gate 6c) +
      `.fitness/ui-contract-endpoints.txt` lines (Gate 6b); regen schema.d.ts (Gate 1)
- [ ] dashboard route is read-only + degrades per-section (never 500s the landing page)
- [ ] review_count uses `items.due_concepts` (pure read), NEVER `/queue` (which mints)
- [ ] no new `.js` (Gate 6e); no frozen god-file grew (Gate 6a); no `any` in web/src/api
- [ ] calm: no streaks/scores; empty states plain
