"""Phase-2 T5 vertical-4 (SPEC F9) — the session-summary engine.

Calls src/session_summary.summarize_session directly against a temp-file sqlite
DB, with a fake session_manager (an in-memory Session) and a stubbed LLM/router
(no network) — the same direct-handler / temp-DB house pattern as
test_dashboard_route.py / test_course_routes.py.

Asserts: a substantive session yields status "ok" + an `agent`-source, UNPINNED
Note carrying the right course_id + session_id + the canned draft body; a too-short
session yields "too_short" and WRITES NOTHING; no-LLM yields "no_llm" and WRITES
NOTHING; a foreign-owner session yields the not-found signal (route -> 404).
"""

from __future__ import annotations

import asyncio
import tempfile
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

import core.database as cdb
import src.session_summary as ss
from core.database import Course, Note, Session as DbSession

_TMPDB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_ENGINE = create_engine(
    f"sqlite:///{_TMPDB.name}",
    connect_args={"check_same_thread": False},
    poolclass=NullPool,
)
cdb.Base.metadata.create_all(_ENGINE)
_TS = sessionmaker(bind=_ENGINE, autoflush=False, autocommit=False)

CANNED_DRAFT = (
    "## Covered\n- Confidence intervals\n\n"
    "## What clicked\n- The margin of error formula\n\n"
    "## Still shaky\n- When to use t vs z\n\n"
    "## Citations touched\nNone this session."
)


def _routed_ok():
    return ss_model_router_RoutedModel(endpoint_url="http://x/v1/chat",
                                       model="m")


def ss_model_router_RoutedModel(**kw):
    # A minimal stand-in for model_router.RoutedModel with the two fields the
    # engine reads (endpoint_url, model) plus headers.
    return SimpleNamespace(endpoint_url=kw.get("endpoint_url", ""),
                           model=kw.get("model", ""),
                           headers=kw.get("headers", {}))


class _FakeSession:
    def __init__(self, owner, turns):
        self.owner = owner
        self._turns = turns
        self.message_count = len(turns)

    def get_context_messages(self):
        return list(self._turns)


class _FakeSM:
    """A fake session_manager: get_session(id) -> the registered Session, or
    raises KeyError (missing) like the real one."""
    def __init__(self):
        self._by_id = {}

    def register(self, session_id, sess):
        self._by_id[session_id] = sess

    def get_session(self, session_id):
        if session_id not in self._by_id:
            raise KeyError(session_id)
        return self._by_id[session_id]


def _turns(n):
    out = []
    for i in range(n):
        role = "user" if i % 2 == 0 else "assistant"
        out.append({"role": role, "content": f"turn {i} about confidence intervals"})
    return out


def _seed_session_row(session_id, owner, course_id):
    db = _TS()
    try:
        db.add(DbSession(id=session_id, name="s", endpoint_url="", model="",
                         owner=owner, course_id=course_id))
        db.commit()
    finally:
        db.close()


def _seed_course(owner="ada", name="AP Statistics"):
    cid = f"c-{ss.uuid.uuid4().hex[:8]}"
    db = _TS()
    try:
        db.add(Course(id=cid, name=name, owner=owner, status="active"))
        db.commit()
    finally:
        db.close()
    return cid


def _patch_seams(monkeypatch, *, routed, draft=CANNED_DRAFT):
    # grounding.session_course_id + student_context both use core.database.SessionLocal.
    monkeypatch.setattr(cdb, "SessionLocal", _TS)
    monkeypatch.setattr("src.model_router.resolve",
                        lambda *a, **k: routed)

    async def _fake_llm(*a, **k):
        return draft
    monkeypatch.setattr("src.llm_core.llm_call_async", _fake_llm)
    # Keep student_context inert (it reads graph tables; we only care it never
    # raises and the draft still writes). Empty block is a valid, exercised path.
    monkeypatch.setattr("src.student_context.student_context",
                        lambda *a, **k: "")


def _run(coro):
    return asyncio.run(coro)


# ---------------------------------------------------------------- ok path

def test_substantive_session_writes_agent_note(monkeypatch):
    owner = "ada"
    cid = _seed_course(owner)
    sid = f"sess-{ss.uuid.uuid4().hex[:8]}"
    _seed_session_row(sid, owner, cid)
    _patch_seams(monkeypatch, routed=_routed_ok())
    sm = _FakeSM()
    sm.register(sid, _FakeSession(owner, _turns(6)))

    db = _TS()
    try:
        result = _run(ss.summarize_session(sm, db, owner, sid))
    finally:
        db.close()

    assert result["status"] == "ok"
    note = result["note"]
    assert note is not None
    assert note["source"] == "agent"
    assert note["pinned"] is False
    assert note["course_id"] == cid
    assert note["session_id"] == sid
    assert note["content"] == CANNED_DRAFT
    assert note["title"].startswith("Session summary")
    assert "AP Statistics" in note["title"]

    # exactly one note row, owner-scoped + agent-sourced
    db = _TS()
    try:
        rows = db.query(Note).filter(Note.session_id == sid).all()
        assert len(rows) == 1
        assert rows[0].owner == owner
        assert rows[0].source == "agent"
        assert rows[0].pinned is False
    finally:
        db.close()


