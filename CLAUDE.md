# CLAUDE.md — agent context for this repo

This is a **fork of an upstream self-hosted AI workspace** (see `ACKNOWLEDGMENTS.md` for
attribution) being converted into a **tutoring app**. Read this before making changes. Authoritative decisions live in
`docs/adr/` and `docs/SPEC-phase-1-lean-core.md`. The Phase-2 tutoring UX is
**FROZEN at v1.0 and under active implementation** (owner delegated all §6 decisions —
resolved as their proposed options; ADR-0004 course model + ADR-0005 ensemble graph
accepted; SPEC §7 T0–T6 is the build order; T0/Slice-7 demolition DONE 2026-06-12):
`docs/SPEC-phase-2-tutoring-ux.md` (—
courses-as-tabs, library grounding w/ citations, the **ensemble memory graph** [one
temporal graph per student: verbatim stated observations + LLM-inferred insights, both
episode-cited, bi-temporal invalidate-never-delete, Graphiti-style semantics on SQLite
proposed — research refs in its §5], the student-context protocol [every user-context
LLM call reads the graph through one assembler; focus course dominant, coupled courses
as bounded periphery], the **model router** [call sites declare a task profile —
micro/light/standard/deep/vision — never a model name; resolves against configured
providers (Anthropic API, Ollama) with degradation + observability; extends
`endpoint_resolver`'s purpose-chain], practice both ways [review queue pushes; the
**Gym** pulls — graph-calibrated, weakness-first problem sets], and the **dashboard**
login surface [today's calendar + todos (new small model) + reading recs deep-linking
PDFs at the page + mini-chat sharing the session with full chat], and **course-material
uploads** [syllabi/homework/any PDF, owner-scoped beside the library, user tags steering
retrieval, schedule miner proposing calendar events + todos from syllabus dates —
confirm-first, idempotent re-upload diffs], plus **webcam document capture** [any upload
surface; multi-page→one PDF; secure-context hint] and the **canvas workspace** [Pointer
Events draw surface — mouse/drawing pad/stylus w/ pressure; templates incl. coordinate
axes; one-click submit-as-image to the tutor; revise/resubmit attempts; PNG + stroke-JSON
persistence; iPad via browser now, `companion/`-paired later]. v0.9 adds: calibration
flow, exam simulation + explain-it-back, typed math input, Cmd-K global search, cost
meter, integrity stance, Gate-7 tutor evals + the untrusted-content invariant (§5), and
@later seams (mobile PWA, ntfy nudges, backup/export, Anki). **Hard owner rules: no
fictional persona names ("the user"); VOICE REJECTED — no TTS/STT, the user must read.**)

**Product name: `puttyU`** ("putty university"). The new `web/` frontend is rebranded —
wordmark `puttyU` + the coral putty-blob mascot, slogan "your patient tutor". Design comes
from the **putty-ai-design** kit (a gitignored working dir at `/putty-ai-design/`): a
near-monochrome identity (ink `#0e0e10` canvas, panels lift lighter, white headings) with a
single **coral `#e06c75`** accent (links/active-nav/icons + `--accent-solid #c2454f` for
text-on-coral CTAs). Type: **Inter** (UI) + **Fira Code** (mono), self-hosted in
`web/public/fonts/`. Tokens live in `web/src/app/shell.css` `:root` (mirrors the kit's
`colors_and_type.css`); component rules use the `var(--token)`s (NOT hardcoded hex) so themes
re-skin everything. Rules: sentence-case (avoid title-case headings), no emoji-as-UI, no
gradients, coral is the *only* accent.
**Themes:** the full kit theme set (18 — putty mono + 17 others) is in `web/src/app/themes.css`
as `:root[data-theme="<key>"]` blocks (that specificity beats `:root` so themes win); a
`<select>` ThemePicker (`web/src/app/ThemePicker.tsx`) + `useThemeStore` (zustand, persists to
`localStorage` `puttyu-theme`, applies `data-theme` on `<html>`) lets the user switch. The kit's
`--fg` is bridged to the app's `--text` in `:root[data-theme]`.
**Backend rebrand (done, TOTAL — 2026-06-12):** every trace of the old brand is renamed; the
owner accepted breaking persisted data ("rebuild brand new if necessary"). FastAPI
`title="puttyU"`; banners/logs → puttyU; env vars are `PUTTYU_*` ONLY (`core/app_env.py` no
longer falls back to the legacy prefix — old `.env` files must be updated); the docker compose
service is `puttyu`; the systemd unit is `puttyu-ui.service`; CLI scripts are
`scripts/puttyu`/`scripts/puttyu-*`. The former "internal contracts" were renamed too:
HTTP headers are `X-PuttyU-*`, the email markers are `"Reminder (puttyU)"`/`"puttyu-ui"`,
the ChromaDB collections are `puttyu_memories`/`puttyu_rag` (old vector collections are
orphaned — re-index to rebuild), and the TOTP issuer is "puttyU" (existing authenticator
entries keep working; only the displayed label on new enrollments changes). Do NOT
reintroduce the old name anywhere except the legal attribution in `LICENSE` and
`ACKNOWLEDGMENTS.md`, which must stay (MIT notice-preservation).

