"""
models.py — the ensemble-graph canonical store (SQLite/SQLAlchemy), per ADR 0005.

Five tables on the SHARED declarative Base (`core.database.Base`):
  * concept_node     — curriculum concepts, closed-world (seeded from corpus structure).
  * entity_node      — the user's world, open-world but sparse (ADD/UPDATE/NOOP writes).
  * assertion        — every fact/edge, with provenance (stated|inferred) and temporal
                       validity. Bi-temporal rule: contradiction invalidates, never deletes.
  * mastery_evidence — append-only log of mastery signals (the receipts).
  * mastery_state    — a DERIVED cache, recomputable from the log (mastery.rebuild_mastery).

Like the corpus (ADR 0003), the graph manages its own tables idempotently via
`ensure_graph_tables()`; init_db calls it the same way it calls ensure_corpus_tables.
All tables carry a nullable `owner` (Gate-5 seam — multi-student needs no rework).
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime

from sqlalchemy import (
    Column, DateTime, Float, Index, JSON, String, Text,
)

from core.database import Base, utcnow_naive

# The closed relation vocabulary (ADR 0005). Extraction output is validated
# against this; unknown relations are coerced to "related_to".
RELATIONS = frozenset({
    "prerequisite_of", "part_of", "related_to",
    "likes", "dislikes", "prefers", "interested_in",
    "struggles_with", "breakthrough_on", "believes", "misconception",
    "corrects",
})

# Relations that count as durable stated PREFERENCES for the profile tier
# (student_context T0).
PREFERENCE_RELATIONS = frozenset({"likes", "dislikes", "prefers", "interested_in"})

# mastery_evidence.signal vocabulary (ADR 0005).
SIGNALS = frozenset({
    "correct", "partial", "incorrect", "hint_used", "explained",
    "override_known", "override_unknown",
})

SUBJECT_TYPES = frozenset({"concept", "entity", "student"})
ASSERTION_KINDS = frozenset({"stated", "inferred"})


def new_id() -> str:
    return str(uuid.uuid4())


def normalize_name(name: str) -> str:
    """The reuse key: lowercase, collapsed whitespace, stripped punctuation
    edges. Exact normalized match per owner reuses the existing node — what
    makes cross-course shared nodes (the F6 periphery) real."""
    s = re.sub(r"\s+", " ", (name or "").strip().lower())
    return s.strip(" .,:;!?\"'()[]")


class ConceptNode(Base):
    """A curriculum concept — closed-world: only seeding (and gated
    consolidation proposals, later) creates these. The extractor classifies
    onto existing nodes."""

    __tablename__ = "concept_node"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    normalized_name = Column(String, nullable=False, index=True)
    source_id = Column(String, nullable=True, index=True)   # seeding corpus_source
    heading_path = Column(JSON, default=list)               # list[str] breadcrumb
    owner = Column(String, nullable=True, index=True)
    # meta: {"sources": [source_id, ...], "ordinal": int, "tags": [...]}
    # sources grows when another course/source reuses the node; ordinal is the
    # first chunk ordinal in the seeding source (book order -> frontier order).
    meta = Column(JSON, default=dict)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)

    __table_args__ = (
        Index("ix_concept_node_norm_owner", "normalized_name", "owner"),
    )


class EntityNode(Base):
    """A thing in the user's world (ice cream, the physics lab, a sibling).
    Open-world but sparse — writes pass ADD/UPDATE/NOOP reconciliation."""

    __tablename__ = "entity_node"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    normalized_name = Column(String, nullable=False, index=True)
    kind = Column(String, nullable=True)                     # person|place|interest|...
    owner = Column(String, nullable=True, index=True)
    meta = Column(JSON, default=dict)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)


class Assertion(Base):
    """One fact/edge with provenance and temporal validity (ADR 0005).

    subject is (subject_type, subject_id): concept|entity|student. The object
    is either a node ref (object_type/object_id) or a literal string. `kind`
    separates "the user said it" (stated, carries the verbatim quote) from
    "the tutor concluded it" (inferred, carries a confidence) — never merged.
    Contradiction sets invalidated_at; rows are never deleted.
    """

    __tablename__ = "assertion"

    id = Column(String, primary_key=True)
    subject_type = Column(String, nullable=False)            # concept|entity|student
    subject_id = Column(String, nullable=False)
    relation = Column(String, nullable=False)                # RELATIONS (closed enum)
    object_type = Column(String, nullable=True)              # concept|entity|None
    object_id = Column(String, nullable=True)
    literal = Column(Text, nullable=True)                    # free-text object
    kind = Column(String, nullable=False)                    # stated|inferred
    quote = Column(Text, nullable=True)                      # verbatim — stated only
    confidence = Column(Float, nullable=True)                # inferred only
    valid_from = Column(DateTime, default=utcnow_naive, nullable=False)
    invalidated_at = Column(DateTime, nullable=True, index=True)
    invalidation_reason = Column(String, nullable=True)
    episode_refs = Column(JSON, default=list)                # [{"type","id"}] receipts
    owner = Column(String, nullable=True, index=True)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)

    __table_args__ = (
        Index("ix_assertion_subject", "subject_type", "subject_id"),
    )


class MasteryEvidence(Base):
    """Append-only mastery log — every signal ever observed, never rewritten.
    mastery_state is derived from this; rebuild_mastery() replays it."""

    __tablename__ = "mastery_evidence"

    id = Column(String, primary_key=True)
    concept_id = Column(String, nullable=False, index=True)
    episode_ref = Column(JSON, nullable=True)                # {"type","id"} or None
    signal = Column(String, nullable=False)                  # SIGNALS
    weight = Column(Float, nullable=False, default=1.0)
    # {"source": chat|gym|review|exam|worksheet|calibration|override,
    #  "difficulty"?, "note"?, "indirect"?: True, "via"?: concept_id}
    context = Column(JSON, default=dict)
    owner = Column(String, nullable=True, index=True)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)


class MasteryState(Base):
    """Derived cache of the BKT-lite engine. NO row = "unknown" (unknown ≠
    zero — the tutor probes before it assumes). Recency decay is applied at
    READ time (mastery.effective_p), not stored."""

    __tablename__ = "mastery_state"

    concept_id = Column(String, primary_key=True)
    p_known = Column(Float, nullable=False, default=0.0)
    state = Column(String, nullable=False, default="learning")  # learning|shaky|mastered
    last_evidence_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)
    owner = Column(String, nullable=True, index=True)


GRAPH_TABLES = [
    ConceptNode.__table__, EntityNode.__table__, Assertion.__table__,
    MasteryEvidence.__table__, MasteryState.__table__,
]


def ensure_graph_tables(bind=None) -> None:
    """Idempotently create the graph tables (checkfirst). The graph analogue of
    ensure_corpus_tables — called from init_db AND by the write paths, so the
    subsystem is self-sufficient in tests/CLI contexts too."""
    from core.database import engine as default_engine
    Base.metadata.create_all(bind=bind or default_engine, tables=GRAPH_TABLES)


def episode_ref(ref_type: str, ref_id) -> dict:
    """Episodes are references to existing persisted records, not a store
    (ADR 0005): chat_message | upload | task_run | assertion | user_override."""
    return {"type": ref_type, "id": ref_id}


def utcnow() -> datetime:
    return utcnow_naive()
