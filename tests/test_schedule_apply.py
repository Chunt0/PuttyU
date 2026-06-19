"""Phase-2 T5 vertical-2 (SPEC F2) — the schedule miner's WRITER apply() pass on
src/schedule/miner.py. apply() is the ONLY writer.

Covers: apply() creates a CalendarEvent (origin="miner", provenance with
proposal_key, on the owner's default calendar) AND a Todo (source="miner",
provenance); a "changed" item UPDATES the existing row in place (count stays 1);
re-apply of the same set is idempotent (no duplicates); an ambiguous/unaccepted
item is skipped; events are owner-scoped via the CalendarCal.owner join.
Isolated temp-file sqlite DB.
"""

import asyncio
import json
import tempfile

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

import core.database as cdb
from src.corpus.models import CorpusChunk, CorpusSource
from src.schedule import miner
from src.schedule.schemas import MineApplyItem

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
COURSE = "course-1"


def _seed_source(db):
    db.add(CorpusSource(
        id=SRC_ID, source_type="material", title="Stats 101 syllabus",
        owner=OWNER, course_id=COURSE, content_hash="h", status="ready"))
    db.commit()


def _key(kind, title):
    return miner._proposal_key(SRC_ID, kind, title)[0]


def _item(kind, title, date, **kw):
    return MineApplyItem(key=_key(kind, title), kind=kind, title=title,
                         date=date, **kw)


def _cleanup():
    s = _TS()
    try:
        s.query(cdb.CalendarEvent).delete()
        s.query(cdb.Todo).delete()
        s.query(cdb.CalendarCal).delete()
        s.query(CorpusSource).delete()
        s.commit()
    finally:
        s.close()


# --------------------------------------------------------------------------- #
def test_apply_creates_event_and_todo():
    db = _TS()
    try:
        _seed_source(db)
        items = [
            _item("event", "Midterm exam", "2026-03-15", page=2),
            _item("todo", "Problem set 1", "2026-02-01", page=3),
        ]
        counts = miner.apply(db, OWNER, SRC_ID, items)
        assert counts == {"created_events": 1, "created_todos": 1,
                          "updated": 0, "skipped": 0}

        ev = db.query(cdb.CalendarEvent).one()
        assert ev.summary == "Midterm exam"
        assert ev.origin == "miner"
        assert ev.course_id == COURSE
        prov = json.loads(ev.provenance)
        assert prov["source_id"] == SRC_ID
        assert prov["page"] == 2
        assert prov["proposal_key"] == _key("event", "Midterm exam")
        assert prov["line_hash"]
        # On the owner's default calendar.
        cal = db.query(cdb.CalendarCal).one()
        assert cal.owner == OWNER
        assert ev.calendar_id == cal.id

        td = db.query(cdb.Todo).one()
        assert td.text == "Problem set 1"
        assert td.source == "miner"
        assert td.due_date == "2026-02-01"
        assert td.owner == OWNER
        assert td.course_id == COURSE
        tprov = json.loads(td.provenance)
        assert tprov["proposal_key"] == _key("todo", "Problem set 1")
    finally:
        db.close()
        _cleanup()


def test_changed_updates_in_place():
    db = _TS()
    try:
        _seed_source(db)
        miner.apply(db, OWNER, SRC_ID,
                    [_item("todo", "Problem set 1", "2026-02-01")])
        assert db.query(cdb.Todo).count() == 1

        # Same proposal_key (title unchanged), new date → update in place.
        existing = db.query(cdb.Todo).one()
        counts = miner.apply(db, OWNER, SRC_ID, [
            _item("todo", "Problem set 1", "2026-02-08",
                  existing_id=existing.id)])
        assert counts["updated"] == 1
        assert counts["created_todos"] == 0
        assert db.query(cdb.Todo).count() == 1          # NOT duplicated
        assert db.query(cdb.Todo).one().due_date == "2026-02-08"
    finally:
        db.close()
        _cleanup()


def test_reapply_is_idempotent():
    db = _TS()
    try:
        _seed_source(db)
        items = [
            _item("event", "Midterm exam", "2026-03-15"),
            _item("todo", "Problem set 1", "2026-02-01"),
        ]
        miner.apply(db, OWNER, SRC_ID, items)
        counts2 = miner.apply(db, OWNER, SRC_ID, items)
        # Second apply matches by key → updates, never creates duplicates.
        assert counts2["created_events"] == 0
        assert counts2["created_todos"] == 0
        assert counts2["updated"] == 2
        assert db.query(cdb.CalendarEvent).count() == 1
        assert db.query(cdb.Todo).count() == 1
    finally:
        db.close()
        _cleanup()


def test_ambiguous_and_unaccepted_skipped():
    db = _TS()
    try:
        _seed_source(db)
        items = [
            _item("todo", "Problem set 5", None),                 # ambiguous: date None
            _item("event", "Optional review", "2026-04-01",
                  accepted=False),                                  # not accepted
            _item("todo", "Problem set 1", "2026-02-01"),          # the one good item
        ]
        counts = miner.apply(db, OWNER, SRC_ID, items)
        assert counts["skipped"] == 2
        assert counts["created_todos"] == 1
        assert counts["created_events"] == 0
        assert db.query(cdb.Todo).count() == 1
        assert db.query(cdb.CalendarEvent).count() == 0
    finally:
        db.close()
        _cleanup()


