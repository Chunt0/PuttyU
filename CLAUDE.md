# CLAUDE.md — agent context for this repo

**puttyU** ("putty university", slogan *"your patient tutor"*) is a self-hosted
AI **tutoring app**, forked from an upstream AI workspace (see `ACKNOWLEDGMENTS.md`)
and being rebuilt into a learning workspace. Single-user in v1; multi-student is a
prepared seam (Gate 5).

**Read order for a new agent:** this file → `docs/PHASE-2-BUILD-PLAN.md` (where we
are + what's next) → `docs/SPEC-phase-2-tutoring-ux.md` (the frozen v1.0 UX spec,
the acceptance layer) → the ADRs in `docs/adr/`. Historical narrative (the full
slice-by-slice build log) lives in `docs/archive/` — don't reconstruct it here.

## Where the project stands (2026-06-13)

- **Phase 1 (lean core + verifiable React frontend rewrite): DONE.** All KEEP
  screens exist in `web/`; the legacy `static/` frontend is retired; CUT features
  are deleted (Slice 7). Spec: `docs/SPEC-phase-1-lean-core.md` (complete).
- **Phase 2 (tutoring workspace): IN PROGRESS.** Spec frozen at v1.0
  (`docs/SPEC-phase-2-tutoring-ux.md`, 12 Gherkin features, build order §7).
  Build plan + live status: **`docs/PHASE-2-BUILD-PLAN.md`** — the source of truth
  for what is built, what is partial, and the detailed remaining slices.
  Done so far: **T0** (demolition), **T1** (courses), **T2** (library + grounding +
  model router + materials + webcam), **T3** (ensemble graph + Progress UI).
  In progress: **T4** (practice engine — partial backend scaffolding only).
- **Health:** `pytest -m "not quarantine"` → **2188 passed, 1 skipped**; web
  **vitest 145**, **Playwright 25 (+1 skipped)**; **all six fitness gates pass**.
  Keep these green — that IS the work (ADR 0002).

## The prime directive: verifiability (ADR 0002)

Invariants are **mechanical gates**, never conventions — an agent forgets
conventions across sessions but cannot bypass a failing build. Adding a feature
means adding the test/contract/model/gate that keeps it honest.

1. **Typed OpenAPI client** — `scripts/openapi-export.py` → `web` `bun run gen:api`
   → committed `web/src/api/schema.d.ts`; CI fails on drift. New UI-consumed
   routes ride this real seam (typed `openapi-fetch`); a few frozen god-file seams
   are hand-typed instead (see Hazards).
2. **pytest required** — blocking in CI (`-m "not quarantine"`); flaky tests get
   the `quarantine` marker (informational job), never `continue-on-error`.
3. **Vitest + Playwright** — no screen merges without a critical-flow e2e.
4. **`tsc --noEmit --strict` + ESLint** — no `any` in `web/src/api`.
5. **`owner_scoped(query, Model, user)`** (`src/auth_helpers.py`) — the only way
   to scope user data. Built and used by all Phase-2 routes. Legacy hand-written
   `.filter(owner == ...)` filters still exist; migrate them, never add new ones.
   (A 6-style fitness gate enforcing this is still unwritten — a follow-up.)
6. **Bash fitness functions** (`.fitness/`, run by `run-all.sh`): **6a** file-size
   ceiling (no god-files; allowlist frozen + non-growing), **6b** every
   UI-consumed route has a `response_model`, **6c** no raw `request.json()` in new
   routes, **6d** no cross-feature imports into the lean core, **6e** no JavaScript
   (TS-only; allowlist down to `.github/scripts/`), **6f** graph tables have one
   door (only `src/graph/`, `src/student_context.py`, `routes/graph_routes.py` may
   touch them).

## The "one door" invariants (Phase-2 architecture spine)

Three subsystems each have exactly one entry point — respect them, they keep the
system reasoned-about and are (or will be) mechanically enforced:

- **User data → `owner_scoped`** (Gate 5).
- **Graph tables → `src/graph/` public API** (Gate 6f). Non-graph code reads the
  student model through `src/graph/queries.py` / `src/student_context.py`, never
  raw SQL on graph tables.
- **Model selection → `src/model_router.py`.** Call sites declare a *task profile*
  (tier `micro|light|standard|deep` + modality + output shape + latency +
  privacy); the router resolves it against configured providers. **No call site
  hardcodes a model name.** Unconfigured → transparent fallback to the legacy
  `endpoint_resolver` chain (behaviour unchanged). Adoption is incremental — only
  the research path and the graph extractor route through it today; chat/grading/
  generation adopt it in later slices.

