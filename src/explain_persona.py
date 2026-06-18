"""
explain_persona.py — the curious-student persona injection for explain-mode
chat (SPEC F8 "explain it back"). When a chat session is flagged `mode="explain"`
(set at creation by src/practice/explain.py, B4), the tutor flips role: instead
of teaching, the model PLAYS a curious student and the human explains a concept
back to it. The model probes gaps, asks "why", and requests examples — it does
NOT lecture until the human's explanation stands on its own (or stalls).

This lives in its own module (NOT routes/chat_helpers.py, a Gate-6a god-file at
its ceiling). build_chat_context reaches it through
student_context.course_system_messages, the one-door combiner.

Contract: cheap (a couple of plain reads, no LLM), never raises into chat (any
failure returns None), and returns None for any non-explain session, incognito,
or error. Reading/writing only — no voice (the permanently-rejected modality).
"""

from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)

EXPLAIN_OPEN = "[EXPLAIN MODE — you are the curious student]"
EXPLAIN_CLOSE = "[END EXPLAIN MODE]"


def _session_mode_and_concept(session_id: str) -> tuple[str | None, str | None]:
    """The session's mode + stashed concept_id (headers JSON bag). Mirrors
    grounding.session_course_id's cheap-read style. ("", None) on miss."""
    from core.database import SessionLocal, Session as DBSession
    db = SessionLocal()
    try:
        row = (db.query(DBSession.mode, DBSession.headers)
               .filter(DBSession.id == session_id).first())
        if not row:
            return None, None
        mode, headers = row[0], row[1]
        concept_id = None
        if isinstance(headers, dict):
            concept_id = headers.get("concept_id")
        elif isinstance(headers, str) and headers:
            try:
                concept_id = (json.loads(headers) or {}).get("concept_id")
            except (json.JSONDecodeError, TypeError):
                concept_id = None
        return mode, concept_id
    finally:
        db.close()


def _tone(db, owner, course_id: str | None) -> str:
    """The course's persona tone dial, if set (copies student_context.
    _profile_lines' settings read). Empty string when absent/unreadable."""
    if not course_id:
        return ""
    try:
        from core.database import Course
        from src.auth_helpers import owner_scoped
        course = (owner_scoped(db.query(Course).filter(Course.id == course_id),
                               Course, owner).first())
        if course is None or not course.settings:
            return ""
        settings = json.loads(course.settings)
        return str(settings.get("tone") or "")
    except (json.JSONDecodeError, TypeError, Exception):
        return ""


def _concept_name(db, owner, concept_id: str | None) -> str:
    """The concept being explained (via the graph one-door). Empty on miss."""
    if not concept_id:
        return ""
    try:
        from src.graph import queries
        brief = queries.concept_brief(db, concept_id, owner)
        return (brief or {}).get("name", "") or ""
    except Exception:
        return ""


def _persona_block(concept_name: str, tone: str) -> str:
    target = (f" the concept \"{concept_name}\"" if concept_name
              else " the concept they chose")
    tone_line = (f"\nKeep your questions {tone} in tone.\n" if tone else "\n")
    return (
        f"{EXPLAIN_OPEN}\n"
        f"For this session you are NOT the tutor. The student is explaining"
        f"{target} back to you to prove they understand it (the protégé "
        f"effect). PLAY a bright, curious peer who is learning it for the "
        f"first time.\n"
        f"How to behave:\n"
        f"- Let the STUDENT do the explaining. Ask one focused question at a "
        f"time and wait for their answer.\n"
        f"- Probe for gaps: ask \"why\" and \"how do you know\", and request a "
        f"concrete example or a worked case when an explanation is abstract.\n"
        f"- Gently surface contradictions or hand-waving instead of correcting "
        f"them outright — let the student notice and repair it.\n"
        f"- Do NOT lecture or hand over the full answer while the explanation "
        f"is progressing. Only step in to teach if the explanation clearly "
        f"stands on its own (then briefly affirm what landed) OR has stalled "
        f"and the student is stuck.\n"
        f"- Stay encouraging and calm; never quiz with a score, never rush.\n"
        f"{tone_line}"
        f"This is a reading/writing exchange only — never assume speech.\n"
        f"{EXPLAIN_CLOSE}"
    )


def maybe_explain_persona(session_id: str, owner, course_id=None) -> dict | None:
    """build_chat_context's explain hook (via course_system_messages): return a
    curious-student persona system message when the session is in explain mode,
    else None. Never raises (None on any error)."""
    try:
        mode, concept_id = _session_mode_and_concept(session_id)
        if (mode or "") != "explain":
            return None
        # L7: the tone dial lives on the course the session is actually BOUND to;
        # the request's course_id is only a fallback (never raises).
        resolved = course_id
        try:
            from src.corpus.grounding import session_course_id
            resolved = session_course_id(session_id, fallback=course_id)
        except Exception:
            resolved = course_id
        from core.database import SessionLocal
        db = SessionLocal()
        try:
            concept_name = _concept_name(db, owner, concept_id)
            tone = _tone(db, owner, resolved)
        finally:
            db.close()
        return {"role": "system",
                "content": _persona_block(concept_name, tone)}
    except Exception as e:
        logger.warning("explain persona injection skipped: %s", e)
        return None


__all__ = ["maybe_explain_persona", "EXPLAIN_OPEN", "EXPLAIN_CLOSE"]
