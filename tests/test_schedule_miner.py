"""Phase-2 T5 vertical-2 (SPEC F2) — the schedule miner's READ-ONLY mine() pass
on src/schedule/miner.py.

Covers: extraction over a seeded syllabus material → proposals incl. an
ambiguous item (date=None, question set); the no-LLM guard (router resolves to
nothing → mine returns None); and the idempotent diff tags (a prior miner row
→ unchanged/changed; a removed item → stale). The LLM is mocked via monkeypatch
on src.llm_core.llm_call_async (canned JSON); model_router.resolve is patched to
a usable routed target. Isolated temp-file sqlite DB. mine() WRITES NOTHING.
"""

import asyncio
import json
import tempfile

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

import core.database as cdb
from src.corpus.models import CorpusChunk, CorpusSource
from src.schedule import miner

_TMPDB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_ENGINE = create_engine(
    f"sqlite:///{_TMPDB.name}",
    connect_args={"check_same_thread": False},
    poolclass=NullPool,
)
cdb.Base.metadata.create_all(_ENGINE)
_TS = sessionmaker(bind=_ENGINE, autoflush=False, autocommit=False)

OWNER = "ada"
SRC_ID = "syllabus-1"


class _Routed:
    endpoint_url = "http://x/v1/chat/completions"
    model = "test-model"
    headers: dict = {}


def _seed_source(db, source_id=SRC_ID, owner=OWNER, course_id="course-1"):
    src = CorpusSource(
        id=source_id, source_type="material", title="Stats 101 syllabus",
        owner=owner, course_id=course_id, content_hash="h", status="ready",
    )
    db.add(src)
    db.add(CorpusChunk(
        id=f"{source_id}:0", source_id=source_id, ordinal=0, kind="prose",
        heading_path=["Schedule"], text="Midterm exam on 2026-03-15.",
        locator={"kind": "page", "start": 2}, content_hash="c0",
    ))
    db.add(CorpusChunk(
        id=f"{source_id}:1", source_id=source_id, ordinal=1, kind="prose",
        heading_path=["Schedule"], text="Problem set 1 due 2026-02-01.",
        locator={"kind": "page", "start": 3}, content_hash="c1",
    ))
    db.commit()


# Canned extraction: an event, a todo, and an ambiguous (date=null) item.
_CANNED_ITEMS = {
    "items": [
        {"kind": "event", "type": "exam", "title": "Midterm exam",
         "date": "2026-03-15", "all_day": True, "page": 2,
         "ambiguous": False, "question": None},
        {"kind": "todo", "type": "problem_set", "title": "Problem set 1",
         "date": "2026-02-01", "all_day": True, "page": 3,
         "ambiguous": False, "question": None},
        {"kind": "todo", "type": "problem_set", "title": "Problem set 5",
         "date": None, "all_day": True, "page": 3, "ambiguous": True,
         "question": "couldn't resolve 'Week 5' — when does week 1 start?"},
    ]
}


def _patch_llm(monkeypatch, items=None, routed=None):
    payload = json.dumps(items if items is not None else _CANNED_ITEMS)
    routed = routed or _Routed()

    async def _fake_call(url, model, messages, **kw):
        return payload

    monkeypatch.setattr("src.llm_core.llm_call_async", _fake_call)
    import src.model_router as mr
    monkeypatch.setattr(mr, "resolve", lambda *a, **k: routed)


def _mine(db):
    return asyncio.run(miner.mine(db, OWNER, SRC_ID))


# --------------------------------------------------------------------------- #
def test_mine_returns_proposals_with_ambiguous(monkeypatch):
    db = _TS()
    try:
        _seed_source(db)
        _patch_llm(monkeypatch)
        res = _mine(db)
        assert res["source_id"] == SRC_ID
        assert res["title"] == "Stats 101 syllabus"
        assert "add to calendar and todos" in res["summary"]
        props = res["proposals"]
        assert len(props) == 3
        kinds = {p["title"]: p["kind"] for p in props}
        assert kinds["Midterm exam"] == "event"
        assert kinds["Problem set 1"] == "todo"
        # The ambiguous item: date=None, ambiguous=True, question carried.
        amb = next(p for p in props if p["title"] == "Problem set 5")
        assert amb["date"] is None
        assert amb["ambiguous"] is True
        assert amb["question"]
        # Every proposal is tagged "new" (no prior ledger rows) + has a key.
        assert all(p["status"] == "new" for p in props)
        assert all(p["key"] for p in props)
        # Provenance citation references the source page.
        ev = next(p for p in props if p["kind"] == "event")
        assert "p. 2" in (ev["citation"] or "")
        # WRITES NOTHING — no events/todos persisted by mine().
        assert db.query(cdb.CalendarEvent).count() == 0
        assert db.query(cdb.Todo).count() == 0
    finally:
        db.close()
        _cleanup(db)


def test_mine_no_llm_guard(monkeypatch):
    db = _TS()
    try:
        _seed_source(db)
        # router resolves to a target with no endpoint/model → no-LLM guard.
        empty = type("R", (), {"endpoint_url": "", "model": "", "headers": {}})()
        import src.model_router as mr
        monkeypatch.setattr(mr, "resolve", lambda *a, **k: empty)
        res = _mine(db)
        assert res is None
    finally:
        db.close()
        _cleanup(db)


def test_mine_404_when_not_visible(monkeypatch):
    db = _TS()
    try:
        _patch_llm(monkeypatch)
        # No source seeded → not visible → False sentinel (route maps to 404).
        res = _mine(db)
        assert res is False
    finally:
        db.close()
        _cleanup(db)


