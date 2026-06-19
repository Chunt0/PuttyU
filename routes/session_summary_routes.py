# routes/session_summary_routes.py
"""Phase-2 T5 vertical-4 (SPEC F9, contract D1) — on-demand session-summary note.

POST /api/sessions/{session_id}/summary draws the session into an editable
`source="agent"` course note. On-demand only (the explicit "I finished a
substantive session" signal) — never after-turn / never a builtin, so there is no
token churn (calm). Typed seam: response_model, no request body (path param only,
so no raw request.json()), strict session ownership (404 on a foreign/missing
session), owner-scoped writes attributed to the real human (effective_user).
"""

import logging

from fastapi import APIRouter, HTTPException, Request

from core.database import SessionLocal
from src import session_summary
from src.auth_helpers import effective_user
from src.request_models import SessionSummaryResponse

logger = logging.getLogger(__name__)


def setup_session_summary_routes(session_manager) -> APIRouter:
    router = APIRouter(prefix="/api/sessions", tags=["sessions"])

    @router.post("/{session_id}/summary", response_model=SessionSummaryResponse)
    async def summarize(request: Request, session_id: str):
        # effective_user: attribute the note write to the real owner (a paired
        # bearer client drafts into the owner's notes, not an "api" silo).
        user = effective_user(request)
        db = SessionLocal()
        try:
            result = await session_summary.summarize_session(
                session_manager, db, user, session_id)
        finally:
            db.close()
        if result.get("status") == session_summary.NOT_FOUND:
            raise HTTPException(404, "Session not found")
        return result

    return router
