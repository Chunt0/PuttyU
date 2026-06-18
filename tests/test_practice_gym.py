"""
test_practice_gym.py — the Gym (src/practice/gym.py, SPEC F8, T4 D5).

Covers:
  * Coach's pick: targets the shakiest concept that ALSO has errors; never a
    mastered concept as filler; nothing eligible -> {item: None}.
  * D5 ZPD adaptation: 2 consecutive correct -> difficulty +1 (streak reset);
    2 consecutive wrong -> difficulty -1 (streak reset) AND a study_citation is
    present; 'partial' nudges neither; bounds clamp at 1 and 5.
  * Running set totals (attempted/correct) fold across requests.

Isolation (T4 contract §3): an isolated in-memory-ish tmp sqlite graph DB plus a
per-test patched practice-store path. The LLM is NEVER hit — the no-LLM paths
rely on model_router resolving to an empty endpoint in the isolated DB, so
grading uses the deterministic string-match against a seeded reference answer.
We assert that with an explicit monkeypatch guard on the async LLM call.
"""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import core.database as cdb
from core.database import Course, CourseSource
from src.corpus.models import CorpusChunk, CorpusSource
from src.corpus.records import Kind
from src.graph import mastery, queries
from src.graph.models import ConceptNode
from src.practice import gym


@pytest.fixture
def db(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'g.db'}")
    cdb.Base.metadata.create_all(engine)
    maker = sessionmaker(bind=engine)
    monkeypatch.setattr(cdb, "SessionLocal", maker)
    monkeypatch.setattr("src.practice.store.STORE_PATH",
                        str(tmp_path / "practice_keys.json"))

    # Hard guard: any attempt to actually call an LLM fails the test loudly.
    async def _no_llm(*a, **k):                       # pragma: no cover - guard
        raise AssertionError("gym tests must never hit a real LLM")
    monkeypatch.setattr("src.llm_core.llm_call_async", _no_llm)

    sess = maker()
    yield sess
    sess.close()


def _seed_world(db, owner="ada", course_id="c1"):
    """Three concepts under Chapter 1, each with an EXERCISE chunk carrying a
    splittable reference answer (so the no-LLM grader is deterministic)."""
    db.add(Course(id=course_id, name="AP Statistics", owner=owner, settings="{}"))
    db.add(CorpusSource(id="s1", source_type="textbook", title="Intro Stats",
                        content_hash="h", status="ready"))
    db.add(CourseSource(course_id=course_id, source_id="s1"))
    names = ["1.1 Definitions", "1.2 Sampling", "1.3 Frequency"]
    for i, name in enumerate(names):
        db.add(ConceptNode(id=f"k{i}", name=name, normalized_name=name.lower(),
                           source_id="s1", owner=owner,
                           heading_path=["Chapter 1", name],
                           meta={"sources": ["s1"], "ordinal": i}))
        db.add(CorpusChunk(
            id=f"s1:{10 + i}", source_id="s1", ordinal=10 + i, kind=Kind.EXERCISE,
            heading_path=["Chapter 1", name],
            text=f"Exercise for {name}: what is 2 + 2?\n\nAnswer:\n4",
            content_hash=f"hc{i}"))
    db.commit()


# ------------------------------------------------------------- coach's pick

@pytest.mark.asyncio
async def test_coach_pick_targets_shaky_with_errors(db):
    """No concept_id -> coach picks the shakiest concept that ALSO has errors."""
    _seed_world(db)
    # k1 has an error (shaky-with-errors). k2 has only positive evidence (no
    # errors) so it must NOT be picked even though it isn't mastered.
    mastery.apply_evidence("k1", "incorrect", owner="ada", db=db)
    mastery.apply_evidence("k2", "correct", owner="ada", db=db)

    out = await gym.next_item(db, "ada", "c1")
    assert out["item"] is not None
    assert out["item"]["concept_id"] == "k1"
    assert out["message"] and "shakiest" in out["message"]
    assert out["item"]["mode"] == "gym"


@pytest.mark.asyncio
async def test_coach_pick_never_filler_mastered(db):
    """A mastered concept is never the coach's pick, even with recorded errors."""
    _seed_world(db)
    # k0 mastered via override but ALSO has an old error row -> still excluded.
    mastery.apply_evidence("k0", "incorrect", owner="ada", db=db)
    mastery.apply_evidence("k0", "override_known", owner="ada", db=db)
    # k1 is the only non-mastered concept with an error.
    mastery.apply_evidence("k1", "incorrect", owner="ada", db=db)

    out = await gym.next_item(db, "ada", "c1")
    assert out["item"] is not None
    assert out["item"]["concept_id"] == "k1"


