"""Phase-2 T5 (contract D3) — the Note.course_id gap in routes/note_routes.py.

The `notes.course_id` column existed but the API ignored it. These tests prove
the round-trip: creating a note with course_id persists it + _note_to_dict
returns it, and list_notes?course_id= filters to that course only.

Direct-handler / temp-DB house pattern (test_course_routes.py).
"""

from __future__ import annotations

import tempfile
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

import core.database as cdb
import routes.note_routes as nroutes
from routes.note_routes import NoteCreate

_TMPDB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_ENGINE = create_engine(
    f"sqlite:///{_TMPDB.name}",
    connect_args={"check_same_thread": False},
    poolclass=NullPool,
)
cdb.Base.metadata.create_all(_ENGINE)
_TS = sessionmaker(bind=_ENGINE, autoflush=False, autocommit=False)
nroutes.SessionLocal = _TS


def _req(user="ada"):
    return SimpleNamespace(state=SimpleNamespace(current_user=user))


_ROUTER = nroutes.setup_note_routes()


def _endpoint(method, suffix):
    for r in _ROUTER.routes:
        if getattr(r, "path", "").endswith(suffix) and method in getattr(r, "methods", set()):
            return r.endpoint
    raise RuntimeError(f"{method} *{suffix} not found")


create_note = _endpoint("POST", "/api/notes")
list_notes = _endpoint("GET", "/api/notes")


def test_create_note_persists_and_returns_course_id():
    out = create_note(_req(), NoteCreate(title="Stats note", content="hi",
                                         course_id="course-stats"))
    assert out["course_id"] == "course-stats"
    # round-trips through _note_to_dict on a fresh read too
    db = _TS()
    try:
        from core.database import Note
        row = db.query(Note).filter(Note.id == out["id"]).first()
        assert row.course_id == "course-stats"
        assert nroutes._note_to_dict(row)["course_id"] == "course-stats"
    finally:
        db.close()


def test_create_note_without_course_id_is_null():
    out = create_note(_req(), NoteCreate(title="Loose note"))
    assert out["course_id"] is None


def test_list_notes_filters_by_course_id():
    create_note(_req(), NoteCreate(title="A", course_id="course-A"))
    create_note(_req(), NoteCreate(title="B", course_id="course-B"))
    create_note(_req(), NoteCreate(title="Loose"))  # no course

    res = list_notes(_req(), course_id="course-A")
    titles = {n["title"] for n in res["notes"]}
    assert "A" in titles
    assert "B" not in titles
    assert "Loose" not in titles
    # every returned note is in the filtered course
    assert all(n["course_id"] == "course-A" for n in res["notes"])

    # no filter -> all of this owner's active notes are visible
    res_all = list_notes(_req())
    all_titles = {n["title"] for n in res_all["notes"]}
    assert {"A", "B", "Loose"} <= all_titles
