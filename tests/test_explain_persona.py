"""Phase-2 T4 / B5 (SPEC F8 explain) — the curious-student persona injection
and the course_system_messages combiner. Isolated tmp-sqlite DB like
tests/test_student_context.py."""

import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import core.database as cdb
import src.explain_persona as ep
import src.student_context as sc
import src.tutor_persona as tp
from core.database import Course, CourseSource, Session as DBSession
from src.corpus.models import CorpusSource
from src.graph.models import ConceptNode


@pytest.fixture
def db(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path/'g.db'}")
    cdb.Base.metadata.create_all(engine)
    maker = sessionmaker(bind=engine)
    monkeypatch.setattr(cdb, "SessionLocal", maker)
    sess = maker()
    yield sess
    sess.close()


def _world(db, owner="ada", mode="explain", concept_id="k1",
           tone="warm and patient"):
    db.add(Course(id="c1", name="Calculus 1", owner=owner, status="active",
                  settings=json.dumps({"tone": tone})))
    db.add(CorpusSource(id="s1", source_type="textbook", title="Calc",
                        content_hash="h", status="ready"))
    db.add(CourseSource(course_id="c1", source_id="s1"))
    db.add(ConceptNode(id="k1", name="The chain rule", normalized_name="the chain rule",
                       source_id="s1", owner=owner, meta={"sources": ["s1"], "ordinal": 0}))
    db.add(DBSession(id="sess-explain", name="explain", owner=owner,
                     endpoint_url="http://x/v1", model="m",
                     course_id="c1", mode=mode,
                     headers={"concept_id": concept_id}))
    db.commit()


def test_persona_block_only_for_explain_sessions(db):
    _world(db, mode="explain")
    msg = ep.maybe_explain_persona("sess-explain", "ada", course_id="c1")
    assert msg is not None
    assert msg["role"] == "system"
    content = msg["content"]
    assert ep.EXPLAIN_OPEN in content and ep.EXPLAIN_CLOSE in content
    # plays a curious student, names the concept, honors the tone dial
    assert "The chain rule" in content
    assert "warm and patient" in content
    assert "NOT the tutor" in content


def test_none_for_non_explain_mode(db):
    _world(db, mode="chat")
    assert ep.maybe_explain_persona("sess-explain", "ada", course_id="c1") is None


def test_none_for_missing_session(db):
    _world(db, mode="explain")
    assert ep.maybe_explain_persona("does-not-exist", "ada", course_id="c1") is None


def test_persona_block_without_concept_or_tone(db):
    """No concept_id stashed and no tone dial -> still a valid persona block."""
    db.add(Course(id="c2", name="Bare", owner="ada", status="active", settings="{}"))
    db.add(DBSession(id="sess-bare", name="b", owner="ada",
                     endpoint_url="http://x/v1", model="m", course_id="c2",
                     mode="explain", headers={}))
    db.commit()
    msg = ep.maybe_explain_persona("sess-bare", "ada", course_id="c2")
    assert msg is not None
    assert ep.EXPLAIN_OPEN in msg["content"]
    assert "the concept they chose" in msg["content"]


def test_never_raises(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("db down")
    monkeypatch.setattr(ep, "_session_mode_and_concept", boom)
    assert ep.maybe_explain_persona("sess", "ada", course_id="c1") is None


def test_tone_resolved_via_session_bound_course_not_request(db):
    """L7: the tone dial comes from the course the session is BOUND to, even when
    the request passes no course_id (the session binding wins)."""
    _world(db, mode="explain", tone="playful and probing")  # session bound to c1
    # Request passes NO course_id — the binding (c1) must still supply the tone.
    msg = ep.maybe_explain_persona("sess-explain", "ada", course_id=None)
    assert msg is not None
    assert "playful and probing" in msg["content"]


def test_tone_prefers_bound_course_over_wrong_request_course(db):
    """L7: a wrong request course_id can't override the session's real binding."""
    # Second course with a DIFFERENT tone; the session is still bound to c1.
    db.add(Course(id="c2", name="Other", owner="ada", status="active",
                  settings=json.dumps({"tone": "WRONG TONE"})))
    db.commit()
    _world(db, mode="explain", tone="warm and patient")  # session -> c1
    msg = ep.maybe_explain_persona("sess-explain", "ada", course_id="c2")
    assert msg is not None
    assert "warm and patient" in msg["content"]
    assert "WRONG TONE" not in msg["content"]


# ---------------------------------------------------------------- combiner

def test_course_system_messages_composes_both(db, monkeypatch):
    """course_system_messages returns [student_context_msg, explain_msg],
    dropping empties."""
    _world(db, mode="explain")
    sc_msg = {"role": "system", "content": "STUDENT CONTEXT BLOCK"}
    monkeypatch.setattr(sc, "maybe_student_context",
                        lambda sid, owner, course_id=None: sc_msg)
    msgs = sc.course_system_messages("sess-explain", "ada", "c1")
    assert sc_msg in msgs
    assert any(ep.EXPLAIN_OPEN in m["content"] for m in msgs)
    assert len(msgs) == 2


def test_course_system_messages_drops_none(db, monkeypatch):
    """A non-explain course session yields the tutor persona (F10) + the
    student-context message; the explain block (None here) is dropped."""
    _world(db, mode="chat")
    sc_msg = {"role": "system", "content": "STUDENT CONTEXT BLOCK"}
    monkeypatch.setattr(sc, "maybe_student_context",
                        lambda sid, owner, course_id=None: sc_msg)
    msgs = sc.course_system_messages("sess-explain", "ada", "c1")
    assert sc_msg in msgs
    assert any(tp.PERSONA_OPEN in m["content"] for m in msgs)  # tutor persona leads
    assert len(msgs) == 2


def test_course_system_messages_respects_incognito(db, monkeypatch):
    """Incognito consults neither sub-builder -> empty list."""
    _world(db, mode="explain")
    called = []
    monkeypatch.setattr(sc, "maybe_student_context",
                        lambda *a, **k: called.append("sc") or
                        {"role": "system", "content": "x"})
    monkeypatch.setattr(ep, "maybe_explain_persona",
                        lambda *a, **k: called.append("ep") or
                        {"role": "system", "content": "y"})
    assert sc.course_system_messages("sess-explain", "ada", "c1",
                                     incognito=True) == []
    assert called == []


def test_course_system_messages_empty_when_nothing(db, monkeypatch):
    """When every sub-builder yields nothing, the combiner returns []."""
    _world(db, mode="chat")
    monkeypatch.setattr(sc, "maybe_student_context",
                        lambda sid, owner, course_id=None: None)
    monkeypatch.setattr(tp, "maybe_tutor_persona",
                        lambda sid, owner, course_id=None: None)
    assert sc.course_system_messages("sess-explain", "ada", "c1") == []
