# SPEC — Phase 2: Tutoring workspace UX (Gherkin deep dive)

> UX-first discovery spec for converting puttyU from "lean AI workspace" into the
> full tutoring/learning workspace. **Read order:** `CLAUDE.md` →
> `docs/adr/0001` → `0002` → `0003` → `docs/SPEC-phase-1-lean-core.md` → this file.
> Phase 1 (all KEEP screens, verifiability gates) is DONE; Slice 7 (demolition of CUT
> code + legacy `static/`) is pending and independent of this spec.

- Status: **v1.0 — FROZEN for implementation (2026-06-12).** §6 questions all
  resolved (owner delegated); ADR-0004 (course model) + ADR-0005 (ensemble
  graph) accepted; §7 is the build order. Scenarios are the acceptance layer —
  Playwright specs adopt the Gherkin names. Draft history: (v0.2: added
  Feature 6 — the student context
  protocol: focus & periphery; renumbered F6–F10 → F7–F11. v0.3: Feature 5
  became the **ensemble memory graph** — verbatim observations + LLM insights,
  episodes with provenance, bi-temporal validity — grounded in the 2026-06-12
  research survey of DyG-RAG / Graphiti / Mem0 / knowledge tracing. v0.4: added
  Feature 7 — the model router: feature-based model selection across providers;
  renumbered F7–F11 → F8–F12. v0.5: Feature 11 became the **dashboard** — the
  Jira-style home base with todos, reading recommendations, and a mini-chat;
  Feature 8 gained **the Gym** — student-driven, weakness-targeted practice.
  v0.6: student **course-material uploads** promoted from F12-later into
  Feature 2 — syllabi/homework/any PDF, user tags steering retrieval, and the
  **schedule miner**: syllabus dates → proposed calendar events + todos.
  v0.7: **webcam document capture** added to Feature 4 — photograph paper
  documents from any upload surface; multi-page capture assembles into one
  material. v0.8: **the canvas workspace** added to Feature 4 — draw with
  mouse/drawing pad/stylus IN the app; one-click submit to the tutor;
  iPad-as-input via browser now, companion pairing later. v0.9: persona name
  dropped — "the user" throughout; **voice rejected: reading is the medium**
  (TTS/STT stay CUT); added calibration (F1), exam simulation + explain-it-back
  (F8), typed math input (F4), Cmd-K global search (F11), cost meter (F7),
  integrity stance (F10), Gate-7 tutor evals + untrusted-content invariant
  (§5), and @later seams: mobile PWA, ntfy nudges, backup/export, Anki export.)
- Date: 2026-06-12
- Owner: solo maintainer (agent-built), single-student v1
- Style: Gherkin (Given/When/Then). Every feature carries a **Grounding** note tying
  it to code that exists today, and scenarios are tagged:
  - `@exists` — works today, scenario is a regression contract
  - `@partial` — backend or UI exists, the other half (or the wiring) is new
  - `@new` — net-new build

---

## 0. Vision (owner's words, 2026-06-12)

> "I want to ultimately have a database filled with textbooks and literature and
> papers from arXiv, etc. that will act as the source of truth. The student will be
> able to log in and set what their current course load is — that determines the
> different 'courses' that are available to tab through, and it informs the AI what
> content to pull from and how to help, using its built-in knowledge and using the
> library as a source of truth. This platform needs to be extensible and able to
> fit any course the student enters. I want to use a graph-style memory system that
> will allow the AI to be flexible with learning what the past and current state of
> the student is and how to adjust its content based on this."

Addendum (same day): *all* LLM calls that require user context must access the
user graph and be aware of the current user state — and **focus matters**: when
the student is working on Calculus 1 while also taking calc-based Physics, the
context should be predominantly calculus-specific, with enough awareness of the
related course that the LLM can ground the calculus in something tangible from
the current physics coursework. Extrapolate this to all potential connections.

Addendum 2 (2026-06-12, after the memory-architecture research survey): the tool
must have a **comprehensive ensemble memory structure**. The owner likes the
Graphiti approach — preserving user interactions over time so the LLM can analyze
a student's progress of learning. The graph holds BOTH what the user actually
says ("I like ice cream") AND insights the LLM makes about the user ("the user
has made a breakthrough with concept X").

Addendum 3 (2026-06-12): **feature-based decision making over which LLM to
call** is a core function. Keep a list of available LLMs — Anthropic API, local
Ollama models — and, depending on the context, use the appropriate model for
the task: a simple yes/no → a light model; high reasoning → Claude; etc.

Addendum 4 (2026-06-12): the platform takes on a **Jira-type dashboard** as the
login surface — all core functions reachable (add classes etc.), integrated with
todos and calendar (it informs the user what needs doing and what's coming up),
a small chat window for quick questions (the full chat tab remains), direct
links to reading recommendations that open the PDF viewer at the exact page —
everything useful for tutoring presented with links to the full resource.
User-friendly; promotes efficient learning. Plus **the Gym**: the user selects
a topic and the LLM generates problems for that course calibrated to the
student's current level — e.g. if a physics student has had a tough time with
free-body diagrams in homework, the LLM prioritizes challenge questions that
strengthen that weakness, instead of feeding already-mastered content over and
over.

Addendum 8 (2026-06-12): no fictional persona names in the spec — say "the
user" or something generic. And **no speech-to-text: the user MUST READ.**
Voice (TTS and STT) stays CUT — reading is deliberate pedagogy, not a missing
feature. The 2026-06-12 gap-analysis suggestions (calibration, exam simulation,
explain-it-back, typed math, global search, evals, the injection invariant,
and the @later ops seams) were all accepted into the spec.

Addendum 7 (2026-06-12): there needs to be a **canvas-style workspace** — draw
with a mouse, or connect a drawing pad / iPad / whatever, to do the work in the
app itself. This makes it easier to get the work to the LLM.

Addendum 6 (2026-06-12): the app must be able to **take pictures of documents
using a webcam** — paper worksheets, handouts, syllabi — feeding the same
ingestion paths as file uploads.

Addendum 5 (2026-06-12): the user must be able to **upload documents** —
syllabus, homework sheets, and PDFs of other kinds — and **add tags** to the
content, which helps the LLM when it needs to search for specific content. The
system should be smart enough to read these files in (a syllabus, a course
schedule with test and homework dates) and **autofill the calendar**.

Decisions captured with the vision:
- **Primary persona: the student, self-serve.** The instance owner is an admin who
  curates the library; in v1 they are usually the same person. Multi-student comes
  later (Gate 5 `owner_scoped` is the prepared seam).
- **Level: adaptive.** Not one audience — tone, scaffolding depth, and pacing are a
  per-student (later per-course) dial the tutor reads and the student can override.
- **Subject: any.** The library is source-type-agnostic (ADR 0003); scenarios below
  use statistics as the worked example because `example-textbook/statistics/` is the
  proven import.
- **One door to the student.** No LLM call site assembles user context ad hoc;
  everything goes through the student-context assembler (Feature 6), which reads
  the graph and produces focus-dominant, periphery-aware, budget-tiered context.
- **Ensemble memory with provenance.** One temporal graph holds verbatim
  observations (stated by the user, quoted, episode-linked) and inferred insights
  (concluded by the tutor, confidence-scored, episode-cited) — never silently
  merged. Beliefs are invalidated, never deleted (bi-temporal, Graphiti-style),
  so the learning *trajectory* stays queryable, not just the current state.
- **Declare the need, not the model.** LLM call sites carry a task profile
  (reasoning tier, modality, output shape); the model router (Feature 7)
  resolves it against the configured providers. No call site names a model.
- **Dashboard-first.** Login lands on the dashboard. Every card is a door —
  a summary that deep-links into the full feature (reading rec → PDF at the
  page; weak spot → the Gym preloaded; todo → the course it belongs to).
  Informative, never gamified.
- **Train the weakness, don't grind the strength.** Practice generation (Gym
  and review queue alike) reads the graph and prioritizes shaky/weak nodes;
  mastered content is never re-fed as filler.
- **Reading is the medium.** No TTS, no STT — voice stays CUT (owner decision,
  2026-06-12). The tutor's output is text the user must read; the user's input
  is typed, drawn, or uploaded. This is pedagogy, not a gap.
- **Course materials are first-class.** The user's own uploads (syllabus, homework
  sheets, any PDF) sit beside the curated library in course-scoped retrieval,
  carry user tags the LLM can filter on, and get mined for structure — dates
  become proposed calendar events and todos (confirm-first, provenance-linked).

## 1. Personas

| Persona | Role in v1 | Notes |
|---|---|---|
| **The user** (the student) | The only seat. Logs in, declares a course load, studies. | Level is a dial, not an age. The user might be in AP Stats, a college lit seminar, and teaching themselves transformers from arXiv — simultaneously. No fictional persona names in this spec (owner directive). |
| **The owner/admin** | Curates the library (Marker imports), configures providers, runs the box. | Same human as the user in v1. Admin actions stay out of the user's daily surface. |
| **The tutor** (the product) | The AI persona across every course tab. | "Your patient tutor." Grounded in the library, honest about its limits, adapts to the graph's picture of the user. |

