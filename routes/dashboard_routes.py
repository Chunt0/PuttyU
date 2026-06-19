# routes/dashboard_routes.py
"""Dashboard aggregator (Phase-2 T5, SPEC F11 — the landing surface).

ONE read-only route that composes the practice review count, weak spots, recent
tutor insights, and reading recommendations. Contract (CONTRACT D3):

  * Read-only. owner_scoped (Gate 5) — every read threads `user`.
  * Degrades per-section: EACH card is wrapped in its own try/except so a single
    failure returns [] / 0 and the route NEVER 500s the landing page (mirrors
    student_context's never-raise contract).
  * review_count is a PURE read via items.due_concepts — it NEVER calls
    /api/practice/queue (which mints items / hits the LLM).
  * Graph access ONLY through src.graph.queries / src.practice.items (Gate 6f);
    corpus ONLY through src.corpus.course_search (via src.dashboard).
"""

import logging
from typing import Optional

from fastapi import APIRouter, Request

from core.database import SessionLocal
from src.auth_helpers import get_current_user
from src.request_models import DashboardResponse

logger = logging.getLogger(__name__)

# The daily review push cap (mirrors routes.practice_routes.DAILY_CAP) — the
# count reflects the same finite, calm queue the Gym would assemble.
DAILY_CAP = 10
# How many due concepts surface as weak spots on the dashboard.
WEAK_SPOTS = 3


def setup_dashboard_routes() -> APIRouter:
    router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

    @router.get("", response_model=DashboardResponse)
    def dashboard(request: Request, course_id: Optional[str] = None):
        """Compose the landing surface. course_id scopes to one course; omitted
        spans all active courses (the Home dashboard). Read-only; never 500s."""
        from src.practice import items
        from src.graph import queries

        user = get_current_user(request)
        db = SessionLocal()
        try:
            # due_concepts is a PURE read (no minting) — computed once and reused
            # for both the review count and the weak-spots / reading cards.
            due: list[dict] = []
            try:
                due = items.due_concepts(db, user, course_id, limit=DAILY_CAP)
            except Exception:
                logger.debug("[dashboard] due_concepts failed", exc_info=True)
                due = []

            review_count = 0
            try:
                review_count = len(due)
            except Exception:
                review_count = 0

            weak_spots: list[dict] = []
            try:
                weak_spots = list(due[:WEAK_SPOTS])
            except Exception:
                logger.debug("[dashboard] weak_spots failed", exc_info=True)
                weak_spots = []

            insights: list[dict] = []
            try:
                insights = queries.recent_insights(db, user, course_id, limit=5)
            except Exception:
                logger.debug("[dashboard] insights failed", exc_info=True)
                insights = []

            reading: list[dict] = []
            try:
                from src import dashboard as dashboard_helper
                # Prefer the due frontier; fall back to the course region so a
                # course with no evidence yet still gets reading recommendations.
                concepts = due
                if not concepts and course_id:
                    concepts = queries.region_concepts(db, course_id, user)
                reading = dashboard_helper.reading_recs(db, user, concepts)
            except Exception:
                logger.debug("[dashboard] reading recs failed", exc_info=True)
                reading = []

            return {
                "review_count": review_count,
                "weak_spots": weak_spots,
                "insights": insights,
                "reading": reading,
            }
        finally:
            db.close()

    return router
