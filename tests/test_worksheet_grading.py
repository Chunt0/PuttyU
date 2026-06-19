"""
test_worksheet_grading.py — worksheet grading depth (src/practice/items.py
grade_worksheet, SPEC F4 / T6a).

Direct engine calls against an isolated temp sqlite DB with a MOCKED vision LLM
(never a live provider). Covers CONTRACT D1-D3:
  * per-problem verdicts are parsed;
  * the incorrect problem writes a source="worksheet" evidence row carrying the
    error_pattern + an "upload" episode_ref, for the RESOLVED concept;
  * a problem whose concept does NOT match a region node is DROPPED (no evidence);
  * after grading, the incorrect concept now surfaces in due_concepts (the
    DECLARATIVE follow-up — no enqueue API);
  * RouterError (no VL model) -> setup_hint, no evidence, never grade blind;
  * the guide flag is honored in the prompt (nudge vs state-the-fix).

The LLM is mocked: model_router.resolve is repointed at a usable RoutedModel and
src.llm_core.llm_call_async returns canned JSON. _resolve_image_data_uris is
patched to a non-empty block list so the vision call path runs without uploads.
"""

from __future__ import annotations

import asyncio
import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import core.database as cdb
from core.database import Course, CourseSource
from src.corpus.models import CorpusSource
from src.graph import queries
from src.graph.models import ConceptNode, MasteryEvidence
from src.practice import items
from src.practice import schemas

OWNER = "ada"
COURSE_ID = "c1"


@pytest.fixture
def db(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'g.db'}")
    cdb.Base.metadata.create_all(engine)
    # The corpus + graph tables live on subsystem metadata that core.database's
    # create_all only covers when those modules are imported first; create them
    # explicitly via the production one-door helpers so this test is immune to
    # other modules' import-order contamination of the shared metadata.
    from src.corpus.models import ensure_corpus_tables
    from src.graph.models import ensure_graph_tables
    ensure_corpus_tables(bind=engine)
    ensure_graph_tables(bind=engine)
    maker = sessionmaker(bind=engine)
    monkeypatch.setattr(cdb, "SessionLocal", maker)
    sess = maker()
    yield sess
    sess.close()


def _seed_world(db, owner=OWNER, course_id=COURSE_ID):
    """One course -> one source -> two concepts in the region."""
    db.add(Course(id=course_id, name="AP Statistics", owner=owner, settings="{}"))
    db.add(CorpusSource(id="s1", source_type="textbook", title="Intro Stats",
                        content_hash="h", status="ready"))
    db.add(CourseSource(course_id=course_id, source_id="s1"))
    for i, name in enumerate(["Sampling Distributions", "Confidence Intervals"]):
        db.add(ConceptNode(id=f"k{i}", name=name, normalized_name=name.lower(),
                           source_id="s1", owner=owner,
                           heading_path=["Chapter 7", name],
                           meta={"sources": ["s1"], "ordinal": i}))
    db.commit()


def _routed(url="http://llm/v1/chat/completions", model="vl"):
    from src.model_router import RoutedModel
    return RoutedModel(endpoint_id="e1", model=model, token_budget=8192,
                       why="test", endpoint_url=url, headers={})


# A canned worksheet response: problem 1 correct (matched concept), problem 2
# incorrect (matched concept + error_pattern), problem 3 incorrect but its
# concept does NOT match any region node -> must be DROPPED.
_CANNED = {
    "problems": [
        {"problem_label": "1", "verdict": "correct",
         "whats_right": "You set up the sampling distribution correctly.",
         "first_error": "", "nudge_question": "",
         "concept": "Sampling Distributions", "error_pattern": ""},
        {"problem_label": "2", "verdict": "incorrect",
         "whats_right": "You picked the right formula.",
         "first_error": "You used the sample SD instead of the standard error.",
         "nudge_question": "What divides the SD to get the standard error?",
         "concept": "Confidence Intervals", "error_pattern": "se_vs_sd"},
        {"problem_label": "3", "verdict": "incorrect",
         "whats_right": "", "first_error": "Wrong distribution.",
         "nudge_question": "Which distribution applies here?",
         "concept": "Bayesian Inference", "error_pattern": "wrong_dist"},
    ]
}


