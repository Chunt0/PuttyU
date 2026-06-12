"""Phase-2 T1 (ADR 0004) — course CRUD, archive semantics, source linking,
and owner scoping on routes/course_routes.py.

Calls the route handlers directly (extracted from the router) with a minimal
fake request, against a temp-file sqlite DB — the same pattern as
test_caldav_writeback_route.py (TestClient threadpools can hang in CI).
"""

import tempfile
import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

import core.database as cdb
import routes.course_routes as croutes
from core.database import Course, CourseSource, Session as DbSession
from src.request_models import (
    CourseCreateRequest,
    CourseUpdateRequest,
    CourseSourcesUpdateRequest,
)

_TMPDB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_ENGINE = create_engine(
    f"sqlite:///{_TMPDB.name}",
    connect_args={"check_same_thread": False},
    poolclass=NullPool,
)
cdb.Base.metadata.create_all(_ENGINE)
# Other test modules (test_corpus_*) register the corpus models on the SHARED
# declarative Base, so depending on import order create_all may have created
# corpus_source here. Drop it: this module's baseline is "corpus tables absent"
# (the present-case test creates its own raw table).
with _ENGINE.begin() as _conn:
    _conn.execute(text("DROP TABLE IF EXISTS corpus_chunk"))
    _conn.execute(text("DROP TABLE IF EXISTS corpus_source"))
_TS = sessionmaker(bind=_ENGINE, autoflush=False, autocommit=False)
croutes.SessionLocal = _TS
croutes.engine = _ENGINE  # _known_corpus_source_ids inspects this


def _req(user="ada"):
    return SimpleNamespace(state=SimpleNamespace(current_user=user))


_ROUTER = croutes.setup_course_routes()


def _endpoint(method, suffix):
    for r in _ROUTER.routes:
        if getattr(r, "path", "").endswith(suffix) and method in getattr(r, "methods", set()):
            return r.endpoint
    raise RuntimeError(f"{method} *{suffix} not found")


list_courses = _endpoint("GET", "/api/courses")
create_course = _endpoint("POST", "/api/courses")
get_course = _endpoint("GET", "/{course_id}")
update_course = _endpoint("PATCH", "/{course_id}")
archive_course = _endpoint("POST", "/{course_id}/archive")
unarchive_course = _endpoint("POST", "/{course_id}/unarchive")
list_sources = _endpoint("GET", "/{course_id}/sources")
replace_sources = _endpoint("PUT", "/{course_id}/sources")


def _create(name="AP Statistics", user="ada", settings=None):
    return create_course(_req(user), CourseCreateRequest(name=name, settings=settings))


# ---------------------------------------------------------------- CRUD


def test_create_and_get_course_free_form_name():
    c = _create(name="Mandarin 2 ")
    assert c["name"] == "Mandarin 2"  # trimmed, free-form (no catalog)
    assert c["status"] == "active"
    assert c["settings"] == {}
    got = get_course(_req(), c["id"])
    assert got["id"] == c["id"] and got["name"] == "Mandarin 2"


def test_create_requires_nonempty_name():
    with pytest.raises(HTTPException) as e:
        _create(name="   ")
    assert e.value.status_code == 400


def test_patch_name_and_settings():
    c = _create(name="Calc")
    updated = update_course(_req(), c["id"], CourseUpdateRequest(name="Calculus 1"))
    assert updated["name"] == "Calculus 1"
    updated = update_course(
        _req(), c["id"], CourseUpdateRequest(settings={"scaffolding": "high"})
    )
    assert updated["settings"] == {"scaffolding": "high"}
    assert updated["name"] == "Calculus 1"  # untouched by settings-only patch


# ---------------------------------------------------------------- archive