## Hard product rules (owner directives — do not relitigate)

- **No fictional persona names** in docs/specs/tests — say "the user".
- **Voice is permanently rejected** — no TTS/STT. Reading is the medium; the
  tutor's output is text the user reads, input is typed/drawn/uploaded.
- **The untrusted-content invariant**: everything the model reads from
  user-supplied or fetched content (uploads, syllabi, pages, notes) is untrusted;
  every write derived from it (calendar events, todos, tags, graph assertions) is
  a **proposal or evidence the user confirms**, never a silent action.
- **Calm, not gamified**: no streaks/XP/leaderboards/guilt mechanics. Mastery
  progress and momentum (narrative, not score) are the motivation surface.

## Engineering principles

- **Keep the Python backend** (ADR 0001) — the tested, ecosystem-anchored asset.
  Do NOT rewrite it to another runtime. No premature optimization (no measured
  bottleneck exists).
- **Frontend is TypeScript + React 19 + Vite, toolchain Bun, `strict` on.**
  **Zero JavaScript** at the end state (even configs are `.ts`); new `.js/.jsx/.mjs/
  .cjs` fails Gate 6e.
- **Ubuntu Linux ONLY.** `core/platform_compat.py` is POSIX-collapsed (public API
  + `IS_WINDOWS = False` kept so callers import unchanged). Do NOT reintroduce
  cross-OS branches. Some non-Linux dead code remains in the DEFERred
  cookbook/hwfit cluster (lazy cleanup).
- **Lean-down is strangler-style**: a backend feature dies when the new UI stops
  calling it; delete lazily, guarded by tests.

## Product / design identity

The `web/` frontend uses the **putty-ai-design** kit (a gitignored working dir at
`/putty-ai-design/`): near-monochrome ink `#0e0e10` canvas, panels lift lighter,
white headings, a single **coral `#e06c75`** accent (`--accent-solid #c2454f` for
text-on-coral CTAs). Type: **Inter** (UI) + **Fira Code** (mono), self-hosted in
`web/public/fonts/`. Tokens live in `web/src/app/shell.css` `:root`; component
rules use `var(--token)`s (never hardcoded hex) so themes re-skin everything.
Rules: **sentence-case** headings, **no emoji-as-UI**, **no gradients**, **coral is
the only accent**. 18 themes in `web/src/app/themes.css` (`:root[data-theme=...]`),
switched via `ThemePicker.tsx` + `useThemeStore` (zustand, persists `puttyu-theme`).

**Backend rebrand (done, total):** env vars are `PUTTYU_*` ONLY (no legacy
fallback); HTTP headers `X-PuttyU-*`; ChromaDB collections `puttyu_memories`/
`puttyu_rag`; docker service `puttyu`; systemd `puttyu-ui.service`; CLI
`scripts/puttyu`/`scripts/puttyu-*`; TOTP issuer "puttyU". Do NOT reintroduce the
old brand anywhere except the legal attribution in `LICENSE` / `ACKNOWLEDGMENTS.md`
(MIT notice-preservation).

## Architecture map

### Backend (kept + extended)
- `app.py` — slim orchestrator: middleware (CORS → SecurityHeaders →
  RequestTimeout(45s) → Auth), routers, lifespan boots MCP + scheduler + bg-monitor.
- `core/` — `database.py` (SQLAlchemy, **ad-hoc startup migrations, no Alembic** —
  `_migrate_*` functions in `init_db`), `auth.py`, `session_manager.py`,
  `middleware.py`, `atomic_io.py`.
- `src/` engines — LLM (`llm_core.py`, `endpoint_resolver.py`, `model_router.py`),
  agent/tools/MCP (`agent_loop.py`, `tool_*`, `mcp_manager.py`), memory/RAG
  (`memory*`, `rag*`, `embeddings.py`, `chroma_client.py`), research
  (`deep_research.py`, `visual_report.py`), scheduler (`task_scheduler.py`,
  `builtin_actions.py`, `event_bus.py`).
