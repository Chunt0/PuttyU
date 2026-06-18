"""
test_practice_exam.py — the exam simulation (src/practice/exam.py, SPEC F8, D9).

Covers:
  * start() assembles up to n items, mixed across headings, prompts ONLY (no
    reference answers in the payload) + persists state with the grading keys
    hidden behind the per-item store keys.
  * start() is silent — no grading happens at assembly.
  * submit() grades answered items (writing evidence context.source=exam),
    marks unanswered items 'skipped' (writing NO evidence), and returns a
    debrief with the correct counts + a readiness narrative.
  * submit() on a missing/expired exam returns {error:"expired"} (no raise),
    and stamps submitted_at on submit.

The LLM is mostly never hit: graded items use the no-LLM string-match path
(seeded corpus exercises with reference answers). One test mocks items._grade_llm
to exercise the partial verdict + the mixed-count debrief. The store path is
patched per the T4 contract §3; the graph + corpus ride an isolated DB.
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
from src.graph.models import ConceptNode, MasteryEvidence
from src.practice import exam, items, store


@pytest.fixture
def db(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'g.db'}")
    cdb.Base.metadata.create_all(engine)
    maker = sessionmaker(bind=engine)
    monkeypatch.setattr(cdb, "SessionLocal", maker)
    monkeypatch.setattr("src.practice.store.STORE_PATH",
                        str(tmp_path / "practice_keys.json"))
    sess = maker()
    yield sess
    sess.close()


# Three chapters, two concepts each — so the mixed-topic spread is observable.
_CONCEPTS = [
    ("k0", "1.1 Definitions", "Chapter 1"),
    ("k1", "1.2 Sampling", "Chapter 1"),
    ("k2", "2.1 Mean", "Chapter 2"),
    ("k3", "2.2 Variance", "Chapter 2"),
    ("k4", "3.1 Probability", "Chapter 3"),
    ("k5", "3.2 Distributions", "Chapter 3"),
]


def _seed_world(db, owner="ada", course_id="c1"):
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
    # An EXERCISE chunk per concept, each with a splittable reference answer so
    # the no-LLM string match can grade them deterministically.
    for i, (cid, name, chapter) in enumerate(_CONCEPTS):
        db.add(CorpusChunk(
            id=f"s1:{100 + i}", source_id="s1", ordinal=100 + i,
            kind=Kind.EXERCISE, heading_path=[chapter, name],
            text=f"Question for {name}: what is the answer?\n\nAnswer:\n{cid}-ans",
            content_hash=f"hc{i}"))
    db.commit()
    # Give every concept evidence + keep them non-mastered so due_concepts
    # surfaces all of them (D3 candidate rule).
    for cid, _, _ in _CONCEPTS:
        mastery.apply_evidence(cid, "incorrect", owner=owner, db=db)


# ----------------------------------------------------------------------- start

@pytest.mark.asyncio
async def test_start_assembles_items_with_no_reference_answers(db):
    """A practice exam assembles from real course material — prompts only."""
    _seed_world(db)
    res = await exam.start(db, "ada", "c1", duration_seconds=1800, n_items=4)

    assert res["exam_key"]
    assert res["duration_seconds"] == 1800
    assert res["started_at"]
    assert len(res["items"]) == 4
    for it in res["items"]:
        assert it["item_key"] and it["concept_id"] and it["prompt"]
        # The grading key NEVER rides the start payload (D9).
        assert "reference_answer" not in it
        # The split stripped the solution out of the prompt.
        assert "Answer:" not in it["prompt"]
        assert "-ans" not in it["prompt"]


@pytest.mark.asyncio
async def test_start_persists_state_with_grading_keys_hidden(db):
    """Exam state persists in the store; reference answers live ONLY in the
    per-item keys, never in the exam record itself."""
    _seed_world(db)
    res = await exam.start(db, "ada", "c1", n_items=3)

    stored = store.get("exams", res["exam_key"])
    assert stored is not None
    assert stored["course_id"] == "c1" and stored["owner"] == "ada"
    assert stored["started_at"] == res["started_at"]
    assert "submitted_at" not in stored
    assert len(stored["items"]) == 3
    for ex_item in stored["items"]:
        # Persisted exam state carries the LINK, not the answer.
        assert "reference_answer" not in ex_item
        # The reference answer lives behind the per-item store key.
        per_item = store.get("items", ex_item["item_key"])
        assert per_item is not None
        assert per_item["reference_answer"].endswith("-ans")
        assert per_item["mode"] == "exam"


@pytest.mark.asyncio
async def test_start_is_mixed_topic_not_all_one_heading(db):
    """The set spreads across headings rather than draining one chapter."""
    _seed_world(db)
    res = await exam.start(db, "ada", "c1", n_items=3)
    headings = set()
    for it in res["items"]:
        cite = it.get("citation") or {}
        headings.add(cite.get("heading") or it["concept_id"])
    # Three items round-robined across three chapters -> three distinct areas.
    assert len(headings) == 3


@pytest.mark.asyncio
async def test_start_dry_region_returns_empty_with_message(db):
    """No corpus items + no LLM -> empty exam with an explanatory message."""
    # Course + concepts with evidence, but NO exercise chunks and no LLM.
    db.add(Course(id="c1", name="Bare", owner="ada", settings="{}"))
    db.add(CorpusSource(id="s1", source_type="textbook", title="Bare",
                        content_hash="h", status="ready"))
    db.add(CourseSource(course_id="c1", source_id="s1"))
    db.add(ConceptNode(id="k0", name="Topic", normalized_name="topic",
                       source_id="s1", owner="ada", heading_path=["Ch", "Topic"],
                       meta={"sources": ["s1"], "ordinal": 0}))
    db.commit()
    mastery.apply_evidence("k0", "incorrect", owner="ada", db=db)

    res = await exam.start(db, "ada", "c1", n_items=5)
    assert res["items"] == []
    assert res["message"]
    # State is still persisted (so a later submit returns the no-items debrief).
    assert store.get("exams", res["exam_key"]) is not None


# ---------------------------------------------------------------------- submit

@pytest.mark.asyncio
async def test_submit_grades_answered_marks_skipped_writes_exam_evidence(db):
    """The debrief: answered graded (evidence source=exam), unanswered skipped
    (no evidence), correct counts + a readiness narrative."""
    _seed_world(db)
    res = await exam.start(db, "ada", "c1", n_items=4)
    exam_items = res["items"]

    # Answer the first two correctly (matching the seeded "<cid>-ans"),
    # the third wrong, leave the fourth unanswered.
    answers = []
    for it in exam_items[:2]:
        answers.append({"item_key": it["item_key"],
                        "answer_text": f"{it['concept_id']}-ans"})
    answers.append({"item_key": exam_items[2]["item_key"],
                    "answer_text": "totally wrong"})
    # exam_items[3] omitted -> skipped.

    debrief = await exam.submit(db, "ada", res["exam_key"], answers)

    assert debrief["total"] == 4
    assert debrief["correct"] == 2
    assert debrief["incorrect"] == 1
    assert debrief["skipped"] == 1
    assert debrief["readiness"]

    # Per-item verdicts line up.
    by_key = {v["item_key"]: v for v in debrief["verdicts"]}
    assert by_key[exam_items[0]["item_key"]]["verdict"] == "correct"
    assert by_key[exam_items[2]["item_key"]]["verdict"] == "incorrect"
    skipped = by_key[exam_items[3]["item_key"]]
    assert skipped["verdict"] == "skipped"
    assert skipped["correct"] is False
    assert skipped["state"] is None        # no grade ran

    # Evidence from the graded items is stamped source=exam (D2).
    exam_rows = (db.query(MasteryEvidence)
                 .filter(MasteryEvidence.owner == "ada").all())
    exam_sourced = [r for r in exam_rows
                    if (r.context or {}).get("source") == "exam"]
    assert len(exam_sourced) == 3          # 2 correct + 1 incorrect, NOT skipped

    # The skipped item's concept got NO exam evidence row.
    skipped_cid = exam_items[3]["concept_id"]
    assert not any(r.concept_id == skipped_cid for r in exam_sourced)


@pytest.mark.asyncio
async def test_submit_silent_until_submit_start_writes_no_evidence(db):
    """The tutor stays SILENT until submission — start() grades nothing."""
    _seed_world(db)
    before = db.query(MasteryEvidence).count()
    await exam.start(db, "ada", "c1", n_items=4)
    after = db.query(MasteryEvidence).count()
    assert after == before            # assembling an exam writes no new evidence


@pytest.mark.asyncio
async def test_submit_stamps_submitted_at(db):
    _seed_world(db)
    res = await exam.start(db, "ada", "c1", n_items=2)
    assert "submitted_at" not in store.get("exams", res["exam_key"])
    await exam.submit(db, "ada", res["exam_key"], [])
    assert store.get("exams", res["exam_key"]).get("submitted_at")


@pytest.mark.asyncio
async def test_submit_is_idempotent_second_submit_grades_nothing(db):
    """H2: submitting an exam twice grades NOTHING the second time and writes no
    additional exam evidence (the first submit already consumed the items)."""
    _seed_world(db)
    res = await exam.start(db, "ada", "c1", n_items=4)
    exam_items = res["items"]
    answers = [{"item_key": it["item_key"],
                "answer_text": f"{it['concept_id']}-ans"} for it in exam_items]

    first = await exam.submit(db, "ada", res["exam_key"], answers)
    assert first["total"] == 4 and first["correct"] == 4
    evidence_after_first = (db.query(MasteryEvidence)
                            .filter(MasteryEvidence.owner == "ada").count())

    second = await exam.submit(db, "ada", res["exam_key"], answers)
    # Second submit re-grades nothing: empty debrief, already-submitted message.
    assert second["total"] == 0
    assert second["verdicts"] == []
    assert second["correct"] == 0
    assert "already submitted" in second["readiness"].lower()
    # And it satisfies the typed response contract.
    from src.practice.schemas import ExamSubmitResponse
    ExamSubmitResponse.model_validate(second)
    # No additional exam evidence was written.
    evidence_after_second = (db.query(MasteryEvidence)
                             .filter(MasteryEvidence.owner == "ada").count())
    assert evidence_after_second == evidence_after_first


@pytest.mark.asyncio
async def test_submit_expired_exam_returns_error_no_raise(db):
    out = await exam.submit(db, "ada", "no-such-exam", [])
    assert out["error"] == "expired"
    assert out["total"] == 0
    assert out["verdicts"] == []
    assert out["readiness"]


@pytest.mark.asyncio
async def test_submit_partial_verdict_via_mocked_llm(db, monkeypatch):
    """Mixed-count debrief with a partial verdict (LLM-graded path)."""
    _seed_world(db)
    res = await exam.start(db, "ada", "c1", n_items=3)
    exam_items = res["items"]

    # Mock the grading LLM to return a fixed sequence of verdicts.
    seq = iter([
        {"verdict": "correct", "feedback_short": "Spot on."},
        {"verdict": "partial", "feedback_short": "Half right."},
        {"verdict": "incorrect", "feedback_short": "Review this."},
    ])

    async def fake_grade_llm(owner, item, answer_text, image_blocks):
        return next(seq)

    monkeypatch.setattr(items, "_grade_llm", fake_grade_llm)

    answers = [{"item_key": it["item_key"], "answer_text": "x"}
               for it in exam_items]
    debrief = await exam.submit(db, "ada", res["exam_key"], answers)

    assert debrief["total"] == 3
    assert debrief["correct"] == 1
    assert debrief["partial"] == 1
    assert debrief["incorrect"] == 1
    assert debrief["skipped"] == 0
    verdicts = [v["verdict"] for v in debrief["verdicts"]]
    assert verdicts == ["correct", "partial", "incorrect"]

    # The partial item wrote a 'partial' evidence row, source=exam (D1/D2).
    partial_rows = (db.query(MasteryEvidence)
                    .filter(MasteryEvidence.signal == "partial").all())
    assert any((r.context or {}).get("source") == "exam" for r in partial_rows)


def test_spread_pick_round_robins_across_headings():
    """Unit: the spread step interleaves headings, weakest-first within each."""
    ranked = [
        {"concept_id": "a1", "name": "a1", "heading_path": ["A", "a1"]},
        {"concept_id": "a2", "name": "a2", "heading_path": ["A", "a2"]},
        {"concept_id": "b1", "name": "b1", "heading_path": ["B", "b1"]},
        {"concept_id": "c1", "name": "c1", "heading_path": ["C", "c1"]},
    ]
    picked = exam._spread_pick(ranked, 3)
    headings = [exam._heading_key(p) for p in picked]
    # First pass takes one from each of A, B, C before A's second concept.
    assert headings == ["A", "B", "C"]
    # n bigger than the pool returns everything.
    assert len(exam._spread_pick(ranked, 10)) == 4
    assert exam._spread_pick(ranked, 0) == []
    assert exam._spread_pick([], 5) == []
