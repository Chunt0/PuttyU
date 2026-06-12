# SPEC — Phase 1: Lean Core + Verifiable Frontend Rewrite

> Master, self-contained execution spec. A fresh agent should be able to run this
> with no prior conversation context. **Read order:** `CLAUDE.md` →
> `docs/adr/0001-architecture-foundation.md` → `docs/adr/0002-verifiability-gates.md`
> → this file. Then execute slice by slice, top to bottom.

- Status: Active
- Date: 2026-06-05
- Owner: solo maintainer (agent-built)
- Tier: small → medium. **v1 is single-user.**

---

## 0. How an agent should execute this spec

1. **Never merge with a red gate.** The gates in §2 are the contract. If a change can't
   keep them green, the change is wrong, not the gate.
2. **Work in slices, in order** (§4). Each slice is a vertical (backend contract → typed
   client → UI → test). Finish and verify a slice before starting the next.
3. **Every task has an Acceptance check** — a command to run and an expected result. A
   task is not done until its check passes. Update its `- [ ]` to `- [x]` in this file.
4. **Ask before destructive backend deletion.** Cutting a feature's code (§Appendix C) is
   reversible only via git; confirm the new UI no longer calls it first.
5. **Do NOT**: rewrite the Python backend in another language; optimize for performance
   without a measured bottleneck; naively delete `document_processor` (chat needs it);
   grow any god-file (§Appendix B); add raw `request.json()` to a route.
6. Prefer small commits scoped to one task. Reference the task ID (e.g. `S1-T3`).

### Current-state facts (grounded, 2026-06-05)
- Backend: FastAPI, ~92K LOC Python, ~50 routers, 434 pytest files (37K LOC).
- Frontend: ~139K LOC vanilla JS in `static/`, no build, no types, no tests.
- CI (`.github/workflows/ci.yml`): only `compileall` + `node --check` (syntax). pytest
  runs `continue-on-error: true` (informational, NOT a gate).
