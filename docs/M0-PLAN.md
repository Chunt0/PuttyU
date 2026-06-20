# M0 PLAN — foundation & spine, in digestible chunks

> The build plan for **M0**: the cross-cutting technical decisions that shape the
> first code, plus the chunk breakdown (each chunk is built, gated green, and
> **surfaced for review before the next** — the CLAUDE.md prime directive).
> Companion to `docs/DESIGN-M0-M1.md` (the API/schema/contract) and ADR-0001/0002.

- **Status:** Accepted (2026-06-20)
- **Goal of M0:** a running, Odysseus-fidelity app whose **verifiability spine is
  green before any tutoring feature exists** — auth, the typed contract, the gate
  harness, the shell, model router v1, and plain streaming chat. No courses, no
  corpus, no graph (those are M1+).

## Decisions locked this pass

- **Wordmark = "puttyU"** (putty-ai type + putty-blob mascot); **no tagline**.
- **Frontend tests = Bun test** (unit/component via `@testing-library/react` +
  happy-dom) **+ Playwright** (e2e). No Vitest.
- **MCP server surface = dropped from v1** (SPEC §13 O6).

## Cross-cutting technical decisions (the gaps we're closing)

### 1. Frontend serving
- **Dev:** Vite dev server; `/api/*` proxied to uvicorn. Two processes.
- **Prod:** `bun run build` → FastAPI serves `web/dist` via `StaticFiles` with an
  SPA fallback (deep-link routes resolve to `index.html`). **Single container.**

### 2. Dependency pinning (reproducibility is a stated value)
- **Backend:** Python 3.11; **`uv`** with a committed lock (FastAPI, uvicorn,
  SQLAlchemy 2.x, pydantic 2.x, `chromadb`, `fastembed`, `bcrypt`, `cryptography`,
  `anthropic`, `httpx`, `pytest`, `pytest-asyncio`).
- **Web:** **Bun** with committed `bun.lockb` (React 19, Vite 6, TypeScript 5,
  `openapi-typescript`, `openapi-fetch`, `@testing-library/react`, `happy-dom`,
  `@playwright/test`, eslint + `@typescript-eslint`).
- Exact versions live in the lockfiles (committed); both are required by CI.

### 3. SSE typing — keep streaming inside the typed contract (the real gap)
REST is typed via OpenAPI (Gate 1), but **streaming sits outside OpenAPI**. So:
- Define the SSE envelope as a **single source of truth**: a Pydantic
  **discriminated union** on the backend —
  `ChatEvent = Token | Citation | Status | Done | Error` (discriminant `type`).
- `scripts/openapi-export.py` emits these models into the OpenAPI
  `components.schemas`, so `bun run gen:api` generates their **TS types alongside
  the REST types** — one codegen, no hand-typed stream types.
- `streamChat()` parses each SSE line and **validates it against the generated
  type** (a thin runtime guard); unknown `type` → logged, ignored.
- A **fitness check** asserts the `ChatEvent` models are exported, so the stream
  contract can't silently drift. (Extends Gate 1 to cover SSE.)

### 4. LLM test strategy — deterministic, token-free
- A **`FakeProvider`** sits behind the model router, selected when
  `PUTTYU_TEST_MODE=1` (and whenever CI runs — no keys there).
- It returns **deterministic canned responses keyed by a prompt fingerprint**, and
  can emit **scripted SSE sequences** (tokens, citations, `error:no_vision_model`,
  etc.).
- pytest + Bun test + Playwright all run against it → **no real model, no tokens,
  fully reproducible**. This is what makes M1's grounded-chat e2e testable.
- **Gate 7** (real-model behavioral evals) is the *only* thing needing a real
  model; it runs on-demand/local, never in CI (ADR-0002).

### 5. Auth session storage
- A small **`auth_session`** table (`id`, `owner`, `created_at`, `expires_at`),
  keyed by the signed cookie's session id — **revocable** and simple (preferred
  over a stateless token). Distinct from `session` (a chat session).

### 6. Config surface (`.env.example`)
`PUTTYU_SECRET_KEY` (signs cookies + Fernet-encrypts provider keys — **back this
up; losing it invalidates stored keys and sessions**), `PUTTYU_DATA_DIR`,
`PUTTYU_LIBRARY_PATH`, `PUTTYU_DB_URL`, `PUTTYU_EMBED_MODEL`, `PUTTYU_TEST_MODE`,
`PUTTYU_HOST`/`PUTTYU_PORT`, and optional provider keys (or set them in-app).

### 7. Dev seed / fixtures
- `scripts/seed-dev.py`: create the owner, optionally ingest one small book
  (`--no-embed` for speed), and add a sample course/session — so the app is
  **reviewable with real content** during the build. Never run in prod.

### 8. Model-router defaults
- Tier table (data, re-tunable): **deep→Claude Opus, standard→Claude Sonnet,
  micro/light→Claude Haiku or a local Ollama model, vision→a VL-capable model**.
  Exact model IDs per the `claude-api` reference at implementation; a one-model or
  one-Ollama box still resolves every tier (SPEC F7).

## The M0 chunk plan

Each chunk ends **demoable + all applicable gates green**, then pauses for review.

| Chunk | Scope | Definition of Done (review gate) |
|---|---|---|
| **M0.0 — skeleton & green harness** | Fresh `.github` CI (stale one already removed); `backend/` (FastAPI + `/api/health` + config + SQLite init + WAL + uv lock); `web/` (React+Vite+Bun, putty-ai tokens/fonts, blank Odysseus-shaped shell); typed OpenAPI contract for `/api/health`; the full gate harness (pytest, bun test, one Playwright e2e, tsc strict, eslint, `.fitness/`) **green on the near-empty app**. | App boots; `/api/health` typed end-to-end (no drift); CI + `.fitness/run-all.sh` green. |
| **M0.1 — auth & first-run** | `user` + `auth_session`; bcrypt; signed httpOnly cookie + CSRF; first-run setup → login → logout; `owner_scoped` introduced + **Gate 5** wired. | setup→login→logout Playwright e2e green; Gate 5 active. |
| **M0.2 — providers & router v1** | `model_endpoint` + `setting`; `model_router.resolve()`; Providers screen; **FakeProvider** for tests; **Gate 6g**. | Add a provider in the UI; `/api/router/resolution` renders; vision-absent fails loud; tests run on FakeProvider. |
| **M0.3 — the shell, for real** | Odysseus-fidelity shell from the kit: sidebar, **dockable window manager**, theme picker (16+1), **Cmd-K palette**, slash-command composer. | **UX-fidelity criterion met** — verified side-by-side vs `ODYSSEUS-REF/` (SPEC §6 / M0 DoD). |
| **M0.4 — sessions & streaming chat** | `session` + `chat_message`; `POST /api/chat` SSE (typed `ChatEvent`); `streamChat()` client; stop-generation; **append-only `interaction_event` logging**. | Plain streaming chat end-to-end; sessions persist/rename/archive/reload; stop leaves clean history; events logged. **→ M0 complete (SPEC §9.1).** |

Then: review M0 as a whole → start **M1** (courses + library + grounded chat),
itself chunked the same way.

## Out of scope for M0 (so it stays small)
Courses, corpus/catalog/ingestion, the graph/BKT, practice, dashboard, worksheets,
canvas — all M1+. M0 is the spine only.
