"""
indexer.py — persist an importer's output into the two stores, idempotently.

Pipeline (ADR 0003): parse -> upsert SQLite (canonical) -> copy assets -> embed -> upsert
Chroma (disposable index). The stages are split so the heavy half is injectable:

  * store_source()  — importer + SQLite upsert + asset copy. No embeddings / Chroma.
                      Idempotent: a source whose book text is unchanged & already 'ready'
                      is skipped; otherwise its chunks are replaced (cascade) wholesale.
  * embed_source()  — read chunks from SQLite, embed, upsert Chroma, stamp embedded_at.
                      Takes an injectable embedder + collection (mocked in tests).
  * index()         — wire the real engine + embedder + Chroma and run both stages.

SQLite is the source of truth; Chroma is rebuildable from it at any time, so an embedding
failure leaves a usable ('ready') corpus that simply degrades to keyword fallback.
"""

from __future__ import annotations

import os
import shutil
import logging

from src.corpus.importers import TextbookMarkerImporter
from src.corpus.importers.base import BaseImporter
from src.corpus.models import CorpusChunk, CorpusSource, chunk_id, ensure_corpus_tables
from src.corpus.records import ChunkRecord, SourceRecord

logger = logging.getLogger(__name__)

DEFAULT_COLLECTION = "corpus"
DEFAULT_ASSETS_ROOT = os.path.join("data", "corpus")
# Embedding models truncate well before this; cap the document we hand Chroma so a rare
# giant (Marker-merged table) chunk can't blow the request. Canonical SQLite text is full.
_MAX_EMBED_CHARS = 8000

_IMPORTERS: list[BaseImporter] = [TextbookMarkerImporter()]


def select_importer(source_dir: str) -> BaseImporter:
    for imp in _IMPORTERS:
        if imp.can_handle(source_dir):
            return imp
    raise ValueError(f"no importer recognises {source_dir!r}")


# --------------------------------------------------------------------------- #
# Stage 1: SQLite + assets (fully testable, no external services)             #
# --------------------------------------------------------------------------- #
def store_source(source_dir, db, importer=None, copy_assets=True,
                 assets_root=DEFAULT_ASSETS_ROOT, **overrides) -> dict:
    """Parse `source_dir` and upsert it + its chunks into SQLite. Idempotent."""
    importer = importer or select_importer(source_dir)
    source, chunks = importer.parse(source_dir, **overrides)

    existing = db.get(CorpusSource, source.id)
    if existing and existing.content_hash == source.content_hash and existing.status == "ready":
        return {"source_id": source.id, "skipped": True, "chunks": len(existing.chunks)}

    if existing:
        db.delete(existing)   # cascade drops old chunks; clean replace on content change
        db.flush()

    assets_dir = None
    if copy_assets:
        assets_dir = _copy_assets(source_dir, importer, chunks, source.id, assets_root)
    source.assets_dir = assets_dir

    db.add(_to_source_model(source))
    db.flush()
    for cr in chunks:
        db.add(_to_chunk_model(source.id, cr))

    src_row = db.get(CorpusSource, source.id)
    src_row.status = "ready"
    db.commit()
    return {"source_id": source.id, "skipped": False, "chunks": len(chunks),
            "assets_dir": assets_dir}


def _copy_assets(source_dir, importer, chunks, source_id, assets_root) -> str:
    """Copy the figures referenced by `chunks` into assets_root/<source_id>/images/."""
    src_images = importer.images_dir(source_dir)
    dst = os.path.join(assets_root, source_id, "images")
    os.makedirs(dst, exist_ok=True)
    referenced = {a for c in chunks for a in c.asset_paths}
    for name in referenced:
        srcp = os.path.join(src_images, name)
        if os.path.exists(srcp):
            shutil.copy2(srcp, os.path.join(dst, os.path.basename(name)))
        else:
            logger.warning("corpus: asset referenced but missing on disk: %s", srcp)
    return dst


def _to_source_model(s: SourceRecord) -> CorpusSource:
    return CorpusSource(
        id=s.id, source_type=s.source_type, title=s.title, subject=s.subject,
        level=s.level, language=s.language, source_url=s.source_url,
        original_path=s.original_path, assets_dir=s.assets_dir, license=s.license,
        authors=s.authors, course_id=s.course_id, owner=s.owner,
        content_hash=s.content_hash, status=s.status, meta=s.meta or {},
    )


