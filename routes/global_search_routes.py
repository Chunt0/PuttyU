# routes/global_search_routes.py
"""Cmd-K global search (Phase-2 T5 vertical-5, SPEC F11 — "one keystroke finds anything").

ONE read-only route that composes a flat result list across six surfaces — courses,
notes, materials, sessions, todos, and graph concepts — so the palette can jump to the
right surface for whatever the user types. Contract: docs/T5-CMDK-CONTRACT.md (D1-D4).

Invariants (all gated):
  * Read-only, GET query params only (no raw request-body parsing — Gate 6c trivially).
  * response_model (Gate 6b).
  * owner_scoped on every DB-model bucket (Gate 5); materials via
    course_search.visible_sources_query (owner-scoped inside); concepts ONLY via
    queries.search_concepts (owner-scoped inside) — this route is NOT on the Gate-6f
    allowlist, so it NEVER imports the graph ORM / queries graph tables directly.
  * Degrades PER BUCKET: each bucket is its own try/except, so a missing corpus/graph
    table (or any failure) yields an empty bucket, never a 500 (mirrors the dashboard
    aggregator's never-raise contract).
  * Blank q → {"query": "", "results": []} BEFORE a DB session is opened.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Request
from sqlalchemy import or_

from core.database import SessionLocal, Course, Note, Todo, Session as DBSession
from src.auth_helpers import get_current_user, owner_scoped
from src.request_models import GlobalSearchResponse

logger = logging.getLogger(__name__)

# Per-kind result cap (clamped from the `limit` query param).
DEFAULT_LIMIT = 8
MAX_LIMIT = 25
# How much of a note's body to surface as the result subtitle.
_SNIPPET = 120


def _snippet(text: Optional[str], n: int = _SNIPPET) -> Optional[str]:
    s = (text or "").strip()
    if not s:
        return None
    s = " ".join(s.split())
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def setup_global_search_routes() -> APIRouter:
    router = APIRouter(prefix="/api", tags=["search"])

    @router.get("/cmdk", response_model=GlobalSearchResponse)
    def cmdk(
        request: Request,
        q: str = "",
        limit: Optional[int] = None,
        course_id: Optional[str] = None,
    ):
        """Global palette search. `q` is matched case-insensitively across six
        kinds; `course_id` narrows materials + concepts to that course's region;
        `limit` caps each kind. Read-only; degrades per bucket; never 500s."""
        user = get_current_user(request)
        q = (q or "").strip()
        if not q:
            return {"query": "", "results": []}

        per_kind = max(1, min(int(limit or DEFAULT_LIMIT), MAX_LIMIT))
        like = f"%{q}%"
        results: list[dict] = []

        db = SessionLocal()
        try:
            # --- courses -------------------------------------------------------
            try:
                rows = (
                    owner_scoped(db.query(Course), Course, user)
                    .filter(Course.name.ilike(like))
                    .order_by(Course.created_at.asc())
                    .limit(per_kind)
                    .all()
                )
                for c in rows:
                    results.append({"kind": "course", "id": c.id, "title": c.name})
            except Exception:
                logger.debug("[cmdk] course bucket failed", exc_info=True)

            # --- notes (title OR content; exclude archived) --------------------
            try:
                rows = (
                    owner_scoped(db.query(Note), Note, user)
                    .filter(Note.archived == False)  # noqa: E712
                    .filter(or_(Note.title.ilike(like), Note.content.ilike(like)))
                    .order_by(Note.updated_at.desc())
                    .limit(per_kind)
                    .all()
                )
                for n in rows:
                    results.append({
                        "kind": "note",
                        "id": n.id,
                        "title": n.title or "",
                        "subtitle": _snippet(n.content),
                        "course_id": n.course_id,
                    })
            except Exception:
                logger.debug("[cmdk] note bucket failed", exc_info=True)

            # --- todos (open only: done_at IS NULL) ----------------------------
            try:
                rows = (
                    owner_scoped(db.query(Todo), Todo, user)
                    .filter(Todo.done_at.is_(None))
                    .filter(Todo.text.ilike(like))
                    .order_by(Todo.created_at.desc())
                    .limit(per_kind)
                    .all()
                )
                for t in rows:
                    results.append({
                        "kind": "todo",
                        "id": t.id,
                        "title": t.text or "",
                        "course_id": t.course_id,
                    })
            except Exception:
                logger.debug("[cmdk] todo bucket failed", exc_info=True)

            # --- sessions (exclude archived; most-recent first) ----------------
            try:
                rows = (
                    owner_scoped(db.query(DBSession), DBSession, user)
                    .filter(DBSession.archived == False)  # noqa: E712
                    .filter(DBSession.name.ilike(like))
                    .order_by(DBSession.last_message_at.desc())
                    .limit(per_kind)
                    .all()
                )
                for s in rows:
                    results.append({"kind": "session", "id": s.id, "title": s.name or ""})
            except Exception:
                logger.debug("[cmdk] session bucket failed", exc_info=True)

            # --- materials (corpus sources; guard the table not existing) ------
            try:
                from src.corpus.course_search import visible_sources_query
                from src.corpus.models import CorpusSource

                q_mat = visible_sources_query(db, user).filter(
                    CorpusSource.title.ilike(like)
                )
                if course_id:
                    from src.corpus.course_search import course_source_ids
                    ids = course_source_ids(db, course_id, user)
                    q_mat = q_mat.filter(CorpusSource.id.in_(ids or [""]))
                rows = q_mat.order_by(CorpusSource.title.asc()).limit(per_kind).all()
                for src in rows:
                    subtitle = src.subject or src.authors or None
                    results.append({
                        "kind": "material",
                        "id": src.id,
                        "source_id": src.id,
                        "title": src.title or "",
                        "subtitle": subtitle,
                    })
            except Exception:
                # corpus tables may be absent (src/corpus manages its own) — empty
                # bucket, never a 500 (CONTRACT D2 "guard the table").
                logger.debug("[cmdk] material bucket failed", exc_info=True)

            # --- concepts (Gate 6f — ONLY through the graph one-door) ----------
            try:
                from src.graph import queries

                concepts = queries.search_concepts(
                    db, user, q, limit=per_kind, course_id=course_id
                )
                # The concept's trajectory deep-link needs its OWNING course; the
                # request course_id is None for a global search, so resolve it from
                # the concept's sources via each active course's region.
                src_to_course: dict = {}
                if not course_id and concepts:
                    from src.corpus.course_search import course_source_ids
                    active = owner_scoped(db.query(Course), Course, user).filter(
                        Course.status == "active").all()
                    for crs in active:
                        for sid in course_source_ids(db, crs.id, user):
                            src_to_course.setdefault(sid, crs.id)
                for c in concepts:
                    heading = " > ".join(c.get("heading_path") or [])
                    owning = course_id
                    if not owning:
                        for sid in (c.get("sources") or []):
                            if sid in src_to_course:
                                owning = src_to_course[sid]
                                break
                    results.append({
                        "kind": "concept",
                        "id": c["id"],
                        "title": c.get("name") or "",
                        "subtitle": heading or None,
                        "course_id": owning,
                    })
            except Exception:
                logger.debug("[cmdk] concept bucket failed", exc_info=True)

            return {"query": q, "results": results}
        finally:
            db.close()

    return router
