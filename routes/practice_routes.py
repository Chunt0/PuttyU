# routes/practice_routes.py
"""Practice-engine HTTP surface (Phase-2 T4a / Phase C — SPEC F8 practice +
F1 calibration).

Thin typed adapters over the fully-built practice engine in ``src/practice/``.
Born small and typed: every endpoint carries a ``response_model`` (Gate 6b),
bodies are Pydantic (Gate 6c — no raw body parsing), writes attribute to the
real owner via ``effective_user`` (mastery evidence is the user's, not the
sandboxed api pseudo-user). Reference answers never serialize here — they stay
server-side in ``src.practice.store`` (the engine returns client-safe shapes).

The minting/grading handlers are ``async`` (they await the items engine, which
may route to an LLM). The graph is touched ONLY through the engine, which goes
through ``src.graph.queries`` (Gate 6f). Model selection lives entirely inside
the engine via ``model_router`` — no model-name literals here.
"""

from fastapi import APIRouter, HTTPException, Request

from core.database import SessionLocal
from src.auth_helpers import effective_user
from src.practice import calibration, exam, explain, gym, items
from src.practice.schemas import (
    AnswerRequest,
    AnswerResponse,
    CalibrationAnswerRequest,
    CalibrationAnswerResponse,
    CalibrationFinishRequest,
    CalibrationFinishResponse,
    CalibrationStartRequest,
    CalibrationStartResponse,
    ExamStartRequest,
    ExamStartResponse,
    ExamSubmitRequest,
    ExamSubmitResponse,
    ExplainStartRequest,
    ExplainStartResponse,
    GymAnswerRequest,
    GymAnswerResponse,
    GymItemResponse,
    GymNextRequest,
    QueueResponse,
    WorksheetGradeRequest,
    WorksheetGradeResponse,
)

# The daily review push caps at this many minted items (SPEC F8 — the queue is a
# calm finite set, never an infinite feed).
DAILY_CAP = 10


