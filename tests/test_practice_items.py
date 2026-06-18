"""
test_practice_items.py — the core practice engine (src/practice/items.py).

Covers:
  * due_concepts ranking + the D3 candidate rule (never-seen excluded, mastered
    excluded) + D4 exam-aware lift (seeded calendar event).
  * item_for_concept sourcing from a seeded EXERCISE chunk incl. the
    reference-answer split, and the no-LLM None generation path.
  * grade_answer no-LLM string-match path + verdict->evidence write +
    the expired-key path.

The LLM is never hit: the no-LLM paths rely on model_router resolving to an empty
endpoint (no providers configured in the isolated DB). The store path is patched
per the T4 contract §3; the graph rides an isolated in-memory DB.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import core.database as cdb
from core.database import (
    CalendarCal, CalendarEvent, Course, CourseSource, utcnow_naive,
)
from src.corpus.models import CorpusChunk, CorpusSource
from src.corpus.records import Kind
from src.graph import mastery, queries
from src.graph.models import ConceptNode
from src.practice import items


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


def _seed_world(db, owner="ada", course_id="c1"):
    db.add(Course(id=course_id, name="AP Statistics", owner=owner, settings="{}"))
    db.add(CorpusSource(id="s1", source_type="textbook", title="Intro Stats",
                        content_hash="h", status="ready"))
    db.add(CourseSource(course_id=course_id, source_id="s1"))
    for i, name in enumerate(["1.1 Definitions", "1.2 Sampling", "1.3 Frequency"]):
        db.add(ConceptNode(id=f"k{i}", name=name, normalized_name=name.lower(),
                           source_id="s1", owner=owner,
                           heading_path=["Chapter 1", name],
                           meta={"sources": ["s1"], "ordinal": i}))
    db.commit()


# ----------------------------------------------------------------- due_concepts

def test_due_concepts_candidate_rule(db):
    """D3: never-seen excluded; mastered excluded; only evidenced+non-mastered."""
    _seed_world(db)
    # k0: mastered (override) -> excluded. k1: has evidence, non-mastered ->
    # candidate. k2: never-seen -> excluded.
    mastery.apply_evidence("k0", "override_known", owner="ada", db=db)
    mastery.apply_evidence("k1", "incorrect", owner="ada", db=db)
    due = items.due_concepts(db, "ada", "c1")
    ids = [d["concept_id"] for d in due]
    assert ids == ["k1"]
    assert due[0]["score"] > 0
    assert due[0]["course_id"] == "c1"


def test_due_concepts_ranks_weaker_higher(db):
    _seed_world(db)
    # k1 wrong (weaker) should outrank k2 partially-right.
    mastery.apply_evidence("k1", "incorrect", owner="ada", db=db)
    mastery.apply_evidence("k2", "partial", owner="ada", db=db)
    due = items.due_concepts(db, "ada", "c1")
    ids = [d["concept_id"] for d in due]
    assert set(ids) == {"k1", "k2"}
    assert ids[0] == "k1"          # weaker ranked first


def test_due_concepts_exam_lift(db):
    """D4: an exam-like calendar event within 14 days multiplies the score."""
    _seed_world(db)
    mastery.apply_evidence("k1", "incorrect", owner="ada", db=db)
    base = items.due_concepts(db, "ada", "c1")[0]["score"]

    db.add(CalendarCal(id="cal1", owner="ada", name="Personal"))
    db.add(CalendarEvent(uid="ev1", calendar_id="cal1", summary="Midterm Exam",
                         dtstart=utcnow_naive() + timedelta(days=3),
                         dtend=utcnow_naive() + timedelta(days=3, hours=2),
                         status="confirmed", course_id="c1"))
    db.commit()
    lifted = items.due_concepts(db, "ada", "c1")[0]["score"]
    assert lifted == pytest.approx(base * items.EXAM_LIFT, rel=1e-6)


def test_due_concepts_no_lift_for_unrelated_event(db):
    _seed_world(db)
    mastery.apply_evidence("k1", "incorrect", owner="ada", db=db)
    base = items.due_concepts(db, "ada", "c1")[0]["score"]
    db.add(CalendarCal(id="cal1", owner="ada", name="Personal"))
    db.add(CalendarEvent(uid="ev1", calendar_id="cal1", summary="Study group",
                         dtstart=utcnow_naive() + timedelta(days=3),
                         dtend=utcnow_naive() + timedelta(days=3, hours=2),
                         status="confirmed", course_id="c1"))
    db.commit()
    assert items.due_concepts(db, "ada", "c1")[0]["score"] == pytest.approx(base)


def test_due_concepts_empty_when_no_courses(db):
    # No course seeded -> nothing to do.
    assert items.due_concepts(db, "ada", "c1") == []


# ------------------------------------------------------------- item_for_concept

@pytest.mark.asyncio
async def test_item_for_concept_from_corpus_splits_reference(db):
    _seed_world(db)
    db.add(CorpusChunk(
        id="s1:5", source_id="s1", ordinal=5, kind=Kind.EXERCISE,
        heading_path=["Chapter 1", "1.2 Sampling"],
        text="Compute the mean of 2, 4, 6.\n\nSolution:\nThe mean is 4.",
        content_hash="hc"))
    db.commit()
    concept = queries.concept_brief(db, "k1", "ada")
    concept["course_id"] = "c1"
    item = await items.item_for_concept(db, "ada", concept, mode="review")
    assert item is not None
    assert item["source"] == "corpus"
    assert "Compute the mean" in item["prompt"]
    assert "Solution" not in item["prompt"]        # split off the reference
    assert "reference_answer" not in item          # never leaks to the client
    assert item["citation"]["source_id"] == "s1"
    assert "text" not in item["citation"]
    # The reference answer lives in the store, keyed by item_key.
    from src.practice import store
    stored = store.get("items", item["item_key"])
    assert "The mean is 4." in stored["reference_answer"]


@pytest.mark.asyncio
async def test_item_for_concept_no_split_whole_text_is_prompt(db):
    _seed_world(db)
    db.add(CorpusChunk(
        id="s1:6", source_id="s1", ordinal=6, kind=Kind.TRY_IT,
        heading_path=["Chapter 1", "1.2 Sampling"],
        text="Try it: list three sampling methods.", content_hash="hc2"))
    db.commit()
    concept = queries.concept_brief(db, "k1", "ada")
    concept["course_id"] = "c1"
    item = await items.item_for_concept(db, "ada", concept, mode="gym")
    assert item["source"] == "corpus"
    assert "three sampling methods" in item["prompt"]
    from src.practice import store
    assert store.get("items", item["item_key"])["reference_answer"] == ""


@pytest.mark.asyncio
async def test_item_for_concept_returns_none_without_corpus_or_llm(db):
    """No corpus exercise + no LLM configured -> None (D6 dry-library path)."""
    _seed_world(db)
    concept = queries.concept_brief(db, "k1", "ada")
    concept["course_id"] = "c1"
    item = await items.item_for_concept(db, "ada", concept, mode="review")
    assert item is None


# -------------------------------------------------------------- grade_answer

@pytest.mark.asyncio
async def test_grade_answer_string_match_correct_writes_evidence(db):
    _seed_world(db)
    db.add(CorpusChunk(
        id="s1:5", source_id="s1", ordinal=5, kind=Kind.EXERCISE,
        heading_path=["Chapter 1", "1.2 Sampling"],
        text="What is 2 + 2?\n\nAnswer:\n4", content_hash="hc"))
    db.commit()
    concept = queries.concept_brief(db, "k1", "ada")
    concept["course_id"] = "c1"
    item = await items.item_for_concept(db, "ada", concept, mode="review")

    result = await items.grade_answer(db, "ada", item["item_key"], answer_text="4")
    assert result["verdict"] == "correct"
    assert result["correct"] is True
    assert result["concept_id"] == "k1"
    assert result["state"] in ("learning", "shaky", "mastered")
    # D1/D2: a 'correct' verdict wrote a 'correct' evidence row, source=review.
    s, ep, last = queries.states_for(db, ["k1"])["k1"]
    assert ep is not None and last is not None
    assert queries.error_counts(db, ["k1"], "ada").get("k1", 0) == 0


@pytest.mark.asyncio
async def test_grade_answer_string_match_incorrect_writes_error(db):
    _seed_world(db)
    db.add(CorpusChunk(
        id="s1:5", source_id="s1", ordinal=5, kind=Kind.EXERCISE,
        heading_path=["Chapter 1", "1.2 Sampling"],
        text="What is 2 + 2?\n\nAnswer:\n4", content_hash="hc"))
    db.commit()
    concept = queries.concept_brief(db, "k1", "ada")
    concept["course_id"] = "c1"
    item = await items.item_for_concept(db, "ada", concept, mode="gym")

    result = await items.grade_answer(db, "ada", item["item_key"], answer_text="17")
    assert result["verdict"] == "incorrect"
    assert result["correct"] is False
    # The study citation falls back to the item's own citation on a miss.
    assert result.get("study_citation", {}).get("source_id") == "s1"
    assert queries.error_counts(db, ["k1"], "ada").get("k1") == 1


@pytest.mark.asyncio
async def test_grade_answer_ungraded_writes_no_evidence(db):
    """No reference answer + no LLM -> 'ungraded', NO evidence row (D7)."""
    _seed_world(db)
    db.add(CorpusChunk(
        id="s1:6", source_id="s1", ordinal=6, kind=Kind.TRY_IT,
        heading_path=["Chapter 1", "1.2 Sampling"],
        text="Explain sampling in your own words.", content_hash="hc2"))
    db.commit()
    concept = queries.concept_brief(db, "k1", "ada")
    concept["course_id"] = "c1"
    item = await items.item_for_concept(db, "ada", concept, mode="review")

    result = await items.grade_answer(db, "ada", item["item_key"],
                                      answer_text="some words")
    assert result["verdict"] == "ungraded"
    # No evidence was written: state stays unknown.
    assert queries.states_for(db, ["k1"])["k1"] == ("unknown", None, None)


@pytest.mark.asyncio
async def test_grade_answer_expired_key(db):
    result = await items.grade_answer(db, "ada", "no-such-key", answer_text="x")
    assert result["verdict"] == "expired"
    assert result["correct"] is False
    assert result["concept_id"] is None


# --------------------------------------------------------- H1: consume on grade

@pytest.mark.asyncio
async def test_grade_answer_consumes_item_no_double_write(db):
    """H1: a graded item is consumed — a SECOND grade of the same key returns
    'expired' and writes NO additional mastery evidence (no double-write)."""
    from src.graph.models import MasteryEvidence
    _seed_world(db)
    db.add(CorpusChunk(
        id="s1:5", source_id="s1", ordinal=5, kind=Kind.EXERCISE,
        heading_path=["Chapter 1", "1.2 Sampling"],
        text="What is 2 + 2?\n\nAnswer:\n4", content_hash="hc"))
    db.commit()
    concept = queries.concept_brief(db, "k1", "ada")
    concept["course_id"] = "c1"
    item = await items.item_for_concept(db, "ada", concept, mode="review")

    first = await items.grade_answer(db, "ada", item["item_key"], answer_text="4")
    assert first["verdict"] == "correct"
    rows_after_first = (db.query(MasteryEvidence)
                        .filter(MasteryEvidence.concept_id == "k1").count())
    assert rows_after_first == 1

    second = await items.grade_answer(db, "ada", item["item_key"], answer_text="4")
    assert second["verdict"] == "expired"
    rows_after_second = (db.query(MasteryEvidence)
                         .filter(MasteryEvidence.concept_id == "k1").count())
    assert rows_after_second == 1          # NO second evidence row


@pytest.mark.asyncio
async def test_grade_answer_ungraded_not_consumed_allows_retry(db):
    """H1: 'ungraded' wrote no evidence -> the item is NOT consumed (retry ok)."""
    _seed_world(db)
    db.add(CorpusChunk(
        id="s1:6", source_id="s1", ordinal=6, kind=Kind.TRY_IT,
        heading_path=["Chapter 1", "1.2 Sampling"],
        text="Explain sampling in your own words.", content_hash="hc2"))
    db.commit()
    concept = queries.concept_brief(db, "k1", "ada")
    concept["course_id"] = "c1"
    item = await items.item_for_concept(db, "ada", concept, mode="review")

    r1 = await items.grade_answer(db, "ada", item["item_key"], answer_text="x")
    assert r1["verdict"] == "ungraded"
    from src.practice import store
    assert store.get("items", item["item_key"]) is not None   # still retryable


# ----------------------------------------- H4: string study_citation is safe

@pytest.mark.asyncio
async def test_grade_answer_string_study_citation_is_never_malformed(db, monkeypatch):
    """H4: an LLM that returns study_citation as a free-text STRING must not
    produce a malformed Citation — study_citation is None or a valid Citation,
    and the result validates against AnswerResponse (no 500)."""
    from src.practice import schemas
    _seed_world(db)
    db.add(CorpusChunk(
        id="s1:5", source_id="s1", ordinal=5, kind=Kind.EXERCISE,
        heading_path=["Chapter 1", "1.2 Sampling"],
        text="What is 2 + 2?\n\nAnswer:\n4", content_hash="hc"))
    db.commit()
    concept = queries.concept_brief(db, "k1", "ada")
    concept["course_id"] = "c1"
    item = await items.item_for_concept(db, "ada", concept, mode="review")

    async def fake_grade_llm(owner, it, answer_text, image_blocks):
        return {"verdict": "incorrect", "feedback_short": "Not quite.",
                "study_citation": "review chapter 3"}
    monkeypatch.setattr(items, "_grade_llm", fake_grade_llm)

    result = await items.grade_answer(db, "ada", item["item_key"], answer_text="5")
    # Validates against the typed response (would raise on a malformed Citation).
    schemas.AnswerResponse.model_validate(result)
    sc = result.get("study_citation")
    assert sc is None or (isinstance(sc, dict)
                          and {"chunk_id", "source_id", "title"} <= set(sc))
    # The free-text hint rode feedback / study_hint, never the Citation field.
    assert "review chapter 3" in (result.get("feedback_short", "")
                                  + result.get("study_hint", ""))


# ----------------------------------------------------- L4: owner check on grade

@pytest.mark.asyncio
async def test_grade_answer_rejects_foreign_owner(db):
    """L4: a stored item owned by someone else grades as 'expired' (not found),
    writing no evidence for the caller."""
    _seed_world(db)
    db.add(CorpusChunk(
        id="s1:5", source_id="s1", ordinal=5, kind=Kind.EXERCISE,
        heading_path=["Chapter 1", "1.2 Sampling"],
        text="What is 2 + 2?\n\nAnswer:\n4", content_hash="hc"))
    db.commit()
    concept = queries.concept_brief(db, "k1", "ada")
    concept["course_id"] = "c1"
    item = await items.item_for_concept(db, "ada", concept, mode="review")

    result = await items.grade_answer(db, "mallory", item["item_key"],
                                      answer_text="4")
    assert result["verdict"] == "expired"
    assert result["concept_id"] is None


# ------------------------------------------ L3: answer-at-top chunk is skipped

@pytest.mark.asyncio
async def test_item_for_concept_skips_answer_at_top_chunk(db):
    """L3: a chunk whose Answer heading is at the very top is skipped (never
    shipped as the prompt); a later clean exercise is used instead."""
    _seed_world(db)
    # First (lower ordinal) chunk: heading at the very top -> must be skipped.
    db.add(CorpusChunk(
        id="s1:4", source_id="s1", ordinal=4, kind=Kind.EXERCISE,
        heading_path=["Chapter 1", "1.2 Sampling"],
        text="Answer:\nThe sample mean is 4.", content_hash="bad"))
    # Second chunk: a normal exercise with a clean prompt.
    db.add(CorpusChunk(
        id="s1:5", source_id="s1", ordinal=5, kind=Kind.EXERCISE,
        heading_path=["Chapter 1", "1.2 Sampling"],
        text="Compute the mean of 2, 4, 6.\n\nSolution:\nThe mean is 4.",
        content_hash="ok"))
    db.commit()
    concept = queries.concept_brief(db, "k1", "ada")
    concept["course_id"] = "c1"
    item = await items.item_for_concept(db, "ada", concept, mode="review")
    assert item is not None
    assert "Compute the mean" in item["prompt"]
    assert "The sample mean is 4." not in item["prompt"]   # answer never the Q


def test_split_reference_answer_helper():
    prompt, ans = items._split_reference_answer(
        "Question text here\n\nSolution:\nThe worked answer.")
    assert prompt == "Question text here"
    assert ans == "The worked answer."
    # No heading -> whole text is the prompt, no reference.
    p2, a2 = items._split_reference_answer("Just a question, no solution.")
    assert p2 == "Just a question, no solution." and a2 == ""
    # L3: a Solution/Answer heading at the very TOP yields an EMPTY prompt so the
    # answer-bearing text is never shipped as the question.
    p3, a3 = items._split_reference_answer("Answer:\nThe answer is 42.")
    assert p3 == "" and "42" in a3


def test_grade_string_helper():
    # L2: exact normalized equality is the ONLY 'correct'; no token-subset pass.
    assert items._grade_string("4", "4") == "correct"
    assert items._grade_string(" 4 ", "4") == "correct"             # whitespace
    assert items._grade_string("the answer is 4", "4") == "incorrect"  # NOT subset
    assert items._grade_string("not 4", "4") == "incorrect"         # the false-pass bug
    assert items._grade_string("99", "4") == "incorrect"
    assert items._grade_string("4", "") == "ungraded"               # no key
    assert items._grade_string("", "4") == "incorrect"              # blank answer
    # L2: internal punctuation is stripped so "Paris, France" tokenizes cleanly.
    assert items._grade_string("Paris, France", "paris france") == "correct"
    assert items._grade_string("paris", "Paris, France") == "incorrect"