## 2. Domain model — the new nouns

| Concept | Definition | Existing seam it lands on |
|---|---|---|
| **Library** | The curated, shared, read-only corpus: textbooks, literature, arXiv papers, (later) video transcripts. Source of truth the tutor cites. | `src/corpus/` (built, unwired): `corpus_source`/`corpus_chunk` + Chroma `corpus` collection, ADR 0003 |
| **Course** | A student-declared unit of study ("AP Statistics", "Victorian Lit", "Transformer papers"). Owns: linked library sources, a concept graph region, a tutor configuration, sessions/notes/events scoped to it. | `course_id` seam already on `corpus_source`/`corpus_chunk` + Chroma metadata (ADR 0003, "deliberately deferred") |
| **Course materials** | the user's own uploads into a course — syllabus, homework sheets, lecture slides, any PDF. Owner-scoped (beside the shared library), **user-taggable**, retrievable with citations, and mined for structure. | `corpus_source.owner` seam (ADR 0003) + documents PDF-import VL path + the Slice-3 upload UI kept "metadata-extensible" for exactly this |
| **Tags** | Free-form labels the user puts on materials ("syllabus", "homework", "week-3", "exam-prep"). Filter the library panel AND steer retrieval — the LLM can scope a search to a tag. | chunk/source `meta` JSON + Chroma scalar metadata (ADR 0003 seam) |
| **Schedule miner** | The extraction pass that reads a schedule-shaped upload (syllabus, course calendar) and proposes dated calendar events + todos — confirm-first, idempotent on re-upload, every proposal provenance-linked to the page it came from. | `memory_extractor` pattern + F7 routing (structured output) + calendar CRUD + todo model |
| **Course load** | The set of courses currently active. Renders as **tabs**. Archivable (semester ends), never silently deleted. | new `course` table |
| **Student graph (ensemble)** | One temporal graph per student: **concept nodes** (curriculum, seeded, closed-world) + **entity nodes** (the user's world — ice cream, the dog, the band; open-world, sparse) + typed, time-stamped **assertions** between them. | new — ADR-0005 to write (§6) |
| **Episode** | The immutable interaction moment an assertion cites: a chat turn, a worksheet upload, a review answer. Episodes are receipts — never edited, never deleted. | existing `chat_messages`/uploads, referenced by id (not duplicated) |
| **Observation** | A **stated** assertion: what the user actually said, quoted verbatim, linked to its episode. "I like ice cream." | new (assertion kind=`stated`) |
| **Insight** | An **inferred** assertion: a conclusion the tutor drew, with confidence and the episodes it rests on. "Breakthrough with hypothesis testing." Invalidated (never deleted) when contradicted. | new (assertion kind=`inferred`, bi-temporal validity) |
| **Mastery state** | Per-(student, concept) evidence: level, confidence, last-seen, error patterns, source episodes. Lives ON the graph nodes; updated knowledge-tracing-style (BKT-inspired). | copies `services/memory/memory_extractor.py` extraction pattern |
| **Student context** | The tiered, budget-aware block the assembler builds for every user-context LLM call: profile → **focus** (active course) → **periphery** (coupled courses) → ambient. | new `src/student_context.py` (Feature 6); reads the graph, read-only |
| **Task profile / model router** | The declared needs of an LLM call (tier: micro/light/standard/deep; modality; output shape; latency & privacy preference) and the resolver that maps it to a configured endpoint+model. | extends the `endpoint_resolver.py` purpose-chain + the Providers screen (Feature 7) |
| **Review queue** | Spaced-repetition stream of due items derived from mastery decay + scheduler — the system *pushes*. | `src/task_scheduler.py` + `src/builtin_actions.py` + event bus |
| **Gym** | Student-driven targeted practice — the user *pulls*: pick a course/topic (or coach's pick), get a problem set calibrated by the graph: weakness-first, adaptive difficulty, real course exercises before generated ones. | F8; corpus `kind` metadata + F5 evidence/insights + F7 routing |
| **Todo** | A lightweight, course-scoped task with a due date (homework, readings, "finish problem set"). Surfaces on the dashboard and calendar. Distinct from scheduler tasks (automation). | @new small table + CRUD |
| **Dashboard** | The login surface: today's calendar + due todos + review/gym status + reading recommendations + momentum + mini-chat, every card deep-linking to its full feature. | new screen composing existing queries; shell/window manager |
| **Study session** | A chat session bound to a course (and optionally a planned calendar block). | existing `sessions` + `calendar_events` |
| **Worksheet analysis** | Photographed/scanned handwritten work → VL extraction → graded, line-referenced feedback. | existing chat attachments → `document_processor`; documents PDF import |
| **Tutor persona** | The system-prompt + behavior profile of the tutor, parameterized by course + adaptivity dial. | `src/preset_manager.py` + skills |

---

## 3. The UX, Gherkin style

### Feature 1 — First run & course load

> **Grounding:** login/auth, sessions, and the shell exist (`web/src/features/auth`,
> Slice 1). Course CRUD, the course-load picker, and tabs are `@new`.

```gherkin
Feature: Declare a course load
  As the user, I tell puttyU what I'm studying so every surface scopes itself to my courses.

  Background:
    Given a fresh instance with at least one LLM provider configured
    And the library contains an imported statistics textbook

  @new
  Scenario: First login lands on course setup, not an empty chat
    Given the user logs in for the first time
    Then the user sees a welcome step: "What are you studying right now?"
    And the user can add a course by typing a free-form name, e.g. "AP Statistics"
    And the user is NOT required to pick from a fixed catalog

  @new
  Scenario: Creating a course suggests matching library sources
    When the user creates the course "AP Statistics"
    Then puttyU searches the library for relevant sources
    And suggests "Introductory Statistics (OpenStax)" as a linked source
    And the user can accept, reject, or search the library manually
    And the course is created even if NO library source matches
      # extensibility: any course, with or without library coverage

  @new
  Scenario: A course without library coverage is honest about it
    When the user creates the course "Mandarin 2" and the library has no Mandarin sources
    Then the course tab is created and fully usable
    And the course header shows "No library sources linked — tutor is using
      built-in knowledge only" with a link to request/import sources

  @new
  Scenario: Course load renders as tabs
    Given the user has courses "AP Statistics", "Victorian Lit", and "Transformers"
    When the user opens puttyU
    Then the shell shows the three course tabs plus a "Home" tab
    And the active tab scopes chat, practice, notes, and progress to that course

  @new
  Scenario: Archiving a course at semester end
    When the user archives "Victorian Lit"
    Then its tab disappears from the active load
    And its sessions, notes, mastery history, and graph region are retained
    And the user can re-activate it from course settings at any time

  @new
  Scenario: Optional calibration warms up the graph
    When the user creates "Calculus 1"
    Then the tutor offers a short calibration: "want to show me where you
      are? ~10 minutes, stop anytime"
    And a handful of adaptive problems (gym machinery, F8) walk the course's
      concept region — stepping down when the user misses, skipping ahead
      when they don't
    And every answer writes mastery evidence — the graph starts WARM
    And skipping is completely fine: the graph stays "unknown" and
      calibrates organically through normal studying
      # unknown ≠ failing; calibration just compresses the blind first weeks
```

### Feature 2 — The library (source of truth)

> **Grounding:** the import pipeline, chunker (atomic Example/Problem/Solution
> blocks), retriever, citations with page locators, and the `python -m src.corpus`
> CLI exist and are tested (49 tests). There are **no HTTP routes, no UI, and the
> tables aren't in `init_db`** — that wiring is the `@partial` work. Admin import
> stays CLI-first; the student-facing library browser is `@new`.

```gherkin
Feature: A curated library the tutor cites
  The library is shared, read-only, and authoritative. Students browse it;
  only the admin grows it.

  @partial
  Scenario: Admin imports a Marker-format textbook (CLI, exists today)
    Given a Marker-output directory for "Introductory Statistics"
    When the admin runs `python -m src.corpus /path/to/book`
    Then a corpus_source row is created with content-hash idempotency
    And pedagogical blocks (Example/Problem/Solution/Try-It) are atomic chunks
    And re-running the command imports nothing new

  @new
  Scenario: Admin imports an arXiv paper
    Given a Marker-output directory for an arXiv paper (PDF → markdown)
    When the admin imports it with source_type "paper"
    Then it chunks by section with page locators like any source
      # requires: a "paper" source_type (ADR 0003 lists textbook|literature|
      # video_transcript — extend the enum, same tables)

  @new
  Scenario: The user browses the library inside a course
    Given "AP Statistics" links the OpenStax statistics textbook
    When the user opens the Library panel in the course tab
    Then the user sees the linked sources with title, authors, and type
    And can expand a source into its table of contents (heading_path tree)
    And can open the original PDF at a specific page
      # ADR 0003: original_path is served for direct student access, never embedded

  @new
  Scenario: Citations are doors, not decorations
    Given the tutor answered with a citation "[Intro Stats §2.3, p. 87]"
    When the user clicks the citation
    Then the library panel opens the source at that section
    And offers "open PDF at page 87"
```

The library is shared and admin-curated; **course materials** are the user's own —
owner-scoped uploads that sit beside it in retrieval (promoted from F12-later,
v0.6):

```gherkin
Feature: The user's course materials — uploaded, tagged, mined
  Syllabi, homework sheets, lecture slides, any PDF. Tagged by the user,
  retrievable with citations, and read for structure the moment they land.

  @partial
  Scenario: Upload anything course-shaped
    Given the user is in "Physics 1"
    When the user drags in the course syllabus PDF (or a homework sheet, or any PDF)
    Then it ingests through the existing PDF/VL extraction path
    And lands as an owner-scoped course material — beside, never inside,
      the shared read-only library

  @new
  Scenario: Tags steer the LLM's search
    When the user tags the upload "syllabus" and another "homework week-3"
    Then the library panel can filter by tag
    And retrieval can scope to tags — "check my week-3 homework sheet"
      resolves against materials tagged week-3, not the whole corpus
    And the system may SUGGEST tags at upload ("looks like a problem set —
      tag as homework?") which the user confirms or edits — never silently applied

  @new
  Scenario: The user's materials join course retrieval, with citations
    Given "Physics 1" has the library textbook and the user's uploaded materials
    When the user asks "what did problem 3 on this week's sheet actually want?"
    Then retrieval covers both stores, scoped to the course
    And answers cite the user's documents the same way ("[your week-3 sheet, p. 2]")
      with the same click-through door

  @new
  Scenario: The syllabus autofills the calendar — the flagship case
    When the user uploads the syllabus with its schedule of homework and exam dates
    Then the schedule miner detects schedule-shaped content
    And proposes the extracted set in a review sheet: "Found 11 homework due
      dates, 3 exams, 1 final — add to calendar and todos?"
    And the user can bulk-accept, prune, or edit before anything is written
    And every created event/todo carries provenance back to the syllabus page
      it came from
      # confirm-first, same principle as tutor-proposed todos (§6 Q12):
      # propose, never silently write

  @new
  Scenario: Re-uploading an updated syllabus diffs, never duplicates
    Given the professor moves the midterm and the user uploads syllabus v2
    Then the miner re-runs idempotently (content-hash, like the corpus importer)
    And proposes only the CHANGES: "midterm moved Oct 12 → Oct 19 — update?"
    And confirmed updates adjust the existing events instead of cloning them

  @new
  Scenario: Ambiguity is asked about, not guessed
    Given the syllabus says "Problem set due Week 5" with no resolvable date
    Then the proposal flags it ("couldn't resolve 'Week 5' — when does week 1
      start?") instead of inventing a date
      # a wrong exam date is worse than no exam date

  @new
  Scenario: Schedule data sharpens everything downstream
    Given the syllabus autofill landed exam and homework dates
    Then the review queue's exam-aware weighting (F8) and the dashboard's
      at-a-glance + reading recommendations (F11) run on REAL course dates
      — no manual calendar entry required first
```

### Feature 3 — Grounded tutoring chat (the core loop)

> **Grounding:** streaming chat, markdown+LaTeX rendering, stop-generation,
> session history, and attachments all exist (`web/src/features/chat`). The
> retriever exists. What's `@new`: wiring corpus retrieval into the chat context
> by course, the citation contract in responses, and the Socratic/adaptive
> behavior contract (tutor persona, Feature 10) and the context the tutor sees
> (Feature 6).

```gherkin
Feature: Course-scoped, library-grounded tutoring
  Within a course tab, the tutor answers from the library first, its own
  knowledge second, and always shows which is which.

  @new
  Scenario: A question inside a course pulls from that course's sources
    Given the user is in the "AP Statistics" tab
    When the user asks "what's the difference between a parameter and a statistic?"
    Then retrieval runs against the corpus scoped to the course's linked sources
    And the answer is grounded in retrieved chunks
    And ends with citations like "[Intro Stats §1.1, p. 9]"

  @new
  Scenario: The tutor is honest when the library can't back it up
    Given the user is in "AP Statistics"
    When the user asks about a topic the linked sources don't cover
    Then the tutor answers from built-in knowledge
    And visibly marks it: "not in your course library — answering from my own
      knowledge"
      # trust contract: never fake a citation; ADR 0003 metadata makes
      # provenance checkable

  @new
  Scenario: Socratic default for problem-solving
    Given the course tutor mode is "guide" (default)
    When the user pastes a homework problem
    Then the tutor does NOT produce the final answer first
    And instead asks what the user has tried, or offers the first scaffold step
    And the user can always say "just show me" to get the full worked solution
      # patient, not withholding — the dial, not a wall

  @new
  Scenario: Adaptivity — the same question, two different students
    Given the graph shows the user has mastered "sampling distributions"
    When the user asks about the Central Limit Theorem
    Then the explanation builds on sampling distributions by reference
    But given the graph shows "sampling distributions" is weak
    Then the tutor first checks that prerequisite with a one-line probe question

  @exists
  Scenario: The mechanics that already work stay working
    Given the user is in any chat
    Then responses stream token-by-token and render markdown + LaTeX
    And the user can stop generation mid-response without corrupting history
    And sessions persist, can be renamed inline, and reload with history intact

  @partial
  Scenario: Agent mode stays available for tool-using study tasks
    Given the user toggles Agent mode in a course chat
    When the user asks "make me a formula sheet from my last three sessions"
    Then tool steps render inline (tool name, command, output) as today
    And the result lands as a versioned document in the course
      # exists: agent loop + steps UI + documents; new: course scoping
```

### Feature 4 — Doing the work: worksheets, capture & the canvas

> **Grounding:** this is the "tutoring killer feature" already working end-to-end:
> chat attachments upload to `/api/upload`, `document_processor` runs VL
> extraction; documents PDF import does the same for scans. `@new` is the
> *pedagogical* layer: line-referenced grading and feeding results to the graph.

```gherkin
Feature: Photograph homework, get patient line-by-line feedback

  @exists
  Scenario: Attach a photo of handwritten work
    Given the user is in a course chat
    When the user drags a photo of a handwritten problem set onto the composer
    Then it uploads immediately and shows as a thumbnail chip
    And on send, the VL model receives the image for analysis

  @new
  Scenario: Graded feedback references the user's actual lines
    Given the user attached handwritten work for "hypothesis testing" problems
    When the user asks "check my work"
    Then the tutor extracts the worked steps
    And responds per problem: what's right, where the first error occurs,
      and a question nudging the user to find it ("guide" mode)
    And cites the textbook section that covers the mistaken concept

  @new
  Scenario: Worksheet results update the graph
    Given the feedback found a sign error in computing a test statistic
    Then the mastery extractor records evidence against
      "test statistic computation" with the error pattern
    And the review queue gains a follow-up practice item for it

  @exists
  Scenario: A multi-page scanned PDF becomes a document
    When the user imports a scanned problem-set PDF in Documents
    Then VL text extraction produces an editable, versioned document

  @new
  Scenario: The webcam is a scanner
    Given the user has a paper worksheet and no phone handy
    When the user clicks "take photo" on any upload surface
      (chat composer, course materials, document import, a gym answer)
    Then a camera view opens (getUserMedia), the user captures, previews,
      and retakes or accepts
    And the accepted shot enters the system EXACTLY like an uploaded image —
      same pipeline, no parallel path
      # v1 is capture + preview + retake; auto-crop/deskew is a later polish,
      # not a v1 gate

  @new
  Scenario: Multi-page capture becomes one material
    Given the user is capturing a 4-page handout
    When the user takes the pages in sequence and taps "done"
    Then the pages assemble into ONE multi-page material (PDF)
    And it flows through VL extraction like any scanned PDF —
      so a photographed syllabus reaches the schedule miner (F2) too

  @new
  Scenario: No secure context, no dead button
    Given the instance is served over plain HTTP on the LAN
      (browsers expose the camera only on HTTPS or localhost)
    Then the capture button shows a setup hint explaining exactly that —
      never a silently broken camera view
```

Paper → camera is the workaround; **the canvas** is the native path — do the
work in the app, and getting it to the LLM is one click:

```gherkin
Feature: The canvas — handwritten work, born digital
  A drawing workspace built on Pointer Events, so mouse, USB drawing pad,
  and stylus (with pressure) all just work. What's drawn submits to the
  tutor like any image — same pipeline, zero photography.

  @new
  Scenario: Open a canvas wherever work happens
    When the user clicks "open canvas" — from the chat composer, a gym problem,
      or as a standalone tool window (the window manager already docks it)
    Then a drawing surface opens with pen, eraser, undo, clear
    And background templates: blank, ruled, grid, coordinate axes
      # axes matter — most math work starts with them

  @new
  Scenario: Any pointing device, including pressure
    Given the user draws with a mouse, a USB drawing tablet, or a stylus
    Then strokes render via Pointer Events with pressure where the
      hardware provides it — no per-device code paths

  @new
  Scenario: One-click submit — the whole point
    Given the user worked a free-body diagram on the canvas in a gym set
    When the user clicks "send to tutor"
    Then the canvas submits as an image through the SAME path as photos (F4)
    And grading/feedback works identically (tier=vision/deep, F7)
      # easier than photographing paper — that's the feature's reason to exist

  @new
  Scenario: Feedback → revise → resubmit, on the same canvas
    Given the tutor's feedback flags the missing normal force in the diagram
    When the user reopens the canvas, adds the force, and resubmits
    Then the revision goes up as the next attempt in the same conversation
    And attempts stay distinct (v1, v2) — the worked-progress trail feeds
      the graph like any worksheet evidence

  @new
  Scenario: Canvas work persists and reopens editable
    When the user saves a canvas
    Then it lands as a course material (image + stroke data sidecar)
    And reopening it restores editable strokes, not a flat picture

  @new
  Scenario: An iPad is an input surface today, a paired one later
    Given the app is reachable on the LAN over HTTPS
    Then the user can open it from an iPad and the Apple Pencil draws on the
      canvas natively (Pointer Events again)
    And @later: the companion bridge (`companion/` — pairing tokens exist)
      pairs the tablet so a canvas drawn on the iPad lands live in the
      desktop session — draw on the pad, see it in the lesson

  @new
  Scenario: Typed math is first-class too
    When an answer calls for math and the user prefers the keyboard
    Then a math input field (LaTeX-backed equation editor) is available
      beside plain text and the canvas — in chat, gym, review, and exams
    And submitted equations render properly in the transcript
      # the third input mode: typed, drawn, or captured — never raw ASCII math
```

### Feature 5 — The student model: ensemble graph memory

> **Grounding:** `@new` subsystem, but every mechanism has a proven template —
> in-repo and in the literature (survey 2026-06-12, references in §5):
> extraction copies `memory_extractor.py` (LLM extracts structured state from
> turns → event → persist), and its tidy pass is the consolidation model;
> storage follows the two-store discipline of ADR 0003; events ride
> `src/event_bus.py`. From the research: **episodes + bi-temporal assertions +
> invalidation-not-deletion** (Graphiti/Zep), **ADD/UPDATE/NOOP reconciliation**
> against existing nodes (Mem0), **timestamped event units as the atomic record**
> (DyG-RAG), **BKT-style mastery updates** (knowledge tracing). Needs **ADR-0005**
> before build (§6).

```gherkin
Feature: A living ensemble memory of who the user is and what the user knows
  One temporal graph: concept nodes (curriculum) and entity nodes (the user's
  world), connected by assertions that carry provenance — stated by the user or
  inferred by the tutor — and temporal validity. Episodes are the receipts.
  The tutor reads it before every answer and writes to it after.

  @new
  Scenario: A course seeds its region of the graph
    When the user creates "AP Statistics" linked to the OpenStax textbook
    Then concept nodes are seeded from the source's structure
      (chapters/sections → concepts; KEY TERMS blocks → leaf concepts)
    And prerequisite edges follow the book's ordering as a first approximation
    And every node starts with mastery "unknown" — not zero
      # unknown ≠ failing: the tutor probes before it assumes

  @new
  Scenario: Evidence accrues from normal studying, silently
    Given the user correctly works two problems about "confidence intervals"
    When the session's extraction pass runs (background, after the turn)
    Then the "confidence intervals" node gains positive evidence
    And linked prerequisite nodes gain weak indirect evidence
    And nothing interrupts the user — no badge, no popup mid-chat

  @new
  Scenario: The graph survives being wrong
    Given the graph believes "z-scores" is mastered
    When the user makes repeated z-score errors in new work
    Then mastery for the node degrades toward "shaky" with the new evidence
    And the tutor adjusts within the SAME session, not next week

  @new
  Scenario: The user can see — and correct — their own map
    When the user opens the Progress panel in a course
    Then the user sees the concept graph region for that course
      (mastered / shaky / unknown / not-yet-reached, visually distinct)
    And the user can tap a node to see the evidence behind its state
    And the user can override: "I know this" / "I never learned this"
      # the student is an authority on themself; overrides are evidence too

  @new
  Scenario: Cross-course edges make transfer visible
    Given "Transformers" needs "linear algebra: matrix multiplication"
    And the user mastered that node in a math course last semester
    Then the Transformers tutor builds on it instead of re-teaching it
      # one graph per student, regions per course — not one graph per course

  @new
  Scenario: What the user says is remembered verbatim, with provenance
    When the user mentions "I like ice cream" in any chat
    Then the graph records an observation: kind=stated, the exact quote,
      linked to the episode (turn) it came from
    And weeks later a related-rates practice problem may feature a melting
      ice-cream cone
      # observations are the personalization fuel for F6 grounding and F8 items

  @new
  Scenario: What the tutor concludes is remembered as an insight — distinctly
    Given the user just worked three hypothesis-testing problems cleanly after a
      week of struggling with them
    When the after-turn extraction pass runs
    Then the graph records an insight: "breakthrough with hypothesis testing",
      kind=inferred, with a confidence and the source episodes it rests on
    And stated and inferred assertions are never silently merged —
      "the user said it" vs "the tutor concluded it" is a first-class distinction

  @new
  Scenario: Beliefs are invalidated, never erased (bi-temporal)
    Given a May insight "confuses standard deviation with standard error"
    When June evidence contradicts it
    Then the old insight gets invalidated_at set — it is not deleted
    And the trajectory "used to confuse these; resolved around June 10"
      remains queryable
      # the learning ARC is the value, not just the current state

  @new
  Scenario: The tutor can analyze the trajectory of learning
    When the user asks "how has my understanding of hypothesis testing developed?"
    Then the tutor reads the concept's timeline: mastery evidence, insights
      (including invalidated ones), and the episodes behind them
    And answers as a grounded narrative — "three weeks ago you were guessing
      at null hypotheses; the turning point was the June 3 worksheet" —
      citing real moments, not vibes

  @new
  Scenario: The user can challenge an insight
    Given the Progress panel shows the insight "avoids word problems"
    When the user says "that's not true — I just hadn't gotten to them yet"
    Then the insight is invalidated, and the user's correction is recorded as a
      stated observation with its episode
      # the student outranks the inference — same principle as the mastery
      # override; no hidden student model
```

### Feature 6 — Focus & periphery: the student context protocol

> **Grounding:** `@new`, but it is the *consumption contract* for the Feature-5
> graph — and the load-bearing answer to a known hazard: the upstream ROADMAP
> already flags agent context bloat as the way small local models die. One
> assembler module (working name `src/student_context.py`) is the single door
> between the graph and every prompt. Because the graph is one-per-student with
> regions per course, "Calculus 1" and "Physics 1" literally share nodes
> (derivative, rate of change) — the periphery is read off the graph structure,
> not guessed from course names.
>
> **Context tiers** (degrade bottom-up under token budget):
>
> | Tier | Content | Under small budgets |
> |---|---|---|
> | 0 — Profile | adaptivity dial, level, durable student facts | always kept |
> | 1 — Focus | active course: graph frontier, shaky nodes, recent evidence, current session topic, course-scoped retrieval | always kept (compressed) |
> | 2 — Periphery | related active courses via shared/linked nodes: one line of current state per course pair | compresses, then drops |
> | 3 — Ambient | stated observations (preferences, interests — the problem-flavoring fuel), study patterns, schedule pressure | first to drop |

```gherkin
Feature: Every tutor thought starts from who the user is right now
  One context assembler serves every LLM call made on the user's behalf. The active
  course is the focus; related course regions are the periphery — present
  enough to ground, never enough to derail.

  @new
  Scenario: All user-context LLM calls read the graph through one door
    Given any LLM call that requires user context
      (tutor turns, agent turns, worksheet grading, review-item generation,
       session summaries, evidence extraction's read side)
    Then its user context is built by the student-context assembler
    And no call site reads graph tables or assembles student state ad hoc
      # mechanical-invariant candidate (Gate-6 family): a fitness check that
      # user-facing LLM call sites import the assembler — convention won't hold

  @new
  Scenario: Focus dominates, periphery grounds — the flagship case
    Given the user's course load includes "Calculus 1" and "Physics 1 (calc-based)"
    And the user is in the "Calculus 1" tab asking about the chain rule
    Then the assembled context is predominantly Calculus 1: its graph region,
      mastery frontier, and textbook retrieval
    And the periphery carries one line: "also enrolled: Physics 1 — currently
      on kinematics, which applies derivatives of position"
    And the tutor may ground the chain rule in the user's actual physics work
      ("this is exactly how position becomes velocity in your kinematics set")
    And the answer remains a calculus answer with a physics aside —
      never a physics lecture

  @new
  Scenario: The connection is symmetric
    Given the same course load
    When the user works on kinematics in the "Physics 1" tab
    Then the periphery carries the Calculus 1 frontier
    And the tutor can say "you just learned the power rule —
      d/dt(t²) = 2t is that rule doing physics"

  @new
  Scenario Outline: Connections extrapolate to any course pair sharing graph ground
    Given the user's load includes "<focus>" and "<peripheral>"
    When the user studies in the "<focus>" tab
    Then the periphery may surface "<shared ground>" from the other course
    And the connection comes from the graph — shared nodes, typed edges,
      accumulated evidence — never invented because two course names sound related

    Examples:
      | focus         | peripheral        | shared ground                          |
      | Victorian Lit | European History  | the period's events behind the novel   |
      | Statistics    | Research Methods  | sampling, significance, study design   |
      | Transformers  | Linear Algebra    | matrix multiplication, dot products    |

  @new
  Scenario: Periphery is bounded and budget-aware
    Given the serving model has a small context window
    Then tiers degrade in order: ambient drops, periphery compresses to one
      line per coupled course then drops, profile + focus always survive
    And no tier is ever an unbounded graph dump
      # the ROADMAP's context-bloat lesson, made a contract

  @new
  Scenario: The user steers the coupling
    Given the tutor keeps grounding calculus in physics
    When the user says "stop bringing physics into this"
    Then the preference is recorded as evidence on that course pair
    And the periphery for the pair mutes, reversible in course settings
      # the student outranks the graph — same principle as the F5 override

  @new
  Scenario: Background calls see the same student the live tutor sees
    When the review-queue assembler generates a "related rates" item (Calculus 1)
    Then it may dress the problem in the user's coupled physics setting
      (the lab's cooling cup, the cart on the track)
    And when the session-summary action writes its note
    Then it reads the same focus tier the live tutor saw during the session
```

### Feature 7 — The model router: feature-based model selection

> **Grounding:** `@partial` — the backend is already multi-provider
> (`src/llm_core.py` + `src/endpoint_resolver.py` speak Anthropic/OpenAI-style
> APIs and Ollama; the Providers screen manages endpoints and defaults), and a
> primitive purpose-chain already exists: Slice 5's research path resolves
> research→utility→default→chat→first-endpoint. The router **generalizes that
> seam** — call sites declare a task profile; the router resolves it against
> what's actually configured. It composes with Feature 6: the router's choice
> sets the token budget the context assembler builds against (small local model
> → tighter tiers; big-context model → fuller periphery).
>
> **Task profile axes:** reasoning tier, modality, output shape (free vs
> structured), latency sensitivity, privacy/cost preference. Tier sketch:
>
> | Tier | Typical tasks | Typical resolution |
> |---|---|---|
> | micro | yes/no checks, classification, session titles | smallest configured model |
> | light | evidence extraction, entity reconciliation, session summaries, review-item dressing | small/mid local model |
> | standard | live tutor turns, consolidation pass | best conversational model available |
> | deep | multi-step reasoning, proof walkthroughs, deep research, worksheet grading | strongest reasoner configured (e.g. Claude via the Anthropic API) |
> | vision | worksheet/handwritten-work analysis | a VL-capable model — a hard requirement, not a preference |

```gherkin
Feature: The right model for the job, chosen by the task's needs
  Call sites never name models; they declare what the task requires. The
  router resolves the need against whatever providers this instance has.

  @new
  Scenario: Call sites declare a need, not a model
    Given any LLM call in the system
    Then it carries a task profile (tier + modality + output shape)
    And the router resolves the profile to a configured endpoint + model
    And no call site hardcodes a model name
      # the third one-door invariant (after owner_scoped and student_context);
      # fitness-check candidate once call sites exist

  @new
  Scenario: A yes/no doesn't burn the big model
    When the review queue checks "is the user's flashcard answer correct?"
    Then the call carries tier=micro
    And resolves to the lightest configured model
    And the saved cost/capacity goes where it matters — the tutoring itself

  @new
  Scenario: Deep reasoning gets the strongest reasoner
    When the user asks for a walkthrough of why the CLT needs finite variance
    Then the tutor turn escalates to tier=deep
    And resolves to the strongest configured reasoner (e.g. Claude on the
      Anthropic endpoint) when one exists

  @new
  Scenario: Vision is a hard requirement, not a preference
    When the user attaches a photo of handwritten work
    Then the profile requires modality=vision
    And the router picks a VL-capable model — or fails loudly with a setup
      hint, never silently sending the image to a text-only model

  @new
  Scenario: A one-model box still works completely
    Given the instance has exactly one Ollama model configured
    Then every profile resolves to that model — no feature is gated on
      tier availability
    And the Providers screen notes which tiers run below preferred capability

  @new
  Scenario: The student sets the policy, not the plumbing
    When the user opens routing settings
    Then the user can set the policy dial: local-first (privacy/cost — background
      extraction never leaves the box) vs quality-first (deep work goes to
      the best model anywhere)
    And can pin a specific model per tier, overriding auto-resolution

  @new
  Scenario: Routing is observable
    Then settings shows the live resolution table (tier → endpoint/model)
    And recent calls show which model served them
      # no silent degradation: when extraction quietly fell back to a 3B
      # model, the owner can SEE why insight quality dropped

  @new
  Scenario: Spend is visible
    Then routing observability includes tokens and estimated cost per
      feature ("deep research: ~$0.40 this week; extraction: local, free")
    And the routing settings page shows the running cloud-spend estimate
      # part-local, part-cloud setups deserve a meter, not a surprise bill
```

### Feature 8 — Practice: the review queue & the Gym

> **Grounding:** the scheduler with schedule/event/webhook triggers + Tasks UI
> exist (Slice 6). The corpus `kind` metadata (example|problem|exercise|try_it)
> is the practice-item lever ADR 0003 planned. `@new`: the review-queue builtin
> action, due-item selection from mastery decay, and the practice surface.

```gherkin
Feature: The tutor brings the right practice at the right time

  @new
  Scenario: A daily review queue assembles itself
    Given mastery evidence with last-seen timestamps exists
    When the scheduled "assemble review queue" action runs (default: daily)
    Then due concepts are selected by decay (weak + stale first)
    And each gets a practice item — preferring real exercises from the
      course's sources (kind=problem|exercise|try_it), generated only as fallback
    And the queue caps at a sane daily size (default 10, configurable)

  @new
  Scenario: The user works the queue
    Given today's queue has 6 items across two courses
    When the user opens "Review" from Home
    Then items come one at a time, course-labeled
    And the user answers in chat (text, or a photo of worked math)
    And each item ends with: correct/partial/missed + the citation to study
    And the outcome writes evidence to the graph immediately

  @new
  Scenario: Review respects the calendar
    Given the user has a "STAT midterm" event on the course calendar in 10 days
    Then the queue weights that course's shaky prerequisites heavier
      # exam-aware scheduling: calendar events inform decay priorities

  @partial
  Scenario: Reminders ride the existing scheduler
    Given the user enabled review reminders
    Then a scheduled task fires the existing notification path
    And pausing it from the Tasks screen works like any task today
```

The review queue *pushes* practice on a schedule; **the Gym** is where the user
*pulls* it — same generation machinery, same graph calibration, opposite
initiative:

```gherkin
Feature: The Gym — walk in and train the weakness
  The user picks the focus; the graph picks the problems. Sets target what's
  shaky, never re-feed what's mastered.

  @new
  Scenario: The user picks the focus, the graph calibrates the set
    Given the user is in "Physics 1" and opens the Gym
    When the user selects the topic "Newton's laws" (or taps "coach's pick")
    Then a problem set generates, calibrated to the user's current mastery level
    And it draws real course exercises (kind=problem|exercise) first,
      generating fresh variations only where the library runs dry

  @new
  Scenario: Weakness gets priority — the flagship case
    Given the graph holds homework evidence of repeated free-body-diagram
      errors and an insight "struggles to identify all forces acting on a body"
    When the user starts a gym set on "Newton's laws"
    Then free-body-diagram problems lead the set, pitched as challenge questions
    And content the user has already mastered is NOT re-fed as filler
      # train the weakness, don't grind the strength

  @new
  Scenario: The set adapts mid-session
    Given the user nails the first two free-body-diagram problems
    Then the next one steps up in difficulty (zone of proximal development)
    But given the user struggles twice in a row
    Then the next one scaffolds down AND the tutor cites the section to
      re-read ("[Phys §4.2, p. 118]" — a clickable door, per F2)

  @new
  Scenario: Gym work feeds the graph
    When the user completes a gym set
    Then every outcome writes mastery evidence — the gym is the densest
      evidence source in the app
    And a set summary lands on the dashboard momentum strip
      ("free-body diagrams: 4/6 — up from 1/5 last week")

  @new
  Scenario: Worked answers welcome, photos included
    When a gym problem calls for worked math
    Then the user can answer in text or attach a photo of handwritten work (F4)
    And grading routes tier=micro for right/wrong checks and tier=deep for
      full worked-solution analysis (F7 profiles)
```

Training is one mode; **the dress rehearsal** is another — timed, mixed,
silent, against the real exam on the calendar:

```gherkin
Feature: Exam simulation — practice under test conditions
  The Gym trains; the simulation tests. Timed, mixed-topic, no hints,
  weighted to the actual exam's scope.

  @new
  Scenario: A practice exam assembles from real course material
    Given the calendar holds a midterm in 9 days (schedule miner, F2)
    When the user starts an exam simulation for the course
    Then a timed, mixed-topic, no-hints set assembles — weighted to the
      exam's scope, drawn from corpus problems (kind=problem|exercise) first
    And the tutor stays SILENT until submission — no Socratic nudges
      mid-exam; test conditions mean test conditions

  @new
  Scenario: The debrief is where the learning happens
    When the user submits (or time expires)
    Then grading runs per problem, with citations to the sections to review
    And results write mastery evidence and update the readiness readout
    And the dashboard shows readiness against the real exam date
      ("midterm in 6 days — strong on ch. 1–3, ch. 4 needs two more sessions")
```

And the deepest practice mode of all — explaining:

```gherkin
Feature: Explain it back — learning by teaching
  The strongest retrieval practice isn't answering problems; it's teaching.
  The user explains; the tutor plays curious student.

  @new
  Scenario: The user teaches the tutor
    When the user picks "explain it back" on a concept (or the tutor offers
      it for a node that's plateaued at shaky)
    Then the user explains the concept in their own words — typed text or
      a canvas sketch (F4); reading and writing only, per the owner's medium
      decision
    And the tutor plays the curious student: probing gaps ("you said variance
      measures spread — spread of WHAT, exactly?"), asking for the why,
      never lecturing back until the explanation stands or stalls
    And the attempt writes rich mastery evidence — explanation quality is
      the strongest mastery signal there is
```

### Feature 9 — Planning: calendar & notes as study instruments

> **Grounding:** calendar (recurring events, CalDAV sync) and notes (pin/archive)
> screens exist (Slices 6.5a/b). `@new` is course-binding and the session-summary
> loop.

```gherkin
Feature: Study time and study record, attached to courses

  @partial
  Scenario: Planning a recurring study block
    When the user creates "STAT study" Tuesdays 7pm, recurring weekly, in "AP Statistics"
    Then it appears on the calendar (and syncs out via CalDAV if connected)
    And opening puttyU during that block suggests resuming that course tab

  @new
  Scenario: A session leaves a note behind
    Given the user finishes a substantive study session
    When the session summary action runs
    Then a note is created in the course: what was covered, what clicked,
      what's still shaky, citations touched
    And the user can edit it — it's the user's note, the tutor only drafts it

  @partial
  Scenario: Notes stay first-class
    Then notes can be pinned, archived, and browsed per course
    And the tutor can read course notes as context when asked
      ("what did we say about pooled variance last week?")
```

### Feature 10 — The tutor persona & the adaptivity dial

> **Grounding:** presets (system prompt + temperature) and disk-backed skills
> exist. `@new`: the tutor profile schema, per-course overrides, and the dial.

```gherkin
Feature: One patient tutor, tuned per student and per course

  @new
  Scenario: The default tutor needs zero configuration
    Given the user never opens persona settings
    Then every course gets the default tutor: patient, Socratic-leaning,
      cites the library, admits uncertainty, never shames

  @new
  Scenario: The adaptivity dial
    When the user opens course settings
    Then the user can set: scaffolding (guide ↔ direct answers),
      pace (gentle ↔ intense), tone (warm ↔ matter-of-fact)
    And the settings apply to that course only
    And the graph still auto-adjusts difficulty WITHIN whatever the user chose

  @new
  Scenario: Course-shaped behavior without new code
    Given "Victorian Lit" is a literature course
    Then the tutor leans discussion/close-reading (quote, ask, compare)
    And given "AP Statistics" is problem-based
    Then the tutor leans worked-examples and practice
      # course type informs the persona prompt — content-driven, not hardcoded

  @new
  Scenario: A tutor, not a homework laundromat
    Given guide mode is the default everywhere
    Then full answers remain available on explicit request ("just show me")
    And the tutor never moralizes, surveils, or refuses coursework — this is
      a personal tutor on the user's own instance; integrity is the user's
      responsibility
    And the framing stays pedagogical either way: feedback and the path
      first, the answer second
      # the integrity stance, settled in one scenario
```

### Feature 11 — The dashboard: home base

> **Grounding:** `@partial` — this is a *composition* surface: calendar, notes,
> tasks, sessions, and graph queries all exist or are specced; the window-manager
> shell already does dockable panels; the mini-chat reuses `streamChat` and the
> session model; reading recommendations reuse ADR 0003's `original_path` +
> page locators (the open-PDF-at-page door F2 already specs). Net-new: the
> dashboard screen itself, the **todo** model (course-scoped, due-dated — there
> is no todo backend today; scheduler tasks are automation, not todos), and the
> recommendation generator.

```gherkin
Feature: One place that answers "what should I do right now?"
  The user logs in and lands here. Every card is a summary AND a door —
  it deep-links into the full feature it summarizes.

  @new
  Scenario: Login lands on the dashboard
    When the user logs in
    Then the dashboard is the first screen — not an empty chat
    And the course tabs, full chat tab, and all tools remain one click away
    And new courses can be added right from the dashboard (F1 flow)

  @new
  Scenario: Today, at a glance
    Then the dashboard shows: today's calendar (the 4pm tutoring block, the
      Friday exam), due and overdue todos, the review-queue count, and
      "resume where you left off" on the most recent session
    And clicking any of them opens the full resource — the calendar event,
      the todo's course tab, the review queue, the session

  @new
  Scenario: Reading recommendations are doors into the library
    Given the graph frontier says "sampling distributions" is next and shaky
    And the calendar shows a statistics exam in 9 days
    Then the dashboard recommends: "Before Tuesday: read §7.2 Sampling
      Distributions (pp. 201–214)"
    And clicking it opens the PDF viewer at exactly page 201
      # original_path + page locator — the citation door, reused for push

  @new
  Scenario: The weak spot card walks the user into the Gym
    Given the graph's current shakiest concept in Physics is free-body diagrams
    Then a card says "Free-body diagrams need work — train now"
    And clicking it opens the Gym preloaded on that topic (F8)

  @new
  Scenario: Momentum is narrative, not score
    Then a momentum strip shows recent insights as plain sentences —
      "breakthrough with hypothesis testing (Tuesday)", "free-body diagrams
      improving: 4/6 vs 1/5 last week"
    And clicking one opens the concept's trajectory timeline (F5)

  @new
  Scenario: The mini-chat answers quick questions in place
    When the user types "when's my stats exam?" into the dashboard chat widget
    Then the answer streams right there (tier=light, ambient context)
    And "open in full chat" carries the same session into the chat tab —
      one conversation, two surfaces, never a fork

  @new
  Scenario: Quick capture
    When the user adds "finish problem set 6 by Thursday" from the dashboard
    Then a todo is created, bound to the course, due Thursday
    And it appears on the calendar and counts toward Thursday's at-a-glance

  @new
  Scenario: One keystroke finds anything
    When the user presses Cmd/Ctrl-K anywhere in the app
    Then a global search opens across courses, notes, materials, sessions,
      todos, and graph concepts
    And picking a concept opens its trajectory; a material opens the viewer;
      a session resumes it; a todo jumps to its course
      # the workspace glue: no resource is more than two keystrokes away
      # (the backend search feature is in the KEEP set — this is its front door)

  @new
  Scenario: The dashboard stays calm
    Then no streaks, XP, leaderboards, or guilt mechanics — ever
    And an empty day says so plainly ("nothing due; the review queue has 4
      items when you're ready") instead of manufacturing urgency
      # efficient learning is the promise; anxiety is not a feature
```

### Feature 12 — Later (specced now so seams stay open, NOT v1)

```gherkin
@later
Scenario: Multiple students share an instance
  # Gate 5 owner_scoped becomes blocking; each student gets their own graph,
  # courses, sessions. The library stays shared/read-only. Already-prepared seam.

@later
Scenario: Video sources join the library
  # VideoTranscriptImporter (ADR 0003): kind=transcript_segment, time locators,
  # citations deep-link to timestamps.

@promoted
Scenario: Student-uploaded course materials
  # PROMOTED to Feature 2 in v0.6 (uploads + tags + schedule miner) — the
  # corpus_source.owner seam carries it. Kept here as a record of the move.

@later
Scenario: The phone is the review surface
  # responsive PWA: dashboard + review queue + mini-chat installable on
  # mobile (the habit surface); the full workspace stays desktop-first.

@later
Scenario: Push nudges ride ntfy
  # the ntfy service already in the compose stack: "review due",
  # "lesson in 30 min" — the dashboard's calm rules apply to notifications
  # too (informative, never guilt).

@later
Scenario: Backup and course export
  # scheduled data/ snapshots + per-course export (notes, materials, graph
  # region as files). The graph is the first IRREPLACEABLE data this app
  # creates — backup was CUT upstream; this is the deliberate un-cut.

@later
Scenario: Anki export
  # review-queue items exportable as an Anki deck, for students who already
  # live there. Cheap, niche, worth the seam.

@rejected
Scenario: Voice (TTS/STT)
  # REJECTED 2026-06-12 (Addendum 8): the user MUST READ. Reading is the
  # medium — deliberate pedagogy, not a roadmap gap. TTS/STT stay CUT.
```

---

## 4. Capability map — scenario groups vs. today's code

| Feature | Exists today | The gap |
|---|---|---|
| F1 Courses/tabs | auth, shell, window manager | `course` table + CRUD routes + tabs UI + onboarding flow + **calibration flow** (gym machinery + graph writes) |
| F2 Library + course materials | full `src/corpus/` pipeline + CLI (tested); PDF/VL import path; `owner` + `meta` seams (ADR 0003); upload UI kept metadata-extensible (Slice 3) | `ensure_corpus_tables()` → `init_db`; corpus routes (real OpenAPI seam); library browser UI; "paper" source_type; **owner-scoped uploads + tag CRUD/filtering; schedule miner (structured extraction → event/todo proposals, idempotent re-runs, review-sheet UI)** |
| F3 Grounded chat | chat vertical, streaming, retriever | retrieval→chat context injection scoped by course; citation render + click-through; honesty marker |
| F4 Doing the work | attachments→VL, PDF import, `/api/upload`, window manager, `companion/` pairing bridge | grading prompt contract; extraction→graph hook; **webcam capture widget** (getUserMedia + preview/retake + multi-page→PDF assembly; secure-context hint); **canvas workspace** (Pointer Events + pressure, templates, stroke-data persistence, submit-as-image, revise/resubmit; @later companion-paired tablet input) |
| F5 Ensemble graph memory | extractor pattern + tidy pass, event bus, two-store discipline, persisted chat/upload records as episodes | **ADR-0005**, ensemble tables (concepts + entities + assertions + evidence), extraction & reconciliation prompts, consolidation action, Progress/timeline UI |
| F6 Context protocol | prompt assembly seams in `chat_handler`/`agent_loop`; ROADMAP's context-budget lessons | `src/student_context.py` assembler, tier budgets, call-site adoption, coupling mute, fitness check |
| F7 Model router | multi-provider `llm_core`/`endpoint_resolver` + purpose-chain + Providers screen | task-profile schema, tier table (data, not code), policy dial + per-tier pins, degradation rules, routing-decision log + settings readout |
| F8 Review queue + Gym + exam sim + explain-it-back | scheduler + Tasks UI + corpus `kind` metadata; F4 photo-answer path | queue assembly action, due-selection, Review UI; gym set generator (graph-calibrated, weakness-first), adaptive difficulty, Gym UI; **exam-sim assembler (timed, silent, scope-weighted) + readiness readout; explain-it-back mode (persona variant + evidence hook)** |
| F9 Calendar/notes | both screens + CalDAV | `course_id` on events/notes; session-summary action |
| F10 Persona | presets + skills | tutor profile schema, per-course override, dial UI |
| F11 Dashboard | window-manager shell (dockable panels), calendar/notes/tasks/sessions queries, `streamChat`, ADR-0003 page locators, KEEP-set search backend | dashboard screen + cards, **todo model + CRUD** (net-new), reading-rec generator, mini-chat widget (shared session), momentum strip, **Cmd-K global search** (front door on the existing search + graph concepts) |

## 5. UX-architecture implications (for the build spec, after review)

1. **Course is a scoping dimension, not a folder.** `course_id` lands on: corpus
   retrieval filters (seam exists), sessions, notes, calendar events, mastery
   nodes' evidence, persona overrides. Nullable everywhere → everything still
   works course-less (Home tab = no course).
2. **The graph gets the ADR-0003 treatment before any code:** small typed core
   in SQLite (canonical), speculative attributes in JSON `meta`, optional Chroma
   collection for concept-similarity later. Proposed ensemble core (four tables):
   - `concept_node` — curriculum concepts, seeded from sources, **closed-world**
     (the extractor classifies onto existing nodes; new-node proposals are gated).
   - `entity_node` — the user's world (ice cream, the dog), **open-world but sparse**;
     writes go through a Mem0-style ADD/UPDATE/NOOP reconciliation step, the
     anti-rot mechanism for the only open-ended part of the graph.
   - `assertion` — the edges/facts: `kind` (`stated` | `inferred`), verbatim
     `quote` (stated) or statement + `confidence` (inferred), typed relation,
     `valid_from` / `invalidated_at` (**bi-temporal — contradiction invalidates,
     never deletes**), `episode_ids` (JSON — the receipts).
   - `mastery_evidence` — append-only, per-(concept, episode); mastery state is
     a **derived projection** updated knowledge-tracing-style (BKT-inspired:
     recency/difficulty/hint-aware), recomputable from the log when prompts improve.
   Episodes are NOT a new store — they're references to existing `chat_messages`
   / upload / task-run records. A scheduled **consolidation action** (the
   `memory_extractor.py` tidy-pass pattern; what Anthropic ships as "dreaming")
   merges duplicates, prunes junk, and re-scores stale confidences. Decide in
   **ADR-0005**: storage (build Graphiti-style semantics on SQLite — proposed —
   vs adopt the Graphiti library + a 5th store), seeding, evidence schema, the
   mastery update rule, and the flip conditions. Graph is per-student (one
   region per course), satisfying the `@later` multi-student seam via `owner`.
3. **Extraction is background and event-driven**, copying `memory_extractor.py`:
   after-turn hook → LLM extracts evidence JSON → event bus → persist → queue
   effects. Never blocks the chat stream.
3b. **The student-context assembler is the graph's only consumer-facing API.**
   `student_context(student, active_course, call_type, token_budget) → tiered
   block` (tiers in Feature 6). Call-site inventory to adopt it: chat turns
   (`chat_handler`), agent loop, worksheet grading, review-item generation,
   gym set generation, session-summary action, the schedule miner, the
   extractor's read side. Write side (evidence
   persistence) is separate — the assembler is read-only. Candidate mechanical
   gate once call sites exist: a Gate-6-family fitness check that those sites
   import the assembler instead of touching graph tables — per ADR 0002,
   "an agent forgets conventions but cannot bypass a failing build."
   Course coupling needs no extra machinery: periphery = the other active
   courses' regions reachable from focus-region nodes (shared nodes first,
   then 1-hop typed edges), ranked by edge weight/evidence recency, with a
   per-pair mute flag (Feature 6 "the user steers the coupling").
