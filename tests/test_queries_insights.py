"""
test_queries_insights.py — exercise the new src/graph/queries.recent_insights
door (CONTRACT D4, the dashboard's insight card). Verifies it returns ONLY
inferred student insights, newest-first, owner-scoped, excludes invalidated
rows and the structural prerequisite_of edges, and (with course_id) keeps only
insights whose object concept is in that course's region.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import core.database as cdb
from core.database import Course, CourseSource
from src.corpus.models import CorpusSource
from src.graph import queries
from src.graph.models import Assertion, ConceptNode, new_id


@pytest.fixture
def db(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'g.db'}")
    cdb.Base.metadata.create_all(engine)
    maker = sessionmaker(bind=engine)
    monkeypatch.setattr(cdb, "SessionLocal", maker)
    sess = maker()
    yield sess
    sess.close()


def _insight(db, owner, *, literal, valid_from, relation="struggles_with",
             kind="inferred", subject_type="student", invalidated=False,
             object_type=None, object_id=None, confidence=0.7):
    db.add(Assertion(
        id=new_id(), subject_type=subject_type, subject_id="student",
        relation=relation, kind=kind, literal=literal, confidence=confidence,
        object_type=object_type, object_id=object_id,
        valid_from=valid_from, owner=owner,
        invalidated_at=(valid_from if invalidated else None),
    ))


def _seed_course(db, owner="ada"):
    db.add(Course(id="c1", name="AP Statistics", owner=owner, settings="{}"))
    db.add(CorpusSource(id="s1", source_type="textbook", title="Intro Stats",
                        content_hash="h", status="ready"))
    db.add(CourseSource(course_id="c1", source_id="s1"))
    db.add(ConceptNode(id="k0", name="Sampling", normalized_name="sampling",
                       source_id="s1", owner=owner, heading_path=["Ch1", "Sampling"],
                       meta={"sources": ["s1"], "ordinal": 0}))


def test_returns_only_inferred_student_insights_newest_first(db):
    now = datetime(2026, 6, 1, 12, 0, 0)
    _insight(db, "ada", literal="older insight", valid_from=now - timedelta(days=2))
    _insight(db, "ada", literal="newest insight", valid_from=now)
    _insight(db, "ada", literal="middle insight", valid_from=now - timedelta(days=1))
    # NOT an insight: a stated (non-inferred) assertion.
    _insight(db, "ada", literal="stated thing", valid_from=now, kind="stated")
    # NOT an insight: a concept-subject (structural) assertion.
    _insight(db, "ada", literal="concept fact", valid_from=now, subject_type="concept")
    # NOT an insight: an invalidated row.
    _insight(db, "ada", literal="retracted", valid_from=now, invalidated=True)
    # NOT an insight: a prerequisite_of edge.
    _insight(db, "ada", literal="prereq", valid_from=now, relation="prerequisite_of")
    db.commit()

    out = queries.recent_insights(db, "ada", limit=5)
    literals = [r["literal"] for r in out]
    assert literals == ["newest insight", "middle insight", "older insight"]
    # Shape contract.
    top = out[0]
    assert set(top) >= {"id", "relation", "literal", "confidence", "valid_from"}
    assert top["confidence"] == 0.7
    assert top["valid_from"].startswith("2026-06-01")


def test_owner_scoped_excludes_foreign(db):
    now = datetime(2026, 6, 1)
    _insight(db, "ada", literal="ada's insight", valid_from=now)
    _insight(db, "bob", literal="bob's insight", valid_from=now)
    db.commit()
    ada = [r["literal"] for r in queries.recent_insights(db, "ada")]
    assert "ada's insight" in ada
    assert "bob's insight" not in ada


def test_limit_caps_results(db):
    now = datetime(2026, 6, 1, 12)
    for i in range(8):
        _insight(db, "ada", literal=f"insight {i}",
                 valid_from=now - timedelta(hours=i))
    db.commit()
    assert len(queries.recent_insights(db, "ada", limit=3)) == 3


def test_course_filter_and_concept_join(db):
    now = datetime(2026, 6, 1, 12)
    _seed_course(db)
    # In-region: points at concept k0 (in course c1's region).
    _insight(db, "ada", literal="weak on sampling", valid_from=now,
             object_type="concept", object_id="k0")
    # Out-of-region: points at an unknown concept id.
    _insight(db, "ada", literal="off-topic", valid_from=now,
             object_type="concept", object_id="other-concept")
    db.commit()

    scoped = queries.recent_insights(db, "ada", course_id="c1", limit=5)
    literals = [r["literal"] for r in scoped]
    assert "weak on sampling" in literals
    assert "off-topic" not in literals
    rec = next(r for r in scoped if r["literal"] == "weak on sampling")
    assert rec["concept_id"] == "k0" and rec["concept_name"] == "Sampling"


def test_course_filter_keeps_concept_less_insights(db):
    """Regression (F1): the region filter must apply ONLY to concept-anchored
    rows. A concept-less inferred insight (no object concept) carries no anchor,
    so a course-scoped call must KEEP it (mirrors student_context._focus_lines,
    which applies no region filter on the insight object). Before the fix, every
    concept-less insight was dropped under a course filter (None not in region)."""
    now = datetime(2026, 6, 1, 12)
    _seed_course(db)
    # Concept-less: a plain inferred insight with no object concept.
    _insight(db, "ada", literal="rushes the setup", valid_from=now)
    # In-region: points at concept k0 (in course c1's region).
    _insight(db, "ada", literal="weak on sampling", valid_from=now,
             object_type="concept", object_id="k0")
    # Out-of-region: points at an unknown concept id.
    _insight(db, "ada", literal="off-topic", valid_from=now,
             object_type="concept", object_id="other-concept")
    db.commit()

    scoped = queries.recent_insights(db, "ada", course_id="c1", limit=5)
    literals = [r["literal"] for r in scoped]
    assert "rushes the setup" in literals      # concept-less: kept
    assert "weak on sampling" in literals       # in-region concept: kept
    assert "off-topic" not in literals          # out-of-region concept: dropped
