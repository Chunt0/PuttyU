"""Phase-2 T3a (ADR 0005) — the seeding TRIGGERS: linking new sources to a
course (PUT /api/courses/{id}/sources) and ingesting a course-bound material
both kick best-effort graph seeding; failures never break the request."""

import tempfile
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

import core.database as cdb
import routes.course_routes as croutes
import src.graph.seeding as seeding
from core.database import Course, CourseSource
from src.corpus.models import CorpusSource
from src.request_models import CourseSourcesUpdateRequest

_TMPDB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_ENGINE = create_engine(f"sqlite:///{_TMPDB.name}",
                        connect_args={"check_same_thread": False},
                        poolclass=NullPool)
cdb.Base.metadata.create_all(_ENGINE)
_TS = sessionmaker(bind=_ENGINE, autoflush=False, autocommit=False)


@pytest.fixture(autouse=True)
def _wire(monkeypatch):
    monkeypatch.setattr(croutes, "SessionLocal", _TS)
    monkeypatch.setattr(croutes, "engine", _ENGINE)
    db = _TS()
    try:
        db.query(CourseSource).delete()
        db.query(CorpusSource).delete()
        db.query(Course).delete()
        db.commit()
    finally:
        db.close()


_ROUTER = croutes.setup_course_routes()
_replace = next(r.endpoint for r in _ROUTER.routes
                if r.path.endswith("/sources") and "PUT" in r.methods)


def _req(user="ada"):
    return SimpleNamespace(state=SimpleNamespace(current_user=user))


def _world():
    db = _TS()
    try:
        db.add(Course(id="c1", name="Stats", owner="ada", settings="{}"))
        for sid in ("s1", "s2"):
            db.add(CorpusSource(id=sid, source_type="textbook", title=sid,
                                content_hash="h" + sid, status="ready"))
        db.commit()
    finally:
        db.close()


def test_put_sources_seeds_only_newly_added_links(monkeypatch):
    _world()
    calls = []
    monkeypatch.setattr(seeding, "seed_safely",
                        lambda course_id, sids, owner=None: calls.append(
                            (course_id, list(sids), owner)))
    _replace(_req(), "c1", CourseSourcesUpdateRequest(source_ids=["s1"]))
    assert calls == [("c1", ["s1"], "ada")]
    # re-PUT with s1 + s2: only the NEW link seeds (idempotent trigger)
    _replace(_req(), "c1", CourseSourcesUpdateRequest(source_ids=["s1", "s2"]))
    assert calls[-1] == ("c1", ["s2"], "ada")
    # no additions -> no seeding call
    n = len(calls)
    _replace(_req(), "c1", CourseSourcesUpdateRequest(source_ids=["s1", "s2"]))
    assert len(calls) == n


def test_seed_failure_never_breaks_the_put(monkeypatch):
    _world()

    def boom(course_id, source_id, owner=None, db=None):
        raise RuntimeError("seeding exploded")
    monkeypatch.setattr(seeding, "seed_course_region", boom)
    out = _replace(_req(), "c1", CourseSourcesUpdateRequest(source_ids=["s1"]))
    assert out["source_ids"] == ["s1"]   # seed_safely swallowed the failure


def test_material_upload_route_calls_seeding():
    """Source contract: the corpus materials route hands course-bound uploads
    to seed_safely (which itself skips plain-paragraph materials)."""
    from pathlib import Path
    src_text = (Path(__file__).resolve().parent.parent
                / "routes" / "corpus_routes.py").read_text(encoding="utf-8")
    assert "from src.graph.seeding import seed_safely" in src_text
    gate = src_text.index('if course_id and result["created"]')
    assert gate < src_text.index('seed_safely(course_id, [result["source_id"]]')