3d. **The model router is the third one-door** (after `owner_scoped` and
   `student_context`): extend `src/endpoint_resolver.py` — which already does
   purpose-chain resolution — rather than building a new subsystem. The router
   returns `(endpoint, model, token_budget)`; the assembler consumes that
   budget, so the two doors compose instead of guessing at each other. The
   tier table is **data** (settings/JSON), not code — re-tunable without a
   deploy. Every resolution is logged (profile → choice → why) to back the
   F7 observability scenario. Capability metadata (vision, context size,
   reasoning class) lives on the model-endpoint records the Providers screen
   already manages.
4. **Citations are a typed contract**, not prose convention: retrieval returns
   `{chunk_id, citation, page_start, source_id}`; the chat stream carries a
   `citations` control event; the UI renders chips. (Mirrors how `agentSteps.ts`
   folds control events today.)
5. **Frozen god-files stay frozen.** New routes (`course_routes`, `corpus_routes`,
   `graph_routes`) are born small, typed, under the Gate-6a ceiling, through the
   real OpenAPI seam — no new hand-typed clients.
6. **Slice 7 (demolition) should land before heavy Phase-2 build** — less code to
   entangle, and `codex_routes` must go before documents work grows.
7. **Gate 7 — tutor evals (extend the verifiability religion to the LLM).**
   The spec promises LLM *behaviors* — never fake a citation, mark ungrounded
   answers, extraction precision, weakness-first set composition — and no
   existing gate can see them. Build a golden-set eval harness: fixed
   scenarios with expected behaviors, run on demand against the configured
   models, scored and tracked over time. It is the quality twin of the F7
   observability scenario: it tells the owner when a newly configured local
   model quietly degrades extraction or grounding. Lands alongside T3
   (extraction is its first consumer); informational first, gate later —
   the Gate-2 quarantine playbook, reused.