## What we are doing (the short version)

- **Keep the Python backend.** It is the strong, tested, ecosystem-anchored asset. Do NOT
  rewrite it to another runtime. (ADR 0001)
- **Rewrite the frontend** in **TypeScript + React + Vite**, toolchain **Bun**, `strict`
  on. The old `static/` vanilla-JS frontend (no types/tests/build, scattered state) was
  replaced screen by screen and retired in Slice 7.
- **TypeScript ONLY — zero JavaScript at the end state.** No new `.js/.jsx/.mjs/.cjs`
  anywhere (even tooling configs → `.ts`, e.g. `eslint.config.ts`). The legacy `static/`
  tree is deleted (Slice 7); the only allowlisted JS left is `.github/scripts/`, frozen in
  `.fitness/js-allowlist.txt` and enforced by **Gate 6e** (`no-javascript.sh`); the goal is
  an empty allowlist. New JS fails CI.
- **Lean-down is frontend-led (strangler).** A backend feature dies when the new UI stops
  calling it; delete its backend code lazily afterward, guarded by tests. Do NOT do
  upfront subtractive surgery on entangled features.
- **No premature backend optimization.** No measured bottleneck exists.
- **Ubuntu Linux ONLY (server or desktop).** Windows/macOS portability has been removed to
  cut complexity. `core/platform_compat.py` is collapsed to POSIX/Linux (its public API +
  `IS_WINDOWS = False` constant are kept so callers import unchanged). Do NOT reintroduce
  cross-OS branches. **Still-dead non-Linux code remains** (lazy cleanup, like CUT features):
  the deferred Cookbook/serving cluster (`services/hwfit/_detect_windows`/`_detect_apple_silicon`,
  `cookbook_routes.py`/`fit.py` `if IS_WINDOWS`/Darwin branches) — remove when that feature is
  cut/rebuilt (hwfit/cookbook = DEFER). The legacy `static/` frontend (incl. its `IS_MAC`/AltGr
  code) was deleted in Slice 7. Deleted: `launch-windows.ps1`, `update_windows.bat`,
  `start-macos.sh`, `build-macos-app.sh`.

## The prime directive: verifiability (ADR 0002)

Invariants are **mechanical gates**, never conventions — an agent forgets conventions but
cannot bypass a failing build. Six gates (must block merge once established):
1. Typed OpenAPI client (frontend ↔ backend contract; fail on drift).
2. pytest green + **required** — ✅ DONE. Blocking in CI (`-m "not quarantine"`); suite is
   green (2400 passing). Flaky tests get the `quarantine` marker (pyproject.toml) →
   informational job, never a return to `continue-on-error`.
3. Vitest + Playwright; no screen merges without a critical-flow test.
4. `tsc --noEmit --strict` + ESLint.
5. `owner_scoped(query, Model, user)` is the only way to scope user data (built now,
   load-bearing once multiple students share an instance — v1 is single-user).
6. Bash fitness functions (`.fitness/`): 6a file-size ceiling (no god-files), 6b every
   UI-consumed route has a `response_model`, 6c no raw `request.json()` in new routes, 6d
   no cross-feature imports into the lean core, **6e no JavaScript** (TS-only, shrinking
   `js-allowlist.txt`).

