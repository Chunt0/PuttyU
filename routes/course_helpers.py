# routes/course_helpers.py
"""Course-binding helpers for existing route files (Phase-2 T1, ADR 0004).

Lives outside session_routes.py on purpose: that file sits at its Gate-6a
allowlist ceiling, so its course additions are one-liners that delegate here.
"""

from fastapi import HTTPException

from core.database import Course, Session as DbSession, SessionLocal
from src.auth_helpers import owner_scoped


def bind_session_course(session_id: str, course_id: str, user) -> None:
    """Stamp `course_id` on a session row after validating that the course
    exists and is visible to `user` (Gate 5: owner_scoped, never an ad-hoc
    owner filter). 400 on an unknown or foreign course id."""
    db = SessionLocal()
    try:
        q = db.query(Course).filter(Course.id == course_id)
        if not owner_scoped(q, Course, user).first():
            raise HTTPException(400, "Unknown course")
        row = db.query(DbSession).filter(DbSession.id == session_id).first()
        if row is not None:
            row.course_id = course_id
            db.commit()
    finally:
        db.close()


def session_course_id(session_id: str):
    """The course_id stored on a session row (None when course-less/missing)."""
    db = SessionLocal()
    try:
        row = db.query(DbSession.course_id).filter(DbSession.id == session_id).first()
        return row[0] if row else None
    finally:
        db.close()
