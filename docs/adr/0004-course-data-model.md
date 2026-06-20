# ADR-0004 — Course model & data model (M0–M1)

- **Status:** Accepted (2026-06-19)
- **Context:** SPEC §4 names the domain nouns but not their tables. This ADR fixes
  the data-model conventions and the concrete M0/M1 schema. It is the
  authoritative schema reference; `docs/DESIGN-M0-M1.md` builds the API/flows on
  top of it. Later milestones add tables (graph at M3 — ADR-0005; todos/notes at
  M5) following the same conventions.

## Decision

### Conventions

- **Primary keys:** UUID4 hex `TEXT` (`id`), generated app-side. Stable ids let
  episodes (M3) reference chat messages / uploads without duplication.
- **Ownership:** every per-user table has `owner TEXT` (FK → `user.id`). The
  **only** way to scope it in queries is `owner_scoped(query, Model, user)`
  (ADR-0002 Gate 5).
- **Course scoping:** `course_id TEXT` is **nullable** wherever a row may be
  course-bound — so everything still works course-less (the Home tab).
- **Soft lifecycle:** archive via `archived_at` (nullable) rather than delete
  where the SPEC says "never silently deleted" (courses, sessions).
- **Timestamps:** `created_at` / `updated_at` as UTC datetimes.
- **Extensibility:** a JSON `meta` / `settings` column on rows that carry
  open-ended attributes — typed core columns for what we query, JSON for the rest
  (the ADR-0003 discipline).
- **Migrations:** idempotent `_migrate_*` steps in `init_db` (no Alembic in v1).
- **ORM:** SQLAlchemy over the SQLite layer (not hand-built SQL strings) — eases a
  future Postgres move (ADR-0003 / Mogessie cluster).
- **Evidence is append-only; estimates are temporal rows.** Raw interaction events
  (`interaction_event`, below) are **immutable** and logged from M0/M1. Derived
  state (mastery, M3) is written as **time-stamped rows, never updated in place**
  (the "salaries-table" pattern) so trajectory is queryable for free; prefer a
  nullable `to_ts` over sentinel dates. Any **feature is derived in a deterministic
  layer keyed by `(student, concept, as_of_ts)` that can only read events strictly
  *before* `as_of`** — this is the leakage-safety guarantee for the mastery model
  (`docs/LEARNING-SCIENCE.md` §2.7). Store events raw/un-normalized; normalization
  is a downstream step, never written into the log.

### The shared-library ownership exception

`corpus_source` / `corpus_chunk` are **not** uniformly owner-scoped:

- **Shared library** sources have `owner = NULL` (global, read-only). Read access
  is gated by **course linkage** (`course_source`), not by `owner`.
- **User materials** (M2) are rows in the same tables with `owner` set.

So Gate 5's `owner_scoped` applies to the per-user tables (`session`,
`chat_message`, `course`, `course_source`, and M2 materials), while library reads
are scoped through the course→source join. This exception is documented here so
the Gate-5 allowlist reasoning is explicit.

### M0 schema

```
user
  id PK · username UNIQUE · password_hash · is_owner BOOL
  settings JSON · created_at

setting                       # server-side prefs (router policy, etc.)
  id PK · owner (nullable=global) · key · value JSON · updated_at
  UNIQUE(owner, key)

model_endpoint
  id PK · owner · name · provider ENUM(anthropic|openai_compat|ollama)
  base_url · api_key_enc (Fernet, nullable) · api_key_env (nullable)
  models JSON   # [{name, context_window, vision:bool,
                #   reasoning_class:micro|light|standard|deep,
                #   cost_in, cost_out}]
  enabled BOOL · created_at · updated_at

session                       # a chat session
  id PK · owner · course_id (nullable) · title
  created_at · updated_at · last_message_at · archived_at (nullable)

chat_message
  id PK · session_id FK · owner · role ENUM(user|assistant|system|tool)
  content TEXT · ordinal INT
  meta JSON   # {citations:[{chunk_id,source_id,label,page_start}],
              #  attachments:[], model, usage, grounded:bool}
  created_at

interaction_event             # APPEND-ONLY, immutable; logged from M0/M1.
  id PK · owner · course_id (nullable) · session_id (nullable)
  event_type ENUM(attempt|hint|chat_turn|worksheet|review|gym|exam|calibration)
  concept_ids JSON (nullable)  # KC tags — the Q-matrix link (populated from M3)
  item_id (nullable) · item_kind (nullable) · is_correct (nullable)
  attempt_number (nullable) · num_hints (nullable)
  response_latency_ms (nullable) · time_on_task_ms (nullable)
  difficulty (nullable) · source (nullable) · payload JSON · created_at (UTC)
  # raw, un-normalized; the substrate the M3 mastery model recomputes from.
```

