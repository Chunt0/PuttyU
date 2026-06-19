# T6a contract — worksheet grading depth (F4)

> SPEC F4 (~lines 443-456): photograph/scan handwritten work → graded feedback that
> references the user's ACTUAL lines (what's right, where the FIRST error is, a
> nudging question in guide mode, cite the mistaken concept's section); results
> WRITE graph evidence (with the error pattern) and the review queue gains a
> follow-up item. Read order: `CLAUDE.md` (untrusted-content; document_processor is
> load-bearing — don't cut; calm) → `docs/PHASE-2-BUILD-PLAN.md` §6 → this file.
> Seam-verified 2026-06-19. Gates green; `.venv/bin/python`; `mkdir -p data`.

Key insight: the **follow-up review item is DECLARATIVE** — the queue (`items.due_concepts`)
mints on demand and ranks by weakness, so writing an `incorrect`/`partial` evidence
row against a concept auto-raises it into the next queue. No enqueue API needed.

---

## 0. Pinned decisions (frozen)

- **D1 — `grade_worksheet` in `src/practice/items.py`** (not an overload of `grade_answer`
  — a worksheet is multi-problem with NO minted item / no stored reference answer):
  `async def grade_worksheet(db, owner, course_id, *, attachment_ids, guide=True) -> dict`.
  Reuse `_resolve_image_data_uris` (the practice engine's owner-aware image door — do
  NOT import document_processor) + the `_grade_llm` router pattern. Router
  `TaskProfile(tier="standard", modality="vision", output_shape="structured")`,
  `owner=owner`. RouterError (no VL) → return `{problems:[], concepts_touched:[],
  setup_hint: <msg>}` — NEVER grade blind. No-LLM / parse failure → `{problems:[], ...}`
  gracefully. The system prompt asks for a JSON list of problems, each
  `{problem_label, verdict: correct|partial|incorrect, whats_right, first_error,
  nudge_question, concept (name), error_pattern, study_citation?}` and, per `guide`:
  guide=True → give `nudge_question`, WITHHOLD the corrected answer; guide=False →
  may state the fix. Reuse `parse_extraction`.
- **D2 — concept resolution (closed-world).** Map each problem's named `concept` to a
  real `ConceptNode` via `extractor.course_concept_shortlist(db, course_id, owner)` +
  `normalize_name` (mirror `persist_extraction`); DROP problems whose concept doesn't
  match a region node (don't invent nodes).
- **D3 — graph hook (Gate 6f, the one door).** Per problem with a resolved concept and
  a non-`ungraded` verdict: `queries.record_evidence(concept_id, signal, weight=1.0,
  episode_ref=episode_ref("upload", attachment_id), context={"source":"worksheet",
  "error_pattern": <short tag>}, owner=owner, db=db)` (signal = `_VERDICT_SIGNAL[verdict]`).
  `"worksheet"` is already a documented `context.source`; `error_pattern` is just a
  context key — NO schema change. The weakness bump IS the follow-up review item (D-note).
  Return each problem's resulting `(state, effective_p)`.
- **D4 — schemas** (`src/practice/schemas.py`, `ConfigDict(extra="allow")`, reuse
  `Citation`): `WorksheetGradeRequest {course_id: str, attachment_ids: list[str],
  guide: bool = True}`; `WorksheetProblemVerdict {problem_label, verdict, whats_right,
  first_error, nudge_question, concept_id?, concept_name?, study_citation?: Citation,
  error_pattern?, state?, effective_p?}`; `WorksheetGradeResponse {problems:
  list[WorksheetProblemVerdict], concepts_touched: list[str], setup_hint?: str}`.
- **D5 — route** `POST /api/practice/worksheet` → `WorksheetGradeResponse` in
  `routes/practice_routes.py` (mirror the existing handlers): `effective_user(request)`
  (attribute evidence to the real owner), typed body (Gate 6c), `response_model`
  (Gate 6b), `SessionLocal` try/finally, `async`. Add to `.fitness/ui-contract-endpoints.txt`;
  regen the contract.
- **D6 — frontend "Worksheet" view** `web/src/features/worksheet/` (Worksheet.tsx, api.ts,
  worksheet.css, Worksheet.test.tsx): gate on active course; attach photo(s) via the
  existing CameraCapture + file upload (`uploadFiles` → attachment ids); a guide
  toggle; a "Check my work" button → `useGradeWorksheet()` (POST /api/practice/worksheet)
  → render per-problem cards: the verdict label (calm), what's right, the FIRST error,
  the nudge question (guide), the concept + StateChip, and the study citation as a
  clickable chip (CitationChips → openPdf). Register in `web/src/app/windows/tools.tsx`
  (`{key:"worksheet", title:"Worksheet", node:<Worksheet/>}`). (Canvas as an input mode
  is added in T6b; v1 worksheet input is photo/file.)
- **D7 — untrusted-content + calm.** The graded feedback + evidence are derived from an
  untrusted uploaded image; the per-problem feedback IS the confirmable artifact the
  student sees (not a silent destructive action), and evidence rides the existing
  confirmable mastery model. No streaks/scores. Never grade blind (RouterError → setup hint).

---

## 1. Condensed seam APIs (copy)
- Grader bits: `items.py` — `_resolve_image_data_uris:366`, `_grade_llm:402`,
  `_VERDICT_SIGNAL:44`, evidence write `:541`; `parse_extraction` (graph.extractor).
- Concept resolution: `extractor.course_concept_shortlist:151` + `normalize_name`;
  `persist_extraction:226` is the mapping precedent.
- Graph door: `queries.record_evidence:210`; `episode_ref("upload", id)` (`models.py:184`).
- Route/schemas template: `routes/practice_routes.py:50-89`, `src/practice/schemas.py`
  (Citation `:24`). Contract regen: `scripts/openapi-export.py && (cd web && bun run gen:api)`.
- Frontend reuse: CameraCapture, `uploadFiles` (`features/chat/attachments.ts`),
  CitationChips + openPdf, StateChip (`features/progress/StateChip.tsx`), Spinner/toast,
  Markdown; window registry `app/windows/tools.tsx`; hook style `features/practice/api.ts`.

## 2. File ownership / phases
- **Phase A — backend (one agent):** `src/practice/items.py` (grade_worksheet) +
  `src/practice/schemas.py` (3 models) + `routes/practice_routes.py` (the route) +
  ui-contract + regen. Tests: `tests/test_worksheet_grading.py` (TestClient/house
  pattern, mocked vision LLM): per-problem verdicts parsed; evidence written with
  `source="worksheet"` + error_pattern + episode_ref upload, per resolved concept;
  unmatched concepts dropped; guide vs direct prompt behavior reflected in the request;
  RouterError → setup_hint, no evidence, never blind; an incorrect verdict raises the
  concept so `due_concepts` now surfaces it (the declarative follow-up).
- **Phase B — frontend (one agent):** `web/src/features/worksheet/` + register +
  vitest + a Playwright `worksheet.spec.ts` (attach a photo (mock upload) → check →
  per-problem feedback + a citation chip).

## 3. Invariant checklist
- [ ] graph writes only via `queries.record_evidence` (Gate 6f); owner threaded; `effective_user` on the route
- [ ] model selection only via model_router + TaskProfile; no model-name literals; never grade blind (RouterError → hint)
- [ ] document_processor untouched (reuse `_resolve_image_data_uris`); no schema/migration (worksheet source + error_pattern are existing JSON)
- [ ] route response_model + typed body (no request.json()) + ui-contract; regen schema.d.ts
- [ ] follow-up item is declarative (evidence write), not a new enqueue; calm; no `any`/no `.js`; no god-file grew