def _to_chunk_model(source_id: str, c: ChunkRecord) -> CorpusChunk:
    return CorpusChunk(
        id=chunk_id(source_id, c.ordinal), source_id=source_id, ordinal=c.ordinal,
        kind=c.kind, heading_path=c.heading_path, text=c.text, locator=c.locator,
        asset_paths=c.asset_paths, token_estimate=c.token_estimate,
        char_count=c.char_count, content_hash=c.content_hash, meta=c.meta or {},
    )


# --------------------------------------------------------------------------- #
# Stage 2: embeddings + Chroma (injectable; mocked in tests)                  #
# --------------------------------------------------------------------------- #
def chroma_metadata(src: CorpusSource, c: CorpusChunk) -> dict:
    """Scalar-only metadata for Chroma (ADR 0003): filters + citation. Drops None/empty."""
    heading = " > ".join(c.heading_path or [])
    page_start = (c.locator or {}).get("start") if c.locator else None
    citation = src.title + (f" — {c.heading_path[-1]}" if c.heading_path else "")
    if page_start is not None:
        citation += f" (p. {page_start})"
    md = {
        "source_id": src.id, "source_type": src.source_type, "title": src.title,
        "subject": src.subject, "level": src.level, "kind": c.kind, "heading": heading,
        "page_start": page_start, "asset_count": len(c.asset_paths or []),
        "citation": citation, "course_id": src.course_id, "owner": src.owner,
        "ordinal": c.ordinal,
    }
    return {k: v for k, v in md.items() if v is not None and v != ""}


def embed_source(source_id, db, embedder=None, collection=None, batch_size=128) -> dict:
    """Embed a source's chunks and upsert them into the Chroma `corpus` collection."""
    from src.corpus.records import content_hash  # local: keep module import-light
    from datetime import datetime, timezone

    embedder = embedder or _default_embedder()
    collection = collection or _default_collection()

    src = db.get(CorpusSource, source_id)
    if src is None:
        raise ValueError(f"unknown source: {source_id}")
    chunks = (db.query(CorpusChunk)
              .filter(CorpusChunk.source_id == source_id)
              .order_by(CorpusChunk.ordinal).all())

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    embedded = 0
    for i in range(0, len(chunks), batch_size):
        batch = chunks[i:i + batch_size]
        docs = [_embed_document(c) for c in batch]
        vectors = embedder.encode(docs)
        collection.upsert(
            ids=[c.id for c in batch],
            embeddings=[v.tolist() if hasattr(v, "tolist") else list(v) for v in vectors],
            documents=docs,
            metadatas=[chroma_metadata(src, c) for c in batch],
        )
        for c in batch:
            c.embedded_at = now
        embedded += len(batch)
    db.commit()
    return {"source_id": source_id, "embedded": embedded}


def _embed_document(c: CorpusChunk) -> str:
    """The text Chroma embeds: heading breadcrumb + body, truncated for safety."""
    head = " > ".join(c.heading_path or [])
    doc = f"{head}\n{c.text}" if head else c.text
    return doc[:_MAX_EMBED_CHARS]


def _default_embedder():
    from src.embeddings import get_embedding_client
    client = get_embedding_client()
    if client is None:
        raise RuntimeError("no embedding client available (install fastembed or set EMBEDDING_URL)")
    return client


def _default_collection():
    from src.chroma_client import get_chroma_client
    return get_chroma_client().get_or_create_collection(DEFAULT_COLLECTION)


# --------------------------------------------------------------------------- #
# Full pipeline                                                               #
# --------------------------------------------------------------------------- #
def index(source_dir, db=None, embed=True, **overrides) -> dict:
    """Import + store + (optionally) embed a source against the real app stores."""
    ensure_corpus_tables()
    own_session = db is None
    if own_session:
        from core.database import SessionLocal
        db = SessionLocal()
    try:
        stats = store_source(source_dir, db, **overrides)
        if embed and not stats.get("skipped"):
            try:
                stats.update(embed_source(stats["source_id"], db))
            except Exception as e:  # canonical store already succeeded; degrade gracefully
                logger.warning("corpus: embedding skipped (%s); corpus usable via keyword", e)
                stats["embedded"] = 0
        return stats
    finally:
        if own_session:
            db.close()
