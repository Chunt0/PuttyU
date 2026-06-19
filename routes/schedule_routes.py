# routes/schedule_routes.py
"""Schedule-miner HTTP surface (Phase-2 T5 vertical-2 — SPEC F2).

Two thin typed adapters over the engine in ``src/schedule/``:

  POST /api/schedule/{source_id}/mine   → MineResponse   — READ-ONLY. Loads the
        material, runs the router extraction, diffs against existing miner rows,
        returns proposals. Writes NOTHING (the untrusted-content invariant).
  POST /api/schedule/{source_id}/apply  → MineApplyResponse — THE ONLY WRITER.
        Creates/updates the user-confirmed, unambiguous proposals.

Born small + typed: response_model on both (Gate 6b), Pydantic body on apply
(Gate 6c — no raw request.json()), owner resolved once via effective_user, the
SessionLocal try/finally pattern. Reads are owner-scoped; events scope through
the CalendarCal.owner join inside the engine. Model selection lives entirely in
the engine via model_router — no model-name literals here. The graph tables are
never touched (corpus + calendar + todo only).
"""

from fastapi import APIRouter, HTTPException, Request

from core.database import SessionLocal
from src.auth_helpers import effective_user
from src.schedule import miner
from src.schedule.schemas import (
    MineApplyRequest,
    MineApplyResponse,
    MineResponse,
)


def setup_schedule_routes() -> APIRouter:
    router = APIRouter(prefix="/api/schedule", tags=["schedule"])

    @router.post("/{source_id}/mine", response_model=MineResponse)
    async def mine_schedule(request: Request, source_id: str):
        """Propose schedule events + todos from a material. Read-only — nothing
        is written. 404 when the material isn't visible to the caller; 503 when
        no model is configured for schedule mining."""
        user = effective_user(request)
        db = SessionLocal()
        try:
            result = await miner.mine(db, user, source_id)
            if result is False:
                raise HTTPException(404, "Material not found")
            if result is None:
                raise HTTPException(503, "No model configured for schedule mining")
            return result
        finally:
            db.close()

    @router.post("/{source_id}/apply", response_model=MineApplyResponse)
    def apply_proposals(request: Request, source_id: str, body: MineApplyRequest):
        """Apply the user-confirmed proposals as calendar events + todos. The
        only writer; idempotent (updates miner rows in place by proposal_key)."""
        user = effective_user(request)
        db = SessionLocal()
        try:
            return miner.apply(db, user, source_id, body.items)
        finally:
            db.close()

    return router
