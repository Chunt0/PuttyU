# CLAUDE.md — agent context for PuttyU

**PuttyU** ("putty university", *"your patient tutor"*) is a self-hosted AI
**tutoring workspace**: a curated textbook/classics **library** as a grounded
source of truth (RAG with page citations), a per-student **memory graph** that
tracks mastery over time, course-scoped study, practice, and an Odysseus-grade,
typesafe UI. **Permanently single-student** — one student per instance; a
privileged admin/tutor (parent) role may come later, a second student never
(SPEC §2).

## Status — read `docs/STATUS.md` first

**Live state (current chunk, what's done, what's next) lives in
`docs/STATUS.md`** and is updated in the same commit as each chunk — this file
states only stable truths. The build proceeds milestone by milestone (SPEC §9),
chunk by chunk (`docs/M0-PLAN.md`); the planning docs are the spec, the gate
harness (`.fitness/`, ADR-0002) is the enforcement.

## The prime directive: build in digestible chunks

The owner reviews as the build proceeds. **Work in small, reviewable increments:**

- **One milestone at a time** (SPEC §9). Within a milestone, ship the **smallest
  vertical slice** that can be demoed and reviewed.
- **Pause and surface for review at each slice** — do not run ahead. Get sign-off
  before starting the next chunk.
- **All gates green before moving on** (ADR-0002). Adding a feature *means* adding
  the test/contract/model/gate that keeps it honest.
- The **SPEC is the north star, not a build list.** Do **not** try to build toward
  the full feature set. Build the current chunk, then stop and check in.

This is the explicit antidote to how the previous attempt (`OLD-REF/`)
over-scoped and got out of hand.

## Read order (for a new session)

1. **this file**, then `docs/STATUS.md` — where the build actually is
2. `SPEC.md` — vision, hard rules, features F1–F12, milestone roadmap + Definition
   of Done (§9.1), resolved/open decisions (§13)
3. `docs/DESIGN-M0-M1.md` — the concrete first build: schema, API, SSE contract,
   chat loop, ingestion, frontend shell, failure modes, build order
4. `docs/M0-PLAN.md` — **the chunked M0 build plan** (start here to build) + the
   cross-cutting tech decisions (SSE typing, LLM test mocks, serving, pinning)
5. `docs/adr/0001`–`0004` — foundation & auth · verifiability gates · corpus +
   catalog + embeddings · course & data model
6. `docs/LEARNING-SCIENCE.md` — best practices for tutoring (the evidence base; BKT,
   spacing, validity, viz) distilled from `resources/`
7. `docs/TUTOR-PROMPT-ARCHITECTURE.md` — pedagogy-as-prompts (how the science is
   baked into every tutor prompt, verified by Gate 7)
8. `docs/DESIGN-SYSTEM.md` — the **putty-ai-design** visual system (authoritative)
9. `THREAT_MODEL.md` — security surfaces & the untrusted-content invariant

## The reference folders are a knowledge base — mine them, don't ship them

All are **gitignored, local-only, reference material** (not part of the build):

- **`ODYSSEUS-REF/`** — the self-hosted AI workspace we **clone for UX**, and a
  **wealth of working implementations to learn from.** **Frontend fidelity is a
  hard rule:** the UI must be *essentially a clone of Odysseus in look, feel, and
  interaction* (layout, dockable window manager, slash commands, Cmd-K palette,
  streaming feel, keyboard interactions), **skinned with the putty-ai-design kit**
  — we clone the *chrome and interaction model, not the feature set* (SPEC §6).
  *Before building any surface, open `ODYSSEUS-REF/` and match how it behaves.*
  It also has battle-tested patterns for the **agent loop / harness**, **agentic
  tool abilities + MCP**, **SSE streaming**, **slash commands / command palette**,
  and full feature backends — **calendar, notes, tasks/todos, documents,
  research, sessions, settings**. Reuse the *approach* (re-implemented typesafe in
  our React/TS + FastAPI stack), not code verbatim. (It's FastAPI + a vanilla-JS
  SPA — map its ideas onto ours.)
- **`OLD-REF/`** — the previous tutoring build: rich vision docs **plus real
  implementations** of the **corpus importer, ensemble graph, practice engine,
  schedule miner, and student-context assembler**. Mine it for the
  tutoring-specific *how-to* — but it **over-scoped**, so take ideas, not its
  architecture wholesale.
