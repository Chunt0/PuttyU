"""
review_queue.py — the daily review-queue builtin (Phase-2 T4a / Phase C, SPEC F8).

A scheduled housekeeping action ("assemble_review_queue") that, once a day, sums
how many concepts are due for review across the owner's active courses and nudges
the user ONCE — calmly, not gamified. It does NOT mint items (those are minted on
demand when the user opens the queue via GET /api/practice/queue); it only counts
due concepts (the cheap pure-read ranking) and dispatches a single reminder.

Mirrors the graph-consolidation builtin pattern (returns ``(message, ok)``,
registered in EXACTLY three spots). ``raise TaskNoop`` when nothing is due so the
scheduler exits silently with nothing in the Activity log.

Invariants (CLAUDE.md + T4 contract):
  * Course reads are owner_scoped (Gate 5) — via items.due_concepts internally.
  * Graph access only through the engine (which uses src.graph.queries, Gate 6f).
  * Notifications go through the single dispatch path (note_routes.dispatch_reminder).
"""

from __future__ import annotations

import logging
from datetime import datetime

logger = logging.getLogger(__name__)


async def action_assemble_review_queue(owner: str, **kwargs) -> tuple[str, bool]:
    """Builtin scheduler action: count due review concepts across active courses
    and nudge the user once/day.

    Returns ``(message, ok)`` like every other builtin. Raises ``TaskNoop`` when
    nothing is due (the scheduler drops the run silently). No LLM.
    """
    from src.builtin_actions import TaskNoop
    try:
        from core.database import Course, SessionLocal
        from src.auth_helpers import owner_scoped
        from src.practice import items

        db = SessionLocal()
        try:
            courses = (owner_scoped(db.query(Course), Course, owner or None)
                       .filter(Course.status == "active").all())
            total = 0
            course_count = 0
            for course in courses:
                due = items.due_concepts(db, owner or None, course.id)
                n = len(due)
                if n > 0:
                    total += n
                    course_count += 1
        finally:
            db.close()

        if total == 0:
            raise TaskNoop("nothing due")

        from routes.note_routes import dispatch_reminder
        ymd = datetime.utcnow().strftime("%Y-%m-%d")
        course_word = "course" if course_count == 1 else "courses"
        item_word = "item" if total == 1 else "items"
        await dispatch_reminder(
            title="Review ready",
            note_body=f"{total} {item_word} due across {course_count} {course_word}",
            note_id=f"review-{owner or 'solo'}-{ymd}",
            owner=owner or "")
        msg = (f"Review queue: {total} {item_word} due across "
               f"{course_count} {course_word}")
        return msg, True
    except TaskNoop:
        raise
    except Exception as e:
        logger.error(f"assemble_review_queue failed: {e}")
        return f"Review queue failed: {e}", False


__all__ = ["action_assemble_review_queue"]