def test_events_are_owner_scoped_via_calendar_join():
    db = _TS()
    try:
        _seed_source(db)
        # ada creates a miner event.
        miner.apply(db, OWNER, SRC_ID, [_item("event", "Midterm exam", "2026-03-15")])
        # A different owner mining the same (visible-NULL would be different, but
        # this source is ada-owned) sees NONE of ada's miner events in its diff.
        ledger_other = miner._existing_event_rows(db, "bob", SRC_ID)
        assert ledger_other == {}
        ledger_ada = miner._existing_event_rows(db, OWNER, SRC_ID)
        assert len(ledger_ada) == 1
    finally:
        db.close()
        _cleanup()


# --------------------------------------------------------------------------- #
# F1 — event idempotency in single-user / auth-off mode (owner None or "").    #
# mine() READS events via CalendarCal.owner; apply() WROTE under FALLBACK_OWNER #
# (_ensure_default_calendar coalesces). If the miner doesn't coalesce too, the  #
# read NEVER matches the write → every re-apply duplicates. _resolve_owner()    #
# closes the gap; the calendar count must stay 1 across mine→apply→mine→apply.  #
# --------------------------------------------------------------------------- #
def _seed_library_source(db):
    """A library source (owner NULL) so it's visible to the single-user caller."""
    db.add(CorpusSource(
        id=SRC_ID, source_type="material", title="Stats 101 syllabus",
        owner=None, course_id=None, content_hash="h", status="ready"))
    db.add(CorpusChunk(
        id=f"{SRC_ID}:0", source_id=SRC_ID, ordinal=0, kind="prose",
        heading_path=["Schedule"], text="Midterm exam on 2026-03-15.",
        locator={"kind": "page", "start": 2}, content_hash="c0"))
    db.commit()


class _Routed:
    endpoint_url = "http://x/v1/chat/completions"
    model = "test-model"
    headers: dict = {}


def _patch_llm(monkeypatch, items):
    payload = json.dumps({"items": items})

    async def _fake_call(url, model, messages, **kw):
        return payload

    monkeypatch.setattr("src.llm_core.llm_call_async", _fake_call)
    import src.model_router as mr
    monkeypatch.setattr(mr, "resolve", lambda *a, **k: _Routed())


def _apply_from_mine(db, owner, mine_res):
    """Accept every dated proposal from a mine result and apply it."""
    items = [MineApplyItem(**{
        "key": p["key"], "kind": p["kind"], "title": p["title"],
        "date": p["date"], "all_day": p["all_day"], "page": p["page"],
        "accepted": True, "existing_id": p["existing_id"],
    }) for p in mine_res["proposals"] if p["date"] and p["status"] != "stale"]
    return miner.apply(db, owner, SRC_ID, items)


def _f1_cycle(owner):
    db = _TS()
    try:
        _seed_library_source(db)
        canned = [{"kind": "event", "type": "exam", "title": "Midterm exam",
                   "date": "2026-03-15", "all_day": True, "page": 2,
                   "ambiguous": False, "question": None}]
        import pytest
        mp = pytest.MonkeyPatch()
        try:
            _patch_llm(mp, canned)
            res1 = asyncio.run(miner.mine(db, owner, SRC_ID))
            _apply_from_mine(db, owner, res1)
            assert db.query(cdb.CalendarEvent).count() == 1

            # Re-mine then re-apply: the second mine must SEE the first row
            # (not "new") and the re-apply must NOT duplicate it.
            res2 = asyncio.run(miner.mine(db, owner, SRC_ID))
            statuses = {p["title"]: p["status"] for p in res2["proposals"]}
            assert statuses["Midterm exam"] in ("unchanged", "changed")
            assert statuses["Midterm exam"] != "new"
            _apply_from_mine(db, owner, res2)
            assert db.query(cdb.CalendarEvent).count() == 1  # still 1, no dup
        finally:
            mp.undo()
    finally:
        db.close()
        _cleanup()


def test_f1_no_duplicate_events_owner_none():
    _f1_cycle(None)


def test_f1_no_duplicate_events_owner_empty():
    _f1_cycle("")


# --------------------------------------------------------------------------- #
# F2 — a non-empty but unparseable date must NOT crash apply() nor void the     #
# batch. apply() wraps each item; a bad date → skipped+continue. The valid       #
# todo applied earlier in the same call must still commit.                      #
# --------------------------------------------------------------------------- #
def test_f2_bad_date_skips_not_fatal_and_preserves_valid_items():
    db = _TS()
    try:
        _seed_source(db)
        items = [
            _item("todo", "Problem set 1", "2026-02-01"),    # valid, applied first
            _item("event", "Final exam", "week 5"),          # unparseable date
            _item("event", "Lab tour", "2026-13-45"),        # impossible date
        ]
        counts = miner.apply(db, OWNER, SRC_ID, items)        # must not raise
        assert counts["skipped"] >= 1
        assert counts["created_todos"] == 1
        # The valid todo IS committed (not rolled back with the bad rows).
        assert db.query(cdb.Todo).count() == 1
        assert db.query(cdb.Todo).one().text == "Problem set 1"
        # The unparseable events created nothing.
        assert db.query(cdb.CalendarEvent).count() == 0
    finally:
        db.close()
        _cleanup()