> `interaction_event` is the **learning-science substrate** (`docs/LEARNING-SCIENCE.md`
> §2.7): immutable, timestamped, owner-scoped. M0/M1 log `chat_turn`/`worksheet`
> events; M2 adds worksheet grading detail; M3's BKT mastery + graph evidence are
> *derived* from this log via the `as_of`-gated transform (above), never by mutating
> events. KC tagging (`concept_ids`) becomes load-bearing at M3 (ADR-0005).

Router config lives in `setting` under key `router`:
`{policy: local_first|quality_first, pins:{tier→model_ref}, tier_table:{tier→[model_ref…]}}`.
Resolution is computed from `model_endpoint.models` + policy + pins (ADR-0002
Gate 6g; see DESIGN-M0-M1 for the algorithm).

### M1 schema

```
course
  id PK · owner · name · slug (UNIQUE per owner)
  type (nullable: stem|lit|lang|general) · status ENUM(active|archived)
  settings JSON   # {persona_dial:{scaffolding,pace,tone}, coupling_mutes:[]}
  ordinal INT     # tab order
  created_at · updated_at · archived_at (nullable)

library_catalog               # available-to-link, NOT ingested (ADR-0003)
  id PK · path UNIQUE · source_type · title · author (nullable)
  subject (nullable) · category (nullable) · gutenberg_id (nullable)
  has_pdf BOOL · ingested_source_id (nullable FK corpus_source)
  meta JSON · created_at

corpus_source                 # ingested source (shared library OR user material)
  id PK · source_type ENUM(textbook|literature|paper|material)
  title · author (nullable) · subject (nullable) · level (nullable)
  owner (NULL = shared library; set = user material)
  original_path (nullable) · content_hash · page_offset INT DEFAULT 0
  status ENUM(ingesting|ingested|failed) · meta JSON
  created_at · updated_at

course_source                 # links a course to an ingested source
  id PK · course_id FK · source_id FK · owner · created_at
  UNIQUE(course_id, source_id)

corpus_chunk                  # id == Chroma vector id
  id PK · source_id FK · ordinal INT · kind ENUM(example|problem|exercise|
       try_it|key_terms|prose)
  heading_path TEXT · text TEXT
  page_start (nullable) · page_end (nullable) · token_count INT
  asset_paths JSON · meta JSON
```

## Consequences

- The schema is small and legible — M0 is 5 tables, M1 adds 5 — matching "start
  slow". Each later milestone adds a bounded, conventional set.
- Nullable `course_id` + nullable library `owner` are the two deliberate
  flexibilities; both are documented so they don't read as omissions.
- UUID PKs cost a little space but make the M3 episode-reference model trivial.

## Alternatives considered

- **Integer autoincrement PKs.** Rejected: UUIDs make cross-table/episode
  references and any future export/merge safer.
- **Separate `material` tables vs. reusing `corpus_source`.** Reusing the corpus
  tables (with `owner` set) keeps retrieval uniform — materials sit *beside* the
  library in one query path (SPEC F2). Chosen.
- **Per-course graph tables.** Deferred to ADR-0005; the graph is one-per-student
  with course regions, not one-per-course.
