"""Phase-2 T5 (SPEC F11) — the dashboard aggregator (routes/dashboard_routes.py).

Verifies the 4-key shape against a seeded graph + corpus, that review_count
reflects items.due_concepts (a PURE read), that the route NEVER mints (it
survives items.item_for_concept being broken — proving it uses due_concepts, not
the minting queue), and that a per-section failure degrades to []/0 rather than
500ing the landing page.

Calls the route handler directly with a minimal fake request, against a
temp-file sqlite DB — the same pattern as test_course_routes.py.
"""

from __future__ import annotations

import tempfile
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

import core.database as cdb
import routes.dashboard_routes as droutes
from core.database import Course, CourseSource
from src.corpus.models import CorpusChunk, CorpusSource
from src.graph import mastery, queries
from src.graph.models import Assertion, ConceptNode, new_id

_TMPDB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_ENGINE = create_engine(
    f"sqlite:///{_TMPDB.name}",
    connect_args={"check_same_thread": False},
    poolclass=NullPool,
)
cdb.Base.metadata.create_all(_ENGINE)
_TS = sessionmaker(bind=_ENGINE, autoflush=False, autocommit=False)
droutes.SessionLocal = _TS


def _req(user="ada"):
    return SimpleNamespace(state=SimpleNamespace(current_user=user))


_ROUTER = droutes.setup_dashboard_routes()
dashboard = next(r.endpoint for r in _ROUTER.routes
                 if getattr(r, "path", "").endswith("/api/dashboard")
                 and "GET" in getattr(r, "methods", set()))


def _seed(owner="ada"):
    """Seed an isolated course/source/concept set (unique ids per call, since the
    test module shares one persistent engine across tests). Returns (course_id,
    k0_id) — k0 is the in-region concept the seeded insight points at."""
    suffix = new_id()[:8]
    course_id = f"c-{suffix}"
    sid = f"s-{suffix}"
    k0, k1 = f"k0-{suffix}", f"k1-{suffix}"
    db = _TS()
    try:
        db.add(Course(id=course_id, name="AP Statistics", owner=owner,
                      status="active", settings="{}"))
        db.add(CorpusSource(id=sid, source_type="textbook", title="Intro Stats",
                            content_hash="h", status="ready", owner=owner))
        db.add(CourseSource(course_id=course_id, source_id=sid))
        # Two chunks give the TOC headings + page_start for reading recs.
        db.add(CorpusChunk(id=f"{sid}:0", source_id=sid, ordinal=0, kind="prose",
                           heading_path=["Chapter 1", "Sampling"], text="about sampling",
                           locator={"kind": "page", "start": 12, "end": 14},
                           content_hash="c0"))
        db.add(CorpusChunk(id=f"{sid}:1", source_id=sid, ordinal=1, kind="prose",
                           heading_path=["Chapter 1", "Frequency"], text="about frequency",
                           locator={"kind": "page", "start": 20}, content_hash="c1"))
        for i, (cid, name, hp) in enumerate([
            (k0, "Sampling", ["Chapter 1", "Sampling"]),
            (k1, "Frequency", ["Chapter 1", "Frequency"]),
        ]):
            db.add(ConceptNode(id=cid, name=name, normalized_name=name.lower(),
                               source_id=sid, owner=owner, heading_path=hp,
                               meta={"sources": [sid], "ordinal": i}))
        # Evidence makes the concepts DUE (have evidence, non-mastered).
        db.add(Assertion(id=new_id(), subject_type="student", subject_id="student",
                         relation="struggles_with", kind="inferred",
                         literal="tends to confuse sampling and population",
                         confidence=0.7, object_type="concept", object_id=k0,
                         owner=owner))
        db.commit()
        # Make k0 / k1 due via incorrect evidence (uses the graph write door).
        mastery.apply_evidence(k0, "incorrect", owner=owner, db=db)
        mastery.apply_evidence(k1, "incorrect", owner=owner, db=db)
        db.commit()
    finally:
        db.close()
    return course_id, k0


