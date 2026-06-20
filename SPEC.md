# PuttyU — SPEC

> **PuttyU** ("putty university") — a self-hosted AI **tutoring workspace**. 
> A curated library of textbooks and classics is the
> source of truth (this is subject to grow); a per-student memory graph tracks what the student knows over
> time; the workspace organizes study by course load. Odysseus-grade UI/UX,
> rebuilt typesafe.

- **Status:** v0.1 — DRAFT for review (2026-06-19). North-star vision is frozen;
  build is incremental, one milestone at a time (§9).
- **Owner:** solo maintainer (agent-built), single-student v1.
- **This is a fresh start.** `OLD-REF/` (a previous attempt that over-scoped) and
  `ODYSSEUS-REF/` (the workspace whose UI/UX we replicate) are **reference-only**
  and will be removed once fully mined. No code is carried over verbatim; the
  *vision*, the *verifiability discipline*, and the *UI/UX* are.

**Companion docs (the "how"):** `docs/adr/0001`–`0004` (foundation & auth · gates ·
corpus + catalog + embeddings · course & data model), `docs/DESIGN-M0-M1.md`
(schema, API, streaming, shell), `docs/M0-PLAN.md` (the chunked M0 build plan +
cross-cutting tech decisions), `docs/DESIGN-SYSTEM.md` (the putty-ai-design kit
— authoritative visual system), `docs/LEARNING-SCIENCE.md` (best practices for
tutoring, distilled from the resources library — the evidence base for the
pedagogy), `docs/TUTOR-PROMPT-ARCHITECTURE.md` (pedagogy-as-prompts — how the
science is baked into every tutor prompt), and `THREAT_MODEL.md`. This SPEC is the
north star; those hold the implementation detail.

---

## Table of contents