def _patch_llm(monkeypatch, payload=None, routed=None, capture=None):
    payload = json.dumps(payload if payload is not None else _CANNED)
    routed = routed or _routed()
    import src.model_router as mr
    monkeypatch.setattr(mr, "resolve", lambda *a, **k: routed)

    async def _fake_call(url, model, messages, **kw):
        if capture is not None:
            capture["messages"] = messages
        return payload

    monkeypatch.setattr("src.llm_core.llm_call_async", _fake_call)
    # A worksheet always has image(s); skip the real upload door in unit tests.
    monkeypatch.setattr(items, "_resolve_image_data_uris",
                        lambda owner, ids: [{"type": "image_url",
                                             "image_url": {"url": "data:image/png;base64,xx"}}])


def _grade(db, **kw):
    kw.setdefault("attachment_ids", ["up1"])
    return asyncio.run(items.grade_worksheet(db, OWNER, COURSE_ID, **kw))


# --------------------------------------------------------------------------- #
# Per-problem verdicts + evidence + concept resolution                        #
# --------------------------------------------------------------------------- #
def test_parses_per_problem_verdicts(db, monkeypatch):
    _seed_world(db)
    _patch_llm(monkeypatch)
    out = _grade(db)
    # Validates against the typed response (a malformed Citation would raise).
    schemas.WorksheetGradeResponse.model_validate(out)
    labels = [p["problem_label"] for p in out["problems"]]
    # Problems 1 and 2 (matched concepts) survive; problem 3 is dropped.
    assert labels == ["1", "2"]
    by_label = {p["problem_label"]: p for p in out["problems"]}
    assert by_label["1"]["verdict"] == "correct"
    assert by_label["2"]["verdict"] == "incorrect"
    assert "standard error" in by_label["2"]["first_error"]
    assert by_label["2"]["concept_name"] == "Confidence Intervals"
    assert by_label["2"]["state"] in ("learning", "shaky", "mastered")


def test_incorrect_problem_writes_worksheet_evidence(db, monkeypatch):
    _seed_world(db)
    _patch_llm(monkeypatch)
    _grade(db)
    rows = (db.query(MasteryEvidence)
            .filter(MasteryEvidence.concept_id == "k1").all())  # Confidence Intervals
    assert len(rows) == 1
    ev = rows[0]
    assert ev.signal == "incorrect"
    assert ev.owner == OWNER
    assert (ev.context or {}).get("source") == "worksheet"
    assert (ev.context or {}).get("error_pattern") == "se_vs_sd"
    assert (ev.episode_ref or {}).get("type") == "upload"
    assert (ev.episode_ref or {}).get("id") == "up1"


def test_correct_problem_also_writes_evidence(db, monkeypatch):
    _seed_world(db)
    _patch_llm(monkeypatch)
    out = _grade(db)
    rows = (db.query(MasteryEvidence)
            .filter(MasteryEvidence.concept_id == "k0").all())  # Sampling Distributions
    assert len(rows) == 1 and rows[0].signal == "correct"
    # Both resolved concepts touched (correct + incorrect), the unmatched one not.
    assert set(out["concepts_touched"]) == {
        "Sampling Distributions", "Confidence Intervals"}


def test_unmatched_concept_problem_is_dropped(db, monkeypatch):
    _seed_world(db)
    _patch_llm(monkeypatch)
    out = _grade(db)
    # No region node named "Bayesian Inference" -> problem 3 dropped, no evidence.
    names = {p["concept_name"] for p in out["problems"]}
    assert "Bayesian Inference" not in names
    assert "Bayesian Inference" not in out["concepts_touched"]
    # Only two evidence rows total (problems 1 + 2), none for the dropped problem.
    assert db.query(MasteryEvidence).count() == 2


# --------------------------------------------------------------------------- #
# The DECLARATIVE follow-up: the wrong concept surfaces in due_concepts        #
# --------------------------------------------------------------------------- #
def test_incorrect_concept_surfaces_in_due_queue(db, monkeypatch):
    _seed_world(db)
    # Before grading: never-seen concepts are NOT in the queue (D3 candidate rule).
    assert items.due_concepts(db, OWNER, COURSE_ID) == []
    _patch_llm(monkeypatch)
    _grade(db)
    due = items.due_concepts(db, OWNER, COURSE_ID)
    ids = [d["concept_id"] for d in due]
    # The incorrect concept (Confidence Intervals = k1) is now a due candidate —
    # the review follow-up is declarative (no enqueue API was called).
    assert "k1" in ids


