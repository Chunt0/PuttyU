# T4 build contract — practice engine (authoritative for this slice)

> Working build doc for **T4** (SPEC F8 practice + F1 calibration + F6 periphery).
> Read order for a T4 build agent: `CLAUDE.md` → `docs/PHASE-2-BUILD-PLAN.md` §4
> → the relevant SPEC F8/F1/F6 scenarios → **this file** (the pinned decisions,
> condensed seam APIs, and file-ownership plan). The seam APIs below were verified
> against the live code on 2026-06-18; trust them but `grep` to confirm line moves.
>
> **Every gate stays green after your chunk** (CLAUDE.md prime directive). Use the
> project venv (`.venv/bin/python`), `mkdir -p data` first.

---

## 0. Pinned decisions (deterministic — do NOT re-litigate)

These resolve the judgment calls the build plan left open. They are frozen for T4.

- **D1 — verdict → mastery signal (1:1).** A grade verdict `correct|partial|incorrect`
  maps directly to the mastery `signal` of the same name. `explained` is written
  ONLY by explain-mode. `override_*` is Progress-UI only (already shipped T3b).
- **D2 — evidence weight = 1.0 for all practice sources in v1.** partial/explained/
  hint_used dampening is ALREADY in `mastery._SIGNAL_RULES`; do not double-dampen.
  The `weight` knob is reserved (leave at default 1.0). Always pass `context["source"]`
  = `review|gym|exam|calibration` and an `episode_ref`.
- **D3 — `due_concepts` ranking** (review queue). For each candidate concept:
  `weakness = 1 - effective_p` (use `P_INIT=0.2` when `effective_p is None`);
  `staleness = clamp(days_since_last_evidence / 21, 0, 1)` (21 = decay half-life;
  None → 1.0); `foundational = min(prereq_out_degree / 3, 1)`.
  `score = 0.5*weakness + 0.3*staleness + 0.2*foundational`. Rank desc, cap `limit`
  (default 10). **Candidates = concepts that HAVE evidence (`last_evidence_at != None`)
  AND are non-mastered (`effective_p < 0.8`).** The daily push never quizzes
  never-seen concepts (that's the tutor's job in chat). The Gym MAY include
  unknown-in-scope concepts the user explicitly picks.
- **D4 — exam-aware lift.** If the course has a calendar event within **14 days**
  whose `summary` matches `(?i)\b(exam|midterm|final|quiz|test)\b` (no exam field
  exists — title heuristic is the v1 rule), multiply `score` by **1.5** for
  concepts with `effective_p < 0.8`.
- **D5 — gym adaptive difficulty.** `difficulty ∈ {1..5}`, start at **2**.
  2 consecutive correct → +1 (cap 5); 2 consecutive wrong → −1 (floor 1) AND the
  verdict carries a study citation. Never pick a mastered concept as filler.
  Coach's-pick (no topic) = the shakiest concept that also has `error_counts > 0`.
- **D6 — `item_for_concept` sourcing.** Prefer REAL corpus chunks with
  `kind in (EXERCISE, TRY_IT)` (NOTE: `PROBLEM`/`SOLUTION` are reserved and NOT
  emitted by the v1 chunker — do not query them) whose `heading_path` is under the
  concept's heading subtree, scoped via `course_source_ids`. Try to split a
  reference answer out of the chunk text on a `Solution|Answer` heading; the prose
  before it is the prompt, after it is the server-side `reference_answer`. If no
  split, the whole chunk is the prompt and `reference_answer` is empty. Fall back
  to router-generated (`tier=standard`, structured JSON) only when the library is
  dry; return `None` if no LLM is configured.
- **D7 — `grade_answer` no-LLM fallback.** If no LLM: normalized-string match
  against `reference_answer` (`correct`/`incorrect`) when a key exists, else verdict
  `ungraded` (writes NO evidence). With an LLM: `tier=micro`, structured verdict
  `{verdict: correct|partial|incorrect, feedback_short, study_citation?}`.
- **D8 — calibration on an empty region.** If `course_concept_shortlist` is empty
  (no library / no concepts), `calibration.start` returns a benign state
  `{status: "no_region", message: "No library concepts to calibrate yet — the
  graph warms up as you study."}` and writes nothing. Skippable everywhere.
- **D9 — exam state + timer.** Exam state lives in `store.py` section `exams`
  (TTL 24h): `{items: [{key, concept_id, prompt}], started_at, duration_seconds,
  submitted_at?}`. **Reference answers stay in the per-item store keys, never in the
  start response.** The tutor is SILENT until submit (no grading mid-exam). Timer is
  client-side; v1 enforces no hard server cutoff. On submit (or client time-expiry
  posting submit): grade each answered item, write evidence `source=exam`, return a
  debrief (per-item verdict + citation + a readiness summary). Unanswered items are
  reported as `skipped` and write no evidence.
