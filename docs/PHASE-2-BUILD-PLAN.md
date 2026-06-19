# Phase-2 Build Plan & Handoff

> **The single source of truth for "where are we and what's next" on the Phase-2
> tutoring build.** A fresh agent should be able to read this + the frozen spec
> (`docs/SPEC-phase-2-tutoring-ux.md`) + the ADRs and continue the work without
> any prior conversation context.
>
> - Spec (acceptance layer, FROZEN v1.0): `docs/SPEC-phase-2-tutoring-ux.md` —
>   12 Gherkin features; scenarios ARE the acceptance criteria; build order in §7.
> - Decisions: `docs/adr/0004-course-model.md`, `docs/adr/0005-ensemble-graph.md`
>   (+ 0001 foundation, 0002 verifiability gates, 0003 corpus schema).
> - Agent rules + architecture: `CLAUDE.md`.
> - History (slice-by-slice narrative, prior CLAUDE.md): `docs/archive/`.

Date: 2026-06-13

---

## 0. How to execute a slice (the recipe we've been following)

Each slice (or half-slice) is built by **one focused agent** given a detailed
brief, then verified and committed. The loop:

1. **Read first**: `CLAUDE.md`, this plan, the relevant SPEC feature(s), the
   relevant ADR. Study the nearest existing analogue in the codebase before
   writing (e.g. `web/src/features/notes/` for a typed-seam screen,
   `routes/course_routes.py` for a born-small typed router,
   `services/memory/memory_extractor.py` for LLM extraction patterns).
2. **Build backend-first, then frontend** (often split as `Ta`/`Tb`). Keep every
   gate green after each sub-chunk — run `pytest -x` as you go.
3. **Honor the invariants** (CLAUDE.md "one door" section): `owner_scoped` for
   user data; graph access only via `src/graph/` (Gate 6f); model selection only
   via `src/model_router.py` (declare a task profile, never a model name); new
   UI-consumed routes get typed request+response models in `src/request_models.py`
   (`extra="allow"`) on the real OpenAPI seam + an entry in
   `.fitness/ui-contract-endpoints.txt`; no raw `request.json()` (Gate 6c);
   don't grow a frozen god-file (extract a small helper module instead).
4. **Tests are not optional** (ADR 0002): pytest for backend logic, vitest for
   frontend units, **a Playwright e2e per screen** named after the Gherkin
   scenario it proves. All API-mocked, following the existing `web/e2e/*` patterns.
5. **Regenerate the contract** after any UI-consumed route change:
   `python scripts/openapi-export.py && cd web && bun run gen:api` →
   `bunx tsc --noEmit` must stay clean.
6. **Full verify before done**: `pytest -m "not quarantine"`,
   `bash .fitness/run-all.sh`, `cd web && bunx tsc --noEmit && bun run lint &&
   bun run test && bun run e2e` — ALL green.
7. **Commit per slice** with a tight factual message + test counts, then push
   (SSH — the gh OAuth token lacks `workflow` scope):
   `GIT_SSH_COMMAND='ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/tmp/known_hosts_gh' git push origin main`.
8. Append a one-paragraph build-status line to this file's §2 table and move on.

**Tip:** large slices were run as background `general-purpose` agents with a brief
mirroring §3 below. That works well; just verify their report's claims by
re-running the gates yourself before committing.

---

## 1. Health snapshot (must stay green)

| Check | Command | Last known good |
|---|---|---|
| Backend tests | `.venv/bin/python -m pytest -q -m "not quarantine"` | **2348 passed, 1 skipped** (T4 + T5 dashboard + miner in) |
| Fitness gates | `bash .fitness/run-all.sh` | **6a–6f all pass** |
| TS types | `cd web && bunx tsc --noEmit` | clean |
| Lint | `cd web && bun run lint` | clean |
| Vitest | `cd web && bun run test` | **205 passed** (+ T5 dashboard + miner) |
| Playwright | `cd web && bun run e2e` | **33 passed, 2 skipped** (+ T5 dashboard + miner) |
| Contract | `python scripts/openapi-export.py && cd web && bun run gen:api` | 269 paths, no drift |

`mkdir -p data` before running backend tests (the data dir must exist).

---

## 2. Slice status

