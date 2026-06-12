"""Phase-2 T1 (ADR 0004) — sessions bind to a course and the list filters by it.

Covers:
  * bind_session_course stamps a validated course_id on the session row,
    rejects unknown/foreign courses (Gate 5 via owner_scoped);
  * POST /api/session accepts an optional course_id form field;
  * GET /api/sessions returns course_id and honours ?course_id=.
"""

import tempfile
import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

import core.database as cdb
import routes.course_helpers as chelpers
import routes.session_routes as sroutes
from core.database import Course, Session as DbSession

_TMPDB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_ENGINE = create_engine(
    f"sqlite:///{_TMPDB.name}",
    connect_args={"check_same_thread": False},
    poolclass=NullPool,
)
cdb.Base.metadata.create_all(_ENGINE)
_TS = sessionmaker(bind=_ENGINE, autoflush=False, autocommit=False)
chelpers.SessionLocal = _TS
sroutes.SessionLocal = _TS


def _req(user="ada"):
    return SimpleNamespace(state=SimpleNamespace(current_user=user))


def _mk_course(owner="ada", name="AP Statistics"):
    db = _TS()
    try:
        c = Course(id=str(uuid.uuid4()), name=name, owner=owner)
        db.add(c)
        db.commit()
        return c.id
    finally:
        db.close()


def _mk_session_row(owner="ada", name="chat", course_id=None):
    db = _TS()
    try:
        s = DbSession(id=str(uuid.uuid4()), name=name, endpoint_url="", model="m",
                      owner=owner, course_id=course_id)
        db.add(s)
        db.commit()
        return s.id
    finally:
        db.close()


def _row_course(sid):
    db = _TS()
    try:
        return db.query(DbSession).filter(DbSession.id == sid).first().course_id
    finally:
        db.close()


# ----------------------------------------------------------- bind helper


def test_bind_session_course_stamps_row():
    cid = _mk_course()
    sid = _mk_session_row()
    chelpers.bind_session_course(sid, cid, "ada")
    assert _row_course(sid) == cid


def test_bind_session_course_rejects_unknown_course():
    sid = _mk_session_row()
    with pytest.raises(HTTPException) as e:
        chelpers.bind_session_course(sid, "no-such-course", "ada")
    assert e.value.status_code == 400
    assert _row_course(sid) is None


def test_bind_session_course_rejects_foreign_course():
    cid = _mk_course(owner="bob")
    sid = _mk_session_row(owner="ada")
    with pytest.raises(HTTPException) as e:
        chelpers.bind_session_course(sid, cid, "ada")
    assert e.value.status_code == 400
    assert _row_course(sid) is None


# ----------------------------------------------------------- routes


class _StubSessionManager:
    """Duck-typed SessionManager: create writes the DB row like the real one."""

    def __init__(self):
        self.sessions = {}

    def create_session(self, session_id, name, endpoint_url, model, rag=False, owner=None):
        db = _TS()
        try:
            db.add(DbSession(id=session_id, name=name or "chat", endpoint_url=endpoint_url,
                             model=model, rag=rag, owner=owner))
            db.commit()
        finally:
            db.close()
        s = SimpleNamespace(id=session_id, name=name or "chat", endpoint_url=endpoint_url,
                            model=model, rag=rag, archived=False, owner=owner, headers={})
        self.sessions[session_id] = s
        return s

    def get_sessions_for_user(self, user):
        return {sid: s for sid, s in self.sessions.items() if s.owner == user}


def _endpoints():
    sm = _StubSessionManager()
    router = sroutes.setup_session_routes(sm, {})
    eps = {}
    for r in router.routes:
        for m in getattr(r, "methods", set()):
            eps[(m, r.path)] = r.endpoint
    return sm, eps


def test_create_session_with_course_id_and_list_filter():
    cid = _mk_course(owner="ada", name="Calculus 1")
    sm, eps = _endpoints()
    create = eps[("POST", "/api/session")]
    list_sessions = eps[("GET", "/api/sessions")]

    # Direct endpoint calls bypass FastAPI's Form() resolution, so every form
    # field must be supplied explicitly.
    def _create_session(create_fn, **over):
        kw = dict(name="chat", endpoint_url="", model="", rag=None,
                  skip_validation="true", api_key="", endpoint_id="", course_id="")
        kw.update(over)
        return create_fn(_req("ada"), **kw)

    in_course = _create_session(create, name="course chat", course_id=cid)
    loose = _create_session(create, name="loose chat")
    assert in_course.course_id == cid
    assert loose.course_id is None
    assert _row_course(in_course.id) == cid
    assert _row_course(loose.id) is None

    all_sessions = list_sessions(_req("ada"))
    by_id = {s["id"]: s for s in all_sessions}
    assert by_id[in_course.id]["course_id"] == cid
    assert by_id[loose.id]["course_id"] is None

    scoped = list_sessions(_req("ada"), course_id=cid)
    scoped_ids = {s["id"] for s in scoped}
    assert in_course.id in scoped_ids and loose.id not in scoped_ids


def test_create_session_with_unknown_course_400s():
    sm, eps = _endpoints()
    create = eps[("POST", "/api/session")]
    with pytest.raises(HTTPException) as e:
        create(_req("ada"), name="x", endpoint_url="", model="", rag=None,
               skip_validation="true", api_key="", endpoint_id="", course_id="bogus")
    assert e.value.status_code == 400
