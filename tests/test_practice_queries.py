"""
test_practice_queries.py — exercise the existing src/graph/queries.py public
API (the graph one-door, Gate 6f) against a seeded in-memory graph. The "don't
trust unexercised code" step for the read/write seam the practice engine rides.

Covers: region_concepts (source-intersection + ordinal order), states_for
(unknown == ("unknown", None, None) and known rows), prereq_out_degree,
error_counts, concept_brief (state-annotated dict + None), and a
record_evidence round-trip (evidence row + derived state).
"""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import core.database as cdb
from core.database import Course, CourseSource
from src.corpus.models import CorpusSource
from src.graph import mastery, queries
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


def _seed(db, owner="ada"):
    db.add(Course(id="c1", name="AP Statistics", owner=owner, settings="{}"))
    db.add(CorpusSource(id="s1", source_type="textbook", title="Intro Stats",
                        content_hash="h", status="ready"))
    db.add(CourseSource(course_id="c1", source_id="s1"))
    concepts = []
    for i, name in enumerate(["1.1 Definitions", "1.2 Sampling", "1.3 Frequency"]):
        node = ConceptNode(id=f"k{i}", name=name, normalized_name=name.lower(),
                           source_id="s1", owner=owner,
                           heading_path=["Chapter 1", name],
                           meta={"sources": ["s1"], "ordinal": i})
        db.add(node)
        concepts.append(node)
    # k0 is a prerequisite of k1 and k2 (out-degree 2).
    db.add(Assertion(id=new_id(), subject_type="concept", subject_id="k0",
                     relation="prerequisite_of", object_type="concept",
                     object_id="k1", kind="inferred", owner=owner))
    db.add(Assertion(id=new_id(), subject_type="concept", subject_id="k0",
                     relation="prerequisite_of", object_type="concept",
                     object_id="k2", kind="inferred", owner=owner))
    db.commit()
    return concepts


def test_region_concepts_intersection_and_order(db):
    _seed(db)
    region = queries.region_concepts(db, "c1", "ada")
    assert [c["id"] for c in region] == ["k0", "k1", "k2"]   # ordinal order
    assert region[0]["heading_path"] == ["Chapter 1", "1.1 Definitions"]
    assert "s1" in region[0]["sources"]


def test_region_concepts_empty_for_unknown_course(db):
    _seed(db)
    assert queries.region_concepts(db, "no-such-course", "ada") == []


def test_states_for_unknown_is_not_zero(db):
    _seed(db)
    states = queries.states_for(db, ["k0", "k1", "k2"])
    # No evidence yet -> the unknown sentinel for all.
    assert states["k0"] == ("unknown", None, None)
    # Add evidence to k1 and re-read.
    mastery.apply_evidence("k1", "correct", owner="ada", db=db)
    states = queries.states_for(db, ["k1"])
    state, eff_p, last_at = states["k1"]
    assert state in ("learning", "shaky", "mastered")
    assert eff_p is not None and last_at is not None


def test_prereq_out_degree(db):
    _seed(db)
    deg = queries.prereq_out_degree(db, ["k0", "k1", "k2"])
    assert deg.get("k0") == 2          # k0 is prereq of both k1 and k2
    assert deg.get("k1", 0) == 0


def test_error_counts(db):
    _seed(db)
    mastery.apply_evidence("k1", "incorrect", owner="ada", db=db)
    mastery.apply_evidence("k1", "incorrect", owner="ada", db=db)
    mastery.apply_evidence("k1", "correct", owner="ada", db=db)
    counts = queries.error_counts(db, ["k0", "k1"], "ada")
    assert counts.get("k1") == 2       # two 'incorrect' rows
    assert counts.get("k0", 0) == 0


def test_concept_brief_and_none(db):
    _seed(db)
    brief = queries.concept_brief(db, "k0", "ada")
    assert brief["id"] == "k0" and brief["name"] == "1.1 Definitions"
    assert brief["state"] == "unknown" and brief["effective_p"] is None
    assert queries.concept_brief(db, "nope", "ada") is None
    # owner isolation: bob can't see ada's owned node.
    assert queries.concept_brief(db, "k0", "bob") is None


def test_record_evidence_roundtrip(db):
    _seed(db)
    state, eff_p = queries.record_evidence(
        "k1", "correct", weight=1.0, context={"source": "review"},
        owner="ada", db=db)
    assert state in ("learning", "shaky", "mastered")
    assert eff_p is not None
    # Evidence is now visible through the read door.
    s, ep, last = queries.states_for(db, ["k1"])["k1"]
    assert ep is not None and last is not None
    assert queries.error_counts(db, ["k1"], "ada").get("k1", 0) == 0