When adding code, add the test/contract/model that keeps these green. That IS the work.

## Architecture map (backend — kept)

- `app.py` — slim orchestrator: middleware stack (CORS → SecurityHeaders →
  RequestTimeout(45s) → Auth), ~50 routers, lifespan boots MCP + scheduler + bg-monitor.
- `core/` — `database.py` (SQLAlchemy, ~21 tables, **ad-hoc startup migrations, no
  Alembic**), `auth.py`, `session_manager.py`, `middleware.py`, `atomic_io.py`.
- `src/` — the engines: `llm_core.py` + `endpoint_resolver.py` + `model_*` (multi-provider
  LLM), `agent_loop.py` + `tool_*` + `mcp_manager.py` (agent/tools/MCP), `memory*` +
  `rag*` + `embeddings.py` + `chroma_client.py` (memory/RAG), `deep_research.py` +
  `visual_report.py`, `task_scheduler.py` + `builtin_actions.py` + `event_bus.py`.
- `routes/` — thin-ish HTTP adapters, `setup_*_routes(deps) -> APIRouter`, wired in
  `app.py`. Managers built centrally in `src/app_initializer.py`.
- `services/` — facades over `src/`. Some are shims (`src/search` → `services/search`
  via `sys.modules` swap; `services/memory/memory.py` re-exports `src.memory`). Canonical
  homes differ per subsystem — check the shim docstring before importing.

State lives across **4 stores**: SQLite (`data/app.db`), JSON files (`auth.json`,
`sessions.json`, `settings.json`, ...), ChromaDB (vectors, optional — degrades to
keyword), and the filesystem (uploads, media). Single-process assumption throughout.

## Known hazards (do not be surprised by)

- **God-files**: `tool_implementations.py` (204KB), `agent_loop.py` (165KB),
  `email_routes.py` (155KB), `task_scheduler.py`/`builtin_actions.py` (~107KB),
  `database.py` (90KB), `llm_core.py` (85KB). Split the ones you touch; don't grow them.
- **Ownership is by convention** today (~20 hand-written `.filter(owner == user)`). Gate 5
  replaces this — use `owner_scoped`, never re-introduce ad-hoc filters.
- **Entanglement**: email/calendar/notes/documents wire into the agent loop, scheduler,
  `builtin_actions`, and codex routes. `chat_handler` needs `document_processor` for image
  analysis — do NOT naively cut documents. codex must go before/with email/calendar.
- **Startup side-effects**: email poller, default email/calendar/note scheduled tasks —
  disable when leaning down.

## Scope map (Phase 1) — see the SPEC for detail

- **KEEP (new UI):** auth, chat+sessions, agent+tools+MCP (slim default tools),
  multi-provider LLM + model management, memory+RAG/corpus+embeddings, deep research,
  task scheduler, settings, uploads, search, **calendar/CalDAV**, **notes**, **documents**
  (incl. `document_processor` — handwritten-work/image analysis).
- **DEFER (backend dormant, no UI):** Cookbook/local serving.
- **CUT (delete lazily):** email, gallery+image-gen, contacts,
  webhooks, vault, compare, codex/claude, tts/stt, signature, emoji, font, editor drafts,
  backup, admin_wipe.
  > **Scope correction (2026-06-05):** `calendar/CalDAV`, `notes`, and `documents` were moved
  > to KEEP — the owner considers them core to the tutoring app (lesson scheduling, lesson
  > notes, worksheets/student-work analysis). `documents` was promoted from DEFER → KEEP (its
  > `document_processor` image-analysis is a tutoring killer feature). All three have new-UI
  > screens pending and must NOT be deleted in Slice 7. Tools `manage_calendar`,
  > `manage_notes`, `manage_documents` move to KEEP. Nothing was ever deleted; this is a plan
  > correction. **Tier-1 tutoring features (mastery model, corpus grounding, tutor persona)
  > are deferred for now per the owner.** Re-validate any other "CUT" item before acting.

## Tutoring north star (later phases, for context)

