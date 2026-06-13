"""Phase-2 T3a (ADR 0005) — /api/graph routes: the state-colored concept tree,
the evidence+timeline detail (incl. invalidated entries), the mastery override
(evidence rows, the-user-outranks rule), observations, and the challenge flow
(invalidate + stated correction). Handler-direct pattern, like
test_course_routes (TestClient threadpools can hang in CI)."""

import tempfile
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

import core.database as cdb
import routes.graph_routes as groutes
from core.database import Course, CourseSource
from src.corpus.models import CorpusSource
from src.graph import mastery
from src.graph.models import Assertion, ConceptNode, MasteryEvidence, new_id
from src.request_models import GraphChallengeRequest, GraphOverrideRequest

_TMPDB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_ENGINE = create_engine(f"sqlite:///{_TMPDB.name}",
                        connect_args={"check_same_thread": False},
                        poolclass=NullPool)
cdb.Base.metadata.create_all(_ENGINE)
_TS = sessionmaker(bind=_ENGINE, autoflush=False, autocommit=False)
groutes.SessionLocal = _TS

_ROUTER = groutes.setup_graph_routes()


def _endpoint(method, suffix):
    for r in _ROUTER.routes:
        if getattr(r, "path", "").endswith(suffix) and method in getattr(r, "methods", set()):
            return r.endpoint
    raise RuntimeError(f"{method} *{suffix} not found")


concept_tree = _endpoint("GET", "/concepts")
concept_detail = _endpoint("GET", "/concepts/{concept_id}")
override_concept = _endpoint("POST", "/{concept_id}/override")
list_observations = _endpoint("GET", "/observations")
challenge_assertion = _endpoint("POST", "/{assertion_id}/challenge")


def _req(user="ada"):
    return SimpleNamespace(state=SimpleNamespace(current_user=user))


@pytest.fixture(autouse=True)
def clean_db():
    db = _TS()
    try:
        for model in (MasteryEvidence, Assertion, ConceptNode, CourseSource,
                      CorpusSource, Course):
            db.query(model).delete()
        from src.graph.models import EntityNode, MasteryState
        db.query(EntityNode).delete()
        db.query(MasteryState).delete()
        db.commit()
    finally:
        db.close()


def _world(owner="ada"):
    """course c1 -> source s1 -> three concepts (nested heading paths)."""
    db = _TS()
    try:
        db.add(Course(id="c1", name="Stats", owner=owner, settings="{}"))
        db.add(CorpusSource(id="s1", source_type="textbook", title="Intro Stats",
                            content_hash="h", status="ready"))
        db.add(CourseSource(course_id="c1", source_id="s1"))
        db.add(ConceptNode(id="k1", name="1 Sampling", normalized_name="1 sampling",
                           source_id="s1", heading_path=["1 Sampling"], owner=owner,
                           meta={"sources": ["s1"], "ordinal": 0}))
        db.add(ConceptNode(id="k2", name="1.1 Definitions",
                           normalized_name="1.1 definitions", source_id="s1",
                           heading_path=["1 Sampling", "1.1 Definitions"],
                           owner=owner, meta={"sources": ["s1"], "ordinal": 1}))
        db.add(ConceptNode(id="k3", name="z-scores", normalized_name="z-scores",
                           source_id="other", heading_path=["z-scores"], owner=owner,
                           meta={"sources": ["other"], "ordinal": 9}))
        db.commit()
    finally:
        db.close()


# ---------------------------------------------------------------- tree

def test_concept_tree_nested_with_states_and_counts():
    _world()
    db = _TS()
    try:
        mastery.apply_evidence("k2", "correct", owner="ada", db=db,
                               context={"source": "chat"})
    finally:
        db.close()
    out = concept_tree(_req(), course_id="c1")
    assert out["course_id"] == "c1"
    roots = out["concepts"]
    assert [r["name"] for r in roots] == ["1 Sampling"]      # k3: other source
    assert roots[0]["state"] == "unknown" and roots[0]["p_known"] is None
    child = roots[0]["children"][0]
    assert child["name"] == "1.1 Definitions"
    assert child["state"] in ("learning", "shaky")
    assert child["evidence_count"] == 1
    assert isinstance(child["p_known"], float)


def test_concept_tree_without_course_lists_everything_owned():
    _world()
    out = concept_tree(_req(), course_id=None)
    flat = {r["name"] for r in out["concepts"]} | {
        c["name"] for r in out["concepts"] for c in r["children"]}
    assert flat == {"1 Sampling", "1.1 Definitions", "z-scores"}


def test_concept_tree_owner_scoped():
    _world(owner="ada")
    assert concept_tree(_req("bob"), course_id=None)["concepts"] == []


# ---------------------------------------------------------------- detail

