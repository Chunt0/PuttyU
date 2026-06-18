"""
test_practice_routes.py — the practice-engine HTTP surface (Phase-2 T4a / Phase C).

Hits EVERY one of the 10 routes/practice_routes endpoints through a real FastAPI
TestClient so that each 2xx body is validated against its response_model: any
field-type mismatch between what the engine returns and what schemas.py declares
surfaces as a 500/ValidationError here, which is exactly the regression this file
guards against (e.g. the calibration-finish shape, the exam-submit debrief).

A minimal app mounts ONLY the practice router behind a tiny middleware that sets
request.state.current_user, so we get TestClient response-model validation
without the full app's auth middleware (which can hang TestClient in CI). All
SessionLocal references the routes/engine reach are repointed at an isolated
temp-file sqlite DB, and the grading-key store is patched per the T4 contract §3.
The LLM is monkeypatched so grading is deterministic (no live model needed).
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import core.database as cdb
import core.session_manager as csm
import routes.course_helpers as chelp
import routes.practice_routes as proutes
from core.database import Course, CourseSource
from src.corpus.models import CorpusChunk, CorpusSource
from src.corpus.records import Kind
from src.graph import mastery
from src.graph.models import ConceptNode

OWNER = "ada"
COURSE_ID = "c1"


@pytest.fixture
def client(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'g.db'}",
                           connect_args={"check_same_thread": False})
    cdb.Base.metadata.create_all(engine)
    maker = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    # Repoint every SessionLocal the routes + engine + session-creation reach.
    monkeypatch.setattr(cdb, "SessionLocal", maker)
    monkeypatch.setattr(proutes, "SessionLocal", maker)
    monkeypatch.setattr(chelp, "SessionLocal", maker)
    monkeypatch.setattr(csm, "SessionLocal", maker)
    # Isolate the grading-key store (T4 contract §3).
    monkeypatch.setattr("src.practice.store.STORE_PATH",
                        str(tmp_path / "practice_keys.json"))

    _seed(maker)

    app = FastAPI()

    @app.middleware("http")
    async def _inject_user(request: Request, call_next):
        request.state.current_user = OWNER
        request.state.api_token = False
        return await call_next(request)

    app.include_router(proutes.setup_practice_routes())
    with TestClient(app) as c:
        yield c


def _seed(maker):
    """Course c1 -> source s1 -> three concepts, two of them with seeded
    EXERCISE/Answer chunks so items can be minted + graded without an LLM, and
    one concept carrying an 'incorrect' evidence row (a due/coach-pick target)."""
    db = maker()
    try:
        db.add(Course(id=COURSE_ID, name="AP Statistics", owner=OWNER,
                      settings="{}"))
        db.add(CorpusSource(id="s1", source_type="textbook", title="Intro Stats",
                            content_hash="h", status="ready"))
        db.add(CourseSource(course_id=COURSE_ID, source_id="s1"))
        for i, name in enumerate(["1.1 Definitions", "1.2 Sampling",
                                  "1.3 Frequency"]):
            db.add(ConceptNode(id=f"k{i}", name=name, normalized_name=name.lower(),
                               source_id="s1", owner=OWNER,
                               heading_path=["Chapter 1", name],
                               meta={"sources": ["s1"], "ordinal": i}))
        # Two practiceable exercises (each with an Answer the no-LLM grader uses).
        db.add(CorpusChunk(
            id="s1:10", source_id="s1", ordinal=10, kind=Kind.EXERCISE,
            heading_path=["Chapter 1", "1.2 Sampling"],
            text="What is 2 + 2?\n\nAnswer:\n4", content_hash="hc1"))
        db.add(CorpusChunk(
            id="s1:11", source_id="s1", ordinal=11, kind=Kind.EXERCISE,
            heading_path=["Chapter 1", "1.3 Frequency"],
            text="What is 3 + 3?\n\nAnswer:\n6", content_hash="hc2"))
        db.commit()
        # k1 has a recorded error -> a due candidate AND the gym coach's pick.
        mastery.apply_evidence("k1", "incorrect", owner=OWNER, db=db)
        # k2 has evidence too (non-mastered) so the queue has >1 candidate.
        mastery.apply_evidence("k2", "partial", owner=OWNER, db=db)
        db.commit()
    finally:
        db.close()


@pytest.fixture(autouse=True)
def _no_llm(monkeypatch):
    """No live model: force the router's no-endpoint path so grading uses the
    deterministic string-match fallback (and item generation returns None)."""
    async def _boom(*a, **k):
        raise AssertionError("llm_call_async must not be hit in this test")
    monkeypatch.setattr("src.llm_core.llm_call_async", _boom)


# --------------------------------------------------------------------------- #
# Review queue                                                                 #
# --------------------------------------------------------------------------- #
def test_get_queue_returns_minted_items(client):
    r = client.get("/api/practice/queue", params={"course_id": COURSE_ID})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["course_id"] == COURSE_ID
    assert body["count"] == len(body["items"]) >= 1
    assert body["items"][0]["mode"] == "review"
    # Reference answers never leak to the client.
    assert "reference_answer" not in body["items"][0]


def test_get_queue_all_courses(client):
    r = client.get("/api/practice/queue")
    assert r.status_code == 200, r.text
    assert r.json()["course_id"] is None


def test_post_queue_answer_grades_correct(client):
    item = client.get("/api/practice/queue",
                      params={"course_id": COURSE_ID}).json()["items"][0]
    r = client.post("/api/practice/queue/answer",
                    json={"item_key": item["item_key"], "answer_text": "4"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["verdict"] in ("correct", "incorrect")
    assert body["concept_id"] == item["concept_id"]


def test_post_queue_answer_missing_key_400(client):
    r = client.post("/api/practice/queue/answer", json={"item_key": ""})
    assert r.status_code == 400


# --------------------------------------------------------------------------- #
# Gym                                                                          #
# --------------------------------------------------------------------------- #
def test_gym_next_coach_pick(client):
    r = client.post("/api/practice/gym/next", json={"course_id": COURSE_ID})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["difficulty"] == 2
    assert body["item"] is not None          # k1 has errors -> coach pick
    assert body["item"]["mode"] == "gym"


def test_gym_next_specific_concept(client):
    r = client.post("/api/practice/gym/next",
                    json={"course_id": COURSE_ID, "concept_id": "k2",
                          "difficulty": 3})
    assert r.status_code == 200, r.text
    assert r.json()["item"]["concept_id"] == "k2"


def test_gym_next_missing_course_400(client):
    r = client.post("/api/practice/gym/next", json={"course_id": ""})
    assert r.status_code == 400


def test_gym_answer_steps_and_summarizes(client):
    item = client.post("/api/practice/gym/next",
                       json={"course_id": COURSE_ID}).json()["item"]
    r = client.post("/api/practice/gym/answer",
                    json={"item_key": item["item_key"], "answer_text": "4",
                          "difficulty": 2, "streak": 1,
                          "attempted": 1, "correct": 1})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["summary"]["attempted"] == 2
    assert isinstance(body["difficulty"], int)


# --------------------------------------------------------------------------- #
# Calibration                                                                  #
# --------------------------------------------------------------------------- #
def test_calibration_full_walk(client):
    started = client.post("/api/practice/calibration/start",
                          json={"course_id": COURSE_ID})
    assert started.status_code == 200, started.text
    sb = started.json()
    assert sb["status"] == "in_progress"
    assert sb["session_key"]
    sk = sb["session_key"]
    item = sb["item"]

    if item is not None:
        ans = client.post("/api/practice/calibration/answer",
                          json={"session_key": sk, "item_key": item["item_key"],
                                "answer_text": "4"})
        assert ans.status_code == 200, ans.text
        assert "total" in ans.json()

    fin = client.post("/api/practice/calibration/finish",
                      json={"session_key": sk})
    assert fin.status_code == 200, fin.text
    fb = fin.json()
    assert fb["status"] == "done"
    assert isinstance(fb["states"], list)


def test_calibration_skip_step(client):
    sb = client.post("/api/practice/calibration/start",
                     json={"course_id": COURSE_ID}).json()
    r = client.post("/api/practice/calibration/answer",
                    json={"session_key": sb["session_key"], "skip": True})
    assert r.status_code == 200, r.text


def test_calibration_finish_expired_session(client):
    r = client.post("/api/practice/calibration/finish",
                    json={"session_key": "no-such-session"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "expired"


def test_calibration_start_missing_course_400(client):
    r = client.post("/api/practice/calibration/start", json={"course_id": ""})
    assert r.status_code == 400


# --------------------------------------------------------------------------- #
# Exam                                                                         #
# --------------------------------------------------------------------------- #
def test_exam_start_and_submit(client):
    started = client.post("/api/practice/exam/start",
                          json={"course_id": COURSE_ID, "n_items": 5,
                                "duration_seconds": 600})
    assert started.status_code == 200, started.text
    sb = started.json()
    assert sb["exam_key"]
    assert sb["duration_seconds"] == 600
    assert isinstance(sb["items"], list)

    answers = [{"item_key": it["item_key"], "answer_text": "4"}
               for it in sb["items"]]
    submitted = client.post("/api/practice/exam/submit",
                            json={"exam_key": sb["exam_key"], "answers": answers})
    assert submitted.status_code == 200, submitted.text
    db = submitted.json()
    assert db["total"] == len(sb["items"])
    assert db["correct"] + db["partial"] + db["incorrect"] + db["skipped"] \
        + db.get("ungraded", 0) == db["total"]
    assert isinstance(db["readiness"], str)


def test_exam_submit_expired(client):
    r = client.post("/api/practice/exam/submit",
                    json={"exam_key": "no-such-exam", "answers": []})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 0          # expired exam validates against the model


def test_exam_start_missing_course_400(client):
    r = client.post("/api/practice/exam/start", json={"course_id": ""})
    assert r.status_code == 400


# --------------------------------------------------------------------------- #
# Explain                                                                      #
# --------------------------------------------------------------------------- #
def test_explain_start_creates_session(client):
    r = client.post("/api/practice/explain/start",
                    json={"course_id": COURSE_ID, "concept_id": "k1"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["session_id"]
    assert body["concept_id"] == "k1"
    assert body["concept_name"] == "1.2 Sampling"   # k1 is the 2nd seeded concept


def test_explain_start_missing_concept_400(client):
    r = client.post("/api/practice/explain/start",
                    json={"course_id": COURSE_ID, "concept_id": ""})
    assert r.status_code == 400
