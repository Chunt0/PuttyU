# T5 vertical-2 contract — schedule miner (authoritative for this slice)

> SPEC F2: a schedule-shaped upload → router structured extraction → **PROPOSED**
> calendar events + todos in a confirm-first review sheet; idempotent re-mine via a
> content-hash proposal key; every proposal provenance-linked to its source page;
> ambiguity **asked, never guessed**. Read order: `CLAUDE.md` (esp. the
> untrusted-content invariant) → `docs/PHASE-2-BUILD-PLAN.md` §5 → this file. Seams
> verified 2026-06-19. Gates stay green; `.venv/bin/python`; `mkdir -p data`.

THE PRODUCT RULE (untrusted-content invariant): everything the model reads from the
syllabus is untrusted; the **mine** step WRITES NOTHING — it only proposes. The
**apply** step is the only writer, and only the user-confirmed, unambiguous items.

---

## 0. Pinned decisions (frozen)

- **D1 — two routes, new file `routes/schedule_routes.py`** (`setup_schedule_routes()`,
  born small + typed; keeps `corpus_routes` from growing):
  - `POST /api/schedule/{source_id}/mine` → `MineResponse` — READ-ONLY. Loads the
    material text, runs the router extraction, diffs against existing miner-created
    rows, returns proposals. Writes nothing.
  - `POST /api/schedule/{source_id}/apply` (body `MineApplyRequest`) → `MineApplyResponse`
    — THE ONLY WRITER. Creates/updates the confirmed proposals as events + todos.
  Both `owner_scoped` (reads), typed body (Gate 6c), `response_model` (Gate 6b),
  `get_current_user`, SessionLocal try/finally. Add both to ui-contract + regen schema.d.ts.
- **D2 — engine + models in a new `src/schedule/` package** (mirror `src/practice/`):
  `src/schedule/miner.py` (the engine) + `src/schedule/schemas.py` (Pydantic models,
  `ConfigDict(extra="allow")`) — NOT `src/request_models.py` (keep it off its ceiling).
- **D3 — calendar provenance column (the one schema change).** Add
  `provenance = Column(Text, nullable=True)` to `CalendarEvent` (core/database.py ~:1331)
  AND a `_migrate_add_calendar_provenance` copying `_migrate_add_calendar_origin`
  (~:1544) wired into `init_db` (~:1448). (`Todo` already has `source` + `provenance`.)
- **D4 — extraction (`src/schedule/miner.py`).** Router `TaskProfile(tier="standard",
  output_shape="structured", latency="background")`, `owner=owner`,
  `legacy_prefix="utility"`; no-LLM guard `if not routed.endpoint_url or not routed.model:
  return None`; reuse `src.graph.extractor.parse_extraction`. The system prompt asks for
  a JSON list of items, each `{kind: "event"|"todo", type, title, date (ISO date|null),
  end_date?, all_day, page, ambiguous (bool), question (str|null)}`. **Ask-don't-guess:**
  a relative/unresolvable date ("Problem set due Week 5") → `date=null, ambiguous=true,
  question="couldn't resolve 'Week 5' — when does week 1 start?"`. Map kind: exams/
  quizzes/classes/lectures/labs → `event`; homework/assignments/readings/problem-sets/
  projects/papers → `todo` (the LLM emits `kind`; the miner validates/defaults).
- **D5 — material text load (owner-scoped).** `course_search.visible_sources_query(db, owner)`
  → filter `CorpusSource.id == source_id` (404 if None) → `CorpusChunk` ordered by `ordinal`
  → concat `.text`; page per chunk via `course_search.chunk_page_start(chunk)`. Include
  page markers in the user block so the LLM can cite the source page.
- **D6 — proposal_key + idempotent diff.** `line_hash = src.corpus.records.content_hash(
  normalized_item_text)`; `proposal_key = sha256(f"{source_id}:{line_hash}")`. Store
  provenance JSON `{source_id, page, line_hash, proposal_key}` on every created row.
  On **mine**, query existing miner rows scoped to this source (events:
  `origin=="miner"` via the `CalendarCal.owner` join + provenance source_id; todos:
  `source=="miner"` + provenance source_id, `owner_scoped`), build a `{proposal_key:
  row}` map, and tag each fresh proposal: `new` (key absent), `unchanged` (key present,
  same date/title), `changed` (key present, differs — include `existing_id`), and emit
  `stale` rows for DB keys absent from the new extraction (offer prune). Nothing beyond
  the rows' own provenance is persisted (the rows are the ledger).
- **D7 — apply = the only writer, idempotent.** Creates events via
  `_ensure_default_calendar(db, owner)` + `CalendarEvent(... origin="miner",
  provenance=json, course_id, dtstart/is_utc via _parse_dt_pair)`; todos via
  direct `Todo(source="miner", provenance=json, due_date=ISO, course_id, owner)`
  (the `POST /api/todos` route hardcodes manual — bypass it, construct the model).
  For a `changed` proposal with `existing_id`, UPDATE the existing row in place
  (match by proposal_key) — never duplicate. SKIP any `ambiguous && not resolved`
  item server-side (defense-in-depth even though the UI also blocks it). Apply only
  the items the body marks accepted. owner_scoped throughout.
