"""
explain.py — the practice-side of SPEC F8 "Explain it back" (Phase-2 T4 B4).

Two tested helpers:

  * ``start(db, owner, course_id, concept_id)`` mints a chat session flagged
    ``mode="explain"`` with the target ``concept_id`` stashed in the session
    ``headers`` JSON bag (both columns already exist on ``Session`` — no
    migration). The session is bound to ``course_id`` (Gate 5 via
    ``bind_session_course``). It returns an ``ExplainStartResponse``-shaped dict.
    NOTE: start() writes NO evidence — no explanation has happened yet.

  * ``mark_explained(db, owner, session_id)`` is the F8 "explanation writes rich
    evidence" hook: it writes ONE ``explained`` mastery-evidence row for the
    concept stashed on the session and returns the derived ``(state,
    effective_p)``. Whether/where this is auto-triggered after an explain turn is
    a known T4-light point — the after-turn trigger is wired minimally by the
    context-injection agent / left for the extractor; this module only owns the
    tested writer.

Graph access is exclusively through ``src.graph.queries`` (Gate 6f). The
curious-student PERSONA injection is a different module's job
(``src/explain_persona.py``); this file only creates the flagged session and the
evidence helper.
"""

from __future__ import annotations

import uuid

from src.graph import queries
from src.graph.models import episode_ref


def start(db, owner, course_id: str, concept_id: str) -> dict:
    """Create an explain-mode chat session bound to ``course_id`` for
    ``concept_id`` and return an ``ExplainStartResponse``-shaped dict.

    Mirrors the create+bind pattern in ``routes/session_routes.py`` (create via
    ``SessionManager.create_session`` then ``bind_session_course``), then stamps
    ``mode="explain"`` and ``headers["concept_id"]`` directly on the ``DbSession``
    row (the direct-update idiom from ``routes/course_helpers.py``). No
    migration: both columns already exist.

    ``db`` is unused for the writes (the SessionManager + binder open their own
    ``SessionLocal``); it is accepted to resolve the concept name through the
    one graph door and to keep a uniform ``(db, owner, ...)`` signature with the
    rest of the practice engine.
    """
    from core.database import Session as DbSession, SessionLocal
    from core.session_manager import SessionManager
    from routes.course_helpers import bind_session_course

    brief = queries.concept_brief(db, concept_id, owner)
    concept_name = (brief or {}).get("name")

    session_id = str(uuid.uuid4())
    SessionManager().create_session(
        session_id=session_id,
        name=f"Explain: {concept_name or concept_id}",
        endpoint_url="",
        model="",
        rag=False,
        owner=owner,
    )
    # Bind to the course (validated, owner_scoped — raises 400 on a foreign id).
    # L8: if the bind raises (unknown/foreign course), delete the just-created
    # session so we don't leave an orphaned, unbound explain session behind.
    try:
        bind_session_course(session_id, course_id, owner)
    except Exception:
        try:
            SessionManager().delete_session(session_id)
        except Exception:
            pass
        raise

    # Flag the row: explain mode + the concept under explanation.
    wdb = SessionLocal()
    try:
        row = wdb.query(DbSession).filter(DbSession.id == session_id).first()
        if row is not None:
            row.mode = "explain"
            row.headers = {**(row.headers or {}), "concept_id": concept_id}
            wdb.commit()
    finally:
        wdb.close()

    label = concept_name or "this concept"
    return {
        "session_id": session_id,
        "concept_id": concept_id,
        "concept_name": concept_name,
        "message": (
            f"Teach me {label} in your own words — "
            "I'll play the curious student."
        ),
    }


def mark_explained(db, owner, session_id: str) -> tuple | None:
    """Write ONE ``explained`` mastery-evidence row for the concept stashed on
    ``session_id``'s headers and return the derived ``(state, effective_p)``.

    Returns ``None`` when the session has no bound concept (not an explain
    session, missing row, or empty headers). This is the F8 evidence writer;
    its after-turn trigger is wired elsewhere (a known T4-light point).
    """
    from core.database import Session as DbSession, SessionLocal

    rdb = SessionLocal()
    try:
        row = rdb.query(DbSession).filter(DbSession.id == session_id).first()
        # L6: only write 'explained' evidence for an explain-mode session the
        # caller actually owns — otherwise treat it as a no-op (Gate-5 defense).
        if (row is None or row.owner != owner or (row.mode or "") != "explain"):
            concept_id = None
        else:
            concept_id = (row.headers or {}).get("concept_id")
    finally:
        rdb.close()

    if not concept_id:
        return None

    state, effective_p = queries.record_evidence(
        concept_id,
        "explained",
        context={"source": "explain"},
        episode_ref=episode_ref("chat_message", session_id),
        owner=owner,
        db=db,
    )
    return state, effective_p


__all__ = ["start", "mark_explained"]