1. [Vision](#1-vision)
2. [Hard product rules (non-negotiable)](#2-hard-product-rules-non-negotiable)
3. [Personas](#3-personas)
4. [Domain model — the nouns](#4-domain-model--the-nouns)
5. [Architecture](#5-architecture)
6. [UI/UX — the Odysseus workspace, rebuilt](#6-uiux--the-odysseus-workspace-rebuilt)
7. [Verifiability — the prime directive](#7-verifiability--the-prime-directive)
8. [The content library — ingestion target](#8-the-content-library--ingestion-target)
9. [Milestone roadmap (build order)](#9-milestone-roadmap-build-order)
10. [Feature spec (F1–F12)](#10-feature-spec-f1f12)
11. [Non-goals & explicitly deferred](#11-non-goals--explicitly-deferred)
12. [Lessons from OLD-REF (what to avoid)](#12-lessons-from-old-ref-what-to-avoid)
13. [Resolved decisions & open questions](#13-resolved-decisions--open-questions)
14. [Glossary](#14-glossary)

---

## 1. Vision

> "I want a database filled with textbooks, literature, and papers that acts as
> the **source of truth**. The student logs in and sets their current **course
> load** — that determines the courses they tab through, and it informs the AI
> what content to pull from and how to help, using its built-in knowledge *and*
> the library as ground truth. The platform must be extensible to fit any course.
> A **graph-style memory** lets the AI stay flexible about the past and current
> state of the student and adjust its content accordingly."

Three ideas differentiate PuttyU from a chat box:

1. **A curated library as source of truth.** The tutor grounds answers in the
   student's own textbooks and classics, with citations that open the source at
   the exact page. Ungrounded claims are marked honestly.
2. **A persistent student-memory graph.** Every interaction feeds a bi-temporal
   knowledge graph: what the student *said* (verbatim observations) and what the
   tutor *concluded* (inferred insights), never silently merged — so mastery
   *trajectory* over time is queryable, not just current state.
3. **Focus with peripheral awareness.** The workspace scopes by course. Studying
   Calculus while taking calc-based Physics, the tutor's context is *predominantly*
   calculus but stays *aware* of the coupled course, so abstract math grounds in
   tangible physics homework. This generalizes to any pair of courses sharing
   graph ground.

The product surface is a **dashboard-first workspace** ("what should I do right
now?"), modeled on the Odysseus UI/UX the owner loves — multi-panel, dockable
tool windows, slash commands, command palette, streaming chat, themed — rebuilt
in a typesafe React + TypeScript stack.

---

## 2. Hard product rules (non-negotiable)

These are owner directives. Do not relitigate them; build with them.

- **Reading is the medium.** No TTS, no STT — **ever**. The tutor's output is
  text the student reads; the student's input is typed, drawn, or photographed.
  This is deliberate pedagogy, not a missing feature.
- **The untrusted-content invariant.** Everything the model reads from
  user-supplied or fetched content (uploads, syllabi, web pages, notes, the
  student's own materials) is **untrusted**. Every write derived from it
  (calendar events, todos, tags, graph assertions) is a **proposal or evidence
  the user confirms** — never a silent action. Confirm-first flows (schedule
  miner, suggested tags, tutor-proposed todos) are instances of this one rule.
- **Calm, not gamified.** No streaks, XP, leaderboards, or guilt mechanics.
  Mastery progress and momentum are **narrative, not score**. An empty day says
  so plainly; it does not manufacture urgency.
- **The student is the author.** The tutor assists; it does not do the work. But
  it never moralizes, surveils, or refuses coursework — this is a personal tutor
  on the student's own instance. Full answers are available on explicit request
  ("just show me"); the framing stays pedagogical (feedback and path first,
  answer second).
- **The student outranks the inference.** Every inferred insight is visible in
  the Progress UI and challengeable. There is no hidden student model. A student
  override ("I know this" / "that's not true") is itself recorded as evidence.
- **One door per spine subsystem.** User data, the graph, and model selection
  each have exactly one entry point (§5.5), mechanically enforced.

---

## 3. Personas

| Persona | Role in v1 | Notes |
|---|---|---|
| **The user** (the student) | The only seat. Logs in, declares a course load, studies. | Level is a *dial*, not an age — could be in AP Stats, a lit seminar, and self-teaching transformers from arXiv simultaneously. No fictional persona names anywhere. |
| **The owner/admin** | Curates the library, configures providers, runs the box. | Same human as the user in v1. Admin actions stay out of the daily surface. |
| **The tutor** (the product) | The AI persona across every course tab. | Patient, Socratic-leaning, grounded in the library, honest about its limits, adapts to the graph's picture of the student. |

Multi-student is a prepared seam (the `owner_scoped` invariant), not a v1 feature.

---

## 4. Domain model — the nouns

| Concept | Definition |
|---|---|
| **Library** | The curated, shared, read-only corpus: textbooks, classics/literature, (later) papers and video transcripts. The source of truth the tutor cites. |
| **Course** | A student-declared unit of study ("AP Statistics", "Victorian Lit", "Transformers"). Owns: linked library sources, a concept-graph region, a tutor config, and sessions/notes/events/todos scoped to it. |
| **Course materials** | The student's *own* uploads into a course (syllabus, homework, slides, any PDF). Owner-scoped, sit *beside* the shared library in retrieval, **user-taggable**, mined for structure. |
| **Tags** | Free-form labels the student puts on materials ("syllabus", "week-3"). Filter the library panel **and** steer retrieval. |
| **Schedule miner** | The pass that reads a schedule-shaped upload (syllabus) and *proposes* dated calendar events + todos — confirm-first, idempotent on re-upload, every proposal provenance-linked to its page. |
| **Course load** | The set of active courses. Renders as **tabs**. Archivable, never silently deleted. |
| **Student graph (ensemble)** | One bi-temporal graph per student: **concept nodes** (curriculum, seeded, closed-world) + **entity nodes** (the student's world — open-world, sparse) + typed, time-stamped **assertions**. |
| **Episode** | The immutable interaction moment an assertion cites (a chat turn, a worksheet upload, a review answer). Receipts — never edited, never deleted. |
| **Observation** | A **stated** assertion: what the student said, quoted verbatim, episode-linked. |
| **Insight** | An **inferred** assertion: a tutor conclusion, with confidence and source episodes. Invalidated (never deleted) when contradicted. |
| **Mastery state** | Per-(student, concept) derived projection over append-only evidence: level, confidence, last-seen, error patterns. Updated with **Bayesian Knowledge Tracing** (BKT; see `docs/LEARNING-SCIENCE.md` §2.1). |
| **Student context** | The tiered, budget-aware block the assembler builds for every user-context LLM call: profile → **focus** → **periphery** → ambient. |
| **Task profile / model router** | The declared *needs* of an LLM call (tier `micro\|light\|standard\|deep\|vision` + modality + output shape + latency/privacy) and the resolver that maps it to a configured endpoint+model. No call site names a model. |
| **Review queue** | Spaced-repetition stream of due items from mastery decay — the system *pushes*. |
| **Gym** | Student-driven targeted practice — the student *pulls*: pick a topic, get a set calibrated by the graph (weakness-first, adaptive, real exercises before generated). |
| **Todo** | A lightweight, course-scoped, due-dated task. Distinct from scheduler automation. |
| **Dashboard** | The login surface: today's calendar + due todos + review/gym status + reading recommendations + momentum + mini-chat. Every card is a door into its full feature. |
| **Worksheet analysis** | Photographed/drawn/scanned work → vision extraction → graded, line-referenced feedback → graph evidence. |
| **Tutor persona** | The tutor's behavior profile, parameterized by course + an adaptivity dial (scaffolding / pace / tone). |

---

## 5. Architecture

### 5.1 Stack

| Layer | Choice | Why |
|---|---|---|
| **Frontend** | React 19 + TypeScript (`strict`), Vite 6, toolchain **Bun** (package manager + test runner) | Owner's pick; proven; huge ecosystem; matches "TS + Bun". **Zero JavaScript** in the end state (even configs are `.ts`). |
| **Frontend state** | TanStack Query v5 (server state) + Zustand (UI-only state: theme, panels) | Clear split; server cache vs. ephemeral UI. |
| **Backend** | Python 3.11+, FastAPI + Uvicorn (async) | Owner's pick for backend + agent work; ecosystem-anchored (LLM SDKs, PDF, embeddings). |
| **Contract** | OpenAPI → **generated** `web/src/api/schema.d.ts` + typed `openapi-fetch` client; CI fails on drift | The frontend/backend seam is typed and cannot drift silently. |
| **Database** | SQLite (canonical), SQLAlchemy ORM | Single-process v1; simple, durable, inspectable. |
| **Vectors** | ChromaDB (degrades to keyword search if absent) | Two-store corpus: SQLite canonical + disposable vector index. |
| **LLM** | Anthropic API (Claude — deep/standard tier) + local Ollama (light/micro), abstracted behind the model router | Declare the *need*, not the model. Default deep/standard to latest Claude (Opus 4.8 / Sonnet 4.6); micro/light may run local for privacy/cost. |
| **Platform** | Linux only | No cross-OS branches. |

### 5.2 Repository layout (target)

```
PuttyU/
  backend/
    app.py              # slim orchestrator: middleware → routers → lifespan
    core/               # database.py (SQLAlchemy), auth.py, middleware.py, atomic_io.py
    src/                # engines: llm/, corpus/, graph/, practice/, schedule/,
                        #   student_context.py, model_router.py, agent/, tools/
    routes/             # thin HTTP adapters (typed; response_model on UI routes)
    tests/              # pytest
    scripts/            # openapi-export.py, corpus CLI, etc.
  web/
    src/
      app/              # shell, router, window manager, theme system, course tabs
      features/         # one folder per screen (chat, courses, library, progress, …)
      components/       # shared kit (Markdown+KaTeX, ConfirmButton, CameraCapture, …)
      api/              # generated schema.d.ts + typed client + streaming.ts (SSE)
      lib/              # utils + zustand stores
    tests/ e2e/         # bun test + playwright
  .fitness/             # bash fitness-function gates (see §7)
  .github/workflows/    # CI: python tests, web typecheck/lint/test/e2e, gates
  textbooks/            # LOCAL content data — gitignored (~12 GB), ingested to corpus
  SPEC.md               # this file
```

> **`textbooks/` is not committed.** ~12 GB of content data is local-only
> (gitignored) and reached via a configured path; it is ingested into the corpus,
> never stored in git. `OLD-REF/` and `ODYSSEUS-REF/` are reference-only and also
> excluded from the new build.

### 5.3 Backend shape

- `app.py` — slim orchestrator: middleware stack (CORS → security headers →
  request timeout → auth), router registration, lifespan startup (DB init; the
  scheduler lands at M4, MCP is deferred — §13 O6). No business logic.
- `core/` — `database.py` (SQLAlchemy models + idempotent startup migrations),
  `auth.py`, `middleware.py`.
- `src/` — engines, each a focused module: `llm/`, `model_router.py`,
  `corpus/` (records / chunker / importers / indexer / retriever / grounding),
  `graph/` (the ensemble graph public API), `student_context.py`, `practice/`,
  `schedule/`, `agent/`, `tools/`. Modules appear **as their milestone lands**
  (M0: `llm/`, `model_router.py`; `corpus/` at M1; `graph/` + `student_context.py`
  at M3; `practice/` + `schedule/` at M4–M5; `agent/` + `tools/` only when agent
  mode lands — not v1).
- `routes/` — thin adapters: `setup_*_routes(deps) -> APIRouter`, wired in
  `app.py`. UI-consumed routes carry `response_model=` and never read raw
  `request.json()`.

### 5.4 Data stores

SQLite (`backend/data/app.db`) is canonical. ChromaDB holds re-embeddable
vectors (corpus chunks, personal-doc memories) and degrades to keyword search if
unavailable. Filesystem holds uploads and `data/corpus/` assets. Small JSON
sidecars (auth, settings, router config) where a table is overkill.

### 5.5 The three "one-door" invariants (the spine)

Each subsystem has exactly one entry point, mechanically enforced (§7):

1. **User data → `owner_scoped(query, Model, user)`.** The only way to scope
   user data. No ad-hoc `.filter(Model.owner == ...)`. (Prepared seam for
   multi-student.)
2. **Graph → `src/graph/` public API.** Non-graph code reads/writes the student
   model through `src/graph/queries.py` / `src/student_context.py`, never raw SQL
   on graph tables. This is also what makes the memory *engine* swappable
   (SQLite-native in v1; Graphiti is the flip-target — §13.1).
3. **Model selection → `src/model_router.py`.** Call sites declare a *task
   profile*; the router resolves it against configured providers. No call site
   hardcodes a model name. Unconfigured tiers fall back transparently.

---

## 6. UI/UX — a UX clone of Odysseus, skinned with putty-ai-design

**Fidelity directive (non-negotiable):** the frontend is **essentially a clone of
Odysseus in look, feel, and interaction** — *skinned* with the putty-ai-design
kit. Two halves, both required:

- **UX / interaction = clone `ODYSSEUS-REF`.** The layout, the multi-panel +
  **dockable window manager**, navigation, **slash commands**, the **Cmd/Ctrl-K
  command palette**, **streaming** behavior, keyboard interactions, empty/loading
  states, motion — it should *feel like Odysseus to use*. When building any
  surface, **study how Odysseus does it in `ODYSSEUS-REF/` and match it.**
- **Visual skin = the `putty-ai-design` kit** (tokens, themes, fonts, components,
  mascot — `docs/DESIGN-SYSTEM.md`).

These already align: the putty-ai-design kit is itself a **React recreation of the
Odysseus workspace** (its `Sidebar`/`Composer`/`Messages` mirror Odysseus; its
themes are lifted from it) — so the kit hands us Odysseus-shaped components already
in the putty skin. Build the shell from the kit; for surfaces the kit doesn't
cover, replicate Odysseus's UX using the kit's primitives + tokens.

**Scope of the clone:** we clone the **chrome and interaction model, NOT the
feature set.** Odysseus's productivity features (email, cookbook, gallery,
model-serving) are out of scope (§11); the tutoring surfaces (below) take their
place *inside the same workspace, behaving the same way*. The OLD-REF frontend is
explicitly **not** the model — Odysseus is.

**What we carry from Odysseus (the workspace shell):**

- **Multi-panel workspace** with a collapsible sidebar, a main area, and
  **dockable tool windows** (floating, z-ordered, tile-able) managed by a window
  manager.
- **Streaming everywhere** via Server-Sent Events: chat tokens, tool output,
  research/grading progress.
- **Slash commands** in the composer and a **Cmd/Ctrl-K command palette** for
  global navigation/search.
- **Theme system** — CSS variables driving every color; multiple themes;
  persisted to localStorage.
- **Rich rendering** — markdown + syntax highlighting + **KaTeX math** (bundled,
  no CDN), citation chips, attachment thumbnails.

**What we add (the tutoring layer), into that shell:**

- A **course tab strip** (Home + one tab per active course) that scopes chat,
  library, practice, notes, and progress to the active course.
- A **dashboard** as the login surface (the home base — §10 F11).
- A **library panel + PDF viewer** (open source at exact page from any citation).
- A **Progress panel** (concept tree with mastery state colors; trajectory
  timeline).
- **Practice surfaces** (Review, Gym, Exam sim, Explain-it-back).
- **Capture/canvas** surfaces (webcam, drawing canvas, typed-math input).

**Visual design language — the `putty-ai-design` kit (authoritative).** The
frontend is built on the owner's **putty-ai-design** system (`putty-ai-design/`,
documented in `docs/DESIGN-SYSTEM.md`): a near-greyscale canvas (ink `#0e0e10`,
panels lift lighter), the **coral `#e06c75`** as the **single** interactive
accent (text-on-coral uses `--accent-solid #c2454f` for AA), **Inter** (UI) +
**Fira Code** (mono) self-hosted, a faint **dot-grid** texture, Feather/Lucide
line icons, **borders over shadows**, **sentence-case** headings, **no
emoji-as-UI, no gradients**. The kit ships **16 themes + `putty`** (set
`data-theme` on `<html>`), real fonts, the **putty-blob mascot**, and a
`pa-`-prefixed React component library + chat-shell we port into `web/` at M0.
Its themes are lifted from the Odysseus source app, so "Odysseus UI/UX" and "this
kit" are the same instruction. Mastery is shown as **state, not percentages**
(unknown / learning / shaky / mastered).

**Accessibility** is a build requirement, not a later pass: keyboard-navigable
throughout (the command palette is the spine), visible focus states, WCAG-AA
contrast in every theme, `prefers-reduced-motion` respected, and semantic
landmarks/roles on the shell.

---

## 7. Verifiability — the prime directive

Invariants are **mechanical gates**, never conventions. An agent forgets
conventions across sessions but cannot bypass a failing build. **Adding a feature
means adding the test / contract / model / gate that keeps it honest.** Every
milestone ends with all gates green; that *is* the work.

The CI gate set (carried forward from OLD-REF's proven design, established at M0):

1. **Typed OpenAPI client.** `scripts/openapi-export.py` → `bun run gen:api` →
   committed `web/src/api/schema.d.ts`; **CI fails on drift.** UI-consumed routes
   ride this real seam.
2. **pytest required** (blocking in CI). Flaky tests get a `quarantine` marker
   (informational job), never `continue-on-error`.
3. **Bun test + Playwright.** No screen merges without a critical-flow e2e.
   Playwright specs adopt the feature scenario names from §10.
4. **`tsc --noEmit --strict` + ESLint.** No `any` in `web/src/api`.
5. **`owner_scoped` is the only door** for user-data reads (fitness check; an
   allowlist freezes any migration backlog and may shrink, never grow).
6. **Bash fitness functions** (`.fitness/`):
   - **6a — file-size ceiling:** no god-files (frozen, non-growing allowlist).
   - **6b — `response_model`:** every UI-consumed route declares one.
   - **6c — no raw `request.json()`** in new routes.
   - **6d — no cross-feature imports** into the lean core.
   - **6e — TypeScript only:** no new `.js/.jsx/.mjs/.cjs`.
   - **6f — graph one-door:** only `src/graph/`, `src/student_context.py`, and
     `routes/graph_routes.py` may touch graph tables.
   - **6g — model-router one-door:** no model name hardcoded at a call site.
7. **Gate 7 — tutor evals.** A golden-set eval harness for the LLM *behaviors* the
   spec promises — and specifically for the **learning-science pedagogy** baked
   into the tutor prompts (`docs/TUTOR-PROMPT-ARCHITECTURE.md`): never fake a
   citation; mark ungrounded answers; Socratic-not-spoiler unless asked;
   weakness-first set composition; calm/no-comparison; resists prompt injection;
   extraction precision. Methodology (per ADR-0002): a **frozen, version-pinned
   held-out set**; **student-level** splits where applicable; a **fixed metric
   bundle** (AUC + RMSE + Cohen's κ + recall — never accuracy alone) against
   **must-beat baselines**; multiple-testing correction; a train-vs-eval-gap
   alarm. Informational first (extraction at M3), blocking as it matures — the
   quarantine playbook, reused. It tells the owner when a newly configured local
   model quietly degrades grounding, grading, or extraction.

---

## 8. The content library — ingestion target

`textbooks/` (~12 GB, ~58k files, gitignored) holds two collections:

**A. OpenStax textbooks (77 books).** Per book:
```
<book>/
  book.md            # markdown converted from PDF, inline image refs
  source.pdf         # original PDF (page-accurate citations / viewer)
  images/            # extracted JPEGs, named _page_<N>_<kind>_<i>.jpeg
  marker/output.md   # page-marked variant ({0},{1},… page anchors)
```
- Structure: chapters → sections → subsections; LaTeX math (`$…$`); worked
  **Examples** with solutions; **Review / Critical-Thinking / Visual-Connection
  Questions** (numbered, multiple-choice + free-response) — usable as practice
  items.
- License: CC BY-NC-SA 4.0 (OpenStax).

**B. Classics library (~5,904 Project Gutenberg books).** Per book: a single
`.md` with **YAML frontmatter** (`title`, `author`, `category`, `gutenberg_id`,
`source`, `downloads_30d`). Categories: Literature, History, Philosophy, Eastern
& Sacred, Science. No PDFs/images. An `INDEX.md` lists all books.

**Ingestion design (two-store, ADR-worthy):**
- Importer parses a source dir → `corpus_source` row (content-hash idempotent) +
  `corpus_chunk` rows.
- **Chunking:** build hierarchy from section *numbers* in heading text (not `#`
  depth); pedagogical blocks (Example/Problem/Solution/Try-It/Key-Terms) are
  **atomic** chunks; prose targets ~200–500 tokens on paragraph boundaries; page
  locator from the latest `page-N` anchor; image names attached.
- **Chunk `kind`** (`example|problem|exercise|try_it|prose|key_terms`) is the
  practice-item lever for the Gym/Review.
- SQLite is canonical; one Chroma vector per chunk (`heading_path + text`), with
  scalar metadata (`source_id, kind, page_start, course_id, owner, subject`).
- **Retrieval:** embed query → vector search filtered by course/tag/kind →
  expand context via SQLite (`source_id`, `ordinal ± N`) → return
  `{chunk_id, citation, page_start, source_id}` to the LLM; the PDF page link
  goes to the student.
- CLI-first admin import: `python -m src.corpus <dir> [--no-embed]`.

---

## 9. Milestone roadmap (build order)

**The whole vision (§10) is the north star. The build is incremental — one
milestone at a time, each fully green (all gates, §7) before the next.** This is
the discipline that OLD-REF lacked (§12).

| Milestone | Scope | Maps to |
|---|---|---|
| **M0 — Foundation & spine** | Repo + CI + **all gates wired and green**; FastAPI backend + React/Vite/Bun frontend talking over the **typed OpenAPI contract**; auth/login; the **Odysseus-style workspace shell** (panels, dockable windows, tab strip, command palette, slash commands, theme system); plain **streaming chat** to a configured LLM (no grounding yet); **model router v1** (task profiles, tier table, transparent fallback). | infra + F7 (core) |
| **M1 — Courses + Library + Grounded chat** *(first tutoring slice — chosen)* | `course` table + CRUD + onboarding + tabs; corpus tables in `init_db` + **ingest several textbooks**; library browser + **PDF viewer** (open at page); **course-scoped retrieval → grounded chat** with **citation chips** (click-through to page) and the **honesty marker** for ungrounded answers. | F1 (courses), F2 (library), F3 |
| **M2 — Materials + worksheets** | Owner-scoped **uploads + tags** + dual-store retrieval; **webcam capture** (getUserMedia, preview/retake, multi-page→PDF; secure-context hint); **worksheet grading** (vision extraction → line-referenced feedback: what's right, first error, nudge, cited concept). | F2 (materials), F4 (capture/grading) |
| **M3 — Student graph + context** | Ensemble graph (concept/entity/assertion/evidence/mastery, bi-temporal) on **SQLite behind the one-door API** (Graphiti spike → ADR-0005, §13.1); **per-concept BKT mastery** (clamped P(G)<0.3, P(S)<0.1; recomputed from the append-only evidence log); seeding from source structure + **Q-matrix (item→KC) tagging**; **after-turn extraction** (router tier=light); **student-context assembler (focus tier)**; chat switches from raw retrieval to assembled context; **Progress UI** (list/tree, state colors, trajectory, challenge/override). | F5, F6 (focus) |
| **M4 — Practice** | **Review queue** (**half-life-regression scheduling**, expanding intervals, calendar-aware weighting, Review UI); **the Gym** (graph-calibrated, weakness-first, ZPD difficulty); **calibration** flow; **exam simulation** (timed, silent, scope-weighted) + readiness; **explain-it-back**; **periphery tier + coupling mute**. | F1 (calibration), F8, F6 (periphery) |
| **M5 — Dashboard & planning** | **Dashboard** (cards, all doors); **todo** model + CRUD; **Cmd-K global search** (front door); **schedule miner** (syllabus → event/todo proposals, idempotent, confirm-first); **persona + adaptivity dial + integrity stance**; **session-summary notes**; calendar/notes course-binding; **cost meter** + routing observability; **typed math input**. | F2 (miner), F9, F10, F11 |
| **M6 — Canvas & born-digital work** | **Canvas workspace** (Pointer Events + pressure; blank/ruled/grid/axes templates; one-click submit-as-image; feedback → revise → resubmit; stroke-data persistence so saved canvases reopen editable). | F4 (canvas) |
| **Later** | Multi-student (`owner_scoped` becomes blocking); video sources; mobile PWA; ntfy nudges; backup/export; Anki export. | F12 |

> **M0 is the unavoidable scaffolding** beneath the M1 slice you chose; together
> they are the first two steps. Nothing past M1 is built until M0 and M1 are
> green.

### 9.1 Definition of Done (per milestone)

A milestone is done when **all gates (§7) are green on the real build** *and* its
exit criteria below hold (its key §10 scenarios pass as Playwright e2e).

**M0**
- First-run setup → login → logout; owner persisted (bcrypt); signed session cookie.
- ≥1 provider configurable in the Providers screen; `/api/router/resolution`
  renders; a vision-required-but-absent call **fails loud** (no silent text-only).
- Shell: sidebar + dockable tool windows + theme picker + Cmd/Ctrl-K palette +
  slash-command composer.
- **UX fidelity:** the shell looks and behaves like Odysseus, skinned with
  putty-ai-design — verified **side-by-side against `ODYSSEUS-REF/`** (layout,
  panel/window behavior, palette, slash commands, streaming feel). §6 directive.
- Plain streaming chat end-to-end (SSE); sessions persist / rename / archive /
  reload; stop-generation leaves clean history.
- Typed OpenAPI client generated with **no drift**; `tsc` strict + ESLint clean;
  pytest + bun test + an e2e (login → send a message → stream renders) green.

**M1**
- Course create / edit / archive + tabs + first-login course setup (free-form,
  no fixed catalog; creatable with no library match).
- Library catalog built from `PUTTYU_LIBRARY_PATH`; catalog search; source
  suggestion on course create.
- Lazy ingestion: link a source → parse / chunk / embed → `ingested`; idempotent
  on re-link; failures visible (never silent).
- Library browser + TOC + PDF viewer open-at-page.
- Course-scoped grounded chat: citation chips click through to the PDF page;
  honesty marker on ungrounded answers; **never fakes a citation** (tutor-eval
  informational green).
- `owner_scoped` gate active for user-data tables.
- e2e: create course → link a source → ask a grounded question → click a citation
  → PDF opens at the right page.

**M2–M6** — DoD = the feature's §10 scenarios pass as e2e + the milestone's new
gate(s) land + all gates stay green. Detailed exit criteria are written at the
*start* of each milestone (don't over-specify far milestones — §12).

> **M3 and M4 are large — sub-slice each into reviewable chunks at milestone
> start**, the way M0 is chunked (`docs/M0-PLAN.md`). Indicative: **M3a** graph +
> seeding + evidence log · **M3b** BKT + Progress UI · **M3c** extraction +
> assembler; **M4a** review queue · **M4b** Gym · **M4c** calibration / exam /
> explain-it-back.

---

## 10. Feature spec (F1–F12)

> Acceptance layer for the whole vision. Each feature lists its intent and key
> scenarios (Given/When/Then). Playwright specs adopt these scenario names. Tags:
> `@exists` is N/A for a fresh build — everything is `@new` until built; the
> milestone column says *when*.

### F1 — Course load & calibration *(M1; calibration M4)*

**Intent:** the student declares what they're studying; the workspace scopes to it.

- First login lands on **course setup**, not an empty chat: "What are you
  studying right now?" — free-form names, **no fixed catalog**.
- Creating a course **suggests matching library sources** (e.g. "AP Statistics" →
  OpenStax Introductory Statistics); accept / reject / search manually; **course
  is created even with no match**.
- A course **without library coverage is honest**: "No library sources linked —
  tutor is using built-in knowledge only."
- Course load renders as **tabs** (+ a Home tab); the active tab scopes chat,
  practice, notes, progress.
- **Archiving** a course removes its tab but retains sessions/notes/mastery/graph;
  re-activatable anytime.
- *(M4)* **Optional calibration** (~10 min, stop anytime): adaptive problems walk
  the concept region, writing mastery evidence so the graph starts warm. Skipping
  is fine — unknown ≠ failing.

### F2 — The library + course materials + schedule miner *(library M1; materials/miner M2/M5)*

**Intent:** a curated, cited source of truth, plus the student's own materials beside it.

- *(admin, CLI)* Import a Marker-format textbook: `python -m src.corpus <dir>` →
  `corpus_source` with **content-hash idempotency**; pedagogical blocks atomic;
  re-running imports nothing new.
- Extensible source types: textbook, literature/classic, **paper**, (later) video
  transcript — same tables, same importer.
- Student **browses the library** inside a course: linked sources with
  title/authors/type; expand into the heading-path tree; **open the PDF at a
  page**.
- **Citations are doors:** clicking `[Intro Stats §2.3, p. 87]` opens the source
  at that section and offers "open PDF at page 87."
- *(M2)* **Upload** anything course-shaped (syllabus, homework, any PDF) →
  owner-scoped course material *beside* the read-only library.
- *(M2)* **Tags steer retrieval:** the student tags uploads; the library panel
  filters by tag; retrieval can scope to a tag ("check my week-3 homework").
  Upload-time tag **suggestions** are confirm-to-apply, never silent.
- *(M2)* Materials **join course retrieval with citations** (`[your week-3 sheet,
  p. 2]`), same click-through.
- *(M5)* **Schedule miner (flagship):** uploading a syllabus → detects
  schedule-shaped content → proposes events + todos in a review sheet ("Found 11
  due dates, 3 exams — add?"); bulk-accept/prune/edit; every item
  **provenance-linked** to its page. **Re-upload diffs, never duplicates**
  (content-hash). **Ambiguity is asked about, not guessed** ("couldn't resolve
  'Week 5'"). A wrong exam date is worse than no exam date.

### F3 — Grounded tutoring chat (the core loop) *(M1)*

**Intent:** within a course, answer from the library first, own knowledge second, always showing which.

- A question in a course tab runs **retrieval scoped to that course's sources**;
  the answer is grounded in retrieved chunks and ends with **citations**.
- **Honesty marker:** when the library can't back it, the tutor answers from
  built-in knowledge and visibly marks it — **never fakes a citation**.
- **Socratic default** ("guide" mode): on a homework problem, don't produce the
  final answer first — ask what was tried, or offer the first scaffold step. The
  student can always say "just show me."
- **Adaptivity:** the same question gets different treatment depending on the
  graph (build on a mastered prerequisite by reference; probe a shaky one first).
  *(Full adaptivity requires the graph — M3; M1 ships the grounded loop.)*
- Mechanics that must work: token streaming, markdown + LaTeX render, stop
  generation mid-response without corrupting history, sessions persist/rename/reload.
- *(later)* Agent mode for tool-using study tasks ("make a formula sheet from my
  last three sessions"), course-scoped, result lands as a versioned document.

### F4 — Doing the work: worksheets, capture & canvas *(grading/webcam M2; canvas M6)*

**Intent:** get handwritten/worked content to the tutor and back with patient, line-referenced feedback.

- Attach a photo of handwritten work to the composer → thumbnail chip → vision
  model receives it on send.
- **Graded feedback references the student's actual lines:** per problem, what's
  right, **where the first error occurs**, a nudge to find it, and a **citation**
  to the concept's section.
- Worksheet results **write graph evidence** (with the error pattern) and queue a
  follow-up review item.
- **Webcam is a scanner:** "take photo" on any upload surface → camera view →
  capture/preview/retake → enters the *same* pipeline as an upload. **Multi-page
  capture → one PDF.** No secure context → a **setup hint**, never a dead button.
- **The canvas (M6):** a Pointer-Events draw surface (mouse / USB pad / stylus,
  pressure where available); templates (blank/ruled/grid/**axes**); pen/eraser/
  undo/clear. **One-click "send to tutor"** submits as an image through the same
  path as photos. **Feedback → revise → resubmit** on the same canvas, attempts
  distinct (v1, v2). Saved canvases **reopen editable** (PNG + stroke-data JSON).
- **Typed math** is first-class too: a LaTeX-backed equation input beside text
  and canvas, in chat/gym/review/exams; renders properly in the transcript.

### F5 — The student model: ensemble graph memory *(M3)*

**Intent:** a living, bi-temporal memory of who the student is and what they know.

- A course **seeds its graph region** from source structure (chapters/sections →
  concepts; key-terms → leaf concepts); prerequisite edges follow book ordering;
  every node starts **"unknown"** (not zero). **Seeded edges are low-confidence
  `inferred` claims**, validated against performance over time (correctness-
  covariance: items sharing a KC should co-vary); nodes split/merge as fit demands.
- **Mastery = per-concept Bayesian Knowledge Tracing (BKT).** Four parameters
  {P(L0), P(T), P(G), P(S)}; latent P(L) updated Bayesianly per first attempt,
  **clamped P(G)<0.3, P(S)<0.1** to avoid degeneracy; recomputed from the
  append-only evidence log (ADR-0004). P(L) maps to the four UI states. Multi-KC
  items decompose to single-KC steps (PFA/LKT fallback); DKT deferred.
  (Grounding: `docs/LEARNING-SCIENCE.md` §2.1; formalized in ADR-0005 at M3.)
- **Items carry KC tags (a Q-matrix):** every worksheet/Gym/exam/review item maps
  to its concept(s) — the prerequisite for any mastery update.
- **Evidence accrues silently** from normal studying (background after-turn
  pass); no badge, no popup.
- **The graph survives being wrong:** repeated errors degrade a "mastered" node
  toward "shaky" within the same session.
- **The student can see and correct their map:** Progress panel shows the region
  (mastered/shaky/unknown/not-reached); tap a node for its evidence; override
  ("I know this" / "I never learned this") — overrides are evidence too.
- **Cross-course edges make transfer visible:** mastering "matrix multiplication"
  in a math course means the Transformers tutor builds on it. One graph per
  student, regions per course.
- **Observations (stated)** are recorded **verbatim with provenance** ("I like ice
  cream" → may flavor a later related-rates problem). **Insights (inferred)** are
  recorded **distinctly**, with confidence and source episodes. Stated and
  inferred are **never silently merged**.
- **Beliefs are invalidated, never erased** (bi-temporal): a contradicted insight
  gets `invalidated_at`; the trajectory stays queryable.
- The tutor can **analyze the trajectory** ("three weeks ago you were guessing at
  null hypotheses; the turning point was the June 3 worksheet") citing real
  moments. The trajectory is modeled as a **sequence of study states** (read /
  practice / review / stuck / mastered…); a transition matrix + entropy/turbulence
  surface *how* the student moves through material (and flag disengagement).
- **Insights are measurements, stated honestly:** every inferred insight carries a
  **confidence** (from evidence quantity/recency) and the **observations it rests
  on**; mastery is checked for convergent validity (tracks worksheet/exam
  performance) and discriminant validity (not driven by reading load / UI
  familiarity — construct-irrelevant variance). (`docs/LEARNING-SCIENCE.md` §2.5.)
- The student can **challenge an insight**; it's invalidated and the correction
  recorded as a stated observation.

### F6 — Focus & periphery: the student-context protocol *(focus M3; periphery M4)*

**Intent:** every tutor thought starts from who the student is right now — focus-dominant, periphery-aware.

- **One door:** all user-context LLM calls (tutor turns, agent turns, grading,
  review/gym generation, summaries, extraction's read side) build context via the
  **student-context assembler**; no call site assembles state ad hoc
  (fitness-checked).
- **Context tiers** (degrade bottom-up under token budget): **0 Profile** (dial,
  level, durable facts — always kept) → **1 Focus** (active course: frontier,
  shaky nodes, recent evidence, retrieval — always kept, compressed) → **2
  Periphery** (coupled active courses via shared/1-hop nodes, ≤1 line each,
  ~15% budget cap — compresses then drops) → **3 Ambient** (stated observations,
  study patterns, schedule pressure — first to drop).
- **Focus dominates, periphery grounds (flagship):** in Calculus with Physics
  also enrolled, context is predominantly calculus + one periphery line ("Physics
  1 — currently on kinematics, which applies derivatives of position"); the tutor
  may ground the chain rule in the student's actual physics work — **a calculus
  answer with a physics aside, never a physics lecture**. The connection is
  **symmetric** and comes from **shared graph nodes**, never invented from course
  names.
- **Bounded & budget-aware:** no tier is ever an unbounded graph dump.
- **The student steers coupling:** "stop bringing physics into this" records
  evidence on the pair and **mutes** the periphery (reversible in settings).
  *(v1: mute-only; no positive "always connect".)*
- Background calls see the **same student** the live tutor sees.

### F7 — The model router: feature-based model selection *(v1 at M0; observability/cost M5)*

**Intent:** the right model for the job, chosen by the task's declared needs.

- **Call sites declare a need, not a model** (the third one-door invariant,
  fitness-checked).
- **Tiers:** `micro` (yes/no, titles → smallest model), `light` (extraction,
  summaries, item dressing → small/mid local), `standard` (live tutor turns →
  best conversational), `deep` (proofs, deep research, grading → strongest
  reasoner, e.g. Claude), `vision` (handwritten-work analysis → a VL model, a
  **hard requirement**, fail loudly if absent — never silently text-only).
- **A one-model box still works completely:** every profile resolves to the one
  model; the Providers screen notes which tiers run below preferred capability.
- **The student sets policy, not plumbing:** a dial — **local-first**
  (privacy/cost; background extraction never leaves the box) vs **quality-first**
  (deep work → best model anywhere); per-tier pins override auto-resolution.
- **Observable:** settings shows the live resolution table and recent calls'
  models — no silent degradation.
- *(M5)* **Spend is visible:** tokens + estimated cost per feature; a running
  cloud-spend meter.
- The tier table is **data** (JSON/settings), not code — re-tunable without a
  deploy. The router returns `(endpoint, model, token_budget)`; the F6 assembler
  consumes that budget, so the two doors compose.

### F8 — Practice: review queue, Gym, exam sim, explain-it-back *(M4)*

**Intent:** the right practice at the right time, weakness-first.

- **Review queue (push):** a scheduled action selects **due concepts by a
  forgetting model** — **half-life regression** (FSRS/Duolingo-style: predict
  recall + memory half-life from time-since-last-seen, #seen, #correct/#incorrect,
  difficulty) with **expanding intervals** (Leitner) — weak + stale first. It
  assigns a practice item **preferring real course exercises**
  (`kind=problem|exercise|try_it`), generating only as fallback; caps at a sane
  daily size. Worked one at a time, course-labeled; answer in chat (text or
  photo); each ends with correct/partial/missed + a citation; outcome **writes
  evidence immediately**. **Exam-aware:** a midterm on the calendar
  weights that course's shaky prerequisites heavier.
- **The Gym (pull):** pick a topic (or "coach's pick") → a set **calibrated to
  current mastery**, real exercises first. **Weakness gets priority** (flagship:
  free-body-diagram errors → those lead the set as challenge questions; mastered
  content **not re-fed as filler**). **Adapts mid-session** (two right → step up;
  two wrong → scaffold down + cite the section to re-read). Every outcome **feeds
  the graph** (the densest evidence source); a set summary lands on the dashboard
  momentum strip.
- **Exam simulation:** timed, mixed-topic, **no hints**, weighted to the real
  exam's scope; the tutor stays **silent until submission**. The **debrief** is
  where learning happens: per-problem grading + citations + evidence + a
  readiness readout against the real date.
- **Explain-it-back:** the student teaches a concept (typed or canvas); the tutor
  **plays curious student**, probing gaps, never lecturing until the explanation
  stands. Explanation quality is the strongest mastery signal.

### F9 — Calendar & notes as study instruments *(course-binding M5)*

**Intent:** study time and study record, attached to courses.

- Recurring **study blocks** on the calendar (CalDAV sync out); opening PuttyU
  during a block suggests resuming that course tab.
- **Session-summary notes:** after a substantive session, an action drafts a
  course note (covered / clicked / shaky / citations); the student **edits before
  save** — it's the student's note, the tutor only drafts.
- Notes stay first-class: pin/archive/browse per course; the tutor can read
  course notes as context when asked.

### F10 — The tutor persona & the adaptivity dial *(M5)*

**Intent:** one patient tutor, tuned per student and per course.

> The persona is not prose — it is **composed from versioned, source-cited,
> Gate-7-verified prompt modules** that encode learning-science pedagogy and are
> grounded in the student's live model on every turn. See
> `docs/TUTOR-PROMPT-ARCHITECTURE.md` (with F3 grounding, F6 assembler).

- **Zero-config default:** patient, Socratic-leaning, cites the library, admits
  uncertainty, never shames.
- **Adaptivity dial** (per course): scaffolding (guide ↔ direct), pace (gentle ↔
  intense), tone (warm ↔ matter-of-fact); the graph still auto-adjusts difficulty
  *within* whatever is chosen.
- **Course-shaped behavior without new code:** a lit course leans
  discussion/close-reading; a stats course leans worked examples — content-driven,
  not hardcoded.
- **The integrity stance:** full answers on explicit request; never moralizes,
  surveils, or refuses; framing stays pedagogical.

### F11 — The dashboard: home base *(M5)*

**Intent:** one place that answers "what should I do right now?" Every card is a door.

- **Login lands on the dashboard** (not an empty chat); tabs/tools one click away;
  new courses addable here.
- **Today at a glance:** today's calendar, due/overdue todos, the review-queue
  count, "resume where you left off" — each opens its full resource.
- **Reading recommendations are doors into the library:** "Before Tuesday: read
  §7.2 (pp. 201–214)" → opens the PDF at page 201.
- **Weak-spot card → the Gym** preloaded on that topic.
- **Momentum strip:** recent insights as plain sentences ("breakthrough with
  hypothesis testing (Tue)") → click opens the concept's trajectory. Narrative,
  not score.
- **Mini-chat** widget (tier=light, ambient context); "open in full chat" carries
  the same session — one conversation, two surfaces.
- **Quick capture:** add a todo from the dashboard, bound to the course, due-dated.
- **Cmd/Ctrl-K** opens global search across courses, notes, materials, sessions,
  todos, concepts; picking a result deep-links to its surface.
- **Stays calm:** no streaks/XP/leaderboards; an empty day says so plainly.

### F12 — Later (specced now so seams stay open; NOT v1)

- Multiple students share an instance (`owner_scoped` becomes blocking; per-student
  graph/courses/sessions; library stays shared/read-only).
- Video sources (transcript chunks, time locators, timestamp-deep-linked
  citations).
- Mobile PWA (dashboard + review + mini-chat installable; full workspace stays
  desktop-first).
- Push nudges via ntfy (calm rules apply).
- Backup & per-course export (the graph is the first irreplaceable data this app
  creates).
- Anki export of review items.
- **Voice (TTS/STT): permanently rejected.** Reading is the medium.

---

## 11. Non-goals & explicitly deferred

- **Not** a general AI assistant. Odysseus's email / cookbook / model-serving /
  gallery / deep-research-as-product features are **out of scope** — we borrow its
  *UI/UX shell*, not its feature breadth.
- **No voice.** No TTS/STT, ever.
- **No gamification.** No streaks/XP/leaderboards.
- **No multi-student in v1** (seam only).
- **No cross-OS support.** Linux only.
- **No Alembic in v1** — idempotent startup migrations on SQLite (revisit if
  schema logic gets complex).
- **No full node-graph visualization in v1** — a state-colored list/tree of
  concepts (cheaper, clearer at small scale).
- **No formal efficacy study in v1.** "Does the tutor *cause* learning?" is a
  causal claim deferred to post-M5 — designed for a **randomized feature rollout**;
  observational claims would need propensity/RDD/HTE controls and confounding/
  regression-to-the-mean guards (`docs/LEARNING-SCIENCE.md` §2.6). v1 ships the
  Gate-7 behavioral evals, not an efficacy claim.
- **The ensemble graph, practice engine, dashboard, miner, and canvas are
  deferred to their milestones (M3–M6).** They are specced in full here, but
  **not built until the milestones before them are green.**

---

## 12. Lessons from OLD-REF (what to avoid)

OLD-REF realized this same vision but **over-scoped** — ~92k LOC Python + ~139k
LOC TypeScript across tightly-coupled subsystems, where a bug in one (the context
assembler, the router, the persona) cascaded into all tutoring behavior. What we
do differently:

1. **Build one milestone at a time, fully green, before the next.** The
   comprehensive spec is a north star, not a license to build everything at once.
2. **Defer the ensemble graph past the core loop.** Ship grounded chat (M1) and
   worksheets (M2) before the bi-temporal graph (M3). When mastery lands (M3), use
   the field-standard **BKT** (it's interpretable and bounded) — don't gold-plate
   past it (DKT etc. stay deferred).
3. **Keep the spine subsystems decoupled and one-door** (user data, graph, model
   router) so a fault is contained and testable.
4. **No god-files from day 1** — the file-size ceiling (Gate 6a) is enforced from
   M0, not retrofitted.
5. **Make confirm-first flows visible/sync, not silent async.** If extraction or
   grading fails, the student must know — it can't fail into nothing.
6. **Ship a small curated corpus first** (a few textbooks), not "all of arXiv".
7. **Prove single-student before wiring multi-student.**

What we **keep** from OLD-REF: the vision, the verifiability-as-mechanical-gates
discipline, the two-store corpus design, the typed OpenAPI contract, the one-door
invariants, and the design identity.

---

## 13. Resolved decisions & open questions

**Resolved (owner-delegated in OLD-REF, carried forward):**

- Mastery UI = 4 states (unknown/learning/shaky/mastered) over continuous
  evidence; **no percentages** shown.
- **Mastery algorithm = per-concept BKT** (4 params, Bayesian update, clamp
  P(G)<0.3, P(S)<0.1), recomputed from an append-only evidence log; PFA/LKT for
  multi-KC items; DKT deferred. (`docs/LEARNING-SCIENCE.md` §2.1.)
- **Interaction-event log from M0/M1:** append-only, timestamped, with leakage-safe
  `as_of`-gated feature derivation (ADR-0004) — the substrate the mastery model
  recomputes from.
- **Spaced review = half-life regression** (expanding intervals), not plain decay.
- **Tutor pedagogy is prompt-engineered from learning science and Gate-7 verified**
  (`docs/TUTOR-PROMPT-ARCHITECTURE.md`); eval rigor in ADR-0002 (§7 Gate 7).
- **Dashboard/Progress viz follows the evidence:** categorical state colors (no
  percentages), prescriptive momentum, **no social comparison/leaderboards**,
  blank-box for unknowns (`docs/DESIGN-SYSTEM.md`).
- Graph seeding = from source structure (deterministic), not an LLM pass at
  import; **edges validated by correctness-covariance**, refined (split/merge) over
  time; embedding-clustering may suggest concept families (ADR-0003).
- Review items answered **in the chat surface** (not a separate flashcard UI).
- Memory engine = **build the graph on SQLite (one-door API); Graphiti is the
  named flip-target.** See §13.1 for the full rationale, the M3 spike, and the
  flip condition.
- Routing v1 = **static profile→tier→model table** with capability tags on
  endpoints (deterministic, debuggable); no LLM-assisted routing yet.
- Todos = a new small `todo` table (not scheduler tasks, not notes).
- Dashboard = a **fixed curated card layout** in v1 (window manager covers
  power-user free-form windows elsewhere).
- Coupling control = **mute-only** in v1.
- Periphery = shared nodes + 1-hop edges, ≤1 line per coupled course, ~15% budget
  cap.
- Canvas = submit as **PNG**, persist PNG + stroke-data JSON sidecar; plain
  Pointer Events + `<canvas>`.
- arXiv papers = Marker-converted PDFs through the same importer.

**Open (decide at the relevant milestone):**

- **O1 (resolved):** the **putty-ai-design** kit is the design system
  (`docs/DESIGN-SYSTEM.md`) — tokens, 16+1 themes, fonts, mascot, and the `pa-`
  component library ported into `web/` at M0.
- **O7 (resolved):** product wordmark = **"puttyU"** (in the putty-ai type, with
  the putty-blob mascot); **no tagline** on the login/header.
- **O2 (resolved):** frontend tests = **Bun test** (unit/component, via
  `@testing-library/react` + happy-dom) + **Playwright** (e2e). Bun is the whole
  toolchain; no Vitest.
- **O3 (M1):** which textbooks to ingest first for the worked example (default:
  statistics + calculus + one science book).
- **O4 (M1):** PDF viewer library (pdf.js) integration details.
- **O5 (M3):** ADR-0005 for the graph schema + mastery update rule, written
  *after* the Graphiti spike (§13.1), before M3 code.
- **O6 (resolved):** **MCP server surface dropped from v1** (not core to
  tutoring); revisit later — Odysseus's MCP patterns remain a reference if we add it.
- **O8 (M3, ADR-0005):** **cross-course KC identity.** Two stats courses both have
  "confidence intervals" — same concept node or two? Cross-course transfer (F6)
  needs KC *identity* across sources, but structural seeding creates per-source
  concepts. Decide the dedup/aliasing rule (candidate: embedding-cluster + confirm).
- **O9 (M3):** **BKT parameters in a single-student world.** Per-skill BKT params
  can't be *fitted* with one student's sparse data. v1 uses **seeded default
  params** (e.g. L0≈0.3, T≈0.1, G≈0.2, S≈0.1, clamped) — confirm; per-skill
  fitting waits for cross-student data (multi-student / later).

### 13.1 Memory engine: SQLite-native now, Graphiti as flip-target

**Decision (2026-06-19):** build the student graph on **SQLite** behind the
`src/graph/` one-door API for v1; **Graphiti is the named flip-target**, evaluated
by a spike at M3.

**Why this isn't just "Graphiti yes/no."** PuttyU's "student graph" is two
subsystems with different best-tools:

- **(A) Curriculum concept-mastery** — concept nodes seeded from textbook
  structure (closed-world), append-only mastery *evidence*, derived mastery
  *state* per concept (**BKT knowledge tracing**). This is the educational
  core and the hard part. **Graphiti does not do this** — it's a temporal
  knowledge-graph engine, not a knowledge-tracing engine. We build (A) ourselves
  regardless of backend.
- **(B) Temporal ensemble memory** — verbatim observations, inferred insights,
  the student's-world entities, bi-temporal invalidation, provenance, trajectory
  queries. This **is** Graphiti's wheelhouse (OLD-REF's spec already adopts its
  *semantics*; on temporal reasoning Graphiti/Zep leads Mem0 ~64% vs ~49% on
  LongMemEval).

So adopting Graphiti would cover (B) and leave (A) to us anyway.

**Why SQLite-native for v1:**

- **One door makes it swappable.** `src/graph/` is the only entry point (§5.5), so
  the engine can change later without touching a single call site. Choosing SQLite
  now costs nothing later.
- **No graph-DB server.** As of 2026 Graphiti's backends are servers (Neo4j /
  FalkorDB / Neptune); its embedded **Kuzu backend is deprecated** and the
  embedded `falkordblite` is in-development, not stable. Adopting Graphiti today
  means running a graph database beside SQLite + Chroma — real ops weight for a
  single-user box, against the "start slow" rule.
- **Extraction on our terms.** Graphiti's ingestion is LLM-heavy, open-world, and
  "works best" with frontier structured-output models (OpenAI by default). PuttyU
  wants extraction on the **light/local** router tier, constrained to the
  curriculum vocabulary. SQLite-native lets us do exactly that.
- **The right lesson from OLD-REF.** What got out of hand wasn't bi-temporal
  *storage* (modest SQLite when the graph is curriculum-anchored and mostly
  closed-world) — it was coupling and the mastery model. Graphiti removes neither.

**M3 spike (before writing ADR-0005):** head-to-head on real ingested textbooks +
synthetic study sessions, measuring (1) extraction quality on the light/local
tier, (2) operational cost of a graph DB on a single-user box, (3) retrieval
quality vs. our SQLite + Chroma hybrid. Record the outcome and the flip condition
in ADR-0005.

**Flip condition — adopt Graphiti when any holds:** we move to multi-student or a
large shared corpus (its hybrid retrieval + maintained engine earn their keep at
scale); the embedded `falkordblite` backend stabilizes (removes the server cost);
or our custom temporal layer becomes a maintenance burden. The flip touches only
`src/graph/` internals.

---

## 14. Glossary

- **Corpus / library** — the curated, cited, read-only source of truth.
- **Course** — a student-declared scoping dimension (`course_id` is nullable
  everywhere → Home tab works course-less).
- **Episode** — an immutable interaction moment (chat turn / upload / answer)
  referenced by id; not a new store.
- **Observation** — a *stated* assertion (verbatim, episode-linked).
- **Insight** — an *inferred* assertion (confidence + source episodes;
  invalidated, never deleted).
- **Mastery state** — a derived projection over append-only evidence
  (unknown/learning/shaky/mastered), computed by **BKT**.
- **Knowledge component (KC)** — a tightly-defined skill; the unit mastery is
  tracked at. Items are tagged to KCs (a **Q-matrix**).
- **BKT** — Bayesian Knowledge Tracing: the per-concept mastery algorithm
  (4 params, Bayesian update, degeneracy clamps).
- **Focus / periphery** — context tiers: the active course dominates; coupled
  courses ground.
- **Task profile** — the declared needs of an LLM call (tier + modality + output
  shape + latency/privacy).
- **One door** — a subsystem with exactly one mechanically-enforced entry point
  (user data, graph, model router).
- **Gate** — a mechanical CI check that fails the build when an invariant is
  violated.

---

*Next: review this spec → adjust scope/decisions → begin **M0 (foundation &
spine)**: repo skeleton, CI gates, typed contract, the Odysseus-style shell, and
streaming chat — all green — then **M1 (courses + library + grounded chat)**.*