Built on three new things: a **curated corpus** (new `src/corpus/` subsystem + `corpus`
ChromaDB collection + `corpus_source`/`corpus_chunk` tables — two-store design, shared/
read-only, source-type-agnostic; **see `docs/adr/0003-corpus-schema.md`** for the full
schema, the Marker-textbook importer, and chunking rules), a **tutor persona** (presets +
skills + system prompt — mostly reuse), and a **student progress / mastery model** (new
table; copy the `services/memory/memory_extractor.py` pattern — LLM extracts structured
state from turns, fires an event, persists; scheduler drives spaced repetition).

**Build status (everything below committed + green in CI on `dev`):**

- **Corpus subsystem built** (`src/corpus/`: `records`+`chunker`+`models`+`importers/`+
  `indexer`+`retriever`+`__main__` CLI), test-first vs `example-textbook/statistics/` (49
  tests). `python -m src.corpus <dir>` (idempotent; `--no-embed`). Tables via
  `ensure_corpus_tables()` — NOT yet wired into `init_db` (no corpus UI until Slice 3).
  Known limit: ~6 Marker-merged Homework "tables" are single unsplittable chunks.
- **Slice 0 done** — `web/` scaffold (Vite 6 + React 19 + TS strict + Bun, vitest 3) +
  the verifiability gates live in CI: Gate 1 (OpenAPI drift via `scripts/openapi-export.py`
  → `gen:api` → committed `web/src/api/schema.d.ts`), Gate 2 (pytest required, `quarantine`
  marker), Gates 3/4 (vitest+playwright / tsc+eslint), Gate 6 (`.fitness/` bash funcs +
  frozen allowlists). Gate 5 (`owner_scoped`) NOT built yet.
- **Slice 1 done** — Auth + Chat vertical. `response_model`s added to auth/session/history
  (in `src/request_models.py`, `extra="allow"` so no field-drop). `streamChat` in
  `web/src/api/streaming.ts` parses the real SSE (`{delta}` / `{type}` / `[DONE]`). Login /
  Chat / Sessions screens; TanStack Query (server state) + Zustand (`currentSessionId`).
- **Slice 2 done** — Providers screen (`web/src/features/models/`): add/enable/disable/
  delete endpoints, default-model picker; session creation now uses the default model so
  chat works. Provider endpoints are **hand-typed** (model_routes.py is a frozen god-file;
  typing the seam there needs a P-T6 split — see follow-ups). **Validated end-to-end
  against a real Ollama** (see [[ollama-dev-endpoint]]).
- **Slice 3 done** — Memory + Corpus (personal-docs/RAG) vertical. `response_model`s added
  to `routes/memory_routes.py` (GET `/api/memory`, POST `/add`, POST `/search`, DELETE
  `/{id}`), `routes/personal_routes.py` (GET `/api/personal`, POST `/upload`, DELETE
  `/file`), `routes/embedding_routes.py` (GET `/models`, `/endpoint`) — all in
  `src/request_models.py` with `extra="allow"`, behaviour unchanged. These routes were
  **under the file-size ceiling and not frozen**, so they go through the real OpenAPI seam
  (typed `openapi-fetch` client) — unlike Slice 2's hand-typed provider seam. Screens:
  `web/src/features/memory/` (list/add/search/delete) + `web/src/features/corpus/`
  (upload/list/remove + active-embedding-model readout). Form/multipart endpoints (search,
  upload) use `postForm`/`postFormData` helpers; the rest are typed GET/POST/DELETE. New
  test helper `callInfo`/`findCall` in `web/src/test/util.tsx` normalises openapi-fetch
  `Request`-shaped calls vs raw `(url, init)`. Vitest (Memory + Corpus) + Playwright
  (`e2e/memory-corpus.spec.ts`) green; 9 endpoints added to `ui-contract-endpoints.txt`.
  **Scope decision:** the SPEC (S3-T3) scopes the new `src/corpus/` *tutoring* corpus OUT
  of Phase 1 — Slice 3 wires only the existing personal-docs RAG path; `src/corpus/`
  (routes + management UI + `init_db` wiring) is deferred to the tutoring phase. Upload UI
  kept metadata-extensible for that importer.