- **`putty-ai-design/`** — the design system we port from (see `DESIGN-SYSTEM.md`).
- **`resources/`** — the learning-analytics lecture library (distilled into
  `LEARNING-SCIENCE.md`).
- **`textbooks/`** — the content library the corpus ingests (~12 GB).

**Rule of thumb:** when you build the calendar, todos, the agent loop, MCP,
streaming, or any workspace surface, **grep `ODYSSEUS-REF/` first** (and
`OLD-REF/` for tutoring pieces) — there is a lot there that will save time.

## Hard product rules (owner directives — do not relitigate)

- **One student, permanently** — never multi-student; a privileged admin/tutor
  (parent) role may be added later (SPEC §2, F12/O15). Depth for one, not
  breadth for many.
- **Reading is the medium** — no TTS/STT, ever.
- **Untrusted-content invariant** — every model-derived write (events, todos,
  tags, graph assertions) is a **proposal the user confirms**, never silent.
- **Calm, not gamified** — no streaks/XP/leaderboards; **no social comparison**.
- **The student is the author** — the tutor never moralizes, surveils, or refuses
  coursework; full answers on explicit request; framing stays pedagogical.
- **The student outranks the inference** — insights are confidence-scored and
  challengeable; no hidden student model.

## The spine: one-door invariants + mechanical gates

- **Three one-doors:** user data → `owner_scoped`; the graph → `engines/graph/`; model
  selection → `engines/model_router` (call sites declare a *task profile*, never a
  model name).
- **Gates from M0** (ADR-0002): typed OpenAPI contract (CI fails on drift),
  pytest, bun test + Playwright, `tsc --strict` + ESLint, file-size ceiling,
  `response_model` on UI routes, no raw `request.json()`, no cross-feature
  imports, **TS-only (no new JS)**, graph one-door, router one-door, and Gate 7
  tutor-evals.
- **Learning science is structural, not decorative:** mastery = per-concept **BKT**
  (clamp P(G)<0.3, P(S)<0.1) recomputed from an **append-only `interaction_event`
  log** (logged from M0); spaced review = half-life regression; the tutor's
  prompts are composed + Gate-7-verified (`TUTOR-PROMPT-ARCHITECTURE.md`).

## Architecture (target)

- `backend/` — Python 3.11+, FastAPI. `app.py` (slim orchestrator), `routes/`
  (HTTP layer), `core/` (db/auth/middleware), `engines/` (domain logic: `llm/`,
  `model_router.py`, `corpus/`, `graph/`, `student_context.py`, `practice/`,
  `schedule/`, `tutor/prompts/`), `tests/`, `scripts/`. The corpus CLI runs
  from `backend/` (`python -m engines.corpus …`).
- `web/` — React 19 + TS (strict) + Vite, toolchain **Bun**. `src/app` (shell,
  router, window manager, theme), `src/features` (one folder per screen),
  `src/components`, `src/api` (generated client + SSE helpers).
- SQLite (canonical) + **embedded** Chroma (vectors); model router over Anthropic
  (Claude) + local Ollama. **Linux only.** Single process, single owner.

## Running / testing

The root **`Makefile` is the executable documentation** — commands live there,
docs point here:

- `make dev-backend` / `make dev-web` — the two dev processes (Vite proxies `/api`).
- `make gates` — every deterministic gate (`bash .fitness/run-all.sh`); same
  entrypoint CI runs. **Deterministic gates block CI; LLM/tutor evals (Gate 7)
  run on-demand against a configured model** (no API keys in CI → never a
  blocking CI job).
- `make contract` — regenerate `openapi.json` + `schema.d.ts` after any
  UI-consumed route change (Gate 1 fails on drift otherwise).
- Git: push via SSH (`git@github.com:Chunt0/PuttyU.git`). Reference dirs
  (`OLD-REF/`, `ODYSSEUS-REF/`, `putty-ai-design/`, `resources/`, `textbooks/`)
  are gitignored.

## Next step

See **`docs/STATUS.md`** — always the current chunk of `docs/M0-PLAN.md`,
built in digestible, reviewed increments with all gates green.
