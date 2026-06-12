# ADR 0001 — Architecture foundation for the tutoring fork

- Status: Accepted
- Date: 2026-06-05
- Deciders: project owner (solo, agent-assisted)

## Context

This repo (puttyU) is a feature-rich self-hosted AI workspace: a single FastAPI
process (~92K LOC Python) + a no-build vanilla-JS frontend (~139K LOC). It is being
**forked to become a tutoring app**. The center of gravity for the new product is a
curated **corpus of texts**, a **tutor persona**, and **longitudinal student progress
tracking** — none of which exist yet.

A prior architecture review established:

- The **backend is the strong asset**: sound modular-monolith layering
  (`setup_*_routes(deps)` DI, manager singletons in `src/app_initializer.py`, a clean
  middleware/auth chokepoint in `app.py`), 434 behavioral tests, security-conscious,
  and deeply anchored in the **Python AI ecosystem** (`fastembed` ONNX embeddings,
  `chromadb`, the `mcp` SDK, `caldav`, `pypdf`/PyMuPDF, local model serving via
  vLLM/llama.cpp). Rewriting it would discard the moat.
- The **frontend is the weak asset**: no types, no tests, no build step, and state
  scattered across module closures + `localStorage` + the DOM + `location.hash`
  (a desync-prone "4-store" problem). It is the least verifiable part of the system.
- The dominant structural debt elsewhere is **god-files** (`tool_implementations.py`
  204KB, `agent_loop.py` 165KB, `email_routes.py` 155KB, etc.) and
  **ownership-enforced-by-convention** multi-tenancy.

The owner's prime directive: **convert this into a rigid, verifiable system an AI agent
can safely expand**, leaning to a core first, then building tutoring on top.

## Decision

1. **Keep the Python backend.** It is the strongest, most-tested, ecosystem-anchored
   asset. No rewrite to Bun/TS/other runtimes.
2. **Rewrite the frontend** in **TypeScript + React + Vite**, with **Bun** as the
   build/test/runtime toolchain. TS `strict` from line one.
3. **Lean-down strategy = frontend-led strangler, not upfront backend surgery.** A
   backend feature becomes dead the moment the new lean UI stops calling it; its
   backend code is then deleted lazily, guarded by the existing test suite. We do **not**
   perform an in-place subtractive removal of entangled features (email/calendar/notes/
   documents) as a prerequisite to starting the frontend.
4. **No premature backend optimization.** There is no measured bottleneck, and the new
   client changes access patterns; performance work waits for evidence.
5. **Typed contract seam.** The frontend talks to the backend through a TS client
   **generated from FastAPI's OpenAPI schema**. Backend endpoints consumed by the new UI
   get Pydantic request/response models so the generated client is accurate.

## Alternatives rejected

- **Rewrite the backend in Bun/TS.** Rejected: discards 434 tests and the Python-only
  embeddings/serving/MCP/CalDAV/PDF stack — months of work to re-reach parity, deleting
  the product's moat.
- **In-place backend lean-down first, frontend second.** Rejected: the cut-list features
  are ENTANGLED (startup pollers, `builtin_actions`, codex router reuse, agent-loop
  imports); subtractive surgery is high-risk and still yields an un-verifiable
  architecture, just smaller.
- **Incremental JS→TS of the existing frontend (keep the DOM code).** Rejected for the
  product UI: types alone don't fix the 4-store state desync, and a tutoring UX wants a
  leaner shell anyway. (Incremental typing remains fine for any code we choose to keep.)
- **Big-bang full rewrite (front + back).** Rejected: highest risk, longest time-to-
  running, throws away working tested behavior.

## Consequences

- Two languages across the stack (Python backend, TS frontend). Acceptable and standard
  at this scale; the OpenAPI seam keeps the contract typed.
- A build step is introduced where none existed (cost: dist pipeline, source maps,
  service-worker precache regeneration). Accepted as the price of verifiability.
- The bespoke floating-window/tile/drag shell is **not** rebuilt (see SPEC); the student
  UX is lean.
- Backend features go dormant before they are deleted — transient dead code is expected
  and tolerated, tracked in the SPEC cut-list.

See `docs/adr/0002-verifiability-gates.md` for how "rigid and verifiable" is enforced,
and `docs/SPEC-phase-1-lean-core.md` for the executable scope and sequence.
