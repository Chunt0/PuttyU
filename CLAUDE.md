# CLAUDE.md — agent context for PuttyU

**PuttyU** ("putty university", *"your patient tutor"*) is a self-hosted AI
**tutoring workspace**: a curated textbook/classics **library** as a grounded
source of truth (RAG with page citations), a per-student **memory graph** that
tracks mastery over time, course-scoped study, practice, and an Odysseus-grade,
typesafe UI. Single-student in v1.

## Status — read this first

- **Greenfield. Planning is complete; there is NO application code yet.** The
  first thing to build is **M0** (foundation & spine).
- The repo currently holds the **planning docs** + **stale CI** in `.github/`
  carried from a prior project: `.github/workflows/ci.yml` byte-compiles
  `app.py core routes src …` that don't exist here, and `.github/scripts/*.js`
  exist. **It will fail and it violates our TS-only plan.** **M0 replaces
  `.github/` with our own gate set** (ADR-0002) and removes the leftover JS.
- If the planning docs aren't in `git ls-files`, they're **uncommitted** —
  committing them (and this file) is what makes the repo ready for a fresh clone.

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

1. **this file**
2. `SPEC.md` — vision, hard rules, features F1–F12, milestone roadmap + Definition
   of Done (§9.1), resolved/open decisions (§13)
3. `docs/DESIGN-M0-M1.md` — the concrete first build: schema, API, SSE contract,
   chat loop, ingestion, frontend shell, failure modes, build order
4. `docs/adr/0001`–`0004` — foundation & auth · verifiability gates · corpus +
   catalog + embeddings · course & data model
5. `docs/LEARNING-SCIENCE.md` — best practices for tutoring (the evidence base; BKT,
   spacing, validity, viz) distilled from `resources/`
6. `docs/TUTOR-PROMPT-ARCHITECTURE.md` — pedagogy-as-prompts (how the science is
   baked into every tutor prompt, verified by Gate 7)
7. `docs/DESIGN-SYSTEM.md` — the **putty-ai-design** visual system (authoritative)
8. `THREAT_MODEL.md` — security surfaces & the untrusted-content invariant

## The reference folders are a knowledge base — mine them, don't ship them

All are **gitignored, local-only, reference material** (not part of the build):

- **`ODYSSEUS-REF/`** — the self-hosted AI workspace whose UI/UX we replicate, and
  a **wealth of working implementations to learn from.** *Before building a
  feature, read how Odysseus did it.* It has battle-tested patterns for the
  **agent loop / harness**, **agentic tool abilities + MCP**, **SSE streaming**,
  **slash commands / command palette**, and full feature backends —
  **calendar, notes, tasks/todos, documents, research, sessions, settings**.
  Reuse the *approach* (re-implemented typesafe in our React/TS + FastAPI stack),
  not code verbatim. (It's FastAPI + a vanilla-JS SPA — map its ideas onto ours.)
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

- **Reading is the medium** — no TTS/STT, ever.
- **Untrusted-content invariant** — every model-derived write (events, todos,
  tags, graph assertions) is a **proposal the user confirms**, never silent.
- **Calm, not gamified** — no streaks/XP/leaderboards; **no social comparison**.
- **The student is the author** — the tutor never moralizes, surveils, or refuses
  coursework; full answers on explicit request; framing stays pedagogical.
- **The student outranks the inference** — insights are confidence-scored and
  challengeable; no hidden student model.

## The spine: one-door invariants + mechanical gates

- **Three one-doors:** user data → `owner_scoped`; the graph → `src/graph/`; model
  selection → `src/model_router` (call sites declare a *task profile*, never a
  model name).
- **Gates from M0** (ADR-0002): typed OpenAPI contract (CI fails on drift),
  pytest, vitest + Playwright, `tsc --strict` + ESLint, file-size ceiling,
  `response_model` on UI routes, no raw `request.json()`, no cross-feature
  imports, **TS-only (no new JS)**, graph one-door, router one-door, and Gate 7
  tutor-evals.
- **Learning science is structural, not decorative:** mastery = per-concept **BKT**
  (clamp P(G)<0.3, P(S)<0.1) recomputed from an **append-only `interaction_event`
  log** (logged from M0); spaced review = half-life regression; the tutor's
  prompts are composed + Gate-7-verified (`TUTOR-PROMPT-ARCHITECTURE.md`).

## Architecture (target)

- `backend/` — Python 3.11+, FastAPI. `app.py` (slim orchestrator), `core/`
  (db/auth/middleware), `src/` (engines: `llm/`, `model_router.py`, `corpus/`,
  `graph/`, `student_context.py`, `practice/`, `schedule/`, `tutor/prompts/`),
  `routes/`, `tests/`, `scripts/`. **Doc references to `src/…` mean
  `backend/src/…`; the corpus CLI runs from `backend/` (`python -m src.corpus …`).**
- `web/` — React 19 + TS (strict) + Vite, toolchain **Bun**. `src/app` (shell,
  router, window manager, theme), `src/features` (one folder per screen),
  `src/components`, `src/api` (generated client + SSE helpers).
- SQLite (canonical) + **embedded** Chroma (vectors); model router over Anthropic
  (Claude) + local Ollama. **Linux only.** Single process, single owner.

## Running / testing (once M0 scaffolds — none of this exists yet)

- Backend: `cd backend && uvicorn app:app --reload` (needs `PUTTYU_DATA_DIR` and a
  provider configured).
- Web: `cd web && bun install && bun run dev` (Vite proxies `/api`).
- Contract: `python scripts/openapi-export.py && cd web && bun run gen:api` after
  any UI-consumed route change.
- All gates: `bash .fitness/run-all.sh`. **Deterministic gates block CI; LLM/tutor
  evals (Gate 7) run on-demand against a configured model** (no API keys in CI →
  informational/local, never a blocking CI job).
- Git: branch off `main`; push via SSH (`git@github.com:Chunt0/PuttyU.git`).
  `OLD-REF/`, `ODYSSEUS-REF/`, `putty-ai-design/`, `resources/`, `textbooks/` are
  gitignored.

## Current next step

1. Resolve **O7** (product wordmark/brand — `DESIGN-SYSTEM.md` §"Brand
   reconciliation").
2. Start **M0** per `docs/DESIGN-M0-M1.md` §10 — in digestible, reviewed chunks,
   all gates green — beginning by replacing the stale `.github/` CI with our own.