- **Slice 4 done** — Agent-mode UI, **frontend-only** (no backend/contract changes: the
  `/api/chat_stream` SSE already drives the agent loop via `mode=agent` and emits
  `tool_start`/`tool_output`/`plan_update`). `web/src/features/chat/agentSteps.ts` is a pure,
  unit-tested reducer that folds those control events into renderable tool steps (pairs
  `tool_output`→`tool_start` by most-recent running `(tool, round)`); `Chat.tsx` adds an
  **Agent** toggle (+ a **Plan (read-only)** sub-toggle that sends `plan_mode`, which the
  backend enforces as a read-only tool set) and renders steps (tool name · command · output ·
  exit-status) inline for the live turn, kept visible as a footer until the next send (history
  doesn't persist tool steps). Agent mode opts into `allow_bash`/`allow_web_search` (added to
  `ChatStreamRequest`; default-off server-side). Vitest (reducer + a component agent-turn) +
  `e2e/agent-turn.spec.ts` green.

- **Slice 5 done** — Deep Research vertical. `response_model`s added to `routes/research_routes.py`
  (POST `/api/research/start` → `ResearchStartResponse`, GET `/status/{id}` →
  `ResearchStatusResponse`, GET `/library` → `ResearchLibraryResponse`; all in
  `src/request_models.py`, `extra="allow"`, lenient/defaulted so a persisted dict with a
  loosely-typed key never 500s — e.g. library `rounds` is `int | str`). The **stream** (SSE)
  and **report** (HTML) are NOT in the typed client: `streamResearch(sessionId)` in
  `streaming.ts` (a GET-SSE sibling of `streamChat`) yields `ResearchProgress` events
  (phase planning→searching→reading→analyzing→writing, terminal on `final`/status), and the
  report renders in an `<iframe src="/api/research/report/{id}">`. Screen
  `web/src/features/research/` starts a job, watches streamed progress, auto-opens the report,
  and lists past runs (click → report). A bare `{query}` start works — the backend resolves
  the model from defaults (research→utility→default→chat→first endpoint), 400ing only if no
  provider exists. Vitest + `e2e/research.spec.ts` green; 3 JSON endpoints added to
  `ui-contract-endpoints.txt`.

