# ADR-0002 — Verifiability gates

- **Status:** Accepted (2026-06-19)
- **Context:** PuttyU's prime directive (SPEC §7) is that invariants are
  **mechanical gates**, not conventions — an agent forgets conventions across
  sessions but cannot bypass a failing build. This ADR fixes the gate set, how
  each is enforced, and the rule for adding new ones.

## Decision

**Adding a feature means adding the test / contract / model / gate that keeps it
honest.** Every milestone ends with all gates green; that *is* the work. All
gates run in CI (`.github/workflows/`) and locally via `bash .fitness/run-all.sh`.

| # | Gate | Enforcement | Lands |
|---|---|---|---|
| 1 | **Typed OpenAPI client** | `scripts/openapi-export.py` emits `openapi.json`; `cd web && bun run gen:api` regenerates `web/src/api/schema.d.ts`; CI re-runs both and **fails if the committed output drifts**. UI-consumed routes ride this seam via `openapi-fetch`. | M0 |
| 2 | **pytest required** | `pytest -m "not quarantine"` blocks CI. Flaky tests get the `quarantine` marker → informational job, **never** `continue-on-error`. | M0 |
| 3 | **Vitest + Playwright** | `bun run test` (vitest unit/component) blocks; **no screen merges without a critical-flow Playwright e2e**. E2e specs adopt the scenario names from SPEC §10 / the milestone DoD. | M0 |
| 4 | **tsc strict + ESLint** | `bunx tsc --noEmit` (strict) + `bun run lint` block. **No `any` in `web/src/api`.** | M0 |
| 5 | **`owner_scoped` one-door** | `.fitness/owner-scoped.sh`: only `owner_scoped(query, Model, user)` may scope user data. A `path|count` allowlist freezes any legacy `.filter(Model.owner==...)`; allowlisted counts may shrink, never grow; non-allowlisted files must be zero. | M1 (first user-data tables) |
| 6a | **File-size ceiling** | `.fitness/file-size.sh`: no god-files. A frozen, **non-growing** allowlist of any over-ceiling files. New modules are born small. | M0 |
| 6b | **`response_model`** | every UI-consumed route declares `response_model=` (so the OpenAPI seam is typed). | M0 |
| 6c | **No raw `request.json()`** | new routes parse via typed Pydantic bodies, not raw JSON. | M0 |
| 6d | **No cross-feature imports** into the lean core | feature modules don't reach into each other; shared code lives in shared modules. | M0 |
| 6e | **TypeScript only** | no new `.js/.jsx/.mjs/.cjs` under `web/` (allowlist for unavoidable infra). | M0 |
| 6f | **Graph one-door** | only `src/graph/`, `src/student_context.py`, `routes/graph_routes.py` may touch graph tables. | M3 |
| 6g | **Model-router one-door** | no model name is hardcoded at a call site; calls declare a task profile and go through `src/model_router.py`. | M0 (router v1) / tightened as call sites grow |
| 7 | **Tutor evals** | a golden-set harness for the LLM *behaviors* the spec promises — and the **learning-science pedagogy** encoded in the tutor prompts (`docs/TUTOR-PROMPT-ARCHITECTURE.md`): never fake a citation; mark ungrounded; Socratic-not-spoiler unless asked; weakness-first; calm/no-comparison; resists injection; extraction precision; grading agreement. **Informational first** (Gate-2 quarantine playbook), blocking as it matures. See methodology below. | M1 informational (grounding/honesty) → M2 (grading) → M3 (extraction) |

### Rules

- **Gates are added, not waived.** A new invariant becomes a gate the same
  milestone it's introduced. Removing a gate needs an ADR.
- **Allowlists shrink, never grow.** Where a gate freezes a backlog (5, 6a, 6e),
  the count/list may only decrease over time.
- **A gate must be cheap and deterministic.** Bash + grep for structure; the
  language toolchains for types/tests; the eval harness for behavior. No flaky
  gate is blocking (it gets quarantined until fixed).
- **The contract is the seam.** Gate 1 is the linchpin: it's why the frontend is
  typesafe end-to-end and why backend changes can't silently break the UI.

### Gate 7 — eval methodology (from `docs/LEARNING-SCIENCE.md` §2.6)

Don't fool ourselves when measuring the tutor's models/behaviors:

- **Frozen, version-pinned held-out set** — never used for prompt/model tuning;
  touched once per eval run.
- **Student-level splits** where the unit of generalization is a new learner
  (mastery/grading models) — never row-level, which silently leaks and inflates.
- **Fixed metric bundle, not accuracy:** AUC (discrimination) + RMSE (calibration)
  + **Cohen's κ** (agreement above chance — the right metric for worksheet-grading
  vs. a human rater) + recall. Accuracy lies under the class imbalance typical of
  mastery/at-risk labels.
- **Must-beat baselines** declared up front (majority-class; per-concept average).
- **Multiple-testing correction** (Benjamini-Hochberg) across the many sub-checks;
  a **train-vs-eval-gap** alarm for overfitting.
- Behavioral pedagogy checks (the prompt-architecture rules) are pass/fail golden
  scenarios run against the configured models — each prompt module names the eval
  id that guards it.
- **Gate 7 is run on-demand against a configured model, NOT a blocking CI job**:
  CI has no API keys/local model, so the deterministic gates (1–6) block CI while
  the LLM evals run locally/manually and are tracked over time (the quarantine
  playbook). This is the one gate that cannot live purely in CI.

## Consequences

- New work always pays the verification tax up front; that's the point — it's
  what kept OLD-REF's invariants honest and what we carry forward (SPEC §12).
- The gate set is front-loaded at M0 (most gates) so the discipline exists before
  there's much code to discipline — avoiding OLD-REF's retrofit.
- Some gates (5, 6f, 7) only become meaningful when their subsystem lands; they
  are wired as no-ops/informational earlier and made blocking at the noted
  milestone.

## Alternatives considered

- **Convention + code review.** Rejected: single maintainer, agent-built across
  sessions; conventions are forgotten, a failing build is not.
- **Lint rules only (no bash fitness functions).** Rejected: structural
  invariants (one-door, god-files, no-JS) are easier and more robust as explicit
  grep-based checks than as custom linters.
