# ADR 0003 — Corpus schema (textbooks, literature, transcripts)

- Status: Accepted
- Date: 2026-06-05
- Related: ADR 0001 (foundation), SPEC Slice 3 (corpus)

## Context

The tutoring app is built on a curated **corpus** the tutor can read in full (all
textbooks, literature, and — later — video transcripts). Per-course adaptation and
student-uploaded sources are a **later** layer, not now. The LLM serves **markdown +
associated images**; the original **PDF is kept only for direct student access** (not
chunked/embedded).

Primary source format is **Marker** output (PDF → markdown):
```
<book>/ source.pdf · book.md (the whole book) · images/_page_<N>_Figure_<M>.jpeg · marker/output.md
```
`book.md` has a heading hierarchy, embedded page anchors (`<span id="page-16-2">`),
inline figures, and pedagogical blocks (`EXAMPLE`/`Problem`/`Solution`/`TRY IT`/`NOTE`/
`KEY TERMS`/`Chapter Objectives`). Marker heading **levels are unreliable** (chapters
appear as `#`/`##`/`####` inconsistently); section **numbers** in the heading text are
the reliable hierarchy signal.

Design driver: **extensible without bloat** — a small typed core; everything speculative
in JSON; deferred features are populated-later fields or parallel collections, never a
rework.

## Decision

### Two stores, one link
- **Canonical (SQLite/SQLAlchemy):** source of truth + provenance + structure.
- **Retrieval (ChromaDB `corpus` collection):** disposable index; the vector id **is** the
  `corpus_chunk.id`. Holds embeddings + scalar filter/citation metadata only — never the
  authoritative copy. Re-embeddable from canonical at will.
- Separate from the owner-scoped `personal_docs`/`puttyu_rag` (different lifecycle:
  shared, curated, read-only).

### Tables

**corpus_source** — one textbook / work / video:
`id` (pk, slug/uuid) · `source_type` (textbook|literature|video_transcript) · `title` ·
`subject?` · `level?` · `language` (default en) · `source_url?` (videos) ·
`original_path?` (source.pdf — served for direct student access, NOT embedded) ·
`assets_dir` · `license?` · `authors?` · **`course_id?`** (seam: per-course later) ·
**`owner?`** (seam: null = global corpus → student uploads later) · `content_hash`
(idempotent re-import) · `status` (importing|ready|failed) · `imported_at`/`updated_at` ·
`meta` (JSON: ISBN, year, publisher, num_speakers, …).

**corpus_chunk** — a section / pedagogical block / transcript segment:
`id` (pk, **= Chroma vector id**) · `source_id` (fk, cascade) · `ordinal` (doc order →
neighbor fetch) · `kind` (prose|example|problem|solution|try_it|note|key_terms|objective|
figure|exercise|transcript_segment) · `heading_path` (JSON[str] breadcrumb; null for
video) · `text` (markdown, inline LaTeX + image refs) · `locator` (JSON:
`{kind:"page",start,end}` | `{kind:"time",start,end}`) · `asset_paths` (JSON[str]) ·
`token_estimate` · `char_count` · `content_hash` · `embedded_at?` (seam: null until
vectorized → re-embed/swap model) · `meta` (JSON seam: concept tags, captions,
difficulty — LLM-extracted later).
Indexes: `(source_id, ordinal)`, `source_id`, `kind`, `content_hash`.

**ChromaDB `corpus`** — one vector per chunk: `document` = `heading_path + "\n" + text`;
`metadata` (scalar-only — join/count arrays): `source_id, source_type, title, subject,
level, kind, heading` (joined), `page_start`/`time_start`, `asset_count`, `citation`,
`course_id`, `owner`.

### Chunking (textbook importer)
1. Build hierarchy from section **numbers** in heading text, not `#` depth.
2. Pedagogical blocks (Example/Problem/Solution/Try-It/Note/Key-Terms) are **atomic** —
   never split; detect by heading regex.
3. Prose target ~200–500 tokens; split over-long sections on paragraph boundaries keeping
   `heading_path`; leave small blocks whole.
4. Page locator from the latest `<span id="page-N">` anchor + `_page_N_` image names.
5. Copy `images/*` → `data/corpus/<source_id>/images/`; attach to chunk `asset_paths`.
6. Math: keep LaTeX inline; **text-only embeddings** in v1.

### Importer interface
`BaseImporter.parse(source_dir) -> (SourceRecord, Iterable[ChunkRecord])` with
`TextbookMarkerImporter` (now, `book.md`) and `VideoTranscriptImporter` (later,
`slides.json`, `kind="transcript_segment"`, time-locators) feeding the **same** tables.
`index()` upserts SQLite → copies assets → embeds → upserts Chroma; idempotent by
`content_hash` + `(source_id, ordinal)`.

### Retrieval
Embed query → `corpus.query(where={subject?, kind?, course_id?})` → top-k ids + citation
metadata → cite from metadata; expand context via SQLite `(source_id, ordinal±N)`. Serve
markdown + images to the LLM; PDF page link to the student via `original_path` + page
locator.

## Deliberately deferred (anti-bloat)
- No `corpus_asset` table — assets enumerated in `chunk.asset_paths`; promote later for
  captioning/multimodal.
- No concept/taxonomy tables — concepts in `chunk.meta` once extracted against the future
  mastery model.
- No course/enrollment tables — `course_id`/`owner` are nullable strings until the
  student-upload phase.
- No image/multimodal vectors — a parallel Chroma collection later; no impact on this one.

## Bootstrapping / data loading (corpus is a data-load, NOT a build dependency)

The real corpus library is being compiled into Marker format in a separate project. You do
**not** need it to build this subsystem. The importer + schema depend on the *format*, not
the *content*, and you already have one representative sample at
`example-textbook/statistics/`. Build and fully test the pipeline against that single book
(chunking, heading paths, page locators, atomic pedagogical blocks, embed, retrieve); one
textbook is sufficient to prove the machinery.

When the library is ready, the import is pure data movement — no code/schema change:
- The importer takes a **directory path** and is **idempotent + resumable** (upsert by
  `content_hash` + `(source_id, ordinal)`, skip unchanged), e.g.
  `python -m src.corpus.import /path/to/compiled-textbooks/`. Re-run as the other project
  produces more; each run picks up only new/changed sources.

Implication: the corpus subsystem is an **independent build track** — it touches neither the
frontend nor the kept routes, so it can be built/verified in parallel with the frontend
rewrite, and is a good low-risk first exercise of the ADR-0002 verifiability gates on a
fresh, well-bounded module.

## Consequences
- New `src/corpus/` subsystem + `corpus` Chroma collection; two new tables via one
  idempotent `_migrate_*` function (existing pattern). Reuses `src/embeddings.py`,
  `src/chroma_client.py`.
- Every deferred feature is a populated-later field or parallel collection — no rework.
- The `kind`/`subject`/`course_id` metadata is the tutor's retrieval lever (worked
  examples vs practice problems vs prose; later: scope to a student's course).
- Build lands in SPEC Slice 3; the video importer arrives in the tutoring phase.