- **D10 — periphery tier.** Coupling = another **active** course whose region shares
  a concept node (same `ConceptNode.id`) with the focus region, OR a 1-hop assertion
  between a focus-region node and an other-region node (shared-node is the primary
  v1 mechanism; 1-hop is best-effort). Emit **one line per coupled course**:
  `"also enrolled: <course> — currently on <frontier concept>, which connects via
  <shared concept>"`. Cap total periphery at ~15% of the char budget (the caller
  passes `budget_chars`). Honor `course.settings["coupling_mutes"]` — a list of
  course_ids muted from THIS focus course's periphery. (Conversational "stop
  bringing X into this" appends X's course_id to the focus course's
  `coupling_mutes`; reversible in course settings — the write side is T5/Persona,
  but periphery_tier MUST already respect the list.)

---

## 1. Condensed seam APIs (copy these call patterns)

### 1a. Graph mastery — the ONE write/read door (`src/graph/queries.py`, `src/graph/mastery.py`)
Gate 6f: the practice package may touch the graph ONLY through `src.graph.queries`
(+ `mastery.state_of` for interpreting a state row). Never import graph models for
querying; never raw-SQL the graph tables.
```python
from src.graph import queries
from src.graph.models import episode_ref            # episode_ref(type, id) -> {"type","id"}

# Write evidence (returns derived (state, effective_p) — plain values):
state, eff_p = queries.record_evidence(
    concept_id, "correct",                           # correct|partial|incorrect|hint_used|explained
    weight=1.0, episode_ref=episode_ref("task_run", run_id),
    context={"source": "gym", "difficulty": 2},
    owner=owner, db=db)                              # ALWAYS pass owner; pass db or None

# Reads (all owner-aware; plain dicts/tuples out):
queries.region_concepts(db, course_id, owner)        # -> list[dict] {id,name,heading_path,ordinal,sources}
queries.states_for(db, ids)                          # -> {id: (state, effective_p|None, last_evidence_at|None)}
queries.prereq_out_degree(db, ids)                   # -> {id: int}
queries.error_counts(db, ids, owner)                 # -> {id: int}   (count of 'incorrect')
queries.concept_brief(db, concept_id, owner)         # -> dict | None  (includes state, effective_p)
```
- Region/shortlist of concept ORM nodes (ordinal/book order, cap 60):
  `from src.graph.extractor import course_concept_shortlist` →
  `course_concept_shortlist(db, course_id, owner) -> list[ConceptNode]`. This is the
  closed world for picking practice targets. (It's allowed for `src/practice` to call
  this read-only helper since it returns through the graph package; but prefer
  `queries.region_concepts` for plain dicts where you don't need ORM fields.)
- `mastery.state_of(state_row) -> (state, effective_p)`; states `unknown|learning|shaky|mastered`;
  `MASTERED_MIN=0.8`, `SHAKY_MIN=0.55`, `P_INIT=0.2`, decay half-life 21d.
- **ensure tables:** if you open your own `db` and write, call
  `from src.graph.models import ensure_graph_tables; ensure_graph_tables()` first
  (the `db=None` path auto-ensures, the injected-`db` path does not).

### 1b. Corpus item sourcing (`src/corpus/course_search.py`, `retriever.py`, `models.py`, `records.py`)
```python
from src.corpus.course_search import course_source_ids   # (db, course_id, user) -> list[str]
from src.corpus.models import CorpusChunk                  # id, source_id, ordinal, kind,
                                                           # heading_path(JSON list), text, locator(JSON), meta
from src.corpus.records import Kind                        # Kind.EXERCISE="exercise", Kind.TRY_IT="try_it"
ids = course_source_ids(db, course_id, owner)
q = (db.query(CorpusChunk)
     .filter(CorpusChunk.source_id.in_(ids or [""]),       # [""] guard — never empty IN
             CorpusChunk.kind.in_([Kind.EXERCISE, Kind.TRY_IT])))
# heading_path is JSON -> filter the subtree in Python: c.heading_path[:len(prefix)] == prefix
```
- **GOTCHA: `Kind.PROBLEM`/`Kind.SOLUTION` are reserved and not emitted today.**
  Real practice items = `EXERCISE` + `TRY_IT`. Upload materials emit only `PROSE`.
- Page locator: `chunk.locator` is `{"kind":"page","start":N,"end":M}` or None.
- Citation dict shape (match the chat stream contract): `{chunk_id, source_id, title,
  heading, page_start, citation}` — build via `course_search.chunk_item(...)` (drop
  `text` before returning). Inline label: `grounding.citation_label(...)` →
  `[Title §Heading, p. N]`.
- Relevance-ranked variant: `retriever.search(query, k, where={"source_id":{"$in":ids}})`
  then hydrate + Python-filter by `kind`. Neighbors: `retriever.expand(db, source_id, ordinal, radius)`.

### 1c. Model router — declare a need, never a model (`src/model_router.py`, `src/llm_core.py`)
```python
from src import model_router
from src.llm_core import llm_call_async
from src.graph.extractor import parse_extraction         # tolerant JSON -> dict | None  (reuse it)

routed = model_router.resolve(
    model_router.TaskProfile(tier="micro", output_shape="structured", latency="interactive"),
    owner=owner, legacy_prefix="utility")                 # "research"/"deep" for heavy
if not routed.endpoint_url or not routed.model:
    return None                                           # THE no-LLM guard (text never raises/None)
raw = await llm_call_async(routed.endpoint_url, routed.model,
    [{"role": "system", "content": SYSTEM_PROMPT_REQUIRING_JSON},
     {"role": "user", "content": user_block}],
    temperature=0.1, max_tokens=800, headers=routed.headers, timeout=60)
parsed = parse_extraction(raw)                            # None on failure -> degrade
```
- Tiers: `micro|light|standard|deep` (NO `vision` tier). `output_shape="structured"`
  is **advisory only** — you must instruct JSON in the prompt and parse it yourself.
- **Vision** (photo-answer grading) = `modality="vision"`, and it **RAISES**
  `model_router.RouterError` when no VL model is configured — wrap in try/except and
  surface the setup hint; never grade blind. Image message = OpenAI-style
  `{"type":"image_url","image_url":{"url":"data:image/png;base64,..."}}`.
- Grading/items are `latency="interactive"` micro/standard; generation `standard`.

### 1d. Typed route + contract (`routes/course_routes.py` is the template)
```python
# routes/practice_routes.py
from fastapi import APIRouter, Request, HTTPException
from core.database import SessionLocal
from src.auth_helpers import effective_user             # writes evidence -> attribute to real owner
from src.practice.schemas import QueueResponse, AnswerRequest, AnswerResponse, ...

def setup_practice_routes() -> APIRouter:
    router = APIRouter(prefix="/api/practice", tags=["practice"])

    @router.get("/queue", response_model=QueueResponse)
    def review_queue(request: Request, course_id: str | None = None):
        user = effective_user(request)
        db = SessionLocal()
        try:
            ...
            return {...}                                  # plain dict validated vs response_model
        finally:
            db.close()
    return router
```
- Collection paths use `@router.get("")`/`@router.post("")` (empty string, no trailing slash).
- `owner_scoped(db.query(Model), Model, user)` for any owner-scoped table read (Course,
  sessions, calendar via its own join). The graph goes through `queries`, never owner_scoped.
- Schemas (Pydantic) live in **`src/practice/schemas.py`** with
  `model_config = ConfigDict(extra="allow")`. NEVER add to `src/request_models.py`
  (near its Gate-6a ceiling). Never use `request.json()` (Gate 6c) — typed body params.
- Wire in `app.py` (inline import, bottom, after the graph block ~line 635):
  `from routes.practice_routes import setup_practice_routes` /
  `app.include_router(setup_practice_routes())`.
- Add each UI-consumed route to `.fitness/ui-contract-endpoints.txt` as `METHOD /api/practice/...`.
- Regenerate + commit the contract:
  `.venv/bin/python scripts/openapi-export.py && (cd web && bun run gen:api)` → commit
  `web/src/api/openapi.json` + `web/src/api/schema.d.ts` (CI fails on drift).
- Errors: `HTTPException(404, ...)` (ownership) before `HTTPException(400, ...)` (body).

### 1e. Daily builtin action (`src/builtin_actions.py`, `src/task_scheduler.py`, `routes/note_routes.py`)
```python
# src/practice/review_queue.py
async def action_assemble_review_queue(owner: str, **kwargs):
    try:
        # for each active course (owner_scoped Course query), build the queue via items.due_concepts,
        # cache it, then nudge the user ONCE/day:
        from routes.note_routes import dispatch_reminder
        await dispatch_reminder(title="Review ready", note_body=f"{n} items due",
                                note_id=f"review-{owner}-{ymd}", owner=owner or "")
        return f"Review queue: {n} items across {k} courses", True
    except Exception as e:
        return f"Review queue failed: {e}", False
```
- Register in EXACTLY three spots (mirror `graph_consolidation`; assert all three in a test):
  1. `src/builtin_actions.py` `BUILTIN_ACTIONS["assemble_review_queue"] = action_assemble_review_queue`
  2. `src/builtin_actions.py` `BUILTIN_ACTION_INFO["assemble_review_queue"] = "Assemble the daily review queue ..."`
  3. `src/task_scheduler.py` `HOUSEKEEPING_DEFAULTS["assemble_review_queue"] = {"name": "Review Queue",
     "schedule": "cron", "scheduled_time": None, "cron_expression": "0 7 * * *", "legacy_names": []}`
- Builtins don't auto-notify → call `dispatch_reminder` yourself; `note_id` is the
  dedupe key (use a per-day synthetic id). `raise TaskNoop("nothing due")` for the
  empty case (re-raise it before `except Exception`). No `app.py` change needed —
  startup seeding picks up the new default.

### 1f. Calendar reads (`core/database.py` CalendarEvent/CalendarCal)
```python
from datetime import timedelta
from core.database import CalendarEvent, CalendarCal, utcnow_naive
now = utcnow_naive(); horizon = now + timedelta(days=14)
events = (db.query(CalendarEvent).join(CalendarCal).filter(
    CalendarCal.owner == owner,                    # owner is on the CALENDAR, not the event
    CalendarEvent.course_id == course_id,
    CalendarEvent.status != "cancelled",
    CalendarEvent.dtstart >= now, CalendarEvent.dtstart < horizon
).order_by(CalendarEvent.dtstart).all())
# exam heuristic: re.search(r"(?i)\b(exam|midterm|final|quiz|test)\b", ev.summary or "")
```
- All datetimes are naive; use `utcnow_naive()` (never aware `datetime.now(tz)`).
  Single-user owner falls back to `FALLBACK_OWNER` ("owner@localhost") when unauth'd
  in the calendar routes; in builtins/practice use the passed `owner` (`owner or None`).
- Calendar is NOT a graph table — direct queries fine, no `owner_scoped` helper here
  (owner scoping is the `CalendarCal.owner` join).

### 1g. Explain-mode session + persona injection (the chat-helpers ceiling hazard)
- `Session.mode` (free string, `core/database.py:129`) — set to `"explain"`, NO migration.
  Stash `concept_id` in the session `headers` JSON bag (`core/database.py:106`) — NO migration.
- Create + bind like `routes/session_routes.py:391` (`session_manager.create_session(...)`
  then `bind_session_course(...)`); set `mode`/`headers["concept_id"]` via a direct
  `DbSession` update (mirror `routes/course_helpers.py:14`).
- **Injection hazard:** `build_chat_context` is in `routes/chat_helpers.py` (NOT
  `src/chat_helpers.py`), a Gate-6a god-file at **912/913 — one line of headroom.**
  Do NOT add a multi-line block there. Instead:
  1. New module `src/explain_persona.py` → `maybe_explain_persona(session_id, owner,
     course_id=None) -> dict|None` (the curious-student system block; gates on
     `mode=="explain"`; reads `Course.settings` tone like `student_context._profile_lines`;
     never raises; returns None for non-explain/incognito/error).
  2. Add a combiner in `src/student_context.py` (NOT a god-file):
     `course_system_messages(session_id, owner, course_id=None, incognito=False) -> list[dict]`
     returning `[student_context_msg?, explain_msg?]`.
  3. In `routes/chat_helpers.py`, REPLACE the existing 4-line student-context block
     (`from src.student_context import maybe_student_context` … `preface.append(sc_msg)`,
     ~lines 524-527) with the **2-line** call:
     `from src.student_context import course_system_messages` /
     `preface.extend(course_system_messages(session_id, user, course_id, incognito))`.
     Net change is **−2 lines** in the god-file (buys headroom AND adds explain).
  4. Recognize `mode=="explain"` in `routes/chat_routes.py` where `chat_mode` is read
     (~line 396/525) — it should NOT flip `agent_mode`; explain rides normal chat.
- Reading the student model anywhere here goes through `student_context`/`queries`
  only (Gate 6f). The persona block is author-trusted; if it ever quotes the student's
  upload, wrap via `untrusted_context_message(...)`.

### 1h. Frontend (T4b — copy `web/src/features/progress/` wholesale)
- Typed client: `import { api } from "../../api/client.ts"`; TanStack Query hooks in
  `<feature>/api.ts`; `{ data, error } = await api.GET/POST(...)`, throw on
  `error || !data`. Type aliases go in `web/src/api/types.ts`.
- Register a screen: add to `WINDOW_TOOLS` in `web/src/app/windows/tools.tsx` (+ optional
  route in `web/src/app/router.tsx`). Window DOM: `data-testid="window-<key>"`.
- Reuse: `<Markdown>`, `streamChat()` (explain stream), `<CameraCapture onAccept>` +
  `uploadFiles` (photo answers), `openPdf(sourceId,title,page)` / `<CitationChips>`
  (citation door), `<ConfirmButton>`, `toast.*`, `<Spinner>`. Active course:
  `useCourseStore((s)=>s.activeCourseId)`, pass as `course_id`.
- Tests: vitest via `renderWithProviders` + `stubFetch([[substr, handler]])` (specific
  before general); Playwright `web/e2e/<flow>.spec.ts` with `page.route` mocks (general
  first, specific last), `login(page)`, assert scoped to `getByTestId("window-...")`.
  Name each `test(...)` after its Gherkin scenario.

---

## 2. File ownership & build phases (avoid parallel write conflicts)

**Phase A — core (sequential, must be green before B):**
`src/practice/schemas.py` (typed models for the WHOLE route surface) ·
`src/practice/items.py` (`due_concepts`, `item_for_concept`, `grade_answer`) ·
`tests/test_practice_store.py` + `tests/test_practice_queries.py` (validate the existing
`store.py` + `graph.queries` scaffolding — the "don't trust unexercised code" step) +
`tests/test_practice_items.py`.

**Phase B — consumers (parallel; each owns only its own NEW files except B5):**
- B1 `src/practice/gym.py` + `tests/test_practice_gym.py`
- B2 `src/practice/exam.py` + `tests/test_practice_exam.py`
- B3 `src/practice/calibration.py` + `tests/test_practice_calibration.py`
- B4 `src/practice/explain.py` (practice-side flagged-session creation) + `tests/test_practice_explain.py`
- B5 **context-injection** (the ONLY B agent touching shared backend files):
  `src/student_context.py` (`periphery_tier` impl + `course_system_messages` combiner) ·
  `src/explain_persona.py` (new) · the 2-line `routes/chat_helpers.py` edit ·
  the `routes/chat_routes.py` mode recognition · `tests/test_periphery_tier.py` +
  `tests/test_explain_persona.py`.

**Phase C — routes + wiring (sequential, after A+B):**
`routes/practice_routes.py` · `src/practice/review_queue.py` (+ register in
`src/builtin_actions.py` ×2 and `src/task_scheduler.py` ×1) · `app.py` wiring ·
`.fitness/ui-contract-endpoints.txt` · regen `openapi.json`+`schema.d.ts` ·
`tests/test_practice_routes.py` + `tests/test_review_queue_action.py`.

**Shared files — only ONE agent each, never parallel:** `student_context.py` (B5),
`chat_helpers.py` (B5), `chat_routes.py` (B5), `app.py` (C), `builtin_actions.py` (C),
`task_scheduler.py` (C), `ui-contract-endpoints.txt` (C).

---

## 3. Test isolation (parallel agents share the filesystem)
- Patch the practice store path per test: `monkeypatch.setattr("src.practice.store.STORE_PATH",
  str(tmp_path/"practice_keys.json"))` — never let parallel tests write the real
  `data/practice_keys.json`.
- Use an isolated DB exactly like the existing graph tests (`tests/test_graph_*.py`,
  `tests/test_student_context.py`) — copy their fixture (in-memory or tmp sqlite +
  `ensure_graph_tables()`/`ensure_corpus_tables()`); do NOT mutate the shared `data/app.db`.
- Run only YOUR new test file(s): `.venv/bin/python -m pytest -q tests/test_practice_<x>.py`.
  The orchestrator runs the consolidated suite + all six gates in the verify phase.

## 4. Invariant checklist (every agent, before declaring done)
- [ ] graph access only via `src.graph.queries` / `student_context` (Gate 6f)
- [ ] model selection only via `model_router.resolve` + a `TaskProfile`; no model-name literals
- [ ] new owner-scoped table reads use `owner_scoped(...)`; no new ad-hoc owner filters (Gate 5)
- [ ] new UI route has a `response_model`, a typed body (no `request.json()`, Gate 6c),
      and a `.fitness/ui-contract-endpoints.txt` line (Gate 6b)
- [ ] no new `.js/.jsx/.mjs/.cjs` (Gate 6e); no frozen god-file grew past its ceiling (Gate 6a)
- [ ] `.venv/bin/python -m pytest -q <your test files>` green; reference answers NEVER
      serialize to the client (kept in `store.py`)