8. **The untrusted-content invariant (prompt injection).** Everything the
   model reads from user-supplied or fetched content — uploads, syllabi,
   web pages, notes, even the user's own materials — is untrusted input.
   Any write derived from it (calendar events, todos, tags, graph
   assertions) lands as a **proposal or evidence, never a silent action**.
   The confirm-first flows already specced (schedule miner, suggested tags,
   tutor-proposed todos) are instances of this one rule, not separate
   decisions; `THREAT_MODEL.md` anchors it, and new model-read surfaces
   must name their write path against it.

### Research grounding for the memory design (survey 2026-06-12)

What each source contributes to F5/F6 — cite these in ADR-0005:

- **Graphiti / Zep** ([paper](https://arxiv.org/abs/2501.13956), [overview](https://neo4j.com/blog/developer/graphiti-knowledge-graph-memory/)) —
  episodes → entities two-layer model; bi-temporal edges (`valid_from`/`valid_until`);
  contradiction → invalidation, never deletion. The semantics we adopt; the
  library is the §6-Q9 alternative (backends: Neo4j/FalkorDB/Kuzu/Neptune).
- **Mem0 / Mem0ᵍ** ([paper](https://arxiv.org/html/2504.19413v1)) — candidate
  fact vs existing memory → LLM decides ADD/UPDATE/DELETE/NOOP. Our entity-node
  reconciliation step, verbatim.
- **DyG-RAG** ([paper](https://arxiv.org/abs/2507.13396)) — the atomic unit is a
  timestamped event, not mutable state; time-aware retrieval over event units.
  Validates the append-only `mastery_evidence` log.
- **Knowledge tracing** (BKT/DKT; [IntelliCode](https://arxiv.org/html/2512.18669),
  [TutorLLM](https://arxiv.org/pdf/2502.15709), [Math Academy](https://www.mathacademy.com/how-our-ai-works)) —
  the education-native literature our mastery model belongs to: centralized
  versioned learner state (mastery + misconceptions + review schedules),
  BKT-style updates using difficulty/recency/hints. Use their math, not homemade decay.
- **Anthropic memory surfaces** ([memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool),
  "dreaming" consolidation) — all file/document-based, model-as-curator, with
  immutable versioning and a between-sessions consolidation pass. The
  counterpoint that keeps us honest: graphs must earn their structure (ours does,
  via curriculum anchoring + trajectory queries); consolidation is mandatory
  (our scheduled tidy action); the existing `memory_extractor.py` tidy pass is
  the in-repo template.

## 6. Decisions — RESOLVED 2026-06-12 (owner delegated the calls; frozen for implementation)

> Every question below is **resolved as its "proposed" option**. The owner
> delegated the choices ("you make the correct choice", 2026-06-12); the
> proposals were each researched and grounded, so they stand. One tightening:
> **Q8 ships mute-only in v1** (no positive "always connect" control — YAGNI
> until the mute proves insufficient). Authoritative details for Q1/Q2/Q6/Q9/
> Q10 live in **ADR-0005**; Q3/Q12 in **ADR-0004**. The questions are kept
> verbatim below as the record of what was decided and why.

1. **Graph seeding source:** seed concepts from source structure only (cheap,
   deterministic — proposed v1), or run an LLM concept-extraction pass over
   chunks at import time (richer, slower, needs `chunk.meta` concept tags)?
2. **Mastery vocabulary:** how should the UI talk about it? Proposed: a 4-state
   surface (unknown / learning / shaky / mastered) over continuous evidence —
   no percentages shown to the student.
3. **Course ↔ source linking authority:** can the user link any library source to a
   course themself (proposed: yes — library is read-only anyway), or admin-only?
4. **Review modality:** queue items answered in the chat surface (proposed —
   reuses everything) vs. a dedicated flashcard-style UI?
5. **arXiv ingestion:** Marker-converted PDFs through the same importer
   (proposed), or a dedicated arXiv fetch+convert pipeline inside puttyU?
6. **Graph visualization ambition for v1:** a real node-graph rendering, or a
   structured list/tree of concepts with state colors (cheaper, likely clearer
   at small scale — proposed)?
7. **Periphery defaults:** proposed — shared nodes + 1-hop edges, max one
   summary line per coupled course, periphery capped at ~15% of the context
   budget. Are deeper hops (chained connections across three courses) wanted
   in v1, or is that tier-2 polish?
8. **Coupling control surface:** proposed — automatic from the graph, with a
   per-course-pair mute the student can toggle (and conversational "stop
   bringing X into this" records the same flag). Should there also be a
   positive control ("always connect these two")?
9. **Build vs adopt for the graph semantics:** proposed — implement the
   Graphiti-style semantics (episodes, bi-temporal assertions, invalidation,
   provenance) on SQLite per §5.2, keeping the existing store discipline.
   Alternative: adopt the Graphiti library (+ Kuzu backend) — buys a maintained
   ingest/retrieval engine, costs a 5th data store and an open-world extraction
   pipeline we'd have to constrain back to the curriculum vocabulary. Flip
   condition either way recorded in ADR-0005.
10. **Insight transparency:** proposed — every inferred insight is visible to
    the user in the Progress timeline and challengeable (F5 "the user can challenge an
    insight"); there is no hidden student model. Confirm — this is a values
    decision as much as a UX one.
11. **Routing intelligence:** proposed — v1 is a static profile→tier→model
    table with capability tags on endpoints (deterministic, debuggable,
    cacheable). Alternative: LLM-assisted routing (a micro model judges task
    difficulty per call) — adds a call to every call; defer until the static
    table demonstrably misroutes. Also: capability tags set manually on the
    Providers screen (proposed) vs probe-derived?
12. **Todo backend:** proposed — a new small `todo` table (course_id, text,
    due_date, done_at), typed routes through the real OpenAPI seam, shown on
    dashboard + calendar. Alternatives rejected: scheduler tasks (they're
    automation with triggers, wrong semantics) and notes (no due/done
    semantics). Later seam: the tutor proposes todos from session content
    ("you agreed to finish problem set 6") — accept/dismiss, never auto-added.
13. **Dashboard layout:** proposed — a fixed, curated card layout in v1
    (cheap, coherent, mobile-friendly); the window manager already gives
    power users free-form tool windows elsewhere. Draggable/configurable
    dashboard cards only if the fixed layout proves wrong.
14. **Tags & schedule-miner edges:** proposed — tags are free-form with
    upload-time suggestions (confirm-to-apply), stored in `meta` JSON +
    Chroma scalar metadata; no fixed vocabulary in v1. And on syllabus
    re-upload: should *unambiguous* changes (same event, new date) auto-apply
    with an undoable notice, or does everything stay confirm-first? Proposed:
    everything confirm-first in v1 — revisit when trust is earned.
15. **Canvas persistence format:** proposed — submit as PNG (the VL models
    eat images), persist as PNG + a stroke-data JSON sidecar so saved
    canvases reopen editable. Alternative: SVG-only (smaller, scalable, but
    lossy for pressure data and a worse VL input). Build the canvas on plain
    Pointer Events + `<canvas>`; adopt a library (e.g. perfect-freehand-class
    stroke smoothing) only for feel, not architecture.

## 7. Proposed slice order (preview — becomes the build spec after review)

| Slice | Vertical | Why this order |
|---|---|---|
| T0 | **Slice 7 demolition** (from Phase 1) | shrink the codebase before building on it |
| T1 | Courses: table, routes, tabs, onboarding | everything else scopes by course |
| T2 | Library wiring: init_db, routes, browser UI, retrieval→chat with citations; **course-material uploads + tags** (owner seam, dual-store retrieval); **webcam capture widget** (frontend-only, feeds every upload surface); **model router v1** (task profiles, tier table, degradation — extends `endpoint_resolver`) | the source of truth comes online, the user's materials beside it; F2+F3+F4+F7 — the router lands early because every later slice's background calls route through it |
| T3 | ADR-0005 + graph core: tables, seeding, extraction hook, **student-context assembler (focus tier)**, Progress UI (list-style) | F5+F6 core; chat switches from raw retrieval (T2) to assembled context; extraction runs on router tier=light |
| T4 | Review queue: assembly action, Review UI, calendar-aware weighting; **the Gym** (set generator + adaptive difficulty — shares the item machinery); **calibration flow + exam simulation + explain-it-back** (same machinery, three more doors); **periphery tier + coupling mute** | F1's calibration + F8 + F6 periphery; the full learning loop closes both ways (push and pull) |
| T5 | **Dashboard** (cards, todo model + CRUD, reading recs, mini-chat, momentum); **Cmd-K global search**; **schedule miner** (syllabus → event/todo proposals — needs the todo model, hence here); persona + dial + integrity stance; session-summary notes; routing policy dial + observability UI + **cost meter**; typed math input | F9–F11 + F7 polish + F2's autofill; login lands home and the calendar fills itself |
| T6 | Worksheet grading contract + graph hook; **canvas workspace** (draw, templates, submit, revise/resubmit, stroke persistence) | F4 deepens (the attach/analyze path already works); handwritten work goes born-digital |

---

*Next steps: owner reviews scenarios + answers §6 → scenarios get frozen as the
acceptance layer (Playwright specs adopt the Gherkin names) → ADR-0004 (course
model) + ADR-0005 (concept graph) → per-slice task breakdown in the Phase-2 build
spec.*