# ---------------------------------------------------------------- too_short

def test_too_short_writes_nothing(monkeypatch):
    owner = "ada"
    cid = _seed_course(owner)
    sid = f"short-{ss.uuid.uuid4().hex[:8]}"
    _seed_session_row(sid, owner, cid)
    _patch_seams(monkeypatch, routed=_routed_ok())
    sm = _FakeSM()
    sm.register(sid, _FakeSession(owner, _turns(2)))  # < min_turns (4)

    db = _TS()
    try:
        result = _run(ss.summarize_session(sm, db, owner, sid))
    finally:
        db.close()

    assert result["status"] == "too_short"
    assert result["note"] is None
    db = _TS()
    try:
        assert db.query(Note).filter(Note.session_id == sid).count() == 0
    finally:
        db.close()


# ---------------------------------------------------------------- no_llm

def test_no_llm_writes_nothing(monkeypatch):
    owner = "ada"
    cid = _seed_course(owner)
    sid = f"nollm-{ss.uuid.uuid4().hex[:8]}"
    _seed_session_row(sid, owner, cid)
    # router resolves to an empty target -> no-LLM guard fires
    _patch_seams(monkeypatch, routed=ss_model_router_RoutedModel())
    sm = _FakeSM()
    sm.register(sid, _FakeSession(owner, _turns(6)))

    db = _TS()
    try:
        result = _run(ss.summarize_session(sm, db, owner, sid))
    finally:
        db.close()

    assert result["status"] == "no_llm"
    assert result["note"] is None
    db = _TS()
    try:
        assert db.query(Note).filter(Note.session_id == sid).count() == 0
    finally:
        db.close()


def test_llm_failure_degrades_to_no_llm(monkeypatch):
    """A configured model that is momentarily down/rate-limited (llm_call_async
    RAISES) degrades to the calm no_llm path and writes nothing — never a 5xx."""
    owner = "ada"
    cid = _seed_course(owner)
    sid = f"boom-{ss.uuid.uuid4().hex[:8]}"
    _seed_session_row(sid, owner, cid)
    _patch_seams(monkeypatch, routed=_routed_ok())  # a model IS configured

    async def _boom(*a, **k):
        raise RuntimeError("provider 503")
    monkeypatch.setattr("src.llm_core.llm_call_async", _boom)

    sm = _FakeSM()
    sm.register(sid, _FakeSession(owner, _turns(6)))
    db = _TS()
    try:
        result = _run(ss.summarize_session(sm, db, owner, sid))
    finally:
        db.close()

    assert result["status"] == "no_llm"
    assert result["note"] is None
    db = _TS()
    try:
        assert db.query(Note).filter(Note.session_id == sid).count() == 0
    finally:
        db.close()


# ---------------------------------------------------------------- ownership

def test_foreign_owner_not_found(monkeypatch):
    sid = f"foreign-{ss.uuid.uuid4().hex[:8]}"
    _seed_session_row(sid, "bob", None)
    _patch_seams(monkeypatch, routed=_routed_ok())
    sm = _FakeSM()
    sm.register(sid, _FakeSession("bob", _turns(6)))  # session owned by bob

    db = _TS()
    try:
        result = _run(ss.summarize_session(sm, db, "ada", sid))  # ada asks
    finally:
        db.close()

    assert result["status"] == ss.NOT_FOUND
    assert result["note"] is None
    db = _TS()
    try:
        assert db.query(Note).filter(Note.session_id == sid).count() == 0
    finally:
        db.close()


def test_missing_session_not_found(monkeypatch):
    _patch_seams(monkeypatch, routed=_routed_ok())
    sm = _FakeSM()  # nothing registered
    db = _TS()
    try:
        result = _run(ss.summarize_session(sm, db, "ada", "ghost"))
    finally:
        db.close()
    assert result["status"] == ss.NOT_FOUND
    assert result["note"] is None


# ---------------------------------------------------------------- empty draft

def test_empty_draft_writes_nothing(monkeypatch):
    owner = "ada"
    cid = _seed_course(owner)
    sid = f"empty-{ss.uuid.uuid4().hex[:8]}"
    _seed_session_row(sid, owner, cid)
    _patch_seams(monkeypatch, routed=_routed_ok(), draft="   ")
    sm = _FakeSM()
    sm.register(sid, _FakeSession(owner, _turns(6)))

    db = _TS()
    try:
        result = _run(ss.summarize_session(sm, db, owner, sid))
    finally:
        db.close()

    assert result["status"] == "no_llm"
    db = _TS()
    try:
        assert db.query(Note).filter(Note.session_id == sid).count() == 0
    finally:
        db.close()
