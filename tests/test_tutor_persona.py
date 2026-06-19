"""Phase-2 T5 (SPEC F10) — the base tutor persona + adaptivity dial + integrity
stance injected into course-bound chat. Isolated tmp-sqlite DB like
tests/test_explain_persona.py."""

import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import core.database as cdb
import src.tutor_persona as tp
from core.database import Course, Session as DBSession


@pytest.fixture
def db(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path/'g.db'}")
    cdb.Base.metadata.create_all(engine)
    maker = sessionmaker(bind=engine)
    monkeypatch.setattr(cdb, "SessionLocal", maker)
    sess = maker()
    yield sess
    sess.close()


def _world(db, owner="ada", name="Calculus 1", mode="chat", settings=None,
           course_id="c1", sess_id="sess-1"):
    db.add(Course(id=course_id, name=name, owner=owner, status="active",
                  settings=json.dumps(settings or {})))
    db.add(DBSession(id=sess_id, name="s", owner=owner,
                     endpoint_url="http://x/v1", model="m",
                     course_id=course_id, mode=mode, headers={}))
    db.commit()


def test_default_persona_for_course_session(db):
    _world(db, mode="chat", settings={})
    msg = tp.maybe_tutor_persona("sess-1", "ada", course_id="c1")
    assert msg is not None and msg["role"] == "system"
    c = msg["content"]
    assert tp.PERSONA_OPEN in c and tp.PERSONA_CLOSE in c
    assert "Calculus 1" in c
    # zero-config defaults: guide scaffolding, warm tone, gentle pace
    assert "Default to guiding" in c
    # cites the library + admits uncertainty
    assert "library" in c.lower() and "not sure" in c.lower()
    # problem-based lean inferred from the course name
    assert "problem-based course" in c


def test_integrity_stance_present(db):
    _world(db, mode="chat", settings={})
    c = tp.maybe_tutor_persona("sess-1", "ada", course_id="c1")["content"]
    assert "just show me" in c.lower()
    assert "Never refuse" in c or "never refuse" in c.lower()
    assert "integrity" in c.lower()
    # calm rule: no gamification
    assert "streaks" in c.lower() or "gamify" in c.lower()


def test_dial_shapes_the_block(db):
    _world(db, mode="chat",
           settings={"scaffolding": "direct", "pace": "intense",
                     "tone": "matter-of-fact"})
    c = tp.maybe_tutor_persona("sess-1", "ada", course_id="c1")["content"]
    assert "Be direct" in c                  # scaffolding=direct
    assert "brisk pace" in c                 # pace=intense
    assert "matter-of-fact" in c             # tone
    assert "Default to guiding" not in c     # the guide default is replaced


def test_course_type_discussion_lean(db):
    _world(db, name="Victorian Literature", mode="chat", settings={})
    c = tp.maybe_tutor_persona("sess-1", "ada", course_id="c1")["content"]
    assert "discussion/close-reading course" in c
    assert "problem-based course" not in c


def test_explicit_course_type_overrides_name_heuristic(db):
    _world(db, name="Calculus 1", mode="chat",
           settings={"course_type": "discussion"})
    c = tp.maybe_tutor_persona("sess-1", "ada", course_id="c1")["content"]
    assert "discussion/close-reading course" in c


def test_none_in_explain_mode(db):
    """Explain mode flips the role; explain_persona owns it, so the base
    tutor persona suppresses itself (no conflicting personas)."""
    _world(db, mode="explain", settings={})
    assert tp.maybe_tutor_persona("sess-1", "ada", course_id="c1") is None


def test_none_for_course_less_chat(db):
    """A session bound to no course (and no request course_id) -> generic
    assistant, no tutor persona."""
    db.add(DBSession(id="sess-free", name="s", owner="ada",
                     endpoint_url="http://x/v1", model="m",
                     course_id=None, mode="chat", headers={}))
    db.commit()
    assert tp.maybe_tutor_persona("sess-free", "ada", course_id=None) is None


def test_persona_uses_session_bound_course_over_request(db):
    """The dial/name come from the course the session is BOUND to; a wrong
    request course_id can't override it."""
    db.add(Course(id="c2", name="Other", owner="ada", status="active",
                  settings=json.dumps({"scaffolding": "direct"})))
    db.commit()
    _world(db, name="Calculus 1", mode="chat",
           settings={"scaffolding": "guide"})       # session -> c1 (guide)
    c = tp.maybe_tutor_persona("sess-1", "ada", course_id="c2")["content"]
    assert "Default to guiding" in c                # c1's dial, not c2's
    assert "Calculus 1" in c


def test_never_raises(db, monkeypatch):
    _world(db, mode="chat", settings={})
    monkeypatch.setattr(tp, "_session_mode",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
    assert tp.maybe_tutor_persona("sess-1", "ada", course_id="c1") is None
