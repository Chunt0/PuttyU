# T5 vertical-5 contract — Cmd-K global search (F11)

> SPEC F11 "One keystroke finds anything": ⌘/Ctrl-K opens a global search across
> courses, notes, materials, sessions, todos, and graph concepts; picking a result
> opens the right surface (concept → trajectory, material → PDF viewer, session →
> resume, todo → its course, course → tab, note → Notes). Read order: `CLAUDE.md`
> → `docs/PHASE-2-BUILD-PLAN.md` §5 → this file. Seams verified 2026-06-19.
> Gates stay green; `.venv/bin/python`; `mkdir -p data`.

---

## 0. Pinned decisions (frozen)

- **D1 — route.** `GET /api/cmdk?q=&limit=&course_id=` → `GlobalSearchResponse`, in a
  NEW `routes/global_search_routes.py` (`setup_global_search_routes() -> APIRouter`;
  the name + path avoid the existing web-search `routes/search_routes.py` / `/api/search/*`).
  Wired in `app.py` after the course/todo block. `get_current_user`, `SessionLocal`
  try/finally, `response_model` (Gate 6b), GET query params only (no `request.json()`,
  Gate 6c trivially). Empty/blank `q` → `{"query":"","results":[]}` BEFORE opening a
  DB session. `per_kind = max(1, min(limit or 8, 25))`. **Degrade per bucket** (each in
  its own try/except → empty on failure; the palette never 500s — e.g. corpus/graph
  tables may be absent).
- **D2 — buckets** (each `owner_scoped`, `.ilike(f"%{q}%")`, capped `per_kind`):
  - course: `Course.name` → `{kind:"course", id, title:name}`
  - note: `Note.title` OR `Note.content`, `archived==False` → `{kind:"note", id, title, subtitle:snippet, course_id}`
  - todo: `Todo.text`, `done_at IS NULL` → `{kind:"todo", id, title:text, course_id}`
  - session: `Session.name` (import `Session as DBSession`), `archived==False`, order by
    `last_message_at.desc()` → `{kind:"session", id, title:name}`
  - material: `CorpusSource.title` via `course_search.visible_sources_query(db, user)`
    (guard the table not existing → empty bucket) → `{kind:"material", id:source_id,
    source_id, title, subtitle:subject/authors}` (no page in v1)
  - concept: via the NEW `queries.search_concepts` (D3, Gate 6f) →
    `{kind:"concept", id, title:name, subtitle:heading_path joined, course_id?}`
- **D3 — new graph one-door.** Add `search_concepts(db, owner, q, *, limit=8,
  course_id=None) -> list[dict]` to `src/graph/queries.py` (+ `__all__`): concepts whose
  `name` ilike-matches `q`, owner-scoped, plain dicts (`id, name, heading_path, sources`),
  optionally narrowed to a course region (intersect `course_source_ids`). The global-search
  route is NOT on the Gate-6f allowlist, so it must reach concepts ONLY through this.
- **D4 — models** (in `src/request_models.py`, `ConfigDict(extra="allow")`):
  `GlobalSearchResult{kind:str, id:str, title:str="", subtitle:Optional[str]=None,
  course_id:Optional[str]=None, source_id:Optional[str]=None, page:Optional[int]=None}`;
  `GlobalSearchResponse{query:str="", results:List[GlobalSearchResult]=[]}`. FLAT list
  (the palette groups client-side by `kind`).
- **D5 — global shortcut + palette mount.** In `web/src/app/Shell.tsx`: a `useEffect`
  window `keydown` listener — `(e.metaKey || e.ctrlKey) && e.key.toLowerCase()==="k"` →
  `e.preventDefault()` + toggle `paletteOpen`; render `{paletteOpen && <CommandPalette
  onClose=... />}` next to `<Toasts/>`. Always-mounted, NOT a `WINDOW_TOOLS` entry.
- **D6 — palette** `web/src/features/search/{CommandPalette.tsx, api.ts, search.css,
  CommandPalette.test.tsx}`: a backdrop + centered panel (`role="dialog"`, `aria-modal`,
  `aria-label`), an autofocused input, results grouped by `kind` (labeled sections),
  flat `activeIndex` keyboard nav (ArrowUp/Down/Enter/Esc), backdrop/Esc close, Spinner
  loading + "No results" empty. Tokens-only `search.css` (no hardcoded hex). On Enter/click
  → the door for that `kind`, then `onClose()`:
  - course → `useCourseStore.getState().setActiveCourse(id)`
  - session → `useUiStore.getState().setCurrentSession(id)` + `navigate("/")`
  - material → `openPdf(source_id, title, page ?? undefined)`
  - concept → `progressForConcept(course_id, id)` (D7 — opens the **trajectory**, NOT gym)
  - todo → `useCourseStore.getState().setActiveCourse(course_id)` + `useWindowStore.getState().open("dashboard")`
  - note → `useWindowStore.getState().open("notes")`
