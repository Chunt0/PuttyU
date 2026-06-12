# routes/course_routes.py
"""Course CRUD + archive + library-source linking (Phase-2 T1, ADR 0004).

Born small and typed: every endpoint carries a response_model (Gate 6b), bodies
are Pydantic (Gate 6c — no raw request.json()), and every query goes through
owner_scoped (Gate 5). Archive is a status flip — sessions, notes, mastery
history and the graph region scoped to the course are retained (no hard delete
in v1).
"""

import json
import uuid
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import inspect as sa_inspect, text

from core.database import SessionLocal, Course, CourseSource, engine, utcnow_naive
from src.auth_helpers import get_current_user, owner_scoped
from src.request_models import (
    CourseCreateRequest,
    CourseUpdateRequest,
    CourseResponse,
    CourseListResponse,
    CourseSourcesUpdateRequest,
    CourseSourcesResponse,
)

logger = logging.getLogger(__name__)

_UNVERIFIED_NOTE = (
    "corpus tables not present — source ids accepted verbatim (unverified)"
)


def _course_to_dict(course: Course) -> dict:
    try:
        settings = json.loads(course.settings) if course.settings else {}
        if not isinstance(settings, dict):
            settings = {}
    except (json.JSONDecodeError, TypeError):
        settings = {}
    return {
        "id": course.id,
        "name": course.name,
        "status": course.status,
        "owner": course.owner,
        "settings": settings,
        "created_at": course.created_at.isoformat() if course.created_at else None,
        "updated_at": course.updated_at.isoformat() if course.updated_at else None,
        "archived_at": course.archived_at.isoformat() if course.archived_at else None,
    }


def _get_owned_course(db, course_id: str, user) -> Course:
    """Fetch a course visible to `user` (Gate 5) or 404."""
    q = db.query(Course).filter(Course.id == course_id)
    course = owner_scoped(q, Course, user).first()
    if not course:
        raise HTTPException(404, "Course not found")
    return course


def _known_corpus_source_ids() -> Optional[set]:
    """The set of corpus_source ids, or None when the corpus tables don't
    exist yet (src/corpus manages its own tables and isn't wired into
    init_db — ADR 0003 / Slice-3 scope decision). None = accept ids verbatim.
    """
    try:
        if not sa_inspect(engine).has_table("corpus_source"):
            return None
        with engine.connect() as conn:
            rows = conn.execute(text("SELECT id FROM corpus_source")).fetchall()
        return {r[0] for r in rows}
    except Exception as e:  # malformed/legacy table — don't block linking
        logger.warning(f"corpus_source lookup failed; accepting ids verbatim: {e}")
        return None


