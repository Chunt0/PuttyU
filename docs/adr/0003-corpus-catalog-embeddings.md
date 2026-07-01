# ADR-0003 — Corpus, library catalog & embeddings

- **Status:** Accepted (2026-06-19)
- **Context:** The library is the source of truth (SPEC §1, §8). The content on
  disk is ~12 GB (77 OpenStax textbooks + ~5,904 Project Gutenberg classics). We
  cannot embed all of it up front, yet a course must be able to *discover* and
  *link* any of it. This ADR fixes how content is cataloged, ingested, stored,
  retrieved, and cited.

## Decision

### Two layers: catalog (available) vs. corpus (ingested)

A clean separation the SPEC previously conflated:

- **Library catalog** — a lightweight manifest of **everything available** to
  link, built by scanning `PUTTYU_LIBRARY_PATH`. One row per source with cheap
  metadata only (title, author, subject, type, on-disk path, gutenberg_id), **no
  chunks, no vectors**. ~6k rows; trivial for SQLite. This is what F1's "suggest
  matching sources" searches. Built/refreshed by an explicit one-time
  `python -m engines.corpus catalog` (a full library scan — not done on every boot).
- **Corpus** — the **ingested** subset: `corpus_source` + `corpus_chunk` rows +
  Chroma vectors. Only sources that have actually been chunked and embedded.

### Lazy, linked ingestion

- Ingestion happens **when a source is linked to a course**, not in bulk. Linking
  a catalog entry triggers: parse → chunk → (embed) → create `corpus_source` +
  `corpus_chunk` rows → set `library_catalog.ingested_source_id`.
- **Idempotent** by `content_hash` (re-linking/re-running imports nothing new).
- Admin CLI remains available for pre-ingesting:
  `python -m engines.corpus ingest <path> [--no-embed]` (the `--no-embed` SQLite-only
  fast path for tests).
- A small curated set (O3: statistics + calculus + one science book) is
  pre-ingested for the M1 worked example; everything else is lazy.

### Two-store, canonical = SQLite

- **SQLite is canonical.** `corpus_chunk` holds the authoritative text, ordering,
  heading path, locator, and metadata. The vector index is **disposable** and
  re-embeddable from SQLite.
- **Chroma is embedded** (`chromadb.PersistentClient` at
  `${PUTTYU_DATA_DIR}/chroma/`) — **no separate vector server**. Collection
  `puttyu_corpus`, one vector per chunk, document = `heading_path + "\n" + text`,
  scalar metadata `{source_id, kind, page_start, course_id, owner, subject,
  source_type}`.
- **Embeddings:** local via **fastembed** (default `BAAI/bge-small-en-v1.5`,
  384-dim, ONNX, runs on CPU), configurable by `PUTTYU_EMBED_MODEL`. Local by
  default = privacy/cost-free background work, consistent with the router's
  local-first policy (SPEC §F7). Switching the model re-embeds from SQLite.
  **Embedding + chunking are CPU-bound: run ingestion off the async event loop**
  (a thread/process executor or a background worker) so it never blocks request
  handling in the single process; write to SQLite in **WAL mode**. (A general
  embedder may underperform on heavy math — acceptable for v1, revisit per-subject
  embedders if grounding quality on math courses disappoints.)

### Chunking

- Build the section hierarchy from **section numbers in heading text** (e.g.
  "2.3"), not markdown `#` depth (OpenStax markdown is inconsistent on depth).
- **Pedagogical blocks are atomic chunks**: Example / Problem / Solution / Try-It
  / Key-Terms are never split. `kind ∈ {example, problem, exercise, try_it,
  key_terms, prose}` — the practice-item lever for the Gym/Review (F8).
- Prose targets ~200–500 tokens, split on paragraph boundaries.
- **Locator:** `page_start` from the nearest preceding page anchor; attach image
  names found in the block to `asset_paths`.
- Classics (single `.md`, YAML frontmatter, no pages): chunk by chapter/heading +
  paragraph windows; locator is a heading path / char-offset, no page.

### Citation ↔ PDF-page contract

- A chunk carries `page_start` (1-based PDF page) derived from the marker page
  anchors in `marker/output.md`. **Contract:** marker page index == `source.pdf`
  page index (verified per book at ingest; an `page_offset` on `corpus_source`
  absorbs any constant skew, e.g. cover/front-matter).
- Retrieval returns, per hit, `{chunk_id, source_id, citation, page_start}`.
  `citation` is a display label like `Intro Stats §2.3, p. 87`.
- The UI renders citation chips; clicking opens the library panel at that
  section and offers **"open PDF at page N"** — the same door the dashboard's
  reading recommendations reuse. PDFs are served only by `source_id → path`
  lookup, never by client-supplied path (THREAT_MODEL.md).

### Retrieval & degradation

- Query flow: embed query → Chroma query filtered by `course_id` (and optionally
  `tag`/`kind`) → top-k chunk ids → **expand context in SQLite** (`source_id`,
  `ordinal ± N`) → assemble grounded context + citation metadata.
- **Degradation:** if Chroma/embeddings are unavailable, fall back to SQLite
  **FTS5 keyword search** over `corpus_chunk.text` — grounding still works,
  lower quality, and the UI says so. The app never hard-fails on a missing vector
  index.

### Data-driven concept seeding (learning-science add)

The chunk embeddings are reusable beyond retrieval. **Clustering chunk/concept
embeddings** (cosine similarity ≈ Bowers's "uncentered correlation", average
linkage) can (a) detect near-duplicate/overlapping chunks and (b) **suggest
concept families** that *complement* the structural concept seeding (ADR-0004 /
ADR-0005 at M3) — a cheap, single-student-safe, data-driven prior on the concept
graph. Suggestions are proposals, validated against performance over time
(correctness-covariance). See `docs/LEARNING-SCIENCE.md` §2.2 / §2.8.

### Import/export formats

- **CSV/TSV + JSON** are the interchange lingua franca for materials/rosters/
  worksheets (import and export).
- For interaction logs (ADR-0004), consider an **xAPI/Caliper-style
  actor–verb–object envelope** so the event log can interoperate with LMS tooling
  later — a seam, not a v1 requirement.

## Consequences

- "Clone and run" stays true: no vector server, no 12 GB ingest before first use.
- The catalog/corpus split makes F1 source-suggestion cheap and makes ingestion
  cost proportional to what the student actually studies.
- SQLite-canonical + disposable Chroma means the embedding model is a tunable
  knob, not a migration.

## Alternatives considered

- **Pre-embed the whole library.** Rejected: ~6k books is huge embed time/space
  for content most students never touch.
- **Chroma as a service (OLD-REF did this).** Rejected for v1: an extra server
  against the no-extra-server stance; embedded `PersistentClient` is enough at
  single-user scale.
- **One `corpus_source` table with a `cataloged` status instead of a separate
  catalog.** Reasonable, but ~6k half-populated rows muddy the "ingested" set;
  a dedicated lightweight catalog table is clearer and cheaper to rebuild.
- **Cloud/API embeddings.** Rejected as default (privacy/cost); allowed via
  config for users who prefer quality.