| Slice | Scope | Status |
|---|---|---|
| **T0** | Slice-7 demolition: delete CUT features, retire `static/`, drop dead tables | ✅ done |
| **T1** | Courses: tables, `owner_scoped` (Gate 5), course routes, tabs + onboarding + landing | ✅ done |
| **T2a** | Library backend: corpus wired, `corpus_routes`, materials + tags, **model router v1**, grounded chat + citations SSE | ✅ done |
| **T2b** | Library/materials UI, citation chips, **webcam capture**, router settings panel | ✅ done |
| **T3a** | Ensemble graph backend (ADR 0005): tables, seeding, mastery (BKT-lite), extractor, consolidation, `student_context` assembler (focus tier), `graph_routes`, **Gate 6f** | ✅ done |
| **T3b** | Progress UI: state-colored concept tree, trajectory timeline, overrides, challenge-an-insight | ✅ done |
| **T4** | Practice engine: review queue + Gym + calibration + exam sim + explain-it-back + **periphery tier** + coupling mute | ✅ **done** — T4a backend (engines, periphery, explain-persona, 10 typed routes, daily `assemble_review_queue` builtin; adversarially reviewed, 4 high-sev bugs fixed w/ regressions; pinned decisions in `docs/T4-CONTRACT.md`) + T4b frontend (`web/src/features/practice/`: Review/Gym/Exam/Calibration/Explain screens + shared hooks, registered in the window manager + router, vitest + 5 Playwright specs). Follow-ups deferred to §7: explain `mark_explained` after-turn trigger (extractor-side); coupling-mute write UI (T5/persona). |
| **T5** | Dashboard + todos + schedule miner + persona/dial + integrity + Cmd-K + cost meter + session-summary notes | 🚧 **vertical 1 done** — todos (`todo` table + typed CRUD), the read-only `/api/dashboard` aggregator (review-count/weak-spots/insights/reading; `recent_insights` graph door; never-500, no-mint, Gate-6f clean), and the Dashboard landing surface (`web/src/features/dashboard/`: cards deep-linking calendar/todos/Review/Gym/Progress/PDF/resume, `useGymStore` weak-spot→Gym preload, login-lands-on-dashboard). Adversarially reviewed (5 bugs fixed w/ regressions). Pinned decisions: `docs/T5-DASHBOARD-CONTRACT.md`. **Vertical 2 (schedule miner, F2) done** — `src/schedule/` engine + `routes/schedule_routes.py` (`POST /api/schedule/{id}/mine` read-only extraction + diff; `POST .../apply` the only writer), `CalendarEvent.provenance` column, idempotent re-mine via content-hash `proposal_key` + occurrence ordinal, ambiguity asked-not-guessed; frontend `web/src/features/schedule/` confirm-first review sheet (prune/edit/resolve, provenance chips) from a "Mine schedule" button on a material. Adversarially reviewed (5 bugs fixed incl. single-user event-dup + bad-date-500). Pinned: `docs/T5-MINER-CONTRACT.md`. **Remaining T5 verticals:** persona/dial + integrity (F10), Cmd-K global search (needs a new search backend), cost meter (F7), session-summary notes (F9), typed math (F4). |
| **T6** | Worksheet grading contract + graph hook + **canvas workspace** | ⬜ not started (§6) |
| **X** | Cross-cutting: Gate-7 tutor evals, backend-prep follow-ups, @later seams | ⬜ ongoing (§7) |

---

## 3. What "done" looks like per SPEC feature (coverage map)

| SPEC Feature | Built in | Remaining |
|---|---|---|
| F1 Courses + calibration | T1 (courses); **calibration → T4** | calibration flow |
| F2 Library + materials + schedule miner | T2a/T2b (library, materials, tags, webcam); **schedule miner → T5** | schedule miner |
| F3 Grounded chat + citations | T2a/T2b | — |
| F4 Worksheets + webcam + canvas | T2b (webcam); **grading contract + canvas → T6** | grading depth, canvas |
| F5 Ensemble graph | T3a/T3b | — (extraction quality watched by Gate-7, §7) |
| F6 Focus/periphery context | T3a (focus); **periphery + mute → T4** | periphery tier, coupling mute |
| F7 Model router | T2a/T2b; broader call-site adoption ongoing | adopt in chat/grading/gen as slices land |
| F8 Review + Gym + exam + explain | **→ T4** | all of it |
| F9 Calendar/notes study instruments | exists (Phase-1 screens); **course-binding + session-summary → T5** | session-summary notes |
| F10 Persona + dial + integrity | **→ T5** | all of it |
| F11 Dashboard + todos + Cmd-K + cost meter | **→ T5** | all of it |
| F12 @later seams | **→ §7** | mobile PWA, ntfy, backup/export, Anki |

