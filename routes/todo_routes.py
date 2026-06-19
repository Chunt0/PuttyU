# routes/todo_routes.py
"""Todo CRUD + done-toggle (Phase-2 T5, ADR 0004 §Q12, SPEC F11).

Born small and typed (mirrors routes/course_routes.py): every endpoint carries a
response_model (Gate 6b), bodies are Pydantic (Gate 6c — no raw body parsing),
and every query goes through owner_scoped (Gate 5). NULL course_id = Home. v1
builds only source="manual" todos; tutor/miner proposals land in a later vertical
(always confirmed by the user — the untrusted-content invariant).
"""

import json
import uuid
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from core.database import SessionLocal, Todo, utcnow_naive
from src.auth_helpers import get_current_user, owner_scoped
from src.request_models import (
    TodoCreateRequest,
    TodoUpdateRequest,
    TodoResponse,
    TodoListResponse,
)

logger = logging.getLogger(__name__)


def _todo_to_dict(todo: Todo) -> dict:
    try:
        provenance = json.loads(todo.provenance) if todo.provenance else None
        if provenance is not None and not isinstance(provenance, dict):
            provenance = None
    except (json.JSONDecodeError, TypeError):
        provenance = None
    return {
        "id": todo.id,
        "owner": todo.owner,
        "course_id": todo.course_id,
        "text": todo.text,
        "due_date": todo.due_date,
        "done_at": todo.done_at.isoformat() if todo.done_at else None,
        "done": todo.done_at is not None,
        "source": todo.source or "manual",
        "provenance": provenance,
        "created_at": todo.created_at.isoformat() if todo.created_at else None,
        "updated_at": todo.updated_at.isoformat() if todo.updated_at else None,
    }


def _get_owned_todo(db, todo_id: str, user) -> Todo:
    """Fetch a todo visible to `user` (Gate 5) or 404."""
    q = db.query(Todo).filter(Todo.id == todo_id)
    todo = owner_scoped(q, Todo, user).first()
    if not todo:
        raise HTTPException(404, "Todo not found")
    return todo


def setup_todo_routes() -> APIRouter:
    router = APIRouter(prefix="/api/todos", tags=["todos"])

    # --- LIST -------------------------------------------------------------
    @router.get("", response_model=TodoListResponse)
    def list_todos(request: Request, course_id: Optional[str] = None,
                   done: Optional[bool] = None):
        """The caller's todos. `course_id` filters to one course (omit → all);
        `done=true` → completed only, `done=false` → open only, omitted → both."""
        user = get_current_user(request)
        db = SessionLocal()
        try:
            q = owner_scoped(db.query(Todo), Todo, user)
            if course_id is not None:
                q = q.filter(Todo.course_id == course_id)
            if done is True:
                q = q.filter(Todo.done_at.isnot(None))
            elif done is False:
                q = q.filter(Todo.done_at.is_(None))
            todos = q.order_by(Todo.created_at.asc()).all()
            return {"todos": [_todo_to_dict(t) for t in todos]}
        finally:
            db.close()

    # --- CREATE -----------------------------------------------------------
    @router.post("", response_model=TodoResponse)
    def create_todo(request: Request, body: TodoCreateRequest):
        """Create a manual todo. text is required; course_id null = Home."""
        user = get_current_user(request)
        text = (body.text or "").strip()
        if not text:
            raise HTTPException(400, "Todo text is required")
        db = SessionLocal()
        try:
            todo = Todo(
                id=str(uuid.uuid4()),
                owner=user,
                course_id=body.course_id,
                text=text,
                due_date=body.due_date,
                source="manual",
            )
            db.add(todo)
            db.commit()
            db.refresh(todo)
            return _todo_to_dict(todo)
        finally:
            db.close()

    # --- UPDATE (text / course / due) -------------------------------------
    @router.patch("/{todo_id}", response_model=TodoResponse)
    def update_todo(request: Request, todo_id: str, body: TodoUpdateRequest):
        user = get_current_user(request)
        db = SessionLocal()
        try:
            todo = _get_owned_todo(db, todo_id, user)
            if body.text is not None:
                text = body.text.strip()
                if not text:
                    raise HTTPException(400, "Todo text cannot be empty")
                todo.text = text
            # course_id and due_date are nullable: a PATCH carrying them sets the
            # value verbatim (including clearing to null) — extra="allow" means an
            # absent key never reaches the model, so we only act on what was sent.
            fields = body.model_dump(exclude_unset=True)
            if "course_id" in fields:
                todo.course_id = body.course_id
            if "due_date" in fields:
                todo.due_date = body.due_date
            db.commit()
            db.refresh(todo)
            return _todo_to_dict(todo)
        finally:
            db.close()

    # --- DONE TOGGLE ------------------------------------------------------
    @router.post("/{todo_id}/done", response_model=TodoResponse)
    def toggle_done(request: Request, todo_id: str, done: bool = True):
        """Mark done (stamps done_at=now) or reopen (clears done_at to null)."""
        user = get_current_user(request)
        db = SessionLocal()
        try:
            todo = _get_owned_todo(db, todo_id, user)
            todo.done_at = utcnow_naive() if done else None
            db.commit()
            db.refresh(todo)
            return _todo_to_dict(todo)
        finally:
            db.close()

    # --- DELETE -----------------------------------------------------------
    @router.delete("/{todo_id}", response_model=TodoResponse)
    def delete_todo(request: Request, todo_id: str):
        """Hard delete — todos are ephemeral (unlike courses, which archive)."""
        user = get_current_user(request)
        db = SessionLocal()
        try:
            todo = _get_owned_todo(db, todo_id, user)
            data = _todo_to_dict(todo)
            db.delete(todo)
            db.commit()
            return data
        finally:
            db.close()

    return router