def test_mine_diff_unchanged_changed_stale(monkeypatch):
    db = _TS()
    try:
        _seed_source(db)
        _patch_llm(monkeypatch)
        # Apply the canned set first so the ledger has miner rows.
        res = _mine(db)
        from src.schedule.schemas import MineApplyItem
        items = [MineApplyItem(**{
            "key": p["key"], "kind": p["kind"], "title": p["title"],
            "date": p["date"], "all_day": p["all_day"], "page": p["page"],
            "accepted": True, "existing_id": p["existing_id"],
        }) for p in res["proposals"] if p["date"]]
        miner.apply(db, OWNER, SRC_ID, items)

        # Re-mine with: same midterm (unchanged), a moved PS1 date (changed),
        # PS5 dropped entirely (its prior row... wasn't created since date=None),
        # and the ambiguous PS5 gone (stale only for rows that exist).
        changed = {
            "items": [
                {"kind": "event", "type": "exam", "title": "Midterm exam",
                 "date": "2026-03-15", "all_day": True, "page": 2},
                {"kind": "todo", "type": "problem_set", "title": "Problem set 1",
                 "date": "2026-02-08", "all_day": True, "page": 3},
            ]
        }
        _patch_llm(monkeypatch, items=changed)
        res2 = _mine(db)
        by_title = {p["title"]: p for p in res2["proposals"]}
        assert by_title["Midterm exam"]["status"] == "unchanged"
        assert by_title["Midterm exam"]["existing_id"]
        assert by_title["Problem set 1"]["status"] == "changed"
        assert by_title["Problem set 1"]["existing_id"]
        # No stale rows: PS5 never created a row (ambiguous date=None skipped on apply).
        assert not any(p["status"] == "stale" for p in res2["proposals"])

        # Now drop PS1 from the extraction → its existing row becomes stale.
        only_midterm = {
            "items": [
                {"kind": "event", "type": "exam", "title": "Midterm exam",
                 "date": "2026-03-15", "all_day": True, "page": 2},
            ]
        }
        _patch_llm(monkeypatch, items=only_midterm)
        res3 = _mine(db)
        stale = [p for p in res3["proposals"] if p["status"] == "stale"]
        assert len(stale) == 1
        assert stale[0]["title"] == "Problem set 1"
        assert stale[0]["kind"] == "todo"
    finally:
        db.close()
        _cleanup(db)


# --------------------------------------------------------------------------- #
# F3 — two distinct items sharing kind+title (recurring "Quiz" across a         #
# syllabus) must NOT collide on one proposal_key. An occurrence ordinal folded  #
# into the key (assigned 0,1,2… in document order) keeps each occurrence's key  #
# distinct: apply creates 2 rows, the re-mine sees BOTH (neither orphaned), and  #
# re-apply is idempotent (still 2, not 4). A moved DATE stays "changed".         #
# --------------------------------------------------------------------------- #
def _apply_dated(db, res):
    from src.schedule.schemas import MineApplyItem
    items = [MineApplyItem(**{
        "key": p["key"], "kind": p["kind"], "title": p["title"],
        "date": p["date"], "all_day": p["all_day"], "page": p["page"],
        "accepted": True, "existing_id": p["existing_id"],
    }) for p in res["proposals"] if p["date"] and p["status"] != "stale"]
    return miner.apply(db, OWNER, SRC_ID, items)


def test_mine_same_title_recurring_items_get_distinct_keys(monkeypatch):
    db = _TS()
    try:
        _seed_source(db)
        # Two same-kind/same-title "Quiz" todos on different dates.
        twoquiz = {"items": [
            {"kind": "todo", "type": "quiz", "title": "Quiz",
             "date": "2026-02-10", "all_day": True, "page": 1},
            {"kind": "todo", "type": "quiz", "title": "Quiz",
             "date": "2026-03-10", "all_day": True, "page": 2},
        ]}
        _patch_llm(monkeypatch, items=twoquiz)
        res = _mine(db)
        keys = [p["key"] for p in res["proposals"]]
        assert len(keys) == 2
        assert keys[0] != keys[1]                       # distinct keys (no collision)
        assert all(p["status"] == "new" for p in res["proposals"])

        # Apply → 2 distinct rows (not 1 double-created).
        _apply_dated(db, res)
        assert db.query(cdb.Todo).count() == 2

        # Re-mine the SAME source text → BOTH occurrences seen, neither orphaned
        # (no "stale"); ordinals are stable so each matches its row.
        res2 = _mine(db)
        statuses = [p["status"] for p in res2["proposals"]]
        assert len(res2["proposals"]) == 2
        assert all(s == "unchanged" for s in statuses)
        assert not any(p["status"] == "stale" for p in res2["proposals"])

        # Re-apply is idempotent: still 2 rows, not 4.
        _apply_dated(db, res2)
        assert db.query(cdb.Todo).count() == 2

        # A moved date on the 2nd occurrence stays "changed" (same key), not new.
        moved = {"items": [
            {"kind": "todo", "type": "quiz", "title": "Quiz",
             "date": "2026-02-10", "all_day": True, "page": 1},
            {"kind": "todo", "type": "quiz", "title": "Quiz",
             "date": "2026-03-17", "all_day": True, "page": 2},  # moved
        ]}
        _patch_llm(monkeypatch, items=moved)
        res3 = _mine(db)
        s3 = sorted(p["status"] for p in res3["proposals"])
        assert s3 == ["changed", "unchanged"]
        _apply_dated(db, res3)
        assert db.query(cdb.Todo).count() == 2          # still 2, updated in place
    finally:
        db.close()
        _cleanup(db)


def _cleanup(_db):
    s = _TS()
    try:
        s.query(cdb.CalendarEvent).delete()
        s.query(cdb.Todo).delete()
        s.query(cdb.CalendarCal).delete()
        s.query(CorpusChunk).delete()
        s.query(CorpusSource).delete()
        s.commit()
    finally:
        s.close()