- KEEP-set endpoints: **188 total, 28 have Pydantic models, 160 do not**; 10 are
  streaming/file/HTML (won't type cleanly via OpenAPI).
- Tools: **65 total → 35 KEEP / 30 CUT** (§Appendix B).
- Toolchain present: `bun` (~/.bun/bin/bun), `node` v24, `npm`. Backend Python 3.11
  (invoke via the project venv; `python` may not be on bare PATH — use `python3`/venv).

---

## 1. Target architecture

### 1.1 Repo layout (after Phase 1)
```
/                      # repo root (unchanged backend)
  app.py, core/, src/, routes/, services/   # Python backend — KEPT
  web/                 # NEW TypeScript frontend (Vite + React)
    src/
      api/             # generated OpenAPI types + typed client + streaming helpers
      app/             # router, providers (QueryClient), shell layout
      features/        # one folder per screen: auth, chat, sessions, models,
                       #   memory, corpus, research, tasks, settings
      lib/             # shared utils, state stores (client-state only)
      test/            # vitest setup, test utils
    e2e/               # Playwright critical-flow specs
    index.html, vite.config.ts, tsconfig.json, package.json, playwright.config.ts
  static/              # OLD frontend — served at /legacy during migration, then removed
  .fitness/            # fitness-function scripts + allowlists (§2 gate 6)
  scripts/openapi-export.py   # dump backend OpenAPI schema to web/src/api/openapi.json
```

### 1.2 Tooling (pin exact versions in `web/package.json`)
- **Runtime/toolchain:** Bun (package manager + test runner + script runner).
- **Build:** Vite 6.x. **UI:** React 19 + TypeScript 5.x (`strict: true`).
- **Server state:** TanStack Query v5. **Client state:** small Zustand store (or
  React context) — *only* for UI state (theme, panel open/closed), never server data.
- **Routing:** React Router (data router). **Styling:** plain CSS modules / vanilla-
  extract (no 1MB global sheet; scope per feature).
- **API client:** `openapi-typescript` (types) + `openapi-fetch` (typed fetch).
- **Tests:** Vitest (unit/component) + Playwright (e2e). **Lint:** ESLint +
  `@typescript-eslint`.

### 1.3 The typed seam (how front and back stay in contract)
1. Backend endpoints the UI consumes get Pydantic request **and** response models.
2. `scripts/openapi-export.py` imports `app` and writes `app.openapi()` to
   `web/src/api/openapi.json`.
3. `bun run gen:api` runs `openapi-typescript web/src/api/openapi.json -o
   web/src/api/schema.d.ts`.
4. UI calls go through `openapi-fetch` typed against `schema.d.ts`. Drift = type error.
5. **Streaming endpoints** (§Appendix A.2) are NOT covered by the typed client; they get
   hand-written, individually-typed helpers in `web/src/api/streaming.ts` (e.g.
   `streamChat(req: ChatStreamRequest): AsyncIterable<ChatEvent>`).

### 1.4 Dev & prod wiring (strangler coexistence)
- **Dev:** uvicorn on `127.0.0.1:7000`; Vite dev server proxies `/api/*` and `/static/*`
  to it (`vite.config.ts` server.proxy). Cookies flow same-origin via the proxy.
- **Prod:** FastAPI serves `web/dist` at `/`; the old `static/` app is remounted at
  `/legacy` behind a feature flag until parity is reached, then deleted.
- Auth stays **cookie-based**; the generated client uses `credentials: "same-origin"`.
  No bearer-token migration for the SPA.

---

## 2. Verifiability gates (the spine — see ADR 0002)

All gates run in CI and **block merge** once established. Introduce them via
**ratchet + allowlist** so the legacy code doesn't require a big-bang retrofit: freeze
the current violations in an allowlist, forbid *new* ones, shrink the allowlist over time.

### Gate 1 — Typed contract (frontend ↔ backend)
- CI job regenerates `schema.d.ts` from a fresh `app.openapi()` and runs `tsc --noEmit`.
- **Fails if:** generated schema differs from committed (drift) OR any UI call mismatches.
- Command: `python scripts/openapi-export.py && bun run gen:api && git diff --exit-code
  web/src/api/schema.d.ts && (cd web && bun run typecheck)`.

### Gate 2 — Backend tests required
- Flip pytest to blocking. First triage flaky tests: mark them
  `@pytest.mark.quarantine`; required job runs `pytest -m "not quarantine" -q`; a
  separate **non-blocking** job runs `pytest -m quarantine`.
- CI: remove `continue-on-error` from the required job.
- **Fails if:** any non-quarantined test fails.

### Gate 3 — Frontend tests
- `cd web && bun run test` (Vitest) + `bun run e2e` (Playwright).
- **Rule:** no feature screen merges without at least one Playwright flow covering it.
- Phase-1 required e2e flow: login → configure provider → send a chat → receive stream →
  switch session → reload → history intact.

### Gate 4 — Types + lint
- `cd web && tsc --noEmit && eslint .`. `strict: true`, no `any` in `web/src/api`.

### Gate 5 — Ownership (built now, enforced later)
- Implement `owner_scoped(query, Model, user)` in `src/auth_helpers.py`. Add
  `tests/test_owner_scoped.py` asserting cross-user isolation. **Not yet a blocking gate**
  (single-user v1); becomes blocking before multi-student rollout.

### Gate 6 — Fitness functions (Bash, in `.fitness/`)
Each is a script returning non-zero on violation; CI runs all of them.
- **6a `file-size.sh`** — fail if any tracked `*.py`/`*.ts`/`*.tsx` (excluding
  `static/`, `web/src/api/schema.d.ts`, vendored libs) exceeds **800 lines** AND is not
  listed in `.fitness/oversized-allowlist.txt`. Allowlist is frozen: no new entries, and
  a CI check fails if an allowlisted file *grows* beyond its recorded line count.
- **6b `route-response-models.sh`** — fail if any endpoint in
  `.fitness/ui-contract-endpoints.txt` (the endpoints the UI consumes) lacks a
  `response_model=` on its decorator. List grows as slices add screens.
- **6c `no-new-raw-json.sh`** — grep route files for `request.json()` / `request.form()`;
  fail on any occurrence not in `.fitness/raw-body-allowlist.txt`. Allowlist frozen +
  shrinking.
- **6d `no-cross-feature-import.sh`** — fail if a KEEP module imports a CUT feature
  module (prevents re-entangling the lean core). CUT module list in §Appendix C.

### CI wiring (target `.github/workflows/ci.yml` jobs)
`python-syntax` (keep) · `python-tests-required` (Gate 2) · `python-tests-quarantine`
(non-blocking) · `web-typecheck-lint` (Gates 1,4) · `web-unit` (Gate 3 Vitest) ·
`web-e2e` (Gate 3 Playwright) · `fitness` (Gate 6). Branch protection requires all
except the two non-blocking jobs.

---

## 3. Backend prep (small; contract + correctness only)

- [ ] **P-T1 — OpenAPI export script.** Write `scripts/openapi-export.py` (imports `app`,
  dumps `app.openapi()` to `web/src/api/openapi.json`). *Accept:* running it produces a
  non-empty JSON with `paths`.
- [ ] **P-T2 — Core contract models.** Add Pydantic request+response models to the 18
  core endpoints in §Appendix A.1 (those marked "needs"). Keep behavior identical.
  *Accept:* `pytest -m "not quarantine"` green; those endpoints show typed schemas in
  `/openapi.json`.
- [ ] **P-T3 — Disable cut-feature startup side-effects.** Stop the email poller and the
  default email/calendar/note scheduled-task creation (§Appendix C.3). *Accept:* fresh
  boot logs show no email-poller / no default email tasks; app starts clean.
- [ ] **P-T4 — Slim default tool set.** Remove the 30 CUT tools via the 8-step procedure
  (§Appendix B). Keep `document_processor` (image analysis) even though doc *tools* go.
  *Accept:* `pytest -m "not quarantine"` green; agent boot lists only the 35 KEEP tools;
  `grep -c '"name"' src/tool_schemas.py` reflects the reduction.
- [ ] **P-T5 — `owner_scoped` helper + test** (Gate 5). *Accept:* `tests/test_owner_scoped.py`
  passes.
- [ ] **P-T6 — Split the two god-files we touch** enough to pass Gate 6a without putting
  them on the frozen allowlist: carve `tool_implementations.py` into per-domain modules
  (the surviving KEEP `do_*` handlers) and extract helpers from `agent_loop.py`.
  *Accept:* neither file is on `.fitness/oversized-allowlist.txt`; `pytest` green.

---

## 4. Slices (vertical, in order)

> **Progress (2026-06-05): Slices 0–6 DONE** — committed + green in CI on `dev`,
> validated end-to-end against a real Ollama. **Next: Slice 7 (lazy deletion + retire
> legacy)** — the last Phase-1 slice. See `CLAUDE.md` →
> "Build status" for the authoritative state + open follow-ups (it's the single source of
> truth; these per-task checkboxes below are the original plan, not live status).

### Slice 0 — Foundation (no feature work until gates block merges)
- [ ] **S0-T1** Scaffold `web/` (Vite + React 19 + TS strict + Bun). `bun run dev` serves a
  blank shell proxying `/api` to uvicorn. *Accept:* shell loads at the Vite URL.
- [ ] **S0-T2** Wire `gen:api` (P-T1 must be done). Generated `schema.d.ts` committed.
  *Accept:* `bun run gen:api` succeeds; `tsc --noEmit` green.
- [ ] **S0-T3** Add the typed client (`openapi-fetch`) + `streaming.ts` skeleton +
  TanStack Query provider + React Router shell.
- [ ] **S0-T4** Stand up all six gates in CI (ratchets/allowlists seeded from current
  state) and turn on branch protection. *Accept:* a deliberately-bad PR (e.g. adds
  `request.json()` to a route) is **rejected** by CI.
- [ ] **S0-T5** Author `.fitness/*` scripts + seed allowlists. *Accept:* `fitness` job
  green on `main`.

### Slice 1 — Auth + Chat (the de-risking vertical)
- [ ] **S1-T1** Harden contracts for: `/api/auth/login`, `/api/auth/status`,
  `/api/auth/logout`, `/api/sessions`, `/api/session` (POST), `/api/history/{id}`,
  `/api/chat_stream` (type the form fields as a model + document the SSE event shape).
- [ ] **S1-T2** `streamChat()` in `streaming.ts`: typed request, parses the SSE event
  types (`message`, `tool_output`, `agent_step`, `error`, `stop` — confirm against
  `routes/chat_routes.py`). 
- [ ] **S1-T3** Build screens: Login, Chat (composer + streamed transcript), Session list
  + switch. Server state via TanStack Query; **no duplicated state** (single source).
- [ ] **S1-T4** Playwright flow (the Phase-1 required flow, minus provider until S2).
  *Accept (slice):* e2e green; `/legacy` still serves old UI; gates green.

### Slice 2 — Provider / model management
- [ ] **S2-T1** Contracts for `/api/model-endpoints` (GET/POST/PATCH/DELETE),
  `/api/models`, `/api/default-chat`, `/api/model-endpoints/{id}/probe`.
- [ ] **S2-T2** Settings → Providers screen: add/edit/test an endpoint (local + API),
  pick default chat model. *Accept:* can connect to a running LLM and chat end-to-end;
  extend the Playwright flow to include provider config.

> **Note — corpus backend is an independent track.** The corpus *subsystem* (`src/corpus/`
> models + importer + retriever, per ADR 0003) is buildable NOW, in parallel with / before
> the frontend, tested against `example-textbook/statistics/`. It does not depend on the
> real corpus library (a later data-load) nor on the frontend. Slice 3 below is the corpus
> *UI*; the backend can land earlier.

### Slice 3 — Memory + Corpus + RAG
- [x] **S3-T1** Contracts for `/api/memory` (GET/add/search/delete), `/api/personal` (list/
  upload/remove), `/api/embeddings/*` (models, endpoint). Models in `src/request_models.py`
  (`extra="allow"`); routes were under-ceiling + unfrozen, so they ride the real OpenAPI
  seam (typed `openapi-fetch`), not the hand-typed path Slice 2 needed.
- [x] **S3-T2** Memory screen (`features/memory`: list/add/search/delete). Corpus screen
  (`features/corpus`: upload/list/remove + active-embedding-model readout). Vitest +
  `e2e/memory-corpus.spec.ts`.
- [x] **S3-T3** Design note (resolved SPEC-faithful): the new `src/corpus/` *tutoring*
  corpus is OUT of Phase 1 — Slice 3 wired only the existing owner-scoped personal-docs RAG
  path; the corpus collection/routes/`init_db` wiring land in the tutoring phase. Upload UI
  kept metadata-extensible. Original note follows:
- [ ] **S3-T3 (original)** Design note: the tutoring corpus will be a **separate ChromaDB collection**
  beside owner-scoped personal-docs, with subject/concept/grade metadata. Phase 1 wires
  the personal-docs path; the corpus collection lands in the tutoring phase (out of scope
  here, but keep the upload UI metadata-extensible).

### Slice 4 — Agent mode UI
- [x] **S4-T1** Render tool-call events from the agent stream: tool name, input (`command`),
  output (+ exit status) inline in the transcript, via the pure `agentSteps.ts` reducer over
  `streamChat`'s `control` events (`tool_start`/`tool_output`/`plan_update`). Frontend-only.
- [x] **S4-T2** Agent toggle + Plan-mode sub-toggle (sends `plan_mode`; backend enforces the
  read-only tool set). *Accept:* `e2e/agent-turn.spec.ts` runs an agent turn whose `bash`
  tool step renders; vitest covers the reducer + a component agent turn. ✅

### Slice 5 — Deep Research UI
- [x] **S5-T1** Contracts for `/api/research/start` + `/status/{id}` + `/library` (typed
  `response_model`s); `/stream` is a hand-typed `streamResearch` SSE helper and `/report` is
  an HTML `<iframe>` (both outside the OpenAPI client). Research screen: start a job, watch
  streamed progress, auto-open the HTML report, browse + reopen past runs. Vitest +
  `e2e/research.spec.ts`.

### Slice 6 — Task scheduler UI
- [x] **S6-T1** `/api/tasks` (list/create/update/delete/run/pause/resume), `/{id}/runs`, and
  `/meta/{actions,output-targets}` — **hand-typed** (task_routes.py is a frozen god-file at its
  ceiling; typing it needs a P-T6-style split, like model_routes.py). Tasks screen:
  create/edit a task with **all three trigger types** — schedule (daily/weekly/monthly/once/
  cron), event (`/meta/events` + fire-every-N count), webhook (minted POST-to-fire URL +
  regenerate) — run/pause/resume/delete, expandable per-task runs. Vitest + `e2e/tasks.spec.ts`.

> **Calendar + notes + documents are KEEP (tutoring core).** They need new `web/` screens —
> **Slice 6.5a (Calendar)**, **6.5b (Notes)**, **6.5c (Documents)** — and those are **parity
> prerequisites for S7-T2** (you can't retire `/legacy` until every KEEP feature, now incl.
> calendar + notes + documents, has a new screen). S7-T1 must NOT delete `calendar_routes`/
> `note_routes`/`document_routes` or their tables (§Appendix C, corrected).

### Slice 6.5a — Calendar UI (KEEP)
- [x] **Hand-typed** `/api/calendar/*` (events list in range, create/update/delete; calendars
  list; CalDAV config/test/sync) — `calendar_routes.py` is frozen. `features/calendar/`: month
  agenda grouped by day, event create/edit/delete (recurring edits hit the series), a CalDAV
  connect/sync panel. Vitest + `e2e/calendar.spec.ts`.

### Slice 6.5b — Notes UI (KEEP)
- [x] `/api/notes/*` typed through the **real OpenAPI seam** (note_routes.py isn't frozen):
  `response_model`s on list/create/update/delete/pin/archive. `features/notes/` screen:
  create/edit/delete, pin, archive, active/archived views. Vitest + `e2e/notes.spec.ts`.

### Slice 6.5c — Documents UI (KEEP)
- [x] **Hand-typed** `/api/document(s)/*` (library w/ search, get one, create, versioned update,
  delete/archive, versions+restore, **PDF import**) — `document_routes.py` is frozen.
  `features/documents/`: library + create + PDF import; an editor with versioned save, version
  restore, archive, delete. Note: no standalone image-analysis endpoint — scanned/handwritten
  work gets VL extraction via **PDF import** (or chat attachments). Vitest + `e2e/documents.spec.ts`.

### Slice 7 — Lazy deletion + retire legacy
- [ ] **S7-T1** Delete CUT feature code in dependency order (**codex before email/documents**),
  guarded by tests. **Do NOT delete `calendar_routes`/`note_routes` (KEEP).** Drop dead DB
  tables in one migration once code paths are gone (§Appendix C, corrected — keeps calendar/
  notes tables).
- [ ] **S7-T2** Remove `/legacy` mount and the `static/` tree once KEEP parity confirmed
  (**incl. calendar + notes + documents screens** from Slices 6.5a/b/c).
  *Accept:* app serves only `web/dist`; full e2e green; CUT modules gone; Gate 6d clean.

---

## 5. Phase-1 exit criteria ("up and running")
- New React app serves all KEEP screens against the unchanged Python backend.
- All six gates exist and **block merges** (pytest green+required; tsc/eslint; Vitest +
  Playwright on the required flow; fitness functions live).
- Old `static/` frontend removed (or flagged off pending final parity).
- CUT features dormant or deleted; `document_processor` retained.
- A single user can: log in → configure a provider → chat (plain + agent) → add corpus
  docs and retrieve over them → run a research job → create a scheduled task.

---

## Appendix A — Core endpoint contract surface

### A.1 The 18 endpoints a minimal UI MUST consume (harden these first)
| # | Endpoint | Method | Has model? | Action |
|---|---|---|---|---|
| 1 | /api/auth/login | POST | req ✓ / resp ✗ | add response model |
| 2 | /api/auth/status | GET | ✗ | add response model |
| 3 | /api/auth/logout | POST | ✗ | add response model |
| 4 | /api/sessions | GET | ✗ | add `SessionListResponse` |
| 5 | /api/session | POST | resp ✓ / req form | add `SessionCreateRequest` |
| 6 | /api/history/{id} | GET | ✗ | add `HistoryResponse` |
| 7 | /api/chat | POST | req ✓ / resp ✓ | OK (verify) |
| 8 | /api/chat_stream | POST | ✗ (form, **stream**) | type form as `ChatStreamRequest`; SSE via streaming.ts |
| 9 | /api/models | GET | ✗ | add `ModelListResponse` |
| 10 | /api/model-endpoints | GET | ✗ | add `EndpointListResponse` |
| 11 | /api/default-chat | GET | ✗ | add response model |
| 12 | /api/memory | GET | ✗ | add response model |
| 13 | /api/memory/add | POST | req ✓ / resp ✓ | OK (verify) |
| 14 | /api/memory/search | POST | ✗ (form) | add `MemorySearchRequest` |
| 15 | /api/personal | GET | ✗ | add response model |
| 16 | /api/personal/upload | POST | UploadFile | add `PersonalUploadResponse` |
| 17 | /api/auth/settings | GET | ✗ | add response model (admin) |
| 18 | /api/prefs | GET | ✗ | add response model |

Overall KEEP-set: 188 endpoints, 28 typed, 160 to harden over time (do it per-slice, not
all upfront). Full per-module table is regenerable via the endpoint-inventory pass.

### A.2 Streaming / special endpoints (NOT in the typed client — hand-write helpers)
`POST /api/chat_stream`, `POST /api/chat_raw_stream`, `POST /api/chat_agent_stream`,
`POST /api/model-endpoints/test`, `GET /api/research/stream/{id}`,
`GET /api/research/report/{id}` (HTML), `GET /api/upload/{id}` (file),
`GET /api/mcp/oauth/*` (redirect/HTML).

---

## Appendix B — Tool inventory (65 → 35 KEEP / 30 CUT)

### KEEP (35)
`bash, python, web_search, web_fetch, read_file, write_file, edit_file, grep, glob, ls,`
`manage_memory, ask_user, update_plan, chat_with_model, ask_teacher, create_session,`
`list_sessions, send_to_session, manage_session, search_chats, pipeline, list_models,`
`ui_control, api_call, app_api, trigger_research, manage_research, manage_tasks,`
`create_document, update_document, edit_document, suggest_document,` plus core serving
read-only (`list_served_models, list_cached_models, list_cookbook_servers`).
*(Cookbook serving tools are KEEP-as-backend but the serving UI is deferred; the read-only
serving tools may stay for the agent. Trim further if context-bloat demands.)*

> **Scope correction (2026-06-05):** `manage_calendar` and `manage_notes` moved CUT → KEEP
> (calendar + notes are core to the tutoring app). The "30 CUT / 35 KEEP" counts below are now
> ~28 CUT / 37 KEEP; the calendar/notes rows are struck from this checklist.

### CUT (~28) — checklist
- [ ] Email (9): `list_email_accounts, send_email, list_emails, read_email,
  reply_to_email, bulk_email, delete_email, archive_email, mark_email_read`
- [x] ~~Calendar (1): `manage_calendar`~~ → **KEEP** (tutoring core)
- [x] ~~Notes (1): `manage_notes`~~ → **KEEP** (tutoring core)
- [ ] Contacts (2): `resolve_contact, manage_contact`
- [x] ~~Documents-mgmt (1): `manage_documents`~~ → **KEEP** (tutoring core; promoted DEFER→KEEP)
- [ ] Images (1): `edit_image`
- [ ] Admin config (4): `manage_endpoints, manage_mcp, manage_webhooks, manage_tokens`
      *(keep `manage_settings`, `manage_skills` only if a screen needs them; else cut)*
- [ ] Vault (3): `vault_search, vault_get, vault_unlock`
- [ ] Cookbook write (varies): `download_model, serve_model, stop_served_model,`
  `cancel_download, search_hf_models, serve_preset, adopt_served_model, list_downloads,`
  `tail_serve_output, list_serve_presets` — cut from the agent's default set (serving UI
  deferred); keep the Python impls until the lifecycle is rebuilt.

### 8-step clean removal (per tool)
1. Delete schema block in `src/tool_schemas.py` (`FUNCTION_TOOL_SCHEMAS`, ~L23-1181).
2. Remove from `ALWAYS_AVAILABLE` / `ASSISTANT_ALWAYS_AVAILABLE` (`src/tool_index.py:24-77`).
3. Remove from `_KEYWORD_HINTS` (`src/tool_index.py:325-459`).
4. Remove from `NON_ADMIN_BLOCKED_TOOLS` (`src/tool_security.py:14-51`).
5. Remove from `_PLAN_MODE_KNOWN_MUTATORS` (`src/tool_security.py:101-115`) if a mutator.
6. Remove dispatch: the `elif tool == "<name>"` branch in `src/tool_execution.py`
   (~L1339-1464), or the AI-interaction group (L1356-1361), or MCP map. Inline handlers
   (bash/python/files/web at L682-1117) are KEEP — don't touch.
7. Delete the `async def do_<name>` in `src/tool_implementations.py`.
8. Remove its `elif` in `function_call_to_tool_block()` (`src/tool_schemas.py:1207-1372`).
*Accept after each:* `pytest -m "not quarantine"` green.

---

## Appendix C — Cut-feature severability reference

> **Scope correction (2026-06-05): DO NOT delete calendar or notes.** They moved CUT → KEEP
> (tutoring core). `calendar_routes`, `note_routes` and the `calendars`/`calendar_events`/
> `notes` tables are struck from the lists below. Note: `codex_routes` still reuses the
> calendar router, so the codex-before-X ordering note now means codex must go before
> email/documents (calendar stays).

### C.1 CUT route modules (delete in S7; obey ordering)
`email_routes, email_pollers, email_helpers, gallery_routes,
gallery_helpers, contacts_routes, webhook_routes, vault_routes,
compare_routes, codex_routes, tts_routes, stt_routes, signature_routes, emoji_routes,
font_routes, editor_draft_routes, backup_routes, admin_wipe_routes`.
**KEEP (do not delete):** `calendar_routes`, `note_routes`.
**Ordering:** `codex_routes` reuses email/calendar/document routers → delete codex
**before** the email/document ones (calendar is KEEP).

### C.2 DB tables to drop (one migration, after code paths gone)
`email_accounts, gallery_albums, gallery_images,
comparisons, signatures, webhooks, editor_drafts`. **Keep:** `sessions, chat_messages,
memories, model_endpoints, mcp_servers, api_tokens, scheduled_tasks, task_runs,
documents, document_versions, user_tools, crew_members, calendars, calendar_events, notes`.

### C.3 Startup side-effects to disable (P-T3, before deletion)
- Email poller (started at import in the email routes/pollers).
- Default scheduled-task creation for email/calendar/note actions (in `app.py` startup +
  `src/builtin_actions.py`). Prune those action entries from the `BUILTIN_ACTIONS` map.
- DEFER (do not remove): `document_processor` (chat image analysis), task scheduler,
  bg_monitor, MCP startup, tool-index warmup — all KEEP.

---

## Appendix D — Frontend screen parity map (old `static/` → new `web/`)
| Old module | New feature | Phase-1? |
|---|---|---|
| chat.js, chatRenderer.js, chatStream.js | features/chat | ✅ S1/S4 |
| sessions.js | features/sessions | ✅ S1 |
| models.js, providers.js, modelPicker.js | features/models | ✅ S2 |
| memory.js | features/memory | ✅ S3 |
| rag.js | features/corpus | ✅ S3 |
| research/* | features/research | ✅ S5 |
| tasks.js | features/tasks | ✅ S6 |
| settings.js, prefs | features/settings | ✅ S2/S3 |
| admin.js | features/settings (admin) | partial |
| calendar.js | features/calendar | ⏳ KEEP — screen pending (new slice) |
| notes.js | features/notes | ⏳ KEEP — screen pending (new slice) |
| document.js | features/documents | ⏳ KEEP — screen pending (new slice) |
| gallery.js, emailLibrary.js, compare/*, tts-ai.js | — | ❌ CUT |
| windowDrag, tileManager, modalManager | — | ❌ dropped (lean shell) |

---

## Appendix E — Risks & do-not list
- **Don't** rewrite the backend off Python (kills the embeddings/MCP/serving/CalDAV moat).
- **Don't** cut `document_processor` (chat image analysis depends on it).
- **Don't** big-bang the frontend — strangler, slice by slice, `/legacy` stays until parity.
- **Don't** add raw `request.json()`/`form()` to routes (Gate 6c rejects it).
- **Don't** let `tool_implementations.py` / `agent_loop.py` stay monolithic for the parts
  you edit (Gate 6a).
- **Watch:** streaming endpoints are outside the typed client — keep their hand-written
  helpers individually typed and tested.

## Appendix F — Open questions (resolve in-phase)
- Exact corpus metadata schema (subject/concept/grade) — design at S3, build in tutoring phase.
- Client-state store choice (Zustand vs context) — decide at S0-T3.
- Whether `manage_settings`/`manage_skills` tools stay (depends on whether a screen needs them).
- CI: Bun + Playwright browser caching strategy.
```