- **Phase-2 subsystems** (`src/`):
  - `corpus/` — the curated library: `records`/`chunker`/`models`/`importers/`
    (incl. `upload_importer.py` for student materials)/`indexer`/`retriever`/
    `course_search.py`/`grounding.py`. Two-store (SQLite + Chroma `corpus`);
    `ensure_corpus_tables()` wired into `init_db`. ADR 0003. CLI: `python -m src.corpus`.
  - `graph/` — the ensemble student-memory graph (ADR 0005): `models` (5 tables:
    `concept_node`, `entity_node`, `assertion` bi-temporal, append-only
    `mastery_evidence`, derived `mastery_state`), `seeding`, `mastery` (BKT-lite),
    `extractor` (after-turn, router tier=light), `consolidation` (weekly builtin),
    `queries.py` (the public read/write API). `ensure_graph_tables()` in `init_db`.
  - `student_context.py` — THE assembler: `student_context(owner, course_id,
    call_type, token_budget)` builds tiered context (profile → focus → periphery →
    ambient); injected into course-bound chat. Periphery tier is a stub until T4.
  - `practice/` — practice engine, **PARTIAL** (T4 in progress): only `store.py`
    (TTL grading-key store) + `__init__.py` exist; the rest is specced in the build
    plan and not yet built.
- `routes/` — thin HTTP adapters, `setup_*_routes(deps) -> APIRouter`, wired in
  `app.py`. Phase-2 additions: `course_routes`, `corpus_routes`, `router_routes`,
  `graph_routes` (all typed, real OpenAPI seam, owner_scoped).
- `services/` — facades over `src/` (some `sys.modules` shims; check the docstring
  before importing).

### Frontend (`web/src/`)
- `app/` — shell, router, window manager (`windows/`: dockable tool windows +
  registry), theme system, course tab strip.
- `features/` — one folder per screen: `auth`, `chat`, `sessions`, `models`
  (incl. `Routing.tsx`), `memory`, `corpus`, `research`, `tasks`, `calendar`,
  `notes`, `documents`, `courses`, `library` (incl. `PdfViewer`), `progress`.
- `components/` — shared kit: `Markdown`, `ConfirmButton` (two-step deletes),
  `CameraCapture` (webcam), `toast`/`Toasts`, `Spinner`.
- `api/` — generated `schema.d.ts` + typed client + `streaming.ts` (SSE helpers:
  `streamChat` parses `citations`/agent control events).

### State stores (single-process assumption throughout)
SQLite (`data/app.db`), JSON files (`auth.json`, `sessions.json`, `settings.json`,
`router.json`, `practice_keys.json`, …), ChromaDB (vectors — optional, degrades to
keyword), filesystem (uploads, `data/corpus/`).

## Known hazards

- **God-files** (frozen at their Gate-6a ceilings; their UI seams are hand-typed,
  not OpenAPI): `tool_implementations.py`, `agent_loop.py`, `task_routes.py`,
  `model_routes.py`, `calendar_routes.py`, `document_routes.py`. Editing one to add
  a feature usually means extracting a small helper module instead of growing it.
  `chat_helpers.py` sits ~1 line under its ceiling — Phase-2 additions there have
  had to compact existing lines.
- **DEFER cluster** (dormant, no UI, do not delete or rebuild yet): cookbook /
  local model serving (`cookbook_routes.py`, `services/hwfit/`, the de-exposed
  serving tools whose `do_*` impls were kept). Carries the residual non-Linux code.
- **`document_processor`** is load-bearing for chat image analysis — never naively cut.
- **Migrations are ad-hoc** (`_migrate_*` in `init_db`), idempotent, SQLite —
  `DROP TABLE IF EXISTS` is supported, column drops are not (precedent: dead
  `Document.source_email_*` columns left in place).

## Running / testing

- Backend: `mkdir -p data && python -m uvicorn app:app --host 127.0.0.1 --port 7000`;
  tests `.venv/bin/python -m pytest -q -m "not quarantine"` (the `data/` dir must
  exist). Python may not be on bare PATH — use the project venv.
- Corpus build/test data: `python -m src.corpus example-textbook/statistics --no-embed`.
- Frontend: `cd web && bun install && bun run dev`; checks `bunx tsc --noEmit`,
  `bun run lint`, `bun run test` (vitest), `bun run e2e` (Playwright).
- Contract: `python scripts/openapi-export.py && cd web && bun run gen:api` after any
  UI-consumed route change.
- All gates at once: `bash .fitness/run-all.sh`.
- Git push uses SSH (the gh OAuth token lacks `workflow` scope):
  `GIT_SSH_COMMAND='ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/tmp/known_hosts_gh' git push origin main`.