def test_dashboard_shape_and_review_count():
    course_id, k0 = _seed(owner="ada")
    out = dashboard(_req("ada"), course_id=course_id)
    assert set(out) == {"review_count", "weak_spots", "insights", "reading"}
    assert isinstance(out["review_count"], int)
    assert isinstance(out["weak_spots"], list)
    assert isinstance(out["insights"], list)
    assert isinstance(out["reading"], list)

    # review_count reflects items.due_concepts (a pure read).
    db = _TS()
    try:
        from src.practice import items
        expected = len(items.due_concepts(db, "ada", course_id, limit=droutes.DAILY_CAP))
    finally:
        db.close()
    assert out["review_count"] == expected == 2

    # weak_spots carry the DueConcept shape (deep-links the Gym).
    assert out["weak_spots"]
    ws = out["weak_spots"][0]
    assert "concept_id" in ws and "name" in ws and "course_id" in ws

    # insights came through the new graph door, course-scoped.
    assert any("sampling" in (i.get("literal") or "").lower() for i in out["insights"])
    ins = out["insights"][0]
    assert ins.get("concept_id") == k0 and ins.get("concept_name") == "Sampling"

    # reading recs join concept -> source/heading -> page_start.
    assert out["reading"]
    rec = out["reading"][0]
    assert rec["source_id"].startswith("s-") and rec["title"] == "Intro Stats"
    assert rec["page_start"] is not None
    assert "citation" in rec
    # The top frontier concept is Sampling (ordinal 0) -> p.12; page_end is the
    # next TOC node's page (Frequency, p.20), discovered best-effort.
    assert rec["concept_name"] == "Sampling" and rec["page_start"] == 12
    assert rec.get("page_end") == 20


def test_dashboard_does_not_mint(monkeypatch):
    """The aggregator must use due_concepts, NEVER the minting queue. Break the
    minter: if the dashboard called it, this would error; it must still succeed."""
    course_id, _ = _seed(owner="nomint")

    async def _boom(*a, **k):
        raise RuntimeError("item_for_concept must NOT be called by the dashboard")

    from src.practice import items
    monkeypatch.setattr(items, "item_for_concept", _boom)

    out = dashboard(_req("nomint"), course_id=course_id)
    assert out["review_count"] == 2              # no 500, no mint, still counts


def test_dashboard_degrades_per_section(monkeypatch):
    """A section failure returns []/0, never a 500. Simulate insights blowing up
    and assert the route still returns the other cards."""
    course_id, _ = _seed(owner="degrade")

    def _boom(*a, **k):
        raise RuntimeError("insights backend down")

    monkeypatch.setattr(queries, "recent_insights", _boom)
    out = dashboard(_req("degrade"), course_id=course_id)
    assert out["insights"] == []                 # degraded, not raised
    assert out["review_count"] == 2              # other cards survived


def test_dashboard_empty_course_is_zero():
    """A course with no region / evidence degrades to []/0, never 500."""
    db = _TS()
    try:
        db.add(Course(id="empty", name="Empty Course", owner="ghost",
                      status="active", settings="{}"))
        db.commit()
    finally:
        db.close()
    out = dashboard(_req("ghost"), course_id="empty")
    assert out["review_count"] == 0
    assert out["weak_spots"] == [] and out["reading"] == []


def test_reading_rec_resolves_duplicate_leaf_to_own_chapter():
    """Regression (F2): when the same leaf heading ("Summary") appears under two
    chapters with different page_start, a concept under the SECOND chapter must
    resolve to the second chapter's page — not the first (the bare-leaf,
    first-occurrence-wins bug deep-linked the wrong page in openPdf)."""
    from src.dashboard import reading_recs

    suffix = new_id()[:8]
    sid = f"sdup-{suffix}"
    db = _TS()
    try:
        # Ch 1 (p.10) > Summary (p.18); Ch 5 (p.90) > Summary (p.98). Same leaf,
        # different pages — ordered chunks build the nested TOC.
        chunks = [
            (0, ["Chapter 1", "Intro"], 10),
            (1, ["Chapter 1", "Summary"], 18),
            (2, ["Chapter 5", "Intro"], 90),
            (3, ["Chapter 5", "Summary"], 98),
        ]
        for ordinal, hp, page in chunks:
            db.add(CorpusChunk(id=f"{sid}:{ordinal}", source_id=sid, ordinal=ordinal,
                               kind="prose", heading_path=hp, text="x",
                               locator={"kind": "page", "start": page},
                               content_hash=f"h{ordinal}"))
        db.add(CorpusSource(id=sid, source_type="textbook", title="Big Book",
                            content_hash="hb", status="ready", owner="ada"))
        db.commit()

        # A concept under Chapter 5 > Summary.
        concept = {
            "concept_id": "c-dup", "name": "Recap of 5",
            "sources": [sid], "heading_path": ["Chapter 5", "Summary"],
        }
        recs = reading_recs(db, "ada", [concept], limit=1)
    finally:
        db.close()

    assert len(recs) == 1
    rec = recs[0]
    assert rec["heading"] == "Summary"
    # The 2nd chapter's Summary page (98), NOT the 1st chapter's (18).
    assert rec["page_start"] == 98
