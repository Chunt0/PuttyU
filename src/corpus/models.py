"""
models.py — the corpus canonical store (SQLite/SQLAlchemy), per ADR 0003.

Two tables on the SHARED declarative Base (`core.database.Base`):
  * corpus_source — one textbook / work / video (source of truth + provenance).
  * corpus_chunk  — a section slice / pedagogical block / transcript segment.

The corpus is an independent subsystem: rather than editing core/database.py's init_db,
it creates its own tables idempotently via `ensure_corpus_tables()` (the corpus analogue
of core's `_migrate_*` startup functions). They share Base.metadata, so when the app's
init_db eventually wants them it can call the same helper. Field names mirror ADR 0003.
"""

from __future__ import annotations

from sqlalchemy import (
    Column, String, Text, Integer, DateTime, ForeignKey, JSON, Index,
)
from sqlalchemy.orm import relationship

from core.database import Base, utcnow_naive


class CorpusSource(Base):
    """One textbook / work / video. `original_path` (the PDF) is served, never embedded."""

    __tablename__ = "corpus_source"

    id = Column(String, primary_key=True)                         # slug or uuid
    source_type = Column(String, nullable=False, index=True)      # textbook|literature|video_transcript
    title = Column(String, nullable=False)
    subject = Column(String, nullable=True, index=True)
    level = Column(String, nullable=True)
    language = Column(String, nullable=False, default="en")
    source_url = Column(String, nullable=True)                    # videos
    original_path = Column(String, nullable=True)                 # source.pdf — served, NOT embedded
    assets_dir = Column(String, nullable=True)                    # where figures were copied
    license = Column(String, nullable=True)
    authors = Column(String, nullable=True)
    course_id = Column(String, nullable=True, index=True)         # seam: per-course adaptation later
    owner = Column(String, nullable=True, index=True)             # seam: student uploads later (null = global)
    content_hash = Column(String, nullable=False)                 # idempotent re-import
    status = Column(String, nullable=False, default="importing")  # importing|ready|failed
    imported_at = Column(DateTime, default=utcnow_naive, nullable=False)
    updated_at = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)
    meta = Column(JSON, default=dict)                             # ISBN, year, publisher, …

    # The relationship (not the bare FK) is what tells the unit-of-work to insert a
    # source before its chunks; passive_deletes defers cascade to the DB's ON DELETE.
    chunks = relationship(
        "CorpusChunk", back_populates="source",
        cascade="all, delete-orphan", passive_deletes=True,
    )


class CorpusChunk(Base):
    """A retrievable unit. `id` IS the ChromaDB vector id (one vector per chunk)."""

    __tablename__ = "corpus_chunk"

    id = Column(String, primary_key=True)                         # == Chroma vector id
    source_id = Column(
        String, ForeignKey("corpus_source.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ordinal = Column(Integer, nullable=False)                     # document order -> neighbor fetch
    kind = Column(String, nullable=False, index=True)             # prose|example|problem|… (records.Kind)
    heading_path = Column(JSON, default=list)                     # list[str] breadcrumb
    text = Column(Text, nullable=False)                           # markdown (inline LaTeX + image refs)
    locator = Column(JSON, nullable=True)                         # {"kind":"page","start":N,"end":M}
    asset_paths = Column(JSON, default=list)                      # list[str] figure basenames
    token_estimate = Column(Integer, default=0)
    char_count = Column(Integer, default=0)
    content_hash = Column(String, nullable=False, index=True)
    embedded_at = Column(DateTime, nullable=True)                 # seam: null until vectorized
    meta = Column(JSON, default=dict)                             # seam: concept tags, captions, difficulty

    source = relationship("CorpusSource", back_populates="chunks")

    __table_args__ = (
        # (source_id, ordinal) is the natural key for idempotent upsert + neighbor expansion.
        Index("ix_corpus_chunk_source_ordinal", "source_id", "ordinal", unique=True),
    )


def chunk_id(source_id: str, ordinal: int) -> str:
    """Deterministic chunk/vector id so re-import overwrites in place (idempotency)."""
    return f"{source_id}:{ordinal}"


def ensure_corpus_tables(bind=None) -> None:
    """Idempotently create the corpus tables. Safe to call repeatedly (checkfirst).

    The corpus analogue of core.database's `_migrate_*` startup helpers — but create-only,
    since these are new tables. Called by the indexer before any write so the subsystem is
    self-sufficient without touching core/database.py.
    """
    from core.database import engine as default_engine
    Base.metadata.create_all(
        bind=bind or default_engine,
        tables=[CorpusSource.__table__, CorpusChunk.__table__],
    )
