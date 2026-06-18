"""Phase-2 T4 B4 (SPEC F8 "Explain it back") — the practice-side explain helpers.

Covers:
  * start() mints a session whose DB row has mode="explain", headers["concept_id"]
    set, and is bound to course_id (Gate 5 via bind_session_course);
  * start() returns the ExplainStartResponse-shaped dict (with the curious-student
    message + resolved concept_name) and writes NO mastery evidence;
  * start() rejects a foreign / unknown course (400);
  * mark_explained() writes ONE "explained" evidence row and returns a (state,
    effective_p) tuple;
  * mark_explained() is a no-op (None) when the session has no bound concept.

Isolation: a tmp sqlite DB (all tables) per test, with SessionLocal monkeypatched
in every module on the create+bind+evidence call chain (CONTRACT §3). The practice
store path is irrelevant here (explain.py never writes the key store) but is
patched defensively.
"""

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

import core.database as cdb
import core.session_manager as csm
import routes.course_helpers as chelpers
from core.database import Course, Session as DbSession
from src.graph import queries
from src.graph.models import ConceptNode, ensure_graph_tables, new_id
from src.practice import explain


@pytest.fixture
def db(tmp_path, monkeypatch):
    engine = create_engine(
        f"sqlite:///{tmp_path/'g.db'}",
        connect_args={"check_same_thread": False},
        poolclass=NullPool,
    )
    cdb.Base.metadata.create_all(engine)
    ensure_graph_tables(bind=engine)
    maker = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    # Patch every SessionLocal the create+bind+evidence chain reaches.
    monkeypatch.setattr(cdb, "SessionLocal", maker)
    monkeypatch.setattr(csm, "SessionLocal", maker)
    monkeypatch.setattr(chelpers, "SessionLocal", maker)
    monkeypatch.setattr(
        "src.practice.store.STORE_PATH", str(tmp_path / "practice_keys.json")
    )
    sess = maker()
    yield sess
    sess.close()


def _seed(db, owner="ada", course_id="c1", concept_id="k0",
          concept_name="1.1 Definitions"):
    db.add(Course(id=course_id, name="AP Statistics", owner=owner))
    db.add(ConceptNode(id=concept_id, name=concept_name,
                       normalized_name=concept_name.lower(), source_id="s1",
                       owner=owner, meta={"sources": ["s1"], "ordinal": 0}))
    db.commit()


def _row(db, session_id):
    return db.query(DbSession).filter(DbSession.id == session_id).first()


# --------------------------------------------------------------- start()

def test_start_flags_session_and_binds_course(db):
    """start() creates a session whose DB row is mode='explain' + carries the
    concept_id in headers + is bound to the course."""
    _seed(db)
    out = explain.start(db, "ada", "c1", "k0")

    row = _row(db, out["session_id"])
    assert row is not None
    assert row.mode == "explain"
    assert row.headers["concept_id"] == "k0"
    assert row.course_id == "c1"
    assert row.owner == "ada"


def test_start_returns_response_shape_with_persona_message(db):
    _seed(db)
    out = explain.start(db, "ada", "c1", "k0")
    assert set(out) >= {"session_id", "concept_id", "concept_name", "message"}
    assert out["concept_id"] == "k0"
    assert out["concept_name"] == "1.1 Definitions"
    assert "1.1 Definitions" in out["message"]
    assert "curious student" in out["message"]


def test_start_writes_no_evidence(db):
    """No explanation has happened yet — start() must not touch mastery."""
    _seed(db)
    explain.start(db, "ada", "c1", "k0")
    assert queries.states_for(db, ["k0"])["k0"][0] == "unknown"


def test_start_rejects_foreign_course(db):
    _seed(db, owner="bob")  # course belongs to bob
    with pytest.raises(HTTPException) as e:
        explain.start(db, "ada", "c1", "k0")
    assert e.value.status_code == 400


def test_start_resolves_response_model(db):
    """The dict validates against the frozen ExplainStartResponse schema."""
    from src.practice.schemas import ExplainStartResponse
    _seed(db)
    out = explain.start(db, "ada", "c1", "k0")
    ExplainStartResponse(**out)  # raises on a shape mismatch


# --------------------------------------------------------- mark_explained()

def test_mark_explained_writes_explained_evidence_and_returns_state(db):
    _seed(db)
    out = explain.start(db, "ada", "c1", "k0")
    result = explain.mark_explained(db, "ada", out["session_id"])

    assert result is not None
    state, effective_p = result
    assert state in {"unknown", "learning", "shaky", "mastered"}
    # one 'explained' evidence row landed for k0, attributed to the owner
    from src.graph.models import MasteryEvidence
    rows = (db.query(MasteryEvidence)
            .filter(MasteryEvidence.concept_id == "k0",
                    MasteryEvidence.signal == "explained").all())
    assert len(rows) == 1
    assert rows[0].owner == "ada"
    assert rows[0].context.get("source") == "explain"
    assert rows[0].episode_ref == {"type": "chat_message", "id": out["session_id"]}


def test_mark_explained_moves_state_off_unknown(db):
    _seed(db)
    out = explain.start(db, "ada", "c1", "k0")
    assert queries.states_for(db, ["k0"])["k0"][0] == "unknown"
    explain.mark_explained(db, "ada", out["session_id"])
    # after an 'explained' signal the concept is no longer unknown
    assert queries.states_for(db, ["k0"])["k0"][0] != "unknown"


def test_mark_explained_noop_when_no_concept_bound(db):
    """A session with no concept_id in headers writes nothing and returns None."""
    _seed(db)
    sid = str(uuid.uuid4())
    db.add(DbSession(id=sid, name="plain", endpoint_url="", model="m",
                     owner="ada", course_id="c1", headers={}))
    db.commit()
    assert explain.mark_explained(db, "ada", sid) is None


def test_mark_explained_noop_for_missing_session(db):
    _seed(db)
    assert explain.mark_explained(db, "ada", new_id()) is None


def test_mark_explained_noop_for_foreign_owner(db):
    """L6: a different owner can't write 'explained' evidence on this session."""
    from src.graph.models import MasteryEvidence
    _seed(db)
    out = explain.start(db, "ada", "c1", "k0")
    assert explain.mark_explained(db, "mallory", out["session_id"]) is None
    rows = (db.query(MasteryEvidence)
            .filter(MasteryEvidence.signal == "explained").count())
    assert rows == 0


def test_mark_explained_noop_when_not_explain_mode(db):
    """L6: only an explain-mode session writes 'explained' evidence."""
    _seed(db)
    sid = str(uuid.uuid4())
    db.add(DbSession(id=sid, name="plain", endpoint_url="", model="m",
                     owner="ada", course_id="c1", mode="chat",
                     headers={"concept_id": "k0"}))
    db.commit()
    assert explain.mark_explained(db, "ada", sid) is None


def test_start_does_not_orphan_session_on_foreign_course(db):
    """L8: when bind_session_course raises (foreign course), the just-created
    session is deleted — no orphaned unbound explain session is left behind."""
    _seed(db, owner="bob")  # course belongs to bob
    before = db.query(DbSession).count()
    with pytest.raises(HTTPException):
        explain.start(db, "ada", "c1", "k0")
    # No new (orphaned) session row survived the failed bind.
    assert db.query(DbSession).count() == before