---

## 4. T4 — Practice engine + periphery (IN PROGRESS)

**SPEC:** Feature 8 (all three blocks: review queue, Gym, exam simulation,
explain-it-back), Feature 1 calibration scenario, Feature 6 periphery scenarios.
**Decisions:** §6 Q4 (review answered in a chat-style surface), Q7 (periphery =
shared nodes + 1-hop, ≤1 line/course, ~15% budget), Q8 (mute-only).

### 4.1 Already scaffolded (untested, unwired — validate before extending)
- `src/practice/__init__.py` — package docstring laying out the intended submodules.
- `src/practice/store.py` — `data/practice_keys.json` TTL store: server-side
  grading keys (reference answers **never** serialize to the client), plus exam /
  calibration / explain-session state. Atomic writes, pruned on load.
- `src/graph/queries.py` — the graph's **public read/write API** for non-graph
  subsystems (so the practice engine stays inside Gate 6f). Plain dicts/tuples out,
  no ORM leakage; `record_evidence` wraps the mastery write door.

These import cleanly and the suite is green, but they have **no tests and no
callers yet**. First task: write tests for them (or adjust them as you build the
consumers) — don't trust unexercised code.

### 4.2 T4a — backend (remaining)
Build `src/practice/` per the `__init__` map and route them:

- **`items.py`** — `due_concepts(owner, course_id?, limit)`: rank non-mastered
  concepts by weakness + staleness (use `src/graph` effective-p; calendar reads
  are fine — calendar isn't a graph table) with **exam-aware weighting** (a
  `calendar_event` within 14d for the course lifts that course's shaky
  prerequisites). `item_for_concept(concept, mode, difficulty)`: prefer REAL
  corpus chunks (`kind in problem|exercise|try_it` under the concept's heading
  subtree), strip paired solution text; fall back to router-generated
  (`tier=standard`, structured) only when the library is dry; `None` if no LLM
  either. Item carries a server-side `reference_answer` kept in `store.py`, NEVER
  in the response. `grade_answer(item_key, answer, mode)`: router `tier=micro`
  structured verdict `{correct|partial|incorrect, feedback_short, study_citation?}`;
  no-LLM fallback = normalized-string match or "ungraded"; writes mastery evidence
  via `graph/queries.record_evidence` (context.source = review|gym|exam|calibration).
- **`gym.py`** — adaptive next-item: 2 consecutive correct → difficulty+1; 2 wrong
  → difficulty−1 **and** verdict carries a study citation; coach's-pick (no
  concept) = worst shaky-with-errors; **never** picks mastered concepts as filler.
- **`calibration.py`** — F1 optional warm-up: ordinal walk plan (~10 concepts
  across the region), skip-ahead on correct streak / step-down on miss; finish sets
  `course.settings.calibrated_at`. Skippable by simply not calling.
- **`exam.py`** — scope-weighted mixed-topic assembly (ids+prompts only; NO
  per-item grading mid-exam — silent until submit); submit → full debrief
  (per-item verdicts + citations, readiness summary), evidence source=exam. State
  in `store.py` with TTL.
- **`explain.py`** — create a chat session flagged (session metadata)
  `mode=explain` + concept; the chat pipeline injects a **curious-student** persona
  block (tutor plays student, probes gaps, never lectures until the explanation
  stands/stalls). Reading/typing only (voice rejected). Ensure the explain
  session's concept reaches the graph extractor shortlist so `explained` evidence lands.
- **`schemas.py`** — typed request/response models for the routes (kept here, NOT
  in `src/request_models.py`, which is near its Gate-6a ceiling).
- **`routes/practice_routes.py`** (typed, owner_scoped, ui-contract): `GET
  /api/practice/queue?course_id=` + `POST /queue/answer`; `POST /gym/next` + `POST
  /gym/answer` (returns running set summary); `POST /calibration/start|answer|
  finish`; `POST /exam/start|submit`; `POST /explain/start`.
- **Review-queue scheduled action** — builtin `assemble_review_queue` (daily
  default, registered like `graph_consolidation`); fire the existing notification
  path (study `builtin_actions.py`; do not invent a new notification system).