@pytest.mark.asyncio
async def test_coach_pick_shakiest_of_several(db):
    """Among several errored concepts, the lowest effective_p wins."""
    _seed_world(db)
    # k1: two wrongs (weaker). k2: one wrong then one right (stronger).
    mastery.apply_evidence("k1", "incorrect", owner="ada", db=db)
    mastery.apply_evidence("k1", "incorrect", owner="ada", db=db)
    mastery.apply_evidence("k2", "incorrect", owner="ada", db=db)
    mastery.apply_evidence("k2", "correct", owner="ada", db=db)

    s = queries.states_for(db, ["k1", "k2"])
    assert s["k1"][1] < s["k2"][1]                    # k1 really is shakier
    out = await gym.next_item(db, "ada", "c1")
    assert out["item"]["concept_id"] == "k1"


@pytest.mark.asyncio
async def test_coach_pick_none_when_no_errors(db):
    """No concept has errors -> nothing eligible -> item None."""
    _seed_world(db)
    mastery.apply_evidence("k1", "correct", owner="ada", db=db)
    out = await gym.next_item(db, "ada", "c1")
    assert out["item"] is None
    assert out["difficulty"] == 2
    assert out["message"]


@pytest.mark.asyncio
async def test_explicit_concept_allows_unmastered_pick(db):
    """An explicitly picked concept is drilled even with no errors at all."""
    _seed_world(db)
    out = await gym.next_item(db, "ada", "c1", concept_id="k2")
    assert out["item"] is not None
    assert out["item"]["concept_id"] == "k2"


@pytest.mark.asyncio
async def test_explicit_unknown_concept_is_rejected(db):
    _seed_world(db)
    out = await gym.next_item(db, "ada", "c1", concept_id="nope")
    assert out["item"] is None
    assert out["message"]


# ------------------------------------------------------------- D5 adaptation

async def _mint(db, owner="ada", course_id="c1", concept_id="k1", difficulty=2):
    out = await gym.next_item(db, owner, course_id,
                              concept_id=concept_id, difficulty=difficulty)
    assert out["item"] is not None, "fixture should always mint a corpus item"
    return out["item"]["item_key"]


@pytest.mark.asyncio
async def test_two_correct_steps_difficulty_up(db):
    """2 consecutive correct -> +1 difficulty, streak reset to 0 (D5)."""
    _seed_world(db)
    mastery.apply_evidence("k1", "incorrect", owner="ada", db=db)

    key1 = await _mint(db, difficulty=2)
    r1 = await gym.grade(db, "ada", key1, answer_text="4",
                         difficulty=2, streak=0, attempted=0, correct=0)
    assert r1["verdict"] == "correct"
    assert r1["difficulty"] == 2                       # one correct: no step yet
    assert r1["streak"] == 1
    assert r1["summary"] == {"attempted": 1, "correct": 1,
                             "difficulty": 2, "streak": 1}

    key2 = await _mint(db, difficulty=r1["difficulty"])
    r2 = await gym.grade(db, "ada", key2, answer_text="4",
                         difficulty=r1["difficulty"], streak=r1["streak"],
                         attempted=r1["summary"]["attempted"],
                         correct=r1["summary"]["correct"])
    assert r2["verdict"] == "correct"
    assert r2["difficulty"] == 3                       # stepped up
    assert r2["streak"] == 0                           # reset after the step
    assert r2["summary"] == {"attempted": 2, "correct": 2,
                             "difficulty": 3, "streak": 0}


