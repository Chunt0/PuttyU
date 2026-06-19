"""Phase-2 T5 (ADR 0004 §Q12) — todo CRUD, done-toggle round-trip, the
?course_id/?done filters, create-requires-text, and owner scoping (Gate 5) on
routes/todo_routes.py.

Calls the route handlers directly (extracted from the router) with a minimal
fake request, against a temp-file sqlite DB — the same pattern as
test_course_routes.py (TestClient threadpools can hang in CI).
"""

import tempfile
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

import core.database as cdb
import routes.todo_routes as troutes
from src.request_models import TodoCreateRequest, TodoUpdateRequest

_TMPDB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_ENGINE = create_engine(
    f"sqlite:///{_TMPDB.name}",
    connect_args={"check_same_thread": False},
    poolclass=NullPool,
)
cdb.Base.metadata.create_all(_ENGINE)
_TS = sessionmaker(bind=_ENGINE, autoflush=False, autocommit=False)
troutes.SessionLocal = _TS


def _req(user="ada"):
    return SimpleNamespace(state=SimpleNamespace(current_user=user))


_ROUTER = troutes.setup_todo_routes()


def _endpoint(method, suffix):
    for r in _ROUTER.routes:
        if getattr(r, "path", "").endswith(suffix) and method in getattr(r, "methods", set()):
            return r.endpoint
    raise RuntimeError(f"{method} *{suffix} not found")


list_todos = _endpoint("GET", "/api/todos")
create_todo = _endpoint("POST", "/api/todos")
update_todo = _endpoint("PATCH", "/{todo_id}")
toggle_done = _endpoint("POST", "/{todo_id}/done")
delete_todo = _endpoint("DELETE", "/{todo_id}")


def _create(text="read chapter 3", user="ada", course_id=None, due_date=None):
    return create_todo(
        _req(user),
        TodoCreateRequest(text=text, course_id=course_id, due_date=due_date),
    )


# ---------------------------------------------------------------- CRUD


def test_create_trims_and_defaults():
    t = _create(text="  finish lab report  ")
    assert t["text"] == "finish lab report"     # trimmed
    assert t["source"] == "manual"              # v1 only mints manual
    assert t["done"] is False and t["done_at"] is None
    assert t["owner"] == "ada"
    assert t["provenance"] is None
    assert t["created_at"] is not None


def test_create_requires_text():
    with pytest.raises(HTTPException) as e:
        _create(text="   ")
    assert e.value.status_code == 400


def test_list_round_trip():
    user = "list-user"
    _create(text="a", user=user)
    _create(text="b", user=user)
    rows = list_todos(_req(user))["todos"]
    texts = {r["text"] for r in rows}
    assert {"a", "b"} <= texts


def test_patch_text_course_and_due():
    t = _create(text="orig", course_id=None)
    upd = update_todo(_req(), t["id"], TodoUpdateRequest(text="renamed"))
    assert upd["text"] == "renamed"
    upd = update_todo(_req(), t["id"],
                      TodoUpdateRequest(course_id="c-physics", due_date="2026-07-01"))
    assert upd["course_id"] == "c-physics"
    assert upd["due_date"] == "2026-07-01"
    assert upd["text"] == "renamed"            # untouched by the course/due patch


def test_patch_can_clear_nullable_fields():
    t = _create(text="x", course_id="c1", due_date="2026-01-01")
    upd = update_todo(_req(), t["id"],
                      TodoUpdateRequest(course_id=None, due_date=None))
    assert upd["course_id"] is None and upd["due_date"] is None


def test_patch_empty_text_400():
    t = _create(text="x")
    with pytest.raises(HTTPException) as e:
        update_todo(_req(), t["id"], TodoUpdateRequest(text="  "))
    assert e.value.status_code == 400


def test_delete_returns_row_and_removes():
    t = _create(text="ephemeral")
    out = delete_todo(_req(), t["id"])
    assert out["id"] == t["id"]
    with pytest.raises(HTTPException) as e:
        delete_todo(_req(), t["id"])            # gone now
    assert e.value.status_code == 404


# ---------------------------------------------------------------- done toggle


def test_done_toggle_round_trip():
    t = _create(text="toggle me")
    done = toggle_done(_req(), t["id"], done=True)
    assert done["done"] is True and done["done_at"] is not None
    reopened = toggle_done(_req(), t["id"], done=False)
    assert reopened["done"] is False and reopened["done_at"] is None


# ---------------------------------------------------------------- filters


def test_course_id_filter():
    user = "filter-course"
    a = _create(text="home todo", user=user, course_id=None)
    b = _create(text="phys todo", user=user, course_id="c-phys")
    only_phys = list_todos(_req(user), course_id="c-phys")["todos"]
    ids = {r["id"] for r in only_phys}
    assert b["id"] in ids and a["id"] not in ids


def test_done_filter():
    user = "filter-done"
    open_t = _create(text="still open", user=user)
    closed_t = _create(text="finished", user=user)
    toggle_done(_req(user), closed_t["id"], done=True)

    open_only = {r["id"] for r in list_todos(_req(user), done=False)["todos"]}
    done_only = {r["id"] for r in list_todos(_req(user), done=True)["todos"]}
    assert open_t["id"] in open_only and closed_t["id"] not in open_only
    assert closed_t["id"] in done_only and open_t["id"] not in done_only


# ---------------------------------------------------------------- owner scoping (Gate 5)


def test_todos_are_owner_scoped():
    mine = _create(text="ada's", user="owner-ada")
    theirs = _create(text="bob's", user="owner-bob")

    ada_ids = {x["id"] for x in list_todos(_req("owner-ada"))["todos"]}
    assert mine["id"] in ada_ids
    assert theirs["id"] not in ada_ids          # foreign owner invisible

    # A foreign owner's todo is 404 on every per-id endpoint (never another's row).
    for fn in (delete_todo,):
        with pytest.raises(HTTPException) as e:
            fn(_req("owner-ada"), theirs["id"])
        assert e.value.status_code == 404
    with pytest.raises(HTTPException) as e:
        update_todo(_req("owner-ada"), theirs["id"], TodoUpdateRequest(text="hijack"))
    assert e.value.status_code == 404
    with pytest.raises(HTTPException) as e:
        toggle_done(_req("owner-ada"), theirs["id"], done=True)
    assert e.value.status_code == 404
