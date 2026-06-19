# T5 vertical-4 contract — session-summary notes (F9)

> SPEC F9 "A session leaves a note behind": after a substantive study session the
> tutor DRAFTS an editable course note (covered / what clicked / still shaky /
> citations touched). The draft is the student's note — the tutor only drafts it
> (untrusted-content: a proposal, never auto-acted; calm: no auto-modal, no churn).
> Read order: `CLAUDE.md` → `docs/PHASE-2-BUILD-PLAN.md` §5 → this file. Seams
> verified 2026-06-19. Gates stay green; `.venv/bin/python`; `mkdir -p data`.

---

## 0. Pinned decisions (frozen)

- **D1 — on-demand route (NOT after-turn, NOT builtin).** `POST /api/sessions/{session_id}/summary`
  → `SessionSummaryResponse`. The user clicks "Summarize" when they finish — the
  explicit "I finished a substantive session" signal; after-turn would draft on every
  turn (token churn, not calm). New file `routes/session_summary_routes.py`,
  `setup_session_summary_routes(session_manager) -> APIRouter`, registered in `app.py`
  next to `setup_session_routes(...)`. Typed: `response_model`, no raw `request.json()`
  (no body — path param only), strict session ownership (404 on foreign), owner-scoped.
- **D2 — engine `src/session_summary.py`.**
  `async def summarize_session(session_manager, db, owner, session_id, *, min_turns=4) -> dict`
  returning `{"status": "ok"|"too_short"|"no_llm", "note": <_note_to_dict> | None}`.
  Steps: load via `session_manager.get_session(session_id)` + strict `session.owner==owner`
  check; gate on `Session.message_count` / real turn count `>= min_turns` → else
  `{"status":"too_short"}` (WRITES NOTHING); build the transcript (copy
  `src/graph/extractor.py:121 _recent_turns` — `sess.get_context_messages()`, keep
  role in {user,assistant} + non-empty, truncate each ~4000 chars; walk ALL turns, not
  just the window); resolve course via `src/corpus/grounding.py session_course_id`;
  build the graph ground-truth block via `src/student_context.py student_context(owner,
  course_id)` (Gate 6f — never touch graph tables); draft via the router (D4); on
  no-LLM `{"status":"no_llm"}` (WRITES NOTHING); else create the Note (D3) and return
  `{"status":"ok","note": _note_to_dict(note)}`.
- **D3 — close the `Note.course_id` gap (so the note lands "in the course").** The
  column exists (`core/database.py:1288`) but the notes API ignores it. In
  `routes/note_routes.py`: add `"course_id": note.course_id` + `"session_id":
  note.session_id` + `"source": note.source` to `_note_to_dict`; add an optional
  `course_id` query param to `list_notes` (`.filter(Note.course_id == course_id)` when
  given); add `course_id: Optional[str] = None` to `NoteCreate` + persist it in
  `create_note`. In `src/request_models.py` add `course_id/session_id/source`
  (Optional) to `NoteResponse`. Regenerate the contract.
- **D4 — the draft (free-form, copy the extractor).** Router
  `TaskProfile(tier="light", output_shape="free", latency="background")`, `owner=owner`,
  `legacy_prefix="utility"`; no-LLM guard `if not routed.endpoint_url or not routed.model:
  return {"status":"no_llm"}`. `raw = await llm_call_async(...)`; run through
  `src.text_helpers.strip_think(raw, prose=True)` (precedent `note_routes.py:195`);
  the result string IS the note body (no parse_extraction). NO model-name literals.
  `SUMMARY_SYSTEM_PROMPT`: a concise markdown note with sections **Covered / What
  clicked / Still shaky / Citations touched**, summarizing ONLY what's in the
  transcript + the student-context block; **NEVER invent a citation** (only repeat
  `[title §heading, p. N]` labels actually present in the transcript); calm, no praise
  inflation; it is the student's note.
- **D5 — Note fields on create.** `Note(id=uuid, owner=owner, title="Session summary —
  <course name or date>", content=<draft markdown>, note_type="note", source="agent",
  session_id=session_id, course_id=<resolved>, pinned=False, archived=False)`. Never
  auto-pin / auto-act (untrusted-content). owner set directly; reads via `owner_scoped`.
