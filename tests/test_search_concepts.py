"""Phase-2 T5 vertical-5 (SPEC F11, CONTRACT D3) — the new graph one-door
queries.search_concepts (the ONLY way the global-search route reaches concepts).

Verifies name-matching is owner-scoped, course_id narrows to the course region,
and a blank query short-circuits to []. Uses a temp-file sqlite DB with the
shared Base metadata (same pattern as test_dashboard_route.py)."""

from __future__ import annotations

import tempfile

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

import core.database as cdb
from core.database import Course, CourseSource
from src.corpus.models import CorpusSource
from src.graph import queries
from src.graph.models import ConceptNode, new_id

_TMPDB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_ENGINE = create_engine(
    f"sqlite:///{_TMPDB.name}",
    connect_args={"check_same_thread": False},
    poolclass=NullPool,
)
cdb.Base.metadata.create_all(_ENGINE)
_TS = sessionmaker(bind=_ENGINE, autoflush=False, autocommit=False)


def _seed(owner="ada"):
    """Seed two concepts for `owner` (one in a course region, one not) + a
    foreign-owner concept that must never leak. Returns (course_id, in_region_id,
    out_region_id, foreign_id)."""
    suffix = new_id()[:8]
    course_id = f"c-{suffix}"
    sid = f"s-{suffix}"          # source linked to the course
    sid_other = f"so-{suffix}"   # owned source NOT linked to the course
    in_id, out_id, foreign_id = f"in-{suffix}", f"out-{suffix}", f"f-{suffix}"
    db = _TS()
    try:
        db.add(Course(id=course_id, name="AP Statistics", owner=owner,
                      status="active", settings="{}"))
        db.add(CorpusSource(id=sid, source_type="textbook", title="Intro Stats",
                            content_hash="h", status="ready", owner=owner))
        db.add(CorpusSource(id=sid_other, source_type="textbook", title="Other",
                            content_hash="h2", status="ready", owner=owner))
        db.add(CourseSource(course_id=course_id, source_id=sid))
        # In-region: source linked to the course.
        db.add(ConceptNode(id=in_id, name="Sampling distribution", owner=owner,
                           normalized_name="sampling distribution", source_id=sid,
                           heading_path=["Chapter 1", "Sampling"],
                           meta={"sources": [sid], "ordinal": 0}))
        # Out-of-region: same owner, source NOT in the course region.
        db.add(ConceptNode(id=out_id, name="Sampling bias", owner=owner,
                           normalized_name="sampling bias", source_id=sid_other,
                           heading_path=["Appendix"],
                           meta={"sources": [sid_other], "ordinal": 1}))
        # Foreign owner: must never appear for `owner`.
        db.add(ConceptNode(id=foreign_id, name="Sampling theorem", owner="bob",
                           normalized_name="sampling theorem", source_id=sid,
                           heading_path=["X"], meta={"sources": [sid], "ordinal": 2}))
        db.commit()
    finally:
        db.close()
    return course_id, in_id, out_id, foreign_id


def test_search_concepts_name_match_owner_scoped():
    course_id, in_id, out_id, foreign_id = _seed("ada")
    db = _TS()
    try:
        out = queries.search_concepts(db, "ada", "sampling", limit=10)
        ids = {c["id"] for c in out}
        # Both of ada's "Sampling*" concepts match...
        assert in_id in ids and out_id in ids
        # ...but bob's never leaks (owner scope).
        assert foreign_id not in ids
        # Plain dicts with the contract fields.
        first = out[0]
        assert set(first) >= {"id", "name", "heading_path", "sources"}
        # A non-matching query returns nothing.
        assert queries.search_concepts(db, "ada", "thermodynamics") == []
        # bob sees only his own.
        bob = {c["id"] for c in queries.search_concepts(db, "bob", "sampling")}
        assert bob == {foreign_id}
    finally:
        db.close()


def test_search_concepts_course_narrows_to_region():
    course_id, in_id, out_id, _ = _seed("ada")
    db = _TS()
    try:
        out = queries.search_concepts(db, "ada", "sampling", course_id=course_id)
        ids = {c["id"] for c in out}
        # Only the in-region concept survives the source intersection.
        assert ids == {in_id}
        assert out_id not in ids
    finally:
        db.close()


def test_search_concepts_blank_query_returns_empty():
    db = _TS()
    try:
        assert queries.search_concepts(db, "ada", "") == []
        assert queries.search_concepts(db, "ada", "   ") == []
        assert queries.search_concepts(db, "ada", None) == []
    finally:
        db.close()