def setup_course_routes() -> APIRouter:
    router = APIRouter(prefix="/api/courses", tags=["courses"])

    # --- LIST -------------------------------------------------------------
    @router.get("", response_model=CourseListResponse)
    def list_courses(request: Request, archived: Optional[bool] = None):
        """All of the caller's courses. `archived=true` → archived only,
        `archived=false` → active only, omitted → everything (the frontend
        filters by status for tabs vs. the manage-courses view)."""
        user = get_current_user(request)
        db = SessionLocal()
        try:
            q = owner_scoped(db.query(Course), Course, user)
            if archived is True:
                q = q.filter(Course.status == "archived")
            elif archived is False:
                q = q.filter(Course.status == "active")
            courses = q.order_by(Course.created_at.asc()).all()
            return {"courses": [_course_to_dict(c) for c in courses]}
        finally:
            db.close()

    # --- CREATE -----------------------------------------------------------
    @router.post("", response_model=CourseResponse)
    def create_course(request: Request, body: CourseCreateRequest):
        """Create a course from a free-form name (no fixed catalog — F1)."""
        user = get_current_user(request)
        name = (body.name or "").strip()
        if not name:
            raise HTTPException(400, "Course name is required")
        db = SessionLocal()
        try:
            course = Course(
                id=str(uuid.uuid4()),
                name=name,
                status="active",
                owner=user,
                settings=json.dumps(body.settings or {}),
            )
            db.add(course)
            db.commit()
            db.refresh(course)
            return _course_to_dict(course)
        finally:
            db.close()

    # --- GET ONE ----------------------------------------------------------
    @router.get("/{course_id}", response_model=CourseResponse)
    def get_course(request: Request, course_id: str):
        user = get_current_user(request)
        db = SessionLocal()
        try:
            return _course_to_dict(_get_owned_course(db, course_id, user))
        finally:
            db.close()

    # --- UPDATE (name / settings) ------------------------------------------
    @router.patch("/{course_id}", response_model=CourseResponse)
    def update_course(request: Request, course_id: str, body: CourseUpdateRequest):
        user = get_current_user(request)
        db = SessionLocal()
        try:
            course = _get_owned_course(db, course_id, user)
            if body.name is not None:
                name = body.name.strip()
                if not name:
                    raise HTTPException(400, "Course name cannot be empty")
                course.name = name
            if body.settings is not None:
                course.settings = json.dumps(body.settings)
            db.commit()
            db.refresh(course)
            return _course_to_dict(course)
        finally:
            db.close()

    # --- ARCHIVE / UNARCHIVE ------------------------------------------------
    @router.post("/{course_id}/archive", response_model=CourseResponse)
    def archive_course(request: Request, course_id: str):
        """Status flip only: the tab disappears, scoped data is retained."""
        user = get_current_user(request)
        db = SessionLocal()
        try:
            course = _get_owned_course(db, course_id, user)
            course.status = "archived"
            course.archived_at = utcnow_naive()
            db.commit()
            db.refresh(course)
            return _course_to_dict(course)
        finally:
            db.close()

    @router.post("/{course_id}/unarchive", response_model=CourseResponse)
    def unarchive_course(request: Request, course_id: str):
        user = get_current_user(request)
        db = SessionLocal()
        try:
            course = _get_owned_course(db, course_id, user)
            course.status = "active"
            course.archived_at = None
            db.commit()
            db.refresh(course)
            return _course_to_dict(course)
        finally:
            db.close()

    # --- SOURCE LINKS (course ↔ shared-library sources) ----------------------
    @router.get("/{course_id}/sources", response_model=CourseSourcesResponse)
    def list_course_sources(request: Request, course_id: str):
        user = get_current_user(request)
        db = SessionLocal()
        try:
            _get_owned_course(db, course_id, user)
            links = (
                db.query(CourseSource)
                .filter(CourseSource.course_id == course_id)
                .order_by(CourseSource.added_at.asc(), CourseSource.source_id.asc())
                .all()
            )
            return {"course_id": course_id, "source_ids": [l.source_id for l in links]}
        finally:
            db.close()

    @router.put("/{course_id}/sources", response_model=CourseSourcesResponse)
    def replace_course_sources(
        request: Request, course_id: str, body: CourseSourcesUpdateRequest
    ):
        """Replace the linked source-id set wholesale. Ids are validated
        against corpus_source when that table exists; otherwise (corpus not
        wired into init_db yet) they are stored verbatim with a note."""
        user = get_current_user(request)
        # Dedupe, preserve order, drop empties.
        seen: dict = {}
        for sid in body.source_ids:
            sid = (sid or "").strip()
            if sid:
                seen.setdefault(sid, None)
        source_ids = list(seen)

        db = SessionLocal()
        try:
            # Ownership FIRST (404 beats 400): never validate a body against a
            # course the caller can't see.
            _get_owned_course(db, course_id, user)

            note = None
            known = _known_corpus_source_ids()
            if known is None:
                note = _UNVERIFIED_NOTE if source_ids else None
            else:
                unknown = [s for s in source_ids if s not in known]
                if unknown:
                    raise HTTPException(400, f"Unknown library source ids: {', '.join(unknown)}")

            db.query(CourseSource).filter(CourseSource.course_id == course_id).delete()
            for sid in source_ids:
                db.add(CourseSource(course_id=course_id, source_id=sid))
            db.commit()
            return {"course_id": course_id, "source_ids": source_ids, "note": note}
        finally:
            db.close()

    return router
