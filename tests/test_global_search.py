"""Phase-2 T5 vertical-5 (SPEC F11, CONTRACT D1/D2) — the Cmd-K global search
route (routes/global_search_routes.py).

Calls the route handler directly with a minimal fake request against a temp-file
sqlite DB — the same house pattern as test_dashboard_route.py / test_course_routes.py.

Verifies: a query matching across kinds returns the right FLAT results with the
correct kind + deep-link fields; archived notes/sessions + done todos are
EXCLUDED; an empty q short-circuits to empty; cross-owner rows never leak; and a
MISSING corpus table degrades to an empty material bucket (NOT a 500)."""

from __future__ import annotations

import tempfile
from types import SimpleNamespace

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

import core.database as cdb
import routes.global_search_routes as gsroutes
from core.database import (
    Course, CourseSource, Note, Todo, Session as DBSession, utcnow_naive,
)
from src.corpus.models import CorpusSource
from src.graph.models import ConceptNode, new_id

# --- Engine A: corpus + graph tables PRESENT (the happy path) ----------------
_TMPDB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_ENGINE = create_engine(
    f"sqlite:///{_TMPDB.name}",
    connect_args={"check_same_thread": False},
    poolclass=NullPool,
)
cdb.Base.metadata.create_all(_ENGINE)
_TS = sessionmaker(bind=_ENGINE, autoflush=False, autocommit=False)

_ROUTER = gsroutes.setup_global_search_routes()
cmdk = next(
    r.endpoint for r in _ROUTER.routes
    if getattr(r, "path", "").endswith("/api/cmdk")
    and "GET" in getattr(r, "methods", set())
)


def _req(user="ada"):
    return SimpleNamespace(state=SimpleNamespace(current_user=user))


def _run(ts, user="ada", **kw):
    """Run the handler with SessionLocal pointed at `ts`."""
    gsroutes.SessionLocal = ts
    return cmdk(_req(user), **kw)


def _ids_by_kind(results, kind):
    return {r["id"] for r in results if r["kind"] == kind}


def _seed(ts, owner="ada"):
    """Seed one of each kind matching the word 'sampling', plus an archived
    note + an archived session + a done todo (all matching) that must be
    EXCLUDED. Returns the dict of seeded ids."""
    suffix = new_id()[:8]
    ids = {
        "course": f"course-{suffix}",
        "note": f"note-{suffix}",
        "note_archived": f"notearch-{suffix}",
        "todo": f"todo-{suffix}",
        "todo_done": f"tododone-{suffix}",
        "session": f"sess-{suffix}",
        "session_archived": f"sessarch-{suffix}",
        "material": f"mat-{suffix}",
        "concept": f"con-{suffix}",
    }
    db = ts()
    try:
        db.add(Course(id=ids["course"], name="Sampling Methods", owner=owner,
                      status="active", settings="{}"))
        # Notes: one open (matches title), one archived (matches, must be hidden).
        db.add(Note(id=ids["note"], owner=owner, title="Sampling notes",
                    content="how to draw a random sample", archived=False,
                    course_id=ids["course"]))
        db.add(Note(id=ids["note_archived"], owner=owner, title="Old sampling",
                    content="archived sampling note", archived=True))
        # Todos: one open, one done (both match text).
        db.add(Todo(id=ids["todo"], owner=owner, text="revise sampling chapter",
                    course_id=ids["course"], done_at=None))
        db.add(Todo(id=ids["todo_done"], owner=owner, text="finished sampling drill",
                    done_at=utcnow_naive()))
        # Sessions: one active, one archived (both match name).
        db.add(DBSession(id=ids["session"], name="Sampling chat", owner=owner,
                         endpoint_url="http://x", model="m", archived=False,
                         last_message_at=utcnow_naive()))
        db.add(DBSession(id=ids["session_archived"], name="Sampling archived",
                         owner=owner, endpoint_url="http://x", model="m",
                         archived=True, last_message_at=utcnow_naive()))
        # Material (corpus source, owned) linked to the course.
        db.add(CorpusSource(id=ids["material"], source_type="textbook",
                            title="Sampling Theory", subject="Statistics",
                            authors="Author A", content_hash="h", status="ready",
                            owner=owner))
        db.add(CourseSource(course_id=ids["course"], source_id=ids["material"]))
        # Concept (graph), in the course region.
        db.add(ConceptNode(id=ids["concept"], name="Sampling distribution",
                           owner=owner, normalized_name="sampling distribution",
                           source_id=ids["material"],
                           heading_path=["Chapter 1", "Sampling"],
                           meta={"sources": [ids["material"]], "ordinal": 0}))
        db.commit()
    finally:
        db.close()
    return ids