# --------------------------------------------------------------------------- #
# RouterError -> setup hint, no evidence, never grade blind                    #
# --------------------------------------------------------------------------- #
def test_router_error_returns_setup_hint_no_evidence(db, monkeypatch):
    _seed_world(db)
    import src.model_router as mr

    def _raise(*a, **k):
        raise mr.RouterError("No vision-capable model is configured. <hint>")
    monkeypatch.setattr(mr, "resolve", _raise)

    async def _boom(*a, **k):
        raise AssertionError("must NOT grade blind without a VL model")
    monkeypatch.setattr("src.llm_core.llm_call_async", _boom)

    out = _grade(db)
    schemas.WorksheetGradeResponse.model_validate(out)
    assert out["problems"] == []
    assert out["concepts_touched"] == []
    assert "vision-capable model" in (out["setup_hint"] or "")
    assert db.query(MasteryEvidence).count() == 0


def test_no_llm_configured_grades_gracefully(db, monkeypatch):
    """Empty endpoint/model (router resolves to nothing) -> empty result, no
    LLM call, no evidence — graceful, not an error."""
    _seed_world(db)
    from src.model_router import RoutedModel
    import src.model_router as mr
    monkeypatch.setattr(mr, "resolve",
                        lambda *a, **k: RoutedModel("", "", 0, "no endpoints"))

    async def _boom(*a, **k):
        raise AssertionError("must not call the LLM when none is configured")
    monkeypatch.setattr("src.llm_core.llm_call_async", _boom)

    out = _grade(db)
    assert out == {"problems": [], "concepts_touched": []}
    assert db.query(MasteryEvidence).count() == 0


def test_parse_failure_grades_gracefully(db, monkeypatch):
    """Non-JSON model output -> empty result, no evidence (never raises)."""
    _seed_world(db)
    import src.model_router as mr
    monkeypatch.setattr(mr, "resolve", lambda *a, **k: _routed())

    async def _garbage(*a, **k):
        return "I could not read the worksheet, sorry!"
    monkeypatch.setattr("src.llm_core.llm_call_async", _garbage)
    monkeypatch.setattr(items, "_resolve_image_data_uris",
                        lambda owner, ids: [{"type": "image_url",
                                             "image_url": {"url": "x"}}])

    out = _grade(db)
    assert out == {"problems": [], "concepts_touched": []}
    assert db.query(MasteryEvidence).count() == 0


# --------------------------------------------------------------------------- #
# guide flag is honored in the prompt                                          #
# --------------------------------------------------------------------------- #
def test_guide_flag_changes_the_prompt(db, monkeypatch):
    _seed_world(db)
    cap_guide: dict = {}
    _patch_llm(monkeypatch, capture=cap_guide)
    _grade(db, guide=True)
    sys_guide = cap_guide["messages"][0]["content"]
    # guide mode: explicitly WITHHOLD the corrected answer, ask a Socratic nudge.
    assert "do NOT state the corrected answer" in sys_guide
    assert "SOCRATIC nudge question" in sys_guide

    cap_direct: dict = {}
    _patch_llm(monkeypatch, capture=cap_direct)
    _grade(db, guide=False)
    sys_direct = cap_direct["messages"][0]["content"]
    # direct mode: may state the fix.
    assert "the correct fix" in sys_direct
    assert "do NOT state the corrected answer" not in sys_direct


def test_closed_world_concept_list_rides_the_prompt(db, monkeypatch):
    _seed_world(db)
    cap: dict = {}
    _patch_llm(monkeypatch, capture=cap)
    _grade(db)
    user_block = cap["messages"][-1]["content"]
    # The user content is multimodal: a text block + image block(s).
    text = next(b["text"] for b in user_block if b.get("type") == "text")
    assert "Sampling Distributions" in text
    assert "Confidence Intervals" in text
    # And an image block actually rode along (the vision path ran).
    assert any(b.get("type") == "image_url" for b in user_block)


def test_blind_grade_guard_no_image_no_llm_no_evidence(db, monkeypatch):
    """A VL model IS configured but no image resolves (empty/failed uploads) ->
    NEVER call the LLM and NEVER write evidence (don't fabricate grades from a
    missing photo). The grade_answer analogue; review finding R1-F1."""
    _seed_world(db)
    import src.model_router as mr
    monkeypatch.setattr(mr, "resolve", lambda *a, **k: _routed())  # VL configured
    called = {"n": 0}

    async def _spy(*a, **k):
        called["n"] += 1
        return "{}"
    monkeypatch.setattr("src.llm_core.llm_call_async", _spy)
    monkeypatch.setattr(items, "_resolve_image_data_uris", lambda owner, ids: [])

    out = _grade(db, attachment_ids=["up1"])
    assert out["problems"] == []
    assert called["n"] == 0                          # LLM never invoked
    assert db.query(MasteryEvidence).count() == 0    # no phantom evidence
    assert out.get("setup_hint")
