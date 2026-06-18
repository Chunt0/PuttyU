"""H3 (SPEC F8 explain) — an explain session's persisted mode survives ordinary
chat turns.

The bug: every chat turn computed `_effective_mode = research?/agent?/chat` and
called set_session_mode(...), hard-overwriting a session created with mode=
"explain" back to "chat" BEFORE build_chat_context -> course_system_messages ->
maybe_explain_persona reads Session.mode — so the curious-student persona never
injected. The fix is the pure predicate routes.chat_routes._resolve_effective_mode,
which preserves "explain" on a plain chat/blank turn (research/agent still win).

Tested at two levels: the pure decision, and a real round-trip through the
core.database set/get_session_mode helpers on an isolated DB.
"""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import core.database as cdb
from core.database import (
    Session as DbSession, get_session_mode, set_session_mode,
)
from routes.chat_routes import _resolve_effective_mode


# --------------------------------------------------------- the pure decision

def test_plain_chat_turn_preserves_explain():
    """A blank/chat request on an explain session stays 'explain'."""
    assert _resolve_effective_mode(False, "chat", "explain") == "explain"
    assert _resolve_effective_mode(False, "", "explain") == "explain"


def test_research_and_agent_still_win_over_explain():
    """A real escalation overrides a persisted explain mode."""
    assert _resolve_effective_mode(True, "chat", "explain") == "research"
    assert _resolve_effective_mode(False, "agent", "explain") == "agent"


def test_non_explain_session_unchanged():
    """A normal session resolves to the requested mode (no explain to preserve)."""
    assert _resolve_effective_mode(False, "chat", "chat") == "chat"
    assert _resolve_effective_mode(False, "", None) == "chat"
    assert _resolve_effective_mode(False, "agent", None) == "agent"
    assert _resolve_effective_mode(True, "", None) == "research"


# ------------------------------------------- real set/get round-trip on a DB

@pytest.fixture
def db(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'g.db'}")
    cdb.Base.metadata.create_all(engine)
    maker = sessionmaker(bind=engine)
    monkeypatch.setattr(cdb, "SessionLocal", maker)
    sess = maker()
    yield sess
    sess.close()


def test_explain_mode_survives_a_simulated_chat_turn(db):
    """The end-to-end H3 invariant: an explain session, run through the
    mode-resolution logic with request mode 'chat', keeps mode='explain'."""
    db.add(DbSession(id="sx", name="explain", owner="ada",
                     endpoint_url="http://x/v1", model="m",
                     course_id="c1", mode="explain",
                     headers={"concept_id": "k1"}))
    db.commit()

    # Simulate the route block: read persisted mode, resolve, persist.
    persisted = get_session_mode("sx")
    assert persisted == "explain"
    effective = _resolve_effective_mode(False, "chat", persisted)
    set_session_mode("sx", effective)

    # The persona reads Session.mode downstream — it must still be 'explain'.
    assert get_session_mode("sx") == "explain"


def test_agent_turn_overrides_explain_in_round_trip(db):
    """An explicit agent turn does flip the persisted mode (no over-preserving)."""
    db.add(DbSession(id="sy", name="explain", owner="ada",
                     endpoint_url="http://x/v1", model="m",
                     course_id="c1", mode="explain", headers={}))
    db.commit()
    effective = _resolve_effective_mode(False, "agent", get_session_mode("sy"))
    set_session_mode("sy", effective)
    assert get_session_mode("sy") == "agent"