def setup_practice_routes() -> APIRouter:
    router = APIRouter(prefix="/api/practice", tags=["practice"])

    # --- REVIEW QUEUE (the daily push) -----------------------------------
    @router.get("/queue", response_model=QueueResponse)
    async def review_queue(request: Request, course_id: str | None = None):
        """Assemble today's review queue: rank due concepts (D3/D4) and mint one
        item each (skipping concepts that can't produce one)."""
        user = effective_user(request)
        db = SessionLocal()
        try:
            due = items.due_concepts(db, user, course_id, limit=DAILY_CAP)
            minted = []
            for c in due:
                item = await items.item_for_concept(db, user, c, mode="review")
                if item is not None:
                    minted.append(item)
            return {
                "items": minted,
                "due": due,
                "count": len(minted),
                "course_id": course_id,
            }
        finally:
            db.close()

    @router.post("/queue/answer", response_model=AnswerResponse)
    async def answer_queue_item(request: Request, body: AnswerRequest):
        """Grade a queued review answer and write mastery evidence (D1/D2)."""
        user = effective_user(request)
        if not (body.item_key or "").strip():
            raise HTTPException(400, "item_key is required")
        db = SessionLocal()
        try:
            return await items.grade_answer(
                db, user, body.item_key,
                answer_text=body.answer_text,
                attachment_ids=body.attachment_ids)
        finally:
            db.close()

    # --- GYM (student-pulled adaptive sets) ------------------------------
    @router.post("/gym/next", response_model=GymItemResponse)
    async def gym_next(request: Request, body: GymNextRequest):
        """Mint the next gym item: drill a chosen concept, or coach's-pick the
        shakiest concept with errors (D5)."""
        user = effective_user(request)
        if not (body.course_id or "").strip():
            raise HTTPException(400, "course_id is required")
        db = SessionLocal()
        try:
            return await gym.next_item(
                db, user, body.course_id,
                concept_id=body.concept_id,
                difficulty=body.difficulty or 2)
        finally:
            db.close()

    @router.post("/gym/answer", response_model=GymAnswerResponse)
    async def gym_answer(request: Request, body: GymAnswerRequest):
        """Grade a gym item, step the ZPD difficulty, fold the running set
        totals (D5). Running totals ride extra='allow' — read defensively."""
        user = effective_user(request)
        if not (body.item_key or "").strip():
            raise HTTPException(400, "item_key is required")
        db = SessionLocal()
        try:
            return await gym.grade(
                db, user, body.item_key,
                answer_text=body.answer_text,
                attachment_ids=body.attachment_ids,
                difficulty=body.difficulty or 2,
                streak=body.streak or 0,
                attempted=int(getattr(body, "attempted", 0) or 0),
                correct=int(getattr(body, "correct", 0) or 0))
        finally:
            db.close()

    # --- CALIBRATION (the optional graph warm-up walk, F1) ---------------
    @router.post("/calibration/start", response_model=CalibrationStartResponse)
    async def calibration_start(request: Request, body: CalibrationStartRequest):
        """Open a calibration walk; an empty region returns status='no_region'
        and writes nothing (D8)."""
        user = effective_user(request)
        if not (body.course_id or "").strip():
            raise HTTPException(400, "course_id is required")
        db = SessionLocal()
        try:
            return await calibration.start(db, user, body.course_id)
        finally:
            db.close()

    @router.post("/calibration/answer", response_model=CalibrationAnswerResponse)
    async def calibration_answer(request: Request, body: CalibrationAnswerRequest):
        """Grade or skip the current calibration step and mint the next one."""
        user = effective_user(request)
        if not (body.session_key or "").strip():
            raise HTTPException(400, "session_key is required")
        db = SessionLocal()
        try:
            return await calibration.answer(
                db, user, body.session_key,
                item_key=body.item_key,
                answer_text=body.answer_text,
                attachment_ids=body.attachment_ids,
                skip=bool(getattr(body, "skip", False)))
        finally:
            db.close()

    @router.post("/calibration/finish", response_model=CalibrationFinishResponse)
    def calibration_finish(request: Request, body: CalibrationFinishRequest):
        """End the walk: stamp the course's calibrated_at and summarize the
        walked region's states (sync — pure reads + an owner_scoped write)."""
        user = effective_user(request)
        if not (body.session_key or "").strip():
            raise HTTPException(400, "session_key is required")
        db = SessionLocal()
        try:
            return calibration.finish(db, user, body.session_key)
        finally:
            db.close()

    # --- EXAM (timed mixed-topic simulation, silent until debrief D9) ----
    @router.post("/exam/start", response_model=ExamStartResponse)
    async def exam_start(request: Request, body: ExamStartRequest):
        """Assemble a timed, mixed-topic exam (prompts only — reference answers
        stay in the store, D9)."""
        user = effective_user(request)
        if not (body.course_id or "").strip():
            raise HTTPException(400, "course_id is required")
        db = SessionLocal()
        try:
            return await exam.start(
                db, user, body.course_id,
                duration_seconds=body.duration_seconds or 1800,
                n_items=body.n_items or 10)
        finally:
            db.close()

    @router.post("/exam/submit", response_model=ExamSubmitResponse)
    async def exam_submit(request: Request, body: ExamSubmitRequest):
        """Grade the whole exam at once and return the debrief (D9)."""
        user = effective_user(request)
        if not (body.exam_key or "").strip():
            raise HTTPException(400, "exam_key is required")
        db = SessionLocal()
        try:
            return await exam.submit(db, user, body.exam_key, body.answers)
        finally:
            db.close()

    # --- WORKSHEET (photograph handwritten work -> graded depth, F4) -----
    @router.post("/worksheet", response_model=WorksheetGradeResponse)
    async def grade_worksheet(request: Request, body: WorksheetGradeRequest):
        """Grade photographed/scanned handwritten work: per-problem verdicts that
        reference the student's actual lines, writing mastery evidence per
        resolved concept (D1-D3). No VL model -> setup_hint, never grade blind."""
        user = effective_user(request)
        if not (body.course_id or "").strip():
            raise HTTPException(400, "course_id is required")
        db = SessionLocal()
        try:
            return await items.grade_worksheet(
                db, user, body.course_id,
                attachment_ids=body.attachment_ids,
                guide=body.guide)
        finally:
            db.close()

    # --- EXPLAIN (explain-it-back chat session creation) -----------------
    @router.post("/explain/start", response_model=ExplainStartResponse)
    def explain_start(request: Request, body: ExplainStartRequest):
        """Create an explain-mode chat session bound to a concept (sync — the
        session manager opens its own SessionLocal)."""
        user = effective_user(request)
        if not (body.course_id or "").strip():
            raise HTTPException(400, "course_id is required")
        if not (body.concept_id or "").strip():
            raise HTTPException(400, "concept_id is required")
        db = SessionLocal()
        try:
            return explain.start(db, user, body.course_id, body.concept_id)
        finally:
            db.close()

    return router


__all__ = ["setup_practice_routes", "DAILY_CAP"]