- **D8 — frontend.** A `minerStore.ts` (mirror `pdfStore`/`gymStore`) + a "Mine
  schedule" button per material row in `Materials.tsx` → `open("miner")`. A `Miner`
  window (registered `hidden: true` in `tools.tsx`) renders the review sheet:
  per-proposal checkbox (include/prune; default-checked for `new`/`changed`, unchecked
  for `unchanged`/`stale`), an Edit toggle (inline date/title fields), a provenance chip
  "from syllabus p. N" → `openPdf(source_id, title, page)`, and ambiguous rows render
  the question + an inline resolve control (date input) and are EXCLUDED from bulk-accept
  & commit until resolved (mirror `ConceptDetail.tsx` AssertionRow). Header: the calm
  SPEC line "Found N homework due dates, M exams … — add to calendar and todos?".
  Hooks `useMineSchedule()` + `useApplyProposals()` in `web/src/features/schedule/api.ts`;
  on apply success invalidate `["calendar","events"]`, `["todos"]`, `["dashboard"]`.
- **D9 — calm + confirm-first.** No auto-mine on upload (explicit button). Nothing is
  written until the user clicks "Add to calendar + todos". Tokens-only, sentence-case,
  no emoji-as-UI.

---

## 1. Condensed seam APIs (copy)
- Material text: `from src.corpus import course_search; from src.corpus.models import CorpusSource, CorpusChunk`
  → `src = course_search.visible_sources_query(db, owner).filter(CorpusSource.id==source_id).first()`;
  `chunks = db.query(CorpusChunk).filter(CorpusChunk.source_id==src.id).order_by(CorpusChunk.ordinal).all()`;
  page = `course_search.chunk_page_start(c)`.
- Extraction: `src/graph/extractor.py:314-345` pattern; `parse_extraction` reuse;
  `src/model_router.py` resolve. `content_hash`: `src/corpus/records.py:58`.
- Calendar create: `routes/calendar_routes.py:156 _ensure_default_calendar(db, owner)`,
  `:284 _parse_dt_pair`, `:872 create_event` (copy). `CalendarEvent` PK is `uid`;
  dates naive + `is_utc`; all-day ⇒ `is_utc=False`, `dtend = dtstart + 1 day`.
  Owner is on `CalendarCal` — scope events by the `.join(CalendarCal).filter(CalendarCal.owner==owner)`.
- Todo create: direct `core.database.Todo(...)` (route hardcodes manual). `_todo_to_dict`
  (`routes/todo_routes.py:30`) for serialization. `due_date` is an ISO **string**.
- owner: `get_current_user(request)`; calendar side uses `_require_user`/`FALLBACK_OWNER`
  — resolve the owner ONCE and use it for both subsystems.
- Frontend: entry `web/src/features/library/Materials.tsx` (rows ~178-199); cross-window
  store `pdfStore.ts`/`gymStore.ts`; ask-not-guess UI `progress/ConceptDetail.tsx:41-108`;
  edit fields `calendar/EventForm.tsx`; provenance chip `openPdf` (`library/pdfStore.ts:28`);
  register `app/windows/tools.tsx` (`hidden:true`) + optional `router.tsx`; invalidate
  keys `calendar/api.ts:36`, `dashboard/api.ts:19,66`.

## 2. File ownership / phases
- **Phase A — backend (one agent):** `core/database.py` (CalendarEvent.provenance +
  migration), `src/schedule/{__init__,miner,schemas}.py`, `routes/schedule_routes.py`,
  `app.py` wiring, `.fitness/ui-contract-endpoints.txt`, regen contract. Tests:
  `tests/test_schedule_miner.py` (extraction w/ mocked LLM → proposals incl. ambiguous;
  the no-LLM guard), `tests/test_schedule_apply.py` (apply creates events+todos with
  provenance/proposal_key; re-apply is idempotent/updates-in-place; the diff
  new/changed/unchanged/stale; ambiguous-unresolved is skipped; owner_scoped).
- **Phase B — frontend (one agent):** `web/src/features/schedule/` (Miner.tsx, api.ts,
  miner.model.ts, miner.css, Miner.test.tsx, minerStore.ts), `web/src/api/types.ts`
  aliases, `Materials.tsx` button, register in `tools.tsx` (+ router). Tests: vitest +
  `web/e2e/schedule-miner.spec.ts` (mine → review → resolve an ambiguous item → apply
  → assert the apply POST body; a provenance chip; bulk select).

## 3. Invariant checklist (every agent)
- [ ] untrusted-content: **mine writes nothing**; apply writes only confirmed, unambiguous items
- [ ] graph untouched (this vertical is corpus+calendar+todo, no graph tables)
- [ ] owner_scoped on every read; events scoped via the CalendarCal.owner join; no new ad-hoc owner filters
- [ ] model selection only via model_router + TaskProfile; no model-name literals; no-LLM guard present
- [ ] new routes: response_model + typed body (no request.json()) + ui-contract lines; regen schema.d.ts
- [ ] idempotent: re-mine diffs, re-apply updates-in-place by proposal_key (never duplicates)
- [ ] ambiguous dates are asked, never written; no new `.js`; no god-file grew; no `any` in web/src/api