def test_archive_hides_from_active_and_retains_scoped_data():
    c = _create(name="Victorian Lit")
    sid = str(uuid.uuid4())
    db = _TS()
    try:
        db.add(DbSession(id=sid, name="lit chat", endpoint_url="", model="m",
                         owner="ada", course_id=c["id"]))
        db.commit()
    finally:
        db.close()

    archived = archive_course(_req(), c["id"])
    assert archived["status"] == "archived"
    assert archived["archived_at"] is not None

    active_ids = {x["id"] for x in list_courses(_req(), archived=False)["courses"]}
    assert c["id"] not in active_ids
    archived_ids = {x["id"] for x in list_courses(_req(), archived=True)["courses"]}
    assert c["id"] in archived_ids
    all_ids = {x["id"] for x in list_courses(_req(), archived=None)["courses"]}
    assert c["id"] in all_ids

    # Scoped data is RETAINED (no cascade, no hard delete).
    db = _TS()
    try:
        row = db.query(DbSession).filter(DbSession.id == sid).first()
        assert row is not None and row.course_id == c["id"]
    finally:
        db.close()

    restored = unarchive_course(_req(), c["id"])
    assert restored["status"] == "active" and restored["archived_at"] is None
    assert c["id"] in {x["id"] for x in list_courses(_req(), archived=False)["courses"]}


# ---------------------------------------------------------------- sources


def test_replace_sources_verbatim_when_corpus_tables_absent():
    c = _create()
    res = replace_sources(
        _req(), c["id"], CourseSourcesUpdateRequest(source_ids=["src-1", "src-2", "src-1", " "])
    )
    assert res["source_ids"] == ["src-1", "src-2"]  # deduped, empties dropped
    assert res["note"]  # honest: accepted unverified
    got = list_sources(_req(), c["id"])
    assert got["source_ids"] == ["src-1", "src-2"]

    # Replace is wholesale, not additive.
    res = replace_sources(_req(), c["id"], CourseSourcesUpdateRequest(source_ids=["src-3"]))
    assert res["source_ids"] == ["src-3"]
    assert list_sources(_req(), c["id"])["source_ids"] == ["src-3"]

    # Emptying the set clears the note too.
    res = replace_sources(_req(), c["id"], CourseSourcesUpdateRequest(source_ids=[]))
    assert res["source_ids"] == [] and res["note"] is None


def test_replace_sources_validates_against_corpus_table_when_present():
    c = _create()
    with _ENGINE.begin() as conn:
        conn.execute(text("CREATE TABLE IF NOT EXISTS corpus_source (id TEXT PRIMARY KEY)"))
        conn.execute(text("DELETE FROM corpus_source"))
        conn.execute(text("INSERT INTO corpus_source (id) VALUES ('openstax-stats')"))
    try:
        res = replace_sources(
            _req(), c["id"], CourseSourcesUpdateRequest(source_ids=["openstax-stats"])
        )
        assert res["source_ids"] == ["openstax-stats"] and res["note"] is None

        with pytest.raises(HTTPException) as e:
            replace_sources(
                _req(), c["id"], CourseSourcesUpdateRequest(source_ids=["nope-404"])
            )
        assert e.value.status_code == 400
        # Failed replace did not clobber the stored links.
        assert list_sources(_req(), c["id"])["source_ids"] == ["openstax-stats"]
    finally:
        with _ENGINE.begin() as conn:
            conn.execute(text("DROP TABLE IF EXISTS corpus_source"))


# ---------------------------------------------------------------- owner scoping (Gate 5)


def test_courses_are_owner_scoped():
    mine = _create(name="Ada's algebra", user="ada")
    theirs = _create(name="Bob's biology", user="bob")
    shared = _create(name="Legacy shared", user=None)

    ada_ids = {x["id"] for x in list_courses(_req("ada"), archived=None)["courses"]}
    assert mine["id"] in ada_ids
    assert shared["id"] in ada_ids  # legacy null-owner rule
    assert theirs["id"] not in ada_ids

    for fn in (get_course, archive_course, unarchive_course):
        with pytest.raises(HTTPException) as e:
            fn(_req("ada"), theirs["id"])
        assert e.value.status_code == 404

    with pytest.raises(HTTPException) as e:
        update_course(_req("ada"), theirs["id"], CourseUpdateRequest(name="hijack"))
    assert e.value.status_code == 404
    with pytest.raises(HTTPException) as e:
        replace_sources(_req("ada"), theirs["id"], CourseSourcesUpdateRequest(source_ids=["x"]))
    assert e.value.status_code == 404
