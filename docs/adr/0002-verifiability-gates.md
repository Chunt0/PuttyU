# ADR 0002 — Verifiability gates (the rules an agent cannot forget)

- Status: Accepted
- Date: 2026-06-05
- Deciders: project owner (solo, agent-assisted)

## Context

The prime directive for the fork (see ADR 0001) is a **rigid, verifiable system an AI
agent can safely expand**. The agent-first reality: an AI agent is the sole builder and
maintainer, forgets conventions across sessions, but *cannot bypass a failing build*.
Therefore invariants must be **mechanical gates**, not documented conventions.

Current state (2026-06-05): CI exists (`.github/workflows/ci.yml`) but only enforces
**syntax** — `python -m compileall` and `node --check`. The 434-test pytest suite runs
with `continue-on-error: true` (informational, not blocking, due to known flaky/env
failures). The frontend has no types and no tests. So today's enforced bar is "does it
parse." This ADR raises that bar.

## Decision

Adopt six gates. Each must **block merge** in CI once established. "Verifiable" =
types + tests + mechanical fitness functions, not types alone.

1. **Typed contract seam.** Generate the frontend API client from FastAPI's
   `/openapi.json` (`openapi-typescript` or equivalent). CI regenerates and fails on
   drift. Backend endpoints consumed by the UI must carry Pydantic request/response
   models (enforced by gate 6).

2. **Backend behavior gate.** Make the pytest suite **green and required** (remove
   `continue-on-error`). Fix or quarantine the known-flaky tests explicitly; new backend
   code ships with tests. This is the single highest-value existing asset — it just needs
   to become blocking.

3. **Frontend behavior gate.** Vitest (unit/component) + Playwright (critical user
   flows: login → chat stream → switch session → reload). **No screen merges without a
   flow test.** This catches the state-desync bug class that types cannot.

4. **Type gate.** `tsc --noEmit` with `strict: true` in CI. ESLint with
   `@typescript-eslint`. Catches the undefined-access / wrong-shape bug class.

5. **Ownership gate.** Data is owner-aware from day one (every user-scoped table already
   has an `owner` column). A reusable `owner_scoped(query, Model, user)` helper/mixin is
   the *only* sanctioned way to scope queries. A cross-user isolation test asserts no
   leakage. NOTE: because v1 is single-user, this gate is **built but not yet
   load-bearing**; it becomes mandatory before multiple students share an instance.

6. **Fitness functions (Bash, in CI).** Architectural invariants enforced by failing the
   build — the rules an agent forgets across sessions:
   - no route/module file exceeds a line ceiling (stops god-files regrowing);
   - every API route has a Pydantic response model (keeps the OpenAPI seam accurate);
   - no new `request.json()`/manual form parsing in routes (forces typed models);
   - forbid cross-feature imports that re-entangle the lean core;
   - **TypeScript only** — no tracked `.js/.jsx/.mjs/.cjs` outside a frozen, shrinking
     allowlist (legacy `static/`, deleted in Slice 7, + a few CI files); end state is zero
     JS. Even tooling configs are TS (`eslint.config.ts` via `jiti`). Makes ADR 0001's
     "rewrite the frontend in TypeScript" a mechanical invariant, not a convention.

## Consequences

- Phase 1 cannot be called "running" until the gates exist **and block merges** — wiring
  CI is itself Phase-1 work, not an afterthought.
- Some upfront cost (test stabilization, fitness scripts, client generation). This is the
  deliberate price of an agent-maintainable system; it compounds in safety as the
  tutoring features grow.
- Gate 6 will occasionally reject otherwise-working agent changes (e.g. an oversized
  file). That friction is the point: it converts "please remember" into "the build says
  no."

## Notes

- Line ceilings and exact thresholds are tuning knobs; start permissive enough to pass
  the kept core, then ratchet down as god-files are split.
- The god-files we actually touch in Phase 1 (`tool_implementations.py`, `agent_loop.py`)
  should be split along existing seams first, so gate 6 can be enabled without a huge
  retrofit. Files we don't touch can stay oversized behind an allowlist until deleted.

## Implementation status

- **Gate 2 — DONE (2026-06-05).** Empirical correction to the "Current state" snapshot
  above: the suite is **larger and healthier than recorded** — `2400 passed, 1 skipped`
  locally (the "434 tests / known flaky" figure was stale). So the gate was made blocking
  with **no tests quarantined**. Mechanism: CI `python-tests` job runs
  `pytest --strict-markers -m "not quarantine"` (required, `continue-on-error` removed); a
  separate informational job runs `-m quarantine`; the `quarantine` marker is registered
  in `pyproject.toml`. If CI surfaces a genuinely flaky test, tag it `@pytest.mark.quarantine`
  with a one-line reason — never restore `continue-on-error` on the whole suite.
- Gates 1, 3, 4, 6 land with the frontend scaffold (Slice 0). Gate 5 is built-but-dormant
  (single-user v1).
