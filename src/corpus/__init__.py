"""
corpus — the curated tutoring corpus (textbooks, literature, transcripts).

Two-store design (see docs/adr/0003-corpus-schema.md):
  - Canonical: SQLite/SQLAlchemy (CorpusSource, CorpusChunk) — source of truth.
  - Retrieval: ChromaDB `corpus` collection — disposable index keyed by chunk id.

The package is layered so the pure, fully-testable core (records + chunker) has no
heavy dependencies; the ORM, embeddings, and Chroma live behind the importer/indexer.
"""

from src.corpus.records import ChunkRecord, SourceRecord, Kind, SourceType

__all__ = ["ChunkRecord", "SourceRecord", "Kind", "SourceType"]