def test_concept_detail_shows_evidence_and_full_timeline():
    _world()
    db = _TS()
    try:
        mastery.apply_evidence("k3", "correct", owner="ada", db=db,
                               episode_ref={"type": "chat_message", "id": 5},
                               context={"source": "worksheet"})
        old = Assertion(id="a-old", subject_type="student", subject_id="ada",
                        relation="misconception", object_type="concept",
                        object_id="k3", kind="inferred", confidence=0.7,
                        literal="confuses sd with se", owner="ada")
        db.add(old)
        db.commit()
    finally:
        db.close()
    # challenge it so the timeline carries an invalidated entry
    challenge_assertion(_req(), "a-old",
                        GraphChallengeRequest(correction="that was resolved in June"))

    detail = concept_detail(_req(), "k3")
    assert detail["name"] == "z-scores"
    assert detail["evidence"][0]["signal"] == "correct"
    assert detail["evidence"][0]["source"] == "worksheet"
    assert detail["evidence"][0]["episode_ref"] == {"type": "chat_message", "id": 5}
    kinds = {(a["id"], a["kind"]) for a in detail["assertions"]}
    assert ("a-old", "inferred") in kinds
    old_item = next(a for a in detail["assertions"] if a["id"] == "a-old")
    assert old_item["invalidated_at"] is not None          # trajectory keeps the arc
    assert old_item["invalidation_reason"] == "challenged by user"


def test_concept_detail_404s_for_other_owner():
    _world(owner="ada")
    with pytest.raises(HTTPException) as e:
        concept_detail(_req("bob"), "k1")
    assert e.value.status_code == 404


# ---------------------------------------------------------------- override

def test_override_known_sets_mastered_and_appends_evidence():
    _world()
    out = override_concept(_req(), "k1", GraphOverrideRequest(known=True))
    assert out["state"] == "mastered" and out["evidence_count"] == 1
    db = _TS()
    try:
        rows = db.query(MasteryEvidence).filter_by(concept_id="k1").all()
        assert [r.signal for r in rows] == ["override_known"]
        assert rows[0].context == {"source": "override"}    # overrides ARE evidence
        assert rows[0].owner == "ada"
    finally:
        db.close()


def test_override_unknown_then_known_keeps_both_receipts():
    _world()
    out = override_concept(_req(), "k1", GraphOverrideRequest(known=False))
    assert out["state"] == "learning"
    out = override_concept(_req(), "k1", GraphOverrideRequest(known=True))
    assert out["state"] == "mastered" and out["evidence_count"] == 2


# ---------------------------------------------------------------- observations

def test_observations_lists_stated_only_owner_scoped():
    _world()
    db = _TS()
    try:
        db.add(Assertion(id="ob1", subject_type="student", subject_id="ada",
                         relation="likes", literal="ice cream", kind="stated",
                         quote="I like ice cream", owner="ada"))
        db.add(Assertion(id="in1", subject_type="student", subject_id="ada",
                         relation="struggles_with", literal="x", kind="inferred",
                         confidence=0.5, owner="ada"))
        db.add(Assertion(id="ob2", subject_type="student", subject_id="bob",
                         relation="likes", literal="trains", kind="stated",
                         quote="trains!", owner="bob"))
        db.commit()
    finally:
        db.close()
    out = list_observations(_req(), course_id=None)
    ids = {o["id"] for o in out["observations"]}
    assert ids == {"ob1"}                                  # stated only, ada only
    assert out["observations"][0]["statement"] == "I like ice cream"


# ---------------------------------------------------------------- challenge

def test_challenge_invalidates_and_records_stated_correction():
    _world()
    db = _TS()
    try:
        db.add(Assertion(id="ins", subject_type="student", subject_id="ada",
                         relation="struggles_with", literal="avoids word problems",
                         kind="inferred", confidence=0.8, owner="ada"))
        db.commit()
    finally:
        db.close()

    out = challenge_assertion(
        _req(), "ins",
        GraphChallengeRequest(correction="not true — I just hadn't gotten to them"))
    assert out["invalidated"]["id"] == "ins"
    assert out["invalidated"]["invalidated_at"] is not None
    assert out["invalidated"]["invalidation_reason"] == "challenged by user"
    corr = out["correction"]
    assert corr["kind"] == "stated"                         # the student outranks
    assert corr["quote"] == "not true — I just hadn't gotten to them"
    assert corr["relation"] == "corrects"
    assert corr["episode_refs"] == [{"type": "assertion", "id": "ins"}]

    db = _TS()
    try:
        assert db.query(Assertion).count() == 2             # invalidated, not deleted
    finally:
        db.close()


def test_challenge_404s_for_other_owner():
    _world()
    db = _TS()
    try:
        db.add(Assertion(id="ins2", subject_type="student", subject_id="ada",
                         relation="believes", literal="y", kind="inferred",
                         confidence=0.5, owner="ada"))
        db.commit()
    finally:
        db.close()
    with pytest.raises(HTTPException) as e:
        challenge_assertion(_req("bob"), "ins2",
                            GraphChallengeRequest(correction="nope"))
    assert e.value.status_code == 404
