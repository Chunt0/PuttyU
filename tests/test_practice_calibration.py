"""
test_practice_calibration.py — the calibration warm-up walk
(src/practice/calibration.py, SPEC F1, D8).

Covers:
  * start() on an empty region (a course with no sources) -> status='no_region',
    a benign message, and NO store write (D8).
  * a full walk start -> answer -> finish: items minted mode='calibration',
    graded answers write evidence context.source=calibration, and finish()
    stamps Course.settings.calibrated_at and returns per-concept states.
  * answer(skip=True) advances the walk but writes NO evidence.
  * the v1 walk heuristic: a 2-correct streak skips ahead one extra concept.
  * an unknown/expired session_key is handled gracefully (status:'expired').

The LLM is never hit: graded items use the no-LLM string-match path (seeded
corpus exercises with splittable reference answers). The store path is patched
per the T4 contract §3; the graph + corpus ride an isolated DB.
"""

from __future__ import annotations

import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import core.database as cdb
from core.database import Course, CourseSource
from src.corpus.models import CorpusChunk, CorpusSource
from src.corpus.records import Kind
from src.graph import mastery
from src.graph.models import ConceptNode, MasteryEvidence
from src.practice import calibration, items, store


@pytest.fixture
def db(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'g.db'}")
    cdb.Base.metadata.create_all(engine)
    maker = sessionmaker(bind=engine)
    monkeypatch.setattr(cdb, "SessionLocal", maker)
    # Isolate the grading-key store per the T4 contract §3.
    monkeypatch.setattr("src.practice.store.STORE_PATH",
                        str(tmp_path / "practice_keys.json"))
    sess = maker()
    yield sess
    sess.close()


# Five concepts, each with a splittable EXERCISE so the no-LLM match can grade.
_CONCEPTS = [
    ("k0", "1.1 Definitions", "Chapter 1"),
    ("k1", "1.2 Sampling", "Chapter 1"),
    ("k2", "2.1 Mean", "Chapter 2"),
    ("k3", "2.2 Variance", "Chapter 2"),
    ("k4", "3.1 Probability", "Chapter 3"),
]


def _seed_region(db, owner="ada", course_id="c1"):
    db.add(Course(id=course_id, name="AP Statistics", owner=owner, settings="{}"))
    db.add(CorpusSource(id="s1", source_type="textbook", title="Intro Stats",
                        content_hash="h", status="ready"))
    db.add(CourseSource(course_id=course_id, source_id="s1"))
    for i, (cid, name, chapter) in enumerate(_CONCEPTS):
        db.add(ConceptNode(id=cid, name=name, normalized_name=name.lower(),
                           source_id="s1", owner=owner,
                           heading_path=[chapter, name],
                           meta={"sources": ["s1"], "ordinal": i}))
    db.commit()
    # One splittable EXERCISE per concept: answer "<cid>-ans" grades correct.
    for i, (cid, name, chapter) in enumerate(_CONCEPTS):
        db.add(CorpusChunk(
            id=f"s1:{100 + i}", source_id="s1", ordinal=100 + i,
            kind=Kind.EXERCISE, heading_path=[chapter, name],
            text=f"Question for {name}: what is the answer?\n\nAnswer:\n{cid}-ans",
            content_hash=f"hc{i}"))
    db.commit()


def _seed_empty_course(db, owner="ada", course_id="c_empty"):
    """A course with NO sources -> an empty region (D8 no_region path)."""
    db.add(Course(id=course_id, name="Bare Course", owner=owner, settings="{}"))
    db.commit()


# --------------------------------------------------------------- D8 no_region

@pytest.mark.asyncio
async def test_start_no_region_writes_nothing(db):
    """D8: a course with no library concepts -> no_region, nothing persisted."""
    _seed_empty_course(db)
    res = await calibration.start(db, "ada", "c_empty")
    assert res["status"] == "no_region"
    assert "warms up" in res["message"]
    assert "session_key" not in res
    # Nothing was written to the calibrations section of the store.
    doc = store._load()
    assert doc.get("calibrations", {}) == {}


# ----------------------------------------------------- full walk + finish