- **Slice 6 done** — Task scheduler UI. `routes/task_routes.py` is a **frozen god-file at its
  1125-line ceiling**, so (like Slice 2's `model_routes.py`) the seam is **hand-typed** — no
  backend changes, endpoints NOT in `ui-contract-endpoints.txt`. `web/src/features/tasks/`:
  `types.ts` (hand-typed Task/TaskRun/meta), `api.ts` (useTasks, useTaskMeta, create/update/
  delete/run/pause-resume, useTaskRuns), `TaskForm.tsx` (create/edit a **scheduled** task —
  type llm/research/action, prompt or `/meta/actions` action, schedule daily/weekly/monthly/
  once/cron, `/meta/output-targets`), `Tasks.tsx` (list + run/pause/resume/edit/delete +
  expandable per-task runs). New `postJson` helper in `api/forms.ts`. **All three trigger
  types**: schedule (daily/weekly/monthly/once/cron), **event** (`/meta/events` + fire-every-N
  count), and **webhook** (minted POST-to-fire URL + regenerate). Vitest + `e2e/tasks.spec.ts`
  green. **Follow-up:** typing the tasks seam needs a `task_routes.py` split (P-T6-class, like
  model_routes).

- **Slice 6.5a done** — Calendar UI (KEEP). Hand-typed seam (`calendar_routes.py` frozen at
  1404). `web/src/features/calendar/`: `types.ts` (CalendarEvent/Calendar/CalDAVConfig — note
  the dt conventions: all-day = `YYYY-MM-DD`, timed-local naive, timed-UTC `…Z`; recurring
  events expand server-side to instances w/ compound `uid` + `series_uid`), `api.ts`
  (useEvents(range), useCalendars, create/update/delete event, CalDAV config/sync/test/save),
  `EventForm.tsx` (create/edit — title, all-day, start/end, calendar, location, notes, RRULE;
  edits hit the whole series via `series_uid`), `Calendar.tsx` (month nav + events-grouped-by-
  day agenda + a CalDAV panel: connect form / status + Sync). Vitest + `e2e/calendar.spec.ts`.
- **Slice 6.5b done** — Notes UI (KEEP). `note_routes.py` is **NOT frozen** (741 lines), so this
  goes through the **real OpenAPI seam** (response_models in `request_models.py`: `NoteResponse`/
  `NoteListResponse`; list/create/update/delete/pin/archive typed; 6 endpoints in
  `ui-contract-endpoints.txt`). `web/src/features/notes/` (typed `openapi-fetch` client):
  list/create/edit/delete, pin, archive, active/archived views. Vitest + `e2e/notes.spec.ts`.

- **Slice 6.5c done** — Documents UI (KEEP). Hand-typed seam (`document_routes.py` frozen at
  1687). `web/src/features/documents/`: `types.ts`/`api.ts` (library w/ search, get one, create,
  versioned update, delete/archive, versions+restore, **PDF import**), `Documents.tsx` (library
  + search + create + PDF import), `DocEditor.tsx` (content editor → versioned Save, version
  list + restore, archive, delete). Note: **no standalone image-analysis endpoint** —
  scanned/handwritten work gets VL text extraction via PDF import (or chat attachments). Vitest
  + `e2e/documents.spec.ts`.

- **UX polish pass done (2026-06-10)** — closes the biggest gaps vs the legacy frontend,
  frontend-only (zero backend changes). New shared kit in `web/src/components/`:
  `Markdown.tsx` (react-markdown + remark-gfm + rehype-highlight; code-copy buttons; raw
  HTML NOT rendered; syntax palette derived from theme tokens in shell.css so all 18 themes
  re-skin code), `ConfirmButton.tsx` (two-step arm→confirm destructive button — replaces
  every bare one-click delete across memory/corpus/notes/tasks/calendar/documents/providers/
  sessions; its aria-label stays stable while armed), `toast.ts`+`Toasts.tsx` (zustand toast
  stack, outlet in Shell), `Spinner.tsx` (replaces bare "Loading…" text app-wide). Chat:
  assistant turns render as markdown (user turns stay verbatim), per-message hover copy,
  **stop-generation** (abort → resync history, no error), auto-scroll-unless-scrolled-up,
  session-name+model header, tutor-framed welcome empty state, and **attachments** (`+`
  button / drag-drop → immediate upload to `/api/upload`, image-thumb chips, ids sent as
  `attachments` JSON on `/api/chat_stream` — the worksheet/handwritten-work analysis path).
  Sessions: inline rename (dbl-click or pencil; PATCH `/api/session/{sid}` form `name`) +
  two-step delete (clears selection if current). `patchForm` added to `api/forms.ts`.
  Vitest 79/79, Playwright 11/11 (chat-flow spec needed `exact: true` — session rows now
  have hover-action buttons), tsc/eslint/fitness gates all green.

- **Window manager done (2026-06-10)** — legacy modalManager parity, frontend-only.
  `web/src/app/windows/`: `windowStore.ts` (zustand: open/close/focus-z/minimize/move/
  resize/setDock; geometry persisted per tool to localStorage `puttyu-windows`),
  `FloatingWindow.tsx` (pointer-drag header w/ live DOM updates + one store commit on
  release; corner resize; drag near a viewport edge → snap preview → dock), `tools.tsx`
  (key→screen registry), `WindowLayer.tsx` (renders windows + bottom dock bar of minimized
  chips; docked panels publish `--docked-left/right` consumed by `.shell-main` margins).
  **Sidebar nav now opens tools as windows over the live chat** (buttons, not links —
  active = window open); the full-page **routes remain** for deep links (/calendar etc.).
  Docked-left panels offset 220px to clear the sidebar. e2e nav clicks are
  `getByRole("button", { name, exact: true })` (window chrome adds "Minimize Notes" etc.
  that substring-match). Vitest 91/91 (+store/+layer), Playwright 13/13 (+`windows.spec.ts`
  with real mouse drag + snap-dock), tsc/eslint/fitness green.

- **Slice 7 done (2026-06-12)** — CUT features deleted (codex, email, gallery+image-gen CLI,
  contacts, outbound webhooks, vault, compare, tts/stt, signature, emoji, font, editor drafts,
  backup, admin_wipe), ~28 CUT tools removed/de-exposed, legacy `static/` retired (Gate-6e
  allowlist → 1 CI entry), dead DB tables dropped (`email_accounts`, `gallery_albums`,
  `gallery_images`, `comparisons`, `signatures`, `webhooks`, `editor_drafts` — idempotent
  `_migrate_drop_cut_feature_tables()` in `core/database.py`; their model classes + dead
  email/signature migrations deleted too; `Document.source_email_*` columns kept — the
  ad-hoc pattern has no column-drop precedent), stored-signature stamping excised from
  `document_routes.py`/`pdf_forms.py`/`pdf_form_doc.py` (PDF form *field* filling +
  text/check annotation stamping KEEP; signature fields render `_(unsigned)_`), OpenAPI
  contract regenerated (375 → 249 paths). pytest 2046 passed; Playwright 18/18 (+1
  intentionally-skipped snapshot-capture spec); vitest 103/103; tsc/eslint/fitness green.

- **Phase-2 T1 done (2026-06-12)** — courses vertical (ADR 0004, F1 minus calibration):
  `Course` + `course_source` tables in `core/database.py` + nullable `course_id` on
  sessions/notes/calendar_events (`_migrate_add_course_id_columns`, ad-hoc pattern);
  **Gate 5 landed** — `owner_scoped(query, Model, user)` in `src/auth_helpers.py`
  (legacy `(owner == user) | (owner IS NULL)` semantics, no-op for falsy user) used by all
  course queries + pinned by `tests/test_owner_scoped.py`. `routes/course_routes.py` born
  typed (250 lines): list/create/get/patch + archive/unarchive (status flip, data retained)
  + GET/PUT `/sources` (link-table replace; validated against `corpus_source` only when
  that table exists, else verbatim + `note`) — 8 endpoints on the real OpenAPI seam
  (`ui-contract-endpoints.txt` 23→31). `POST /api/session` takes `course_id` (validated
  via `routes/course_helpers.py` — session_routes is at its 6a ceiling), `GET /api/sessions`
  returns it + filters by `?course_id=`, history response carries it. Frontend:
  `web/src/features/courses/` (typed hooks; `useCourseStore` persists `puttyu-active-course`,
  null = Home), course tab strip in the shell (Home + active courses + "+" menu w/ create +
  manage/unarchive; ConfirmButton archive), F1 onboarding ("What are you studying right
  now?", free-form, skippable), course landing pane (name + honest "No library sources
  linked" chip + course chats), sidebar/new-chat scope to the active tab. pytest 2060
  (+14); vitest 113/113 (+10); Playwright 19 passed +1 skipped (+`courses.spec.ts`; two
  older specs got `exact: true` — the "+" tab name substring-matched "Add"); tsc/eslint/
  fitness green.

**ALL KEEP SCREENS EXIST + Slice 7 demolition complete** → Phase 1 is done. Next: Phase-2
tutoring UX (see `docs/SPEC-phase-2-tutoring-ux.md`).

**Open follow-ups (not yet done):** SPEC backend-prep P-T2 (more response_models) / P-T3
(disable cut-feature startup pollers) / P-T4 (slim to 35 tools) / P-T6 (split
`model_routes.py`/`agent_loop.py` god-files — unblocks typing the provider seam); migrate
legacy hand-written owner filters to `owner_scoped` (Gate 5 built in Phase-2 T1; a 6-style
fitness gate for it is still unwritten); Providers "edit base_url" in place (today:
delete+re-add); backend auto-append `/v1` for Ollama. Not built: tutor persona, mastery
model, video importer, course calibration (F1, T4).

## Running / testing

- Backend (kept): `python -m uvicorn app:app --host 127.0.0.1 --port 7000`; tests
  `python -m pytest -q` (data dir must exist: `mkdir -p data`).
- Corpus: `python -m src.corpus example-textbook/statistics --no-embed` (build/test data).
- Frontend (new): standard Bun + Vite (`bun install`, `bun run dev`, `bun test`) once
  scaffolded. CI: `.github/workflows/ci.yml` — syntax checks + **required** pytest gate
  (Gate 2 done; `-m "not quarantine"`) + informational quarantine job. Gates 1,3,4,6 still
  to land with the frontend scaffold.
