# DESIGN — M0 (foundation & spine) + M1 (courses + library + grounded chat)

> The concrete build design for the first two milestones. Schema lives in
> ADR-0004; gates in ADR-0002; corpus/catalog/embeddings in ADR-0003; auth/config
> in ADR-0001. This doc is the *how* that ties them together: API surface, the
> streaming contract, the chat loop, ingestion flow, the frontend shell, and
> failure modes. SPEC §9 has the milestone scope and Definition of Done.

## 1. Scope

- **M0 — foundation & spine.** Repo + all gates green; typed FastAPI↔React
  contract; single-owner auth; the Odysseus-style shell; provider config +
  model-router v1; **plain streaming chat** (no grounding).
- **M1 — courses + library + grounded chat.** Courses + tabs + onboarding;
  library catalog + lazy ingestion + PDF viewer; **course-scoped grounded chat**
  with citation chips and the honesty marker.

Nothing else is built until M0 then M1 are green.

## 2. API surface

All UI-consumed routes carry `response_model=` (Gate 6b), parse typed bodies
(Gate 6c), and flow through the OpenAPI seam (Gate 1). SSE endpoints are noted.

### M0

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | liveness/readiness |
| GET | `/api/auth/me` | current owner (or 401 / 409-needs-setup) |
| POST | `/api/auth/setup` | first-run: create the owner (only if none exists) |
| POST | `/api/auth/login` | password → session cookie |
| POST | `/api/auth/logout` | clear session |
| GET / PUT | `/api/settings` | server-side prefs (incl. router policy) |
| GET / POST | `/api/model-endpoints` | list / add providers |
| PUT / DELETE | `/api/model-endpoints/{id}` | edit / remove (keys never returned) |
| GET | `/api/router/resolution` | live tier→endpoint/model table (F7 observability) |
| POST | `/api/router/test` | probe an endpoint/model |
| GET / POST | `/api/sessions` | list / create chat sessions |
| GET | `/api/sessions/{id}` | session + metadata |
| PATCH | `/api/sessions/{id}` | rename / archive |
| GET | `/api/sessions/{id}/messages` | message history |
| POST | `/api/chat` | **SSE** — send a message, stream the reply |
| POST | `/api/chat/{session_id}/stop` | stop generation cleanly |

### M1 (adds)

| Method | Path | Purpose |
|---|---|---|
| GET / POST | `/api/courses` | list / create courses |
| GET / PATCH | `/api/courses/{id}` | detail / edit |
| POST | `/api/courses/{id}/archive` | archive / reactivate |
| GET | `/api/library/catalog?q=&subject=&type=` | search **available** sources (ADR-0003) |
| GET | `/api/courses/{id}/sources` | sources linked to the course |
| POST | `/api/courses/{id}/sources` | link a catalog entry → triggers lazy ingest |
| DELETE | `/api/courses/{id}/sources/{sid}` | unlink |
| GET | `/api/sources/{id}` | ingested source + status |
| GET | `/api/sources/{id}/toc` | heading-path tree |
| GET | `/api/sources/{id}/status` | ingestion progress (poll; SSE optional) |
| GET | `/api/sources/{id}/pdf` | serve the PDF (by source_id only — no client paths) |

Retrieval is **internal** to the chat loop (scoped by the active course); a
debug-only `POST /api/retrieve` may exist behind a flag.

## 3. Streaming contract (SSE)

`POST /api/chat` returns `text/event-stream`. Each event is one line:
`data: <json>\n\n`, where json has a discriminating `type`:

| `type` | Payload | Meaning |
|---|---|---|
| `message` | `{id, role:"assistant"}` | assistant message started |
| `status` | `{stage:"retrieving"\|"generating"}` | progress (UI spinner copy) |
| `token` | `{text}` | a content delta |
| `citation` | `{citations:[{chunk_id,source_id,label,page_start}]}` | sources the answer used |
| `done` | `{message_id, grounded:bool, model, usage:{in,out}}` | finished; persisted |
| `error` | `{code, message, hint?}` | failed (e.g. `no_vision_model`, `no_provider`) |

