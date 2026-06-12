# ADR 0004 — Course model (courses, course scoping, todos)

- Status: Accepted (owner delegated decisions, 2026-06-12)
- Related: SPEC-phase-2 v1.0 (F1, F11, §6 Q3/Q12/Q13), ADR 0003 (corpus seams)

## Context

Phase 2 makes the **course** the central scoping dimension: the user declares a
course load, courses render as tabs, and chat retrieval, notes, calendar,
todos, practice, and the graph region all scope to the active course. ADR 0003
already planted `course_id` on `corpus_source`/`corpus_chunk` and the Chroma
metadata. Nothing else knows about courses yet, and there is no todo concept
at all (scheduler tasks are automation; notes have no due/done semantics).

## Decision

### `course` table

`id` (pk, uuid) · `name` · `status` (`active` | `archived`) · `owner?`
(nullable — multi-student seam, Gate 5) · `settings` (JSON: persona dial
`{scaffolding, pace, tone}`, `coupling_mutes: [course_id]`, `calibrated_at?`)
· `created_at` / `updated_at` / `archived_at?`.

Archive hides the tab and stops periphery participation; sessions, notes,
mastery history, and the graph region are retained. Re-activation is a status
flip. No hard delete in v1.

### Course ↔ source linking: a link table, not a column

**`course_source`** (`course_id`, `source_id`, `added_at`) links a course to
shared-library sources — a source can serve many courses (two physics courses,
one textbook). `corpus_source.course_id` (ADR 0003) is used **only for
owner-uploaded course materials**, which belong to exactly one course.
Course-scoped retrieval resolves `course → source_ids` (link table ∪ owned
materials) and filters Chroma with `source_id $in [...]` — the ADR-0003 scalar
metadata needs no change. **The user may link any library source themself**
(§6 Q3 — the library is read-only, linking is harmless).

### `course_id` lands on existing tables (nullable everywhere)

`sessions`, `notes`, `calendar_events` gain a nullable `course_id` column via
the existing ad-hoc startup-migration pattern (no Alembic). Null = course-less
(the Home/dashboard surface and all pre-existing rows keep working unchanged).

### `todo` table (new — §6 Q12)

`id` (pk) · `course_id?` · `text` · `due_date?` · `done_at?` · `source`
(`manual` | `miner` | `tutor`) · `provenance?` (JSON: `{source_id, page}` for
miner-created rows) · `owner?` · `created_at`.

Rejected alternatives: scheduler tasks (trigger/automation semantics, wrong
shape) and notes (no due/done). Tutor- and miner-created todos are **always
proposals confirmed by the user** before a row exists (SPEC §5.8, the
untrusted-content invariant).

### Routes

`routes/course_routes.py` (course CRUD + archive + source linking) and
`routes/todo_routes.py` (todo CRUD + done-toggle): born small, typed
request/response models in `src/request_models.py` (`extra="allow"`), real
OpenAPI seam, endpoints added to `.fitness/ui-contract-endpoints.txt`.

## Consequences

- One new noun (`course`) scopes everything; every consumer treats
  `course_id = NULL` as "global" so nothing breaks course-less.
- The link table keeps ADR-0003's storage untouched while allowing shared
  textbooks across courses.
- Dashboard (F11) composes courses + todos + calendar with zero additional
  schema.
