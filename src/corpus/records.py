"""
records.py — the importer's output contract, decoupled from the ORM.

`ChunkRecord` / `SourceRecord` are plain dataclasses produced by the *chunker* and
*importers*. They carry no SQLAlchemy/Chroma dependency, so the chunker stays a pure
function that can be unit-tested against fixture strings (see tests/test_corpus_chunker*).
The indexer is the only place that maps these onto the ORM rows + Chroma vectors.

Field names mirror docs/adr/0003-corpus-schema.md so the mapping is 1:1 and greppable.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Optional


# --- closed vocabularies (kept as plain strings for cheap JSON/Chroma round-trips) ---

class SourceType:
    TEXTBOOK = "textbook"
    LITERATURE = "literature"
    VIDEO_TRANSCRIPT = "video_transcript"
    # Phase-2 (SPEC F2): an owner-uploaded course material (syllabus, homework
    # sheet, any PDF). Sits beside the curated library — owner is always set.
    MATERIAL = "material"

    ALL = frozenset({TEXTBOOK, LITERATURE, VIDEO_TRANSCRIPT, MATERIAL})


class Kind:
    """Pedagogical/structural role of a chunk — the tutor's primary retrieval lever.

    The textbook importer (v1) emits a subset: PROSE, EXAMPLE, TRY_IT, NOTE, KEY_TERMS,
    OBJECTIVE, EXERCISE. PROBLEM/SOLUTION are reserved (folded into EXAMPLE for now);
    TRANSCRIPT_SEGMENT/FIGURE arrive with later importers. See ADR 0003.
    """

    PROSE = "prose"
    EXAMPLE = "example"
    PROBLEM = "problem"
    SOLUTION = "solution"
    TRY_IT = "try_it"
    NOTE = "note"
    KEY_TERMS = "key_terms"
    OBJECTIVE = "objective"
    FIGURE = "figure"
    EXERCISE = "exercise"
    TRANSCRIPT_SEGMENT = "transcript_segment"

    ALL = frozenset({
        PROSE, EXAMPLE, PROBLEM, SOLUTION, TRY_IT, NOTE, KEY_TERMS,
        OBJECTIVE, FIGURE, EXERCISE, TRANSCRIPT_SEGMENT,
    })


def content_hash(text: str) -> str:
    """Stable hash of chunk text, used for idempotent re-import. sha256 hex."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def estimate_tokens(text: str) -> int:
    """Cheap token estimate (~4 chars/token) — avoids a tokenizer dependency in the
    pure core. Used only for chunk-size targeting, not billing, so approximate is fine."""
    return max(1, round(len(text) / 4))


@dataclass
class ChunkRecord:
    """One retrievable unit: a section's prose slice, or an atomic pedagogical block.

    `ordinal` is document order within a source (enables neighbor expansion).
    `locator` is a provenance dict — {"kind": "page", "start": int, "end": int} for
    textbooks, {"kind": "time", ...} for transcripts; None when unknown.
    """

    ordinal: int
    kind: str
    heading_path: list[str]
    text: str
    locator: Optional[dict] = None
    asset_paths: list[str] = field(default_factory=list)
    token_estimate: int = 0
    char_count: int = 0
    content_hash: str = ""
    # seams (populated later, never by the chunker): see ADR 0003
    meta: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.kind not in Kind.ALL:
            raise ValueError(f"unknown chunk kind: {self.kind!r}")
        # Derive the size/identity fields from text so callers can't forget them.
        if not self.char_count:
            self.char_count = len(self.text)
        if not self.token_estimate:
            self.token_estimate = estimate_tokens(self.text)
        if not self.content_hash:
            self.content_hash = content_hash(self.text)


@dataclass
class SourceRecord:
    """One textbook / work / video. Produced by an importer's parse(), then upserted.

    `original_path` is the served PDF (NOT embedded). `assets_dir` is where the
    importer copied the figures. `course_id`/`owner` are nullable seams (ADR 0003).
    """

    id: str
    source_type: str
    title: str
    content_hash: str
    language: str = "en"
    subject: Optional[str] = None
    level: Optional[str] = None
    source_url: Optional[str] = None
    original_path: Optional[str] = None
    assets_dir: Optional[str] = None
    license: Optional[str] = None
    authors: Optional[str] = None
    course_id: Optional[str] = None
    owner: Optional[str] = None
    status: str = "importing"
    meta: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.source_type not in SourceType.ALL:
            raise ValueError(f"unknown source_type: {self.source_type!r}")