@pytest.mark.asyncio
async def test_two_wrong_steps_difficulty_down_with_citation(db):
    """2 consecutive wrong -> -1 difficulty, streak reset, study_citation set."""
    _seed_world(db)
    mastery.apply_evidence("k1", "incorrect", owner="ada", db=db)

    key1 = await _mint(db, difficulty=3)
    r1 = await gym.grade(db, "ada", key1, answer_text="99",
                         difficulty=3, streak=0, attempted=0, correct=0)
    assert r1["verdict"] == "incorrect"
    assert r1["difficulty"] == 3                       # one wrong: no step yet
    assert r1["streak"] == -1

    key2 = await _mint(db, difficulty=r1["difficulty"])
    r2 = await gym.grade(db, "ada", key2, answer_text="99",
                         difficulty=r1["difficulty"], streak=r1["streak"],
                         attempted=r1["summary"]["attempted"],
                         correct=r1["summary"]["correct"])
    assert r2["verdict"] == "incorrect"
    assert r2["difficulty"] == 2                       # stepped down
    assert r2["streak"] == 0
    # D5: the difficulty drop carries a study citation (the item's own).
    assert r2.get("study_citation") is not None
    assert r2["study_citation"].get("source_id") == "s1"
    assert r2["summary"] == {"attempted": 2, "correct": 0,
                             "difficulty": 2, "streak": 0}


@pytest.mark.asyncio
async def test_correct_after_wrong_resets_to_plus_one(db):
    """A correct verdict after a wrong run flips the signed streak to +1."""
    _seed_world(db)
    mastery.apply_evidence("k1", "incorrect", owner="ada", db=db)
    key = await _mint(db, difficulty=2)
    r = await gym.grade(db, "ada", key, answer_text="4",
                        difficulty=2, streak=-1, attempted=3, correct=1)
    assert r["verdict"] == "correct"
    assert r["streak"] == 1                            # not 0, not -1+1
    assert r["difficulty"] == 2
    assert r["summary"] == {"attempted": 4, "correct": 2,
                            "difficulty": 2, "streak": 1}


@pytest.mark.asyncio
async def test_difficulty_clamps_at_bounds(db):
    """+1 caps at 5, -1 floors at 1."""
    _seed_world(db)
    mastery.apply_evidence("k1", "incorrect", owner="ada", db=db)
    # at the ceiling: second correct would step to 6 -> clamp 5.
    key = await _mint(db, difficulty=5)
    r = await gym.grade(db, "ada", key, answer_text="4",
                        difficulty=5, streak=1, attempted=1, correct=1)
    assert r["difficulty"] == 5
    # at the floor: second wrong would step to 0 -> clamp 1.
    key2 = await _mint(db, difficulty=1)
    r2 = await gym.grade(db, "ada", key2, answer_text="99",
                         difficulty=1, streak=-1, attempted=1, correct=0)
    assert r2["difficulty"] == 1


@pytest.mark.asyncio
async def test_partial_nudges_neither(db):
    """A 'partial' verdict leaves difficulty and streak untouched (D5)."""
    _seed_world(db)
    mastery.apply_evidence("k1", "incorrect", owner="ada", db=db)
    key = await _mint(db, difficulty=3)

    # Force a 'partial' verdict deterministically (no LLM in this env).
    async def fake_grade(db_, owner, item_key, *, answer_text=None,
                         attachment_ids=None):
        return {"verdict": "partial", "correct": False,
                "feedback_short": "halfway there", "concept_id": "k1",
                "concept_name": "1.2 Sampling", "state": "shaky",
                "effective_p": 0.6}

    import src.practice.items as items_mod

    orig = items_mod.grade_answer
    try:
        items_mod.grade_answer = fake_grade
        r = await gym.grade(db, "ada", key, answer_text="maybe",
                            difficulty=3, streak=1, attempted=2, correct=1)
    finally:
        items_mod.grade_answer = orig

    assert r["verdict"] == "partial"
    assert r["difficulty"] == 3                        # unchanged
    assert r["streak"] == 1                            # unchanged
    assert r["summary"] == {"attempted": 3, "correct": 1,
                            "difficulty": 3, "streak": 1}


def test_adapt_unit_transitions():
    """Direct unit coverage of the signed-streak step machine."""
    cite = {"source_id": "s1"}
    # correct path
    assert gym._adapt("correct", 2, 0, cite) == (2, 1, None)
    assert gym._adapt("correct", 2, 1, cite) == (3, 0, None)      # step up
    assert gym._adapt("correct", 2, -3, cite) == (2, 1, None)     # flip sign
    # incorrect path
    assert gym._adapt("incorrect", 3, 0, cite) == (3, -1, None)
    assert gym._adapt("incorrect", 3, -1, cite) == (2, 0, cite)   # step down + cite
    assert gym._adapt("incorrect", 3, 5, cite) == (3, -1, None)   # flip sign
    # neutral verdicts
    assert gym._adapt("partial", 3, 2, cite) == (3, 2, None)
    assert gym._adapt("ungraded", 3, -1, cite) == (3, -1, None)
