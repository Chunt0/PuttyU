"""
test_review_queue_action.py — the daily review-queue builtin (Phase-2 T4a, F8).

Mirrors test_graph_consolidation.py: asserts the action is wired in EXACTLY the
three registration spots, and that the action sums due concepts across active
courses + dispatches ONE reminder (mocked) when something is due / raises
TaskNoop when nothing is due.
"""

from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import core.database as cdb
from core.database import Course, CourseSource
from src.corpus.models import CorpusSource
from src.graph import mastery
from src.graph.models import ConceptNode
from src.practice import review_queue

OWNER = "ada"


@pytest.fixture
def db_maker(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'g.db'}",
                           connect_args={"check_same_thread": False})
    cdb.Base.metadata.create_all(engine)
    maker = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    monkeypatch.setattr(cdb, "SessionLocal", maker)
    monkeypatch.setattr("src.practice.store.STORE_PATH",
                        str(tmp_path / "practice_keys.json"))
    return maker


def _seed_course(maker, course_id="c1", status="active", with_due=True):
    db = maker()
    try:
        db.add(Course(id=course_id, name="Stats", owner=OWNER, status=status,
                      settings="{}"))
        sid = f"s-{course_id}"
        db.add(CorpusSource(id=sid, source_type="textbook", title="Intro",
                            content_hash="h", status="ready"))
        db.add(CourseSource(course_id=course_id, source_id=sid))
        db.add(ConceptNode(id=f"{course_id}-k1", name="Sampling",
                           normalized_name="sampling", source_id=sid, owner=OWNER,
                           heading_path=["1 Sampling"],
                           meta={"sources": [sid], "ordinal": 0}))
        db.commit()
        if with_due:
            # An 'incorrect' evidence row makes the concept a due candidate.
            mastery.apply_evidence(f"{course_id}-k1", "incorrect",
                                   owner=OWNER, db=db)
            db.commit()
    finally:
        db.close()


# --------------------------------------------------------------- registration

def test_action_registered_in_three_spots():
    from src.builtin_actions import BUILTIN_ACTIONS, BUILTIN_ACTION_INFO
    from src.task_scheduler import HOUSEKEEPING_DEFAULTS
    assert BUILTIN_ACTIONS["assemble_review_queue"] is \
        review_queue.action_assemble_review_queue
    assert "assemble_review_queue" in BUILTIN_ACTION_INFO
    defaults = HOUSEKEEPING_DEFAULTS["assemble_review_queue"]
    assert defaults["name"] == "Review Queue"
    assert defaults["schedule"] == "cron"
    assert defaults["cron_expression"] == "0 7 * * *"
    assert defaults["legacy_names"] == []


# ------------------------------------------------------------------- behavior

def test_dispatches_when_due(db_maker, monkeypatch):
    _seed_course(db_maker, "c1", with_due=True)
    _seed_course(db_maker, "c2", with_due=True)

    calls = []

    async def _fake_dispatch(*, title, note_body, note_id, owner):
        calls.append({"title": title, "note_body": note_body,
                      "note_id": note_id, "owner": owner})
        return {"browser_sent": True}

    import routes.note_routes as nr
    monkeypatch.setattr(nr, "dispatch_reminder", _fake_dispatch)

    msg, ok = asyncio.run(review_queue.action_assemble_review_queue(OWNER))
    assert ok is True
    assert len(calls) == 1                       # nudged exactly once
    assert calls[0]["title"] == "Review ready"
    assert calls[0]["owner"] == OWNER
    assert OWNER in calls[0]["note_id"]          # per-day, per-owner dedupe key
    assert "2 item" in msg and "2 course" in msg


def test_raises_noop_when_nothing_due(db_maker, monkeypatch):
    _seed_course(db_maker, "c1", with_due=False)   # concept exists but no evidence

    calls = []

    async def _fake_dispatch(*, title, note_body, note_id, owner):
        calls.append(note_id)
        return {}

    import routes.note_routes as nr
    monkeypatch.setattr(nr, "dispatch_reminder", _fake_dispatch)

    from src.builtin_actions import TaskNoop
    with pytest.raises(TaskNoop):
        asyncio.run(review_queue.action_assemble_review_queue(OWNER))
    assert calls == []                           # no reminder when nothing due


def test_ignores_archived_courses(db_maker, monkeypatch):
    _seed_course(db_maker, "c1", status="archived", with_due=True)

    import routes.note_routes as nr

    async def _fake_dispatch(**k):
        raise AssertionError("should not dispatch for an archived-only owner")
    monkeypatch.setattr(nr, "dispatch_reminder", _fake_dispatch)

    from src.builtin_actions import TaskNoop
    with pytest.raises(TaskNoop):
        asyncio.run(review_queue.action_assemble_review_queue(OWNER))
