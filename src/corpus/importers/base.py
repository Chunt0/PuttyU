"""
base.py — the importer contract.

An importer turns a source directory into a (SourceRecord, [ChunkRecord]) pair feeding
the SAME two tables (ADR 0003). TextbookMarkerImporter exists now; VideoTranscriptImporter
(time-locators, kind=transcript_segment) arrives in the tutoring phase. The indexer is
importer-agnostic: it persists whatever parse() returns.
"""

from __future__ import annotations

import os
import re
from abc import ABC, abstractmethod

from src.corpus.records import ChunkRecord, SourceRecord


def slugify(value: str) -> str:
    """Lowercase, hyphen-separated, alnum-only slug for source ids / paths."""
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return value or "source"


class BaseImporter(ABC):
    """Parse one source directory. Stateless; the indexer owns persistence + assets."""

    #: importer's images live here, relative to the source dir (overridable per importer)
    images_subdir = "images"

    @abstractmethod
    def can_handle(self, source_dir: str) -> bool:
        """True if this importer recognises the directory's layout."""

    @abstractmethod
    def parse(self, source_dir: str, **overrides) -> tuple[SourceRecord, list[ChunkRecord]]:
        """Return the source row and its ordered chunks (no DB / embedding side effects)."""

    def images_dir(self, source_dir: str) -> str:
        return os.path.join(source_dir, self.images_subdir)