- **D6 — frontend.** `useSummarizeSession()` in `web/src/features/notes/api.ts`
  (POST the session id → `SessionSummaryResponse`; on success invalidate `["notes"]` +
  `["dashboard"]`). A "Summarize" button in the chat header (`web/src/features/chat/
  Chat.tsx`, guard `sessionId && !streaming && messages.length > 0`). On `status==="ok"`:
  `toast.success("Saved a note from this session — edit it in Notes.")` + `open("notes")`.
  On `"too_short"`: `toast.info("Not much to summarize yet — keep going.")`. On
  `"no_llm"`: `toast.info("No model configured for summaries.")`. The note is edited
  through the EXISTING Notes screen (zero new edit code). No auto-modal (calm).
- **D7 — untrusted-content + calm.** The draft is `source="agent"`, unpinned, surfaced
  gently (toast + Notes window), never forced into an edit dialog; never invents
  citations; the substantive gate lives server-side.

---

## 1. Condensed seam APIs (copy)
- Session load: `session_manager.get_session(session_id)` (`core/session_manager.py:350`,
  NOT owner-checked — check yourself). Transcript: `extractor._recent_turns` style over
  `sess.get_context_messages()` (`core/models.py:78`). Substantive: `Session.message_count`.
- Note create: `routes/note_routes.py:413-433` constructor. `_note_to_dict` `:60`.
  `NoteResponse`/`NoteListResponse` `src/request_models.py:342,361` (extra="allow").
- Course resolve: `grounding.session_course_id(session_id, fallback=None)`. Graph
  ground-truth: `student_context.student_context(owner, course_id)` (one-door, never raises).
- Router draft: `extractor.py:314-345` pattern; `strip_think` `src/text_helpers.py`.
- Wiring: `app.py:499` (setup_session_routes precedent). ui-contract + regen
  (`scripts/openapi-export.py && cd web && bun run gen:api`).
- Frontend entry: `Chat.tsx` header (lines ~185), `sessionId = useUiStore(s=>s.currentSessionId)`,
  `activeCourseId = useCourseStore(s=>s.activeCourseId)`. Notes hooks `notes/api.ts`;
  `useWindowStore(s=>s.open)("notes")`; toast `components/toast.ts`.

## 2. File ownership / phases
- **Phase A — backend (one agent):** `src/session_summary.py` (engine) +
  `routes/session_summary_routes.py` (route) + `src/request_models.py`
  (`SessionSummaryResponse` + NoteResponse course_id/session_id/source) +
  `routes/note_routes.py` (close the course_id gap: _note_to_dict, list_notes filter,
  NoteCreate) + `app.py` wiring + `.fitness/ui-contract-endpoints.txt` + regen. Tests:
  `tests/test_session_summary.py` (TestClient/house pattern): summarize a seeded
  session+transcript (mock the LLM) → an `agent` Note with the right course_id +
  session_id; too_short gate writes nothing; no_llm writes nothing; foreign session 404;
  the note is owner+course scoped. `tests/test_note_course_id.py`: create+list a note
  with course_id round-trips + the course filter.
- **Phase B — frontend (one agent):** `web/src/api/types.ts` (SessionSummaryResponse
  alias) + `web/src/features/notes/api.ts` (useSummarizeSession) + `Chat.tsx` button +
  vitest + `web/e2e/session-summary.spec.ts` (summarize → toast → Notes opens; the
  too-short path).

## 3. Invariant checklist
- [ ] on-demand only (no after-turn/builtin churn); draft is source="agent", unpinned, editable
- [ ] graph reads only via student_context/queries (Gate 6f); session ownership strict; owner_scoped note reads
- [ ] model selection only via model_router + TaskProfile; no model-name literals; no-LLM guard; never invents citations
- [ ] new route response_model + no raw request.json() (Gate 6c) + ui-contract line (6b); regen schema.d.ts (Gate 1)
- [ ] too_short / no_llm write NOTHING; no new `.js`; no god-file grew; no `any` in web/src/api