### 4.3 T4 — periphery tier (fills the T3a stub)
In `src/student_context.py`, implement `periphery_tier(owner, focus_course_id)`:
other **active** courses whose regions share a node (same `concept_node.id` via
normalized-name reuse, or a 1-hop assertion between region nodes); **one line per
coupled course** ("also enrolled: <course> — currently on <frontier concept>,
which connects via <shared concept>"); cap ~15% of the token budget; respect
`course.settings.coupling_mutes`. Tests: shared-node coupling detected, mute
suppresses, budget cap, no-overlap courses absent, focus-dominance preserved.
The flagship scenario (Calculus 1 ↔ calc-based Physics) is the acceptance test.

### 4.4 T4b — frontend
- **Review** screen (F8): `GET /queue`, one item at a time, course-labeled,
  answer in a chat-style surface (text or photo via the F4 path), verdict +
  citation chip (reuse `library/PdfViewer` door), writes land silently.
- **Gym** screen (F8): topic / coach's-pick picker → adaptive set; difficulty
  visibly adapts; study citation on struggle; set summary; photo/typed/canvas
  (canvas is T6 — wire the hook, text+photo now). A dashboard "weak spot" card
  will deep-link here (T5).
- **Exam** screen (F8): start (duration, n), timed, silent, submit → debrief with
  readiness readout.
- **Explain** mode (F8): entered from a concept (Progress) or offered for a
  plateaued node; opens an explain-flagged chat session.
- **Calibration** (F1): optional step in course onboarding/landing ("show me where
  you are, ~10 min, skip anytime").
- **Typed math input** (F4) belongs to T5 polish but the answer surfaces here
  should leave room for it.
- Tests: vitest for each flow + Playwright `e2e/practice.spec.ts` (queue answer +
  verdict), `e2e/gym.spec.ts` (weakness-first + adaptivity), `e2e/exam.spec.ts`
  (timed → debrief), plus the periphery grounding assertion in a chat e2e.

---

## 5. T5 — Dashboard, todos, planning, persona, search

**SPEC:** Features 11 (dashboard), 9 (session-summary notes), 10 (persona + dial +
integrity), 2 (schedule miner), 7 (cost meter), 4 (typed math). **Decisions:**
Q12 (todo table), Q13 (fixed card layout v1), Q14 (confirm-first miner).

- **Todo model** (ADR-0004): `todo` table (id, course_id?, text, due_date?,
  done_at?, source `manual|miner|tutor`, provenance?, owner?) + typed
  `routes/todo_routes.py` (CRUD + done-toggle, owner_scoped, real seam).
- **Schedule miner** (F2): read a schedule-shaped upload (the material's chunks) →
  router structured extraction → **proposed** calendar events + todos in a review
  sheet (bulk accept/prune/edit); idempotent re-upload **diffs** (content-hash);
  ambiguity asked not guessed; every created row provenance-linked to the page.
  Confirm-first (untrusted-content invariant). Backend action + a review-sheet UI.
- **Dashboard** (F11): the login landing surface. Cards (fixed curated layout):
  today's calendar + due/overdue todos + review-queue count + "resume where you
  left off"; reading recommendations (graph frontier + exam date → "read §X, pp.
  N–M" → opens PdfViewer at page); weak-spot card → opens Gym preloaded; momentum
  strip (recent insights as plain sentences → concept trajectory); mini-chat widget
  (tier=light, shares the session with the full chat tab — "open in full chat"
  carries it, never forks); quick todo capture. **Calm** — no streaks/XP; empty day
  states it plainly. Login routes here (not to chat).
- **Cmd-K global search** (F11): across courses, notes, materials, sessions, todos,
  and graph concepts; front door on the existing KEEP-set search backend + a
  concepts query. Picking a result opens the right surface.
- **Persona + adaptivity dial** (F10): tutor profile schema (reuse
  `preset_manager` + skills); per-course override stored in `course.settings`
  (scaffolding / pace / tone); course-type-shaped default behavior; the **integrity
  stance** scenario (full answers on explicit request; no moralizing/refusing;
  pedagogical framing) baked into the default persona.
- **Session-summary notes** (F9): after a substantive session, an action drafts a
  course note (covered / clicked / shaky / citations) the user can edit.
- **Cost meter** (F7): extend the router observability panel with tokens +
  estimated cost per feature; running cloud-spend estimate.
- **Typed math input** (F4): a LaTeX-backed equation field beside text/canvas in
  chat/gym/review/exam answer surfaces; renders in the transcript.

---

## 6. T6 — Worksheet grading depth + canvas

**SPEC:** Feature 4 (grading scenarios + canvas block). **Decision:** Q15 (canvas
= PNG submit + stroke-JSON sidecar; plain `<canvas>` + Pointer Events).

- **Worksheet grading contract**: deepen the F4 line-referenced grading (what's
  right, where the FIRST error is, a nudging question in guide mode, cite the
  section for the mistaken concept) and ensure results write graph evidence +
  spawn a follow-up review item.
- **Canvas workspace** (`web/src/features/canvas/` or a `components/Canvas`):
  Pointer-Events draw surface (mouse / drawing pad / stylus with pressure),
  templates (blank/ruled/grid/coordinate axes), pen/eraser/undo/clear. Opens from
  chat composer, a gym problem, or as a standalone tool window. **One-click
  "send to tutor"** → submits as an image through the existing `/api/upload` →
  attachment path (same VL grading as a photo). Revise→resubmit as distinct
  attempts (v1, v2) in the same conversation. Persist as PNG + stroke-JSON sidecar
  (a course material) → reopens editable. iPad works via browser today (Pointer
  Events); the `companion/` pairing bridge for live tablet input is @later.
- Tests: vitest (Pointer-Events capture, template render, submit payload, persist/
  reopen), Playwright `e2e/canvas.spec.ts` (draw → submit → graded; the no-secure-
  context path is already covered for webcam).

---

## 7. Cross-cutting (do alongside, not a blocking slice)

- **Gate 7 — tutor evals** (ADR-0005 §Consequences, SPEC §5.7): a golden-set eval
  harness for the LLM *behaviors* the spec promises (never fake a citation, honesty
  marker when ungrounded, extraction precision, weakness-first composition). Fixed
  scenarios run against configured models, scored, tracked. **Informational first**
  (reuse the Gate-2 quarantine playbook), gate later. Lands naturally once the T4
  extraction/grading call sites exist.
- **Backend-prep follow-ups** (from Phase-1 SPEC): P-T2 (more response_models),
  P-T4 (slim to ~35 agent tools), P-T6 (split `model_routes.py` / `agent_loop.py`
  god-files — unblocks typing those hand-typed seams). P-T3 (cut-feature pollers)
  is largely moot post-demolition.
- **`owner_scoped` enforcement gate**: a Gate-6-family check that no new ad-hoc
  `.filter(owner == ...)` is added, and migrate the ~20 legacy ones. Gate 5 helper
  exists; the *gate* doesn't.
- **Providers UX**: edit base_url in place (today: delete + re-add); auto-append
  `/v1` for Ollama.
- **@later seams** (SPEC F12, only when core is solid): mobile PWA (dashboard +
  review + mini-chat, installable), ntfy push nudges (the compose stack already has
  ntfy), **backup/export** (scheduled `data/` snapshot + per-course export — the
  graph is the first irreplaceable data this app creates; raise priority right
  after T4–T6), Anki export of review items.
- **Multi-student** (SPEC F12): flip `owner_scoped` to load-bearing; the `owner?`
  columns are already on every Phase-2 table.

---

## 8. Quick reference — Phase-2 routes & tables already in place

**Tables** (all owner-nullable): `courses`, `course_source`; `corpus_source`,
`corpus_chunk` (ADR 0003, now in `init_db`); `concept_node`, `entity_node`,
`assertion`, `mastery_evidence`, `mastery_state` (ADR 0005); `course_id` columns on
`sessions`/`notes`/`calendar_events`.

**Routes** (typed, real OpenAPI seam, owner_scoped): `course_routes`,
`corpus_routes` (sources/toc/pdf/search/materials/tags), `router_routes`
(config/resolution/log), `graph_routes` (concepts tree/detail/override/observations/
challenge).

**Stores added**: `data/router.json` (router config), `data/router_log.jsonl`
(decisions), `data/practice_keys.json` (grading keys — partial), `data/corpus/`
(uploaded material PDFs + assets).

**Key modules to study before extending**: `src/model_router.py`,
`src/student_context.py`, `src/graph/{mastery,extractor,seeding,queries}.py`,
`src/corpus/{course_search,grounding,importers/upload_importer}.py`,
`routes/course_routes.py` (the born-small typed-router template),
`web/src/features/{courses,library,progress}/` (the freshest UI patterns).