- **D7 — concept → trajectory needs a preselect store.** Add
  `web/src/features/progress/progressStore.ts` mirroring `gymStore.ts`: `useProgressStore`
  `{target:{conceptId}|null, setTarget}` + `progressForConcept(courseId, conceptId)` =
  `setActiveCourse(courseId)` → `setTarget({conceptId})` → `useWindowStore.open("progress")`.
  In `Progress.tsx` add a `useEffect` that reads the target on mount, `setSelectedId(target.conceptId)`,
  and CLEARS it — ordered AFTER the existing `useEffect(()=>setSelectedId(null),[courseId])`
  (or guarded) so activating the course doesn't immediately null the preselected concept.
- **D8 — hook.** `useGlobalSearch(q)` in `search/api.ts`: a `useQuery` over `GET /api/cmdk`
  (typed client), `searchKey=(q)=>["global-search",q]`, `enabled: q.trim().length>=2`.
  Debounce via React 19 `useDeferredValue` on the input value. `types.ts` alias
  `GlobalSearchResponse`/`GlobalSearchResult`.

---

## 1. Condensed seam APIs (copy)
- Route template: `routes/course_routes.py` / `routes/dashboard_routes.py` (born-small, owner_scoped, degrade-per-section). `owner_scoped` `src/auth_helpers.py:130`. `.ilike` precedent `course_search.py:156`.
- Materials: `course_search.visible_sources_query(db, user)` + `CorpusSource` (`src/corpus/models.py:24`); guard missing table (try/except, like `course_routes._known_corpus_source_ids`).
- Concepts door: `src/graph/queries.py` (add search_concepts; mirror `concept_brief`/`region_concepts`; `_concept_dict`). Gate 6f.
- Frontend doors: `useCourseStore.setActiveCourse` (`courses/store.ts:29`), `useUiStore.setCurrentSession` (`lib/store.ts:14`) + `useNavigate`, `openPdf` (`library/pdfStore.ts:28`), `useWindowStore.open` (`windowStore.ts:76`), gymStore precedent (`practice/gymStore.ts`). Shell globals: `Shell.tsx:53-54` (`WindowLayer`, `Toasts`). Spinner `components/Spinner.tsx`.
- Contract regen: `scripts/openapi-export.py && (cd web && bun run gen:api)`; ui-contract line `GET /api/cmdk`.

## 2. File ownership / phases
- **Phase A — backend (one agent):** `src/graph/queries.py` (search_concepts) + `src/request_models.py` (2 models) + `routes/global_search_routes.py` (new) + `app.py` wiring + `.fitness/ui-contract-endpoints.txt` + regen. Tests: `tests/test_global_search.py` (each bucket matches owner-scoped + the deep-link fields; archived/done excluded; empty q → empty; a missing corpus/graph table degrades to an empty bucket not 500; cross-owner isolation), `tests/test_search_concepts.py` (the new query: name match, owner scope, course narrowing).
- **Phase B — frontend (one agent):** `web/src/features/search/` (CommandPalette + api + css + test) + `web/src/features/progress/progressStore.ts` + `Progress.tsx` (read+clear preselect) + `web/src/app/Shell.tsx` (listener + mount) + `web/src/api/types.ts` (aliases). Tests: vitest (palette renders grouped results, keyboard nav, a door fires; progressStore preselect) + `web/e2e/search.spec.ts` (Ctrl+K → dialog → type → result → pick opens the surface; Esc closes).

## 3. Invariant checklist
- [ ] every bucket owner_scoped (Gate 5); concepts ONLY via queries.search_concepts (Gate 6f); no raw graph SQL
- [ ] route response_model + GET params (no request.json()) + ui-contract line (6b); regen schema.d.ts (Gate 1)
- [ ] degrade-per-bucket, never 500; empty q → empty; archived/done excluded
- [ ] palette always-mounted, role=dialog + aria-label; tokens-only; no `any`; no new `.js`; no god-file grew
- [ ] concept opens trajectory (Progress), not gym; every door closes the palette after