def test_matches_across_kinds_with_deep_links():
    ids = _seed(_TS, owner="ada")
    out = _run(_TS, "ada", q="sampling", limit=10)
    assert out["query"] == "sampling"
    res = out["results"]

    # Every kind is represented.
    kinds = {r["kind"] for r in res}
    assert {"course", "note", "todo", "session", "material", "concept"} <= kinds

    # Course.
    assert ids["course"] in _ids_by_kind(res, "course")

    # Note carries a subtitle snippet + course_id deep-link.
    note = next(r for r in res if r["kind"] == "note" and r["id"] == ids["note"])
    assert note["title"] == "Sampling notes"
    assert note["subtitle"] and "random sample" in note["subtitle"]
    assert note["course_id"] == ids["course"]

    # Todo carries course_id.
    todo = next(r for r in res if r["kind"] == "todo" and r["id"] == ids["todo"])
    assert todo["course_id"] == ids["course"]

    # Session is present.
    assert ids["session"] in _ids_by_kind(res, "session")

    # Material carries id == source_id (the openPdf door) + subject subtitle.
    mat = next(r for r in res if r["kind"] == "material" and r["id"] == ids["material"])
    assert mat["source_id"] == ids["material"]
    assert mat["subtitle"] == "Statistics"

    # Concept carries the heading path subtitle + its OWNING course_id (the
    # trajectory door) — resolved from the concept's sources even though this is a
    # GLOBAL search with no course_id param (F1: the door would dead-end otherwise).
    con = next(r for r in res if r["kind"] == "concept" and r["id"] == ids["concept"])
    assert con["title"] == "Sampling distribution"
    assert con["subtitle"] == "Chapter 1 > Sampling"
    assert con["course_id"] == ids["course"]


def test_archived_and_done_excluded():
    ids = _seed(_TS, owner="bea")
    out = _run(_TS, "bea", q="sampling", limit=10)
    res = out["results"]
    assert ids["note_archived"] not in _ids_by_kind(res, "note")
    assert ids["session_archived"] not in _ids_by_kind(res, "session")
    assert ids["todo_done"] not in _ids_by_kind(res, "todo")
    # The open ones DO appear.
    assert ids["note"] in _ids_by_kind(res, "note")
    assert ids["session"] in _ids_by_kind(res, "session")
    assert ids["todo"] in _ids_by_kind(res, "todo")


def test_empty_query_short_circuits():
    out = _run(_TS, "ada", q="")
    assert out == {"query": "", "results": []}
    out = _run(_TS, "ada", q="   ")
    assert out == {"query": "", "results": []}


def test_cross_owner_isolation():
    ids = _seed(_TS, owner="carol")
    # A different owner searching the same term sees none of carol's rows.
    out = _run(_TS, "dave", q="sampling", limit=25)
    all_ids = {r["id"] for r in out["results"]}
    assert not (set(ids.values()) & all_ids)


def test_course_id_narrows_concepts_and_materials():
    ids = _seed(_TS, owner="erin")
    out = _run(_TS, "erin", q="sampling", limit=10, course_id=ids["course"])
    res = out["results"]
    # The in-region material + concept survive the course filter.
    assert ids["material"] in _ids_by_kind(res, "material")
    assert ids["concept"] in _ids_by_kind(res, "concept")


# --- Engine B: corpus tables ABSENT — material bucket must degrade, not 500 --
_TMPDB2 = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_ENGINE_NOCORPUS = create_engine(
    f"sqlite:///{_TMPDB2.name}",
    connect_args={"check_same_thread": False},
    poolclass=NullPool,
)
cdb.Base.metadata.create_all(_ENGINE_NOCORPUS)
# Import order may have created corpus tables on the shared Base — drop them so
# this engine's baseline is genuinely "corpus tables absent".
with _ENGINE_NOCORPUS.begin() as _conn:
    _conn.execute(text("DROP TABLE IF EXISTS corpus_chunk"))
    _conn.execute(text("DROP TABLE IF EXISTS corpus_source"))
_TS_NOCORPUS = sessionmaker(bind=_ENGINE_NOCORPUS, autoflush=False, autocommit=False)


def test_missing_corpus_table_degrades_to_empty_material_bucket():
    # Seed a course + concept that DO match, but no corpus table exists.
    suffix = new_id()[:8]
    db = _TS_NOCORPUS()
    try:
        db.add(Course(id=f"course-{suffix}", name="Sampling Survey",
                      owner="frank", status="active", settings="{}"))
        db.commit()
    finally:
        db.close()
    # Must NOT raise (no 500) — the material bucket is simply empty.
    out = _run(_TS_NOCORPUS, "frank", q="sampling", limit=10)
    res = out["results"]
    assert _ids_by_kind(res, "material") == set()
    # Other buckets still work (the course matched).
    assert f"course-{suffix}" in _ids_by_kind(res, "course")