@pytest.mark.asyncio
async def test_full_walk_writes_calibration_evidence_and_stamps_course(db):
    """A full walk: items minted mode='calibration', graded answers write
    evidence source=calibration, finish() stamps Course.settings.calibrated_at."""
    _seed_region(db)
    res = await calibration.start(db, "ada", "c1")
    assert res["status"] == "in_progress"
    session_key = res["session_key"]
    assert res["total"] == len(_CONCEPTS)        # region <= PLAN_SIZE -> whole
    item = res["item"]
    assert item is not None
    # The minted item is a calibration item with no reference answer leaked.
    assert item["mode"] == "calibration"
    assert "reference_answer" not in item
    stored_item = store.get("items", item["item_key"])
    assert stored_item["mode"] == "calibration"

    # Walk the whole plan, answering each correctly with "<cid>-ans".
    done = False
    guard = 0
    while not done and guard < 20:
        guard += 1
        cid = item["concept_id"]
        out = await calibration.answer(
            db, "ada", session_key, item_key=item["item_key"],
            answer_text=f"{cid}-ans")
        assert out["total"] == len(_CONCEPTS)
        done = out["done"]
        item = out["next_item"]
        if not done:
            assert item is not None

    # Every graded answer wrote evidence stamped source=calibration (D2).
    cal_rows = (db.query(MasteryEvidence)
                .filter(MasteryEvidence.owner == "ada").all())
    cal_sourced = [r for r in cal_rows
                   if (r.context or {}).get("source") == "calibration"]
    assert len(cal_sourced) >= 1
    assert all(r.signal == "correct" for r in cal_sourced)

    # finish() stamps calibrated_at and reports per-concept states.
    fin = calibration.finish(db, "ada", session_key)
    assert fin["status"] == "done"
    assert fin["calibrated"] is True
    assert isinstance(fin["states"], list) and fin["states"]
    for s in fin["states"]:
        assert "concept_id" in s and "state" in s

    course = db.query(Course).filter(Course.id == "c1").first()
    settings = json.loads(course.settings)
    assert "calibrated_at" in settings and settings["calibrated_at"]

    # The session is consumed on finish.
    assert store.get("calibrations", session_key) is None


# --------------------------------------------------------------- skip path

@pytest.mark.asyncio
async def test_skip_writes_no_evidence_and_advances(db):
    """answer(skip=True) advances the walk but writes NO evidence."""
    _seed_region(db)
    res = await calibration.start(db, "ada", "c1")
    session_key = res["session_key"]
    first_item = res["item"]
    start_pos = res["position"]

    before = db.query(MasteryEvidence).count()
    out = await calibration.answer(
        db, "ada", session_key, item_key=first_item["item_key"], skip=True)
    after = db.query(MasteryEvidence).count()

    assert after == before                       # skip writes nothing
    assert out["verdict"] is None                # no grade ran
    assert out["position"] > start_pos           # the walk advanced
    assert out["next_item"] is not None          # more concepts remain


# ------------------------------------------------------ v1 walk heuristic

@pytest.mark.asyncio
async def test_two_correct_streak_skips_ahead_one_extra(db):
    """The v1 heuristic: a 2-correct streak skips ahead by one extra concept."""
    _seed_region(db)
    res = await calibration.start(db, "ada", "c1")
    session_key = res["session_key"]
    item = res["item"]

    # Answer the first correctly: position advances by 1 (streak now 1).
    out1 = await calibration.answer(
        db, "ada", session_key, item_key=item["item_key"],
        answer_text=f"{item['concept_id']}-ans")
    pos_after_1 = out1["position"]
    assert pos_after_1 == 1
    item = out1["next_item"]

    # Answer the second correctly: streak hits 2 -> advance by 2 (the bonus).
    out2 = await calibration.answer(
        db, "ada", session_key, item_key=item["item_key"],
        answer_text=f"{item['concept_id']}-ans")
    assert out2["position"] == pos_after_1 + 2    # one extra concept skipped


# ----------------------------------------------------- expired / unknown

@pytest.mark.asyncio
async def test_answer_unknown_session_is_graceful(db):
    out = await calibration.answer(
        db, "ada", "no-such-session", item_key="x", answer_text="y")
    assert out["status"] == "expired"
    assert out["done"] is True
    assert out["next_item"] is None


def test_finish_unknown_session_is_graceful(db):
    fin = calibration.finish(db, "ada", "no-such-session")
    assert fin["status"] == "expired"
    assert fin["calibrated"] is False
    assert fin["states"] == []


# -------------------------------------------------------- plan spread unit

def test_spread_plan_samples_evenly():
    ids = [f"k{i}" for i in range(30)]
    plan = calibration._spread_plan(ids, 10)
    assert len(plan) == 10
    assert plan[0] == "k0"                        # always starts at the front
    # Even sampling spans the whole range (not just the first chapter).
    assert int(plan[-1][1:]) >= 20
    # Smaller-than-size region -> the whole list, in order.
    assert calibration._spread_plan(["a", "b", "c"], 10) == ["a", "b", "c"]
    assert calibration._spread_plan([], 10) == []
