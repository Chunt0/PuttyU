"""
tutor_persona.py — the base tutor persona + adaptivity dial + integrity stance
for course-bound chat (SPEC F10). Every course-scoped tutor turn gets a behavior
frame: patient, Socratic-leaning, cites the library, admits uncertainty, never
shames — shaped by the per-course dial (scaffolding / pace / tone) the student
sets in course settings, and by the course's type (discussion-led vs
problem-led). The integrity stance is baked in: a tutor, not a homework
laundromat AND not a nanny — full answers on explicit request, never moralize,
refuse, or surveil coursework.

Mirrors src/explain_persona.py: this lives in its own module (NOT the
routes/chat_helpers.py god-file) and build_chat_context reaches it through
student_context.course_system_messages, the one-door combiner.

Contract: cheap (one owner-scoped read, no LLM), never raises into chat (any
failure → None), returns None for a course-less chat (generic assistant) or an
explain-mode session (src/explain_persona.py owns that role instead).
Reading/writing only — voice is the permanently-rejected modality.
"""

from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)

PERSONA_OPEN = "[TUTOR PERSONA — how you, the tutor, behave in this course]"
PERSONA_CLOSE = "[END TUTOR PERSONA]"

# Dial axis -> the behavior line each known value injects. Unknown/absent values
# fall back to the first ("default") option, so an unset dial reads as the
# zero-config default persona (SPEC F10 "needs zero configuration").
_SCAFFOLDING = {
    "guide": "Default to guiding: ask what the student has tried, or offer the "
             "first step, before the full solution — patient, never withholding.",
    "balanced": "Balance guiding and telling: a hint or first step, then the "
                "worked solution if the student is still stuck.",
    "direct": "Be direct: give the complete worked solution up front, then "
              "explain why each step works.",
}
_PACE = {
    "gentle": "Pace gently: small steps, check understanding before moving on, "
              "no rush.",
    "balanced": "Keep a steady pace: enough detail to follow, without dawdling.",
    "intense": "Keep a brisk pace: cover ground efficiently and assume the "
               "student will ask when they need a step expanded.",
}
_TONE = {
    "warm": "Tone: warm and encouraging.",
    "balanced": "Tone: friendly but focused.",
    "matter-of-fact": "Tone: concise and matter-of-fact.",
    "matter_of_fact": "Tone: concise and matter-of-fact.",
}

# Course-type lean. Read from settings.course_type when set, else inferred from
# the course name (cheap keyword heuristic — content-driven, not hardcoded
# per-course). Anything unknown gets a neutral lean.
_TYPE_LEAN = {
    "discussion": "This is a discussion/close-reading course: quote the text, "
                  "ask interpretive questions, and compare readings rather than "
                  "drilling procedures.",
    "problem": "This is a problem-based course: lean on worked examples and "
               "practice, and check each step of the student's reasoning.",
    "language": "This is a language course: favor usage, examples, and gentle "
                "correction in context over rules in the abstract.",
}
_TYPE_KEYWORDS = (
    ("discussion", ("lit", "literature", "english", "history", "philosoph",
                    "poetry", "seminar", "writing", "rhetoric", "art ", "ethics")),
    ("problem", ("math", "calc", "algebra", "statistic", "stats", "physics",
                 "chem", "biolog", "econ", "account", "engineer", "comput",
                 "program", "data ", "geometry", "trig")),
    ("language", ("spanish", "french", "german", "mandarin", "chinese", "latin",
                  "japanese", "korean", "italian", "arabic", "language")),
)


def _norm(v) -> str:
    return str(v or "").strip().lower()


def _course_type(name: str, settings: dict) -> str:
    explicit = _norm(settings.get("course_type"))
    if explicit in _TYPE_LEAN:
        return explicit
    n = (name or "").lower()
    for kind, words in _TYPE_KEYWORDS:
        if any(w in n for w in words):
            return kind
    return ""


def _session_mode(session_id: str) -> str | None:
    """The session's mode (cheap read; mirrors explain_persona)."""
    from core.database import SessionLocal, Session as DBSession
    db = SessionLocal()
    try:
        row = (db.query(DBSession.mode)
               .filter(DBSession.id == session_id).first())
        return row[0] if row else None
    finally:
        db.close()


def _course_name_and_settings(db, owner, course_id: str) -> tuple[str, dict]:
    from core.database import Course
    from src.auth_helpers import owner_scoped
    course = (owner_scoped(db.query(Course).filter(Course.id == course_id),
                           Course, owner).first())
    if course is None:
        return "", {}
    settings = {}
    if course.settings:
        try:
            parsed = json.loads(course.settings)
            settings = parsed if isinstance(parsed, dict) else {}
        except (json.JSONDecodeError, TypeError):
            settings = {}
    return (course.name or ""), settings


def _persona_block(course_name: str, settings: dict) -> str:
    scaffolding = _SCAFFOLDING.get(_norm(settings.get("scaffolding")),
                                   _SCAFFOLDING["guide"])
    pace = _PACE.get(_norm(settings.get("pace")), _PACE["gentle"])
    tone = _TONE.get(_norm(settings.get("tone")), _TONE["warm"])
    lean = _TYPE_LEAN.get(_course_type(course_name, settings), "")

    who = (f"You are the student's patient tutor for \"{course_name}\"."
           if course_name else "You are the student's patient tutor.")
    lines = [
        PERSONA_OPEN,
        who,
        "Teach from the linked course library first and your own knowledge "
        "second, and always show which is which; cite the section when you draw "
        "on the library, and say plainly when you are not sure.",
        scaffolding,
        pace,
        tone,
    ]
    if lean:
        lines.append(lean)
    lines += [
        # The integrity stance (SPEC F10 "a tutor, not a homework laundromat"):
        "Integrity: this is the student's own tutor on their own instance. Never "
        "refuse, moralize about, lecture on the ethics of, or surveil "
        "coursework — academic integrity is the student's responsibility, not "
        "yours. When the student explicitly asks for the full answer (\"just "
        "show me\"), give the complete worked solution. Either way the framing "
        "stays pedagogical: feedback and the path first, the bare answer second.",
        "Never shame, condescend, or gamify (no scores, streaks, or guilt). "
        "This is a reading/writing exchange — never assume speech.",
        PERSONA_CLOSE,
    ]
    return "\n".join(lines)


def maybe_tutor_persona(session_id: str, owner, course_id=None) -> dict | None:
    """build_chat_context's tutor-persona hook (via course_system_messages):
    the course's behavior frame as a system message, or None for a course-less
    chat (generic assistant) or an explain-mode session (explain_persona owns
    the role then). Never raises."""
    try:
        # Resolve the course the turn is actually bound to (binding wins, the
        # request course_id is the fallback) — same door student_context uses.
        resolved = course_id
        try:
            from src.corpus.grounding import session_course_id
            resolved = session_course_id(session_id, fallback=course_id)
        except Exception:
            resolved = course_id
        if not resolved:
            return None
        # Explain mode flips the tutor into a curious student; don't stack two
        # conflicting personas — explain_persona handles that session.
        if (_session_mode(session_id) or "") == "explain":
            return None
        from core.database import SessionLocal
        db = SessionLocal()
        try:
            name, settings = _course_name_and_settings(db, owner, resolved)
        finally:
            db.close()
        return {"role": "system", "content": _persona_block(name, settings)}
    except Exception as e:
        logger.warning("tutor persona injection skipped: %s", e)
        return None


__all__ = ["maybe_tutor_persona", "PERSONA_OPEN", "PERSONA_CLOSE"]