- **Client pattern:** a dedicated `streamChat()` (fetch + `ReadableStream`
  reader + line parser), **not** TanStack Query (Query doesn't stream). Tokens
  append to a per-session buffer in a Zustand store; on `done`, invalidate the
  `messages` query so the canonical persisted history reloads. Query owns all
  cacheable GETs.
- **Stop:** `/api/chat/{id}/stop` flips a per-stream cancel flag; the server
  finalizes a partial assistant message (no corrupted history).
- Later (agent mode, M-later) adds `tool` events on the same envelope.

## 4. Auth flow (ADR-0001)

1. SPA loads → `GET /api/auth/me`. `409 needs_setup` → setup screen; `401` →
   login; `200` → in.
2. `POST /api/auth/setup` (only when no `user` exists) creates the owner (bcrypt).
3. `POST /api/auth/login` sets a signed httpOnly `SameSite=Lax` session cookie.
4. Mutations require the `X-PuttyU-CSRF` header (SPA-set). Login is rate-limited.

## 5. Provider config & router resolution (F7, Gate 6g)

- Providers are `model_endpoint` rows (ADR-0004); each lists its `models` with
  capabilities. Keys are Fernet-encrypted at rest; never returned to the client.
- A **task profile** `{tier, modality, output_shape, latency, privacy}` is passed
  to `model_router.resolve(profile) -> (endpoint, model, token_budget)`:
  1. If `pins[tier]` is set and available → use it.
  2. Filter by hard requirements: `modality=vision` ⇒ `vision:true`;
     `output=structured` ⇒ provider supports structured output. **Vision with no
     vision model ⇒ raise `no_vision_model`** (loud, with a setup hint — never
     silently text-only).
  3. Rank survivors by policy: `local_first` prefers Ollama/local then meets
     `tier`'s minimum `reasoning_class`; `quality_first` prefers the strongest
     reasoner.
  4. If none meets the tier, **degrade** to the best available and flag "below
     preferred" in `/api/router/resolution` (no silent degradation).
  5. `token_budget = model.context_window − reserve`; the F6 assembler (M3)
     consumes this budget, so router and assembler compose.
- Tier minimums: `micro ≤ light ≤ standard ≤ deep`; `vision` is an orthogonal
  modality requirement. The tier table is data in `setting.router` — re-tunable
  without a deploy.

## 6. The chat loop

### M0 (plain)
1. Persist the user message. 2. Resolve model (`tier=standard`; `vision` if
attachments). 3. Stream completion with the default tutor system prompt.
4. Persist the assistant message (`meta.model`, `usage`).

### M1 (grounded, inside a course)
1. Persist user message.
2. If `course_id` has linked sources → **retrieve** (ADR-0003): embed query →
   Chroma filtered by `course_id` → top-k → expand in SQLite. Each chunk gets a
   stable label `[S1], [S2], …`.
3. **System prompt** = default tutor persona + grounding rules ("answer from the
   provided sources first; cite with `[S#]`; if the sources don't cover it, say
   so and do **not** invent `[S#]`") + the labeled chunks.
4. Resolve + stream. The model cites inline as `[S#]`.
5. Backend maps used `[S#]` → citation metadata and emits a `citation` event;
   `grounded = (any [S#] used)`. The UI rewrites `[S#]` into clickable chips and,
   when `grounded=false`, shows the honesty marker.
6. Persist assistant message with `meta.citations`, `meta.grounded`.

This is the contract the **tutor-eval** harness (Gate 7) checks: never fake a
citation; mark ungrounded answers.

## 7. Lazy ingestion flow (ADR-0003)

1. `POST /api/courses/{id}/sources {catalog_id}`. If the catalog entry already
   has `ingested_source_id`, just create the `course_source` link.
2. Otherwise create `corpus_source(status=ingesting)`, create the link, and
   enqueue a background ingest (asyncio task — single process): parse → chunk →
   embed → insert `corpus_chunk` rows → `status=ingested` → set
   `library_catalog.ingested_source_id`. On failure → `status=failed` (visible,
   not silent — SPEC §12).
3. The UI polls `GET /api/sources/{id}/status` and enables the source when ready.
4. Idempotent by `content_hash`; the admin CLI (`python -m engines.corpus …`) shares
   the exact same pipeline.

## 8. Frontend shell (Odysseus-style, SPEC §6)

- **Design system:** built on the **putty-ai-design** kit — see
  `docs/DESIGN-SYSTEM.md`. At M0: copy fonts/tokens/themes/mascot into `web/`,
  port the `pa-` component library to ESM, and build the shell from the kit's
  `Sidebar`/`Composer`/`Messages`/`Login`/`App` (Tools list adapted to PuttyU's
  surfaces). All shell pieces below use the kit's primitives + tokens.
- **Routing** (React Router data router) — every surface is a deep-linkable URL
  (URLs are the "doors"):
  - `/login`, `/setup`
  - `/` Home · `/chat/:sessionId` (course-less chat)
  - `/c/:slug` course home (M1: chat) · `/c/:slug/chat/:sessionId`
  - `/c/:slug/library` · `/c/:slug/library/:sourceId` (TOC) ·
    `/c/:slug/library/:sourceId/p/:page` (**PDF at page — the citation door**)
  - `/settings/providers`, `/settings/appearance`
- **Window manager** — a registry of dockable tool windows (PDF viewer now;
  canvas later). A Zustand store holds open windows + z-order + dock state. Tools
  open from the command palette or a citation click.
- **State split:** TanStack Query = server cache (sessions, messages, courses,
  catalog, router resolution); Zustand = UI only (theme, panels/windows, active
  course, live stream buffers).
- **Shell pieces (M0):** sidebar + main + tool-window layer; course tab strip
  (M1); composer with slash commands; Cmd/Ctrl-K palette; theme picker; Markdown
  renderer with bundled KaTeX + citation-chip support.

## 9. Failure modes

| Condition | Behavior |
|---|---|
| No provider configured | Chat composer disabled with a "configure a provider" link to settings; `error:no_provider`. |
| LLM endpoint unreachable | `error` event with a clear message; partial message preserved; endpoint marked unhealthy in `/api/router/resolution`. |
| Vision required, no vision model | `error:no_vision_model` + setup hint; image **not** sent to a text model. |
| Chroma / embeddings unavailable | Retrieval falls back to SQLite FTS5 keyword; UI notes reduced grounding; never hard-fail. |
| Retrieval returns nothing | Answer proceeds ungrounded with the honesty marker (`grounded:false`). |
| Ingestion fails | `corpus_source.status=failed`, surfaced in the library panel; the link stays but the source shows "failed — retry". |
| PDF missing for a citation | Chip still opens the section (TOC); "PDF unavailable" instead of a dead viewer. |
| Generation stopped mid-stream | Server finalizes the partial assistant message; history stays consistent. |

## 10. Build order within the milestones

**M0:** **remove the stale `.github/` CI** carried from the prior project (the
`ci.yml` byte-compiles non-existent `app.py/core/...`; delete the leftover `.js`
scripts) → repo skeleton (`backend/` + `web/`) + our CI + gates wired (green on
empty) → DB + `user` + auth +
first-run → settings + `model_endpoint` + router v1 + Providers screen → shell
(routing, window manager, theme, composer, palette) → sessions + plain streaming
chat → **append-only `interaction_event` logging wired in** (ADR-0004 — the
learning-science substrate; even M0 chat turns are logged so M3's mastery model
has clean, leakage-safe history) → all gates green.

**M1:** `course` CRUD + tabs + onboarding → `library_catalog` build + catalog
search + source-suggestion → lazy ingestion pipeline + status → library browser +
TOC + PDF viewer (open-at-page) → course-scoped retrieval → grounded chat +
citation chips + honesty marker → tutor-eval harness (informational) → all gates
green.
