# Roadmap / Help Wanted

puttyU is on a voyage, but not home yet. It works for me (lol), but this ship is
moving fast and feedback/help would be appreciated. (I don't really know what I'm
doing — help.)

If you see weird CSS, strange layout behavior, or a suspiciously murky corner of
the codebase, you are probably right to stay away.

**The source of truth for where the build is and what's next is
[`docs/PHASE-2-BUILD-PLAN.md`](docs/PHASE-2-BUILD-PLAN.md)** — read that first. The
frozen spec is [`docs/SPEC-phase-2-tutoring-ux.md`](docs/SPEC-phase-2-tutoring-ux.md).
This file is the higher-level help-wanted list.

## Current focus — finish the tutoring loop

These are the remaining Phase-2 slices (detail + acceptance criteria in the build
plan). Each is built backend-first, then frontend, with tests and gates kept green.

- **T4 — practice engine.** Review queue, the Gym (weakness-targeted practice that
  prefers REAL corpus problems and only LLM-generates when the library is dry),
  calibration, exam simulation, explain-it-back, plus the **periphery context
  tier** (the Calculus ↔ calc-based-Physics coupling) and coupling mute. Backend is
  partially scaffolded.
- **T5 — dashboard + planning.** The login landing surface (today's calendar, due
  todos, review-queue count, reading recommendations that open the PDF at the exact
  page, a weak-spot card, a mini-chat). Plus the todo model, the **schedule miner**
  (syllabus dates → *proposed* calendar events + todos, confirm-first), the persona
  + adaptivity dial, Cmd-K global search, session-summary notes, and a cost meter.
- **T6 — worksheet grading + canvas.** Deepen line-referenced worksheet grading
  (what's right, where the first error is, cite the section, spawn a follow-up
  review item) and add a Pointer-Events **canvas workspace** (draw with mouse/pad/
  stylus, one-click "send to tutor" as an image).

## Cross-cutting quality

- **Grounding & citation quality.** The product promise is "never fake a citation;
  say so when ungrounded." Stress-test it. A golden-set **tutor-eval harness**
  (planned "Gate 7") for the LLM behaviors the spec promises — citation honesty,
  extraction precision, weakness-first composition — is the next verifiability gate.
- **Graph extraction quality.** The after-turn extractor and BKT-lite mastery model
  decide what the tutor believes about you. False or noisy assertions are the worst
  failure mode; help hardening extraction precision and the override/challenge flow.
- **`owner_scoped` enforcement gate.** Gate 5 helper exists and all Phase-2 routes
  use it, but the *gate* that forbids new ad-hoc `.filter(owner == ...)` filters —
  and migrates the ~20 legacy ones — is unwritten.
- **God-file splits.** A handful of frozen large files (`model_routes.py`,
  `agent_loop.py`, `tool_implementations.py`, `task_routes.py`, …) are at their
  Gate-6a ceilings with hand-typed UI seams. Splitting them unblocks putting those
  seams on the real OpenAPI contract.

## Backup / export (raise priority right after T4–T6)

- The student graph is the **first irreplaceable data this app creates** — a
  scheduled `data/` snapshot + per-course export is high-value.
- Anki export of review items.

## Frontend

- Polish the new tutoring screens (Courses, Library, Progress) and capture fresh
  screenshots for the README.
- Accessibility pass: keyboard navigation, focus states, contrast, reduced motion.
- Improve empty states and error messages on fresh installs; tighten first-run
  setup and onboarding so flows don't repeat or fight each other.
- Mobile PWA (a @later seam): a dashboard + review + mini-chat install target.

## Backend / ops

- Fresh-install smoke tests on Linux (Docker + native venv). Provider setup/probing
  for Anthropic, Gemini, OpenAI, OpenRouter, Ollama, vLLM, llama.cpp.
- Better degraded-state reporting for ChromaDB, SearXNG, and provider probes.
- Skill/tool prompt-injection audit. Treat user-editable skills, notes, documents,
  fetched pages, uploads, and memories as untrusted — keep testing whether models
  follow malicious instructions from those surfaces.
- Agent prompt/context bloat for smaller local models: slimmer prompts, smaller
  default tool sets, clearer guidance for 4k/8k/16k context windows.

## Dormant (do not rebuild or delete yet)

The cookbook / local-model-serving cluster (`cookbook_routes.py`, `services/hwfit/`)
is **deferred**, not deleted — no UI calls it. It carries the residual non-Linux
code. Leave it alone until the tutoring core is solid; it gets revisited or
strangled later. Same for any cut-feature backend that no longer has a frontend.

## Not the focus right now

I prob shouldn't add more themes (there are already 18).
</content>
