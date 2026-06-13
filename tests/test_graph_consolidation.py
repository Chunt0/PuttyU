"""Phase-2 T3a (ADR 0005) — the graph consolidation tidy pass (no LLM in v1):
duplicate entity merge (assertions repointed), stale inferred-confidence decay
(x0.8 after 60d, invalidate <0.2), and the builtin scheduler action wrapper."""

import asyncio
from datetime import timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.graph import consolidation
from src.graph.models import (
    Assertion, EntityNode, ensure_graph_tables, new_id, utcnow,
)


@pytest.fixture
def db(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path/'g.db'}")
    ensure_graph_tables(bind=engine)
    sess = sessionmaker(bind=engine)()
    yield sess
    sess.close()


def _entity(db, name, owner="ada", created=None, **meta):
    node = EntityNode(id=new_id(), name=name,
                      normalized_name=name.strip().lower(), owner=owner,
                      meta=meta, created_at=created or utcnow())
    db.add(node)
    db.commit()
    return node


def _insight(db, literal, days_old=0, confidence=0.6, owner="ada"):
    a = Assertion(id=new_id(), subject_type="student", subject_id=owner,
                  relation="struggles_with", literal=literal, kind="inferred",
                  confidence=confidence,
                  valid_from=utcnow() - timedelta(days=days_old), owner=owner)
    db.add(a)
    db.commit()
    return a


def test_merges_duplicate_entities_and_repoints_assertions(db):
    keep = _entity(db, "ice cream", created=utcnow() - timedelta(days=2), flavor="mint")
    dupe = _entity(db, "ice cream", created=utcnow(), origin="chat")
    other = _entity(db, "physics lab")
    a = Assertion(id=new_id(), subject_type="student", subject_id="ada",
                  relation="likes", object_type="entity", object_id=dupe.id,
                  kind="stated", quote="I like ice cream", owner="ada")
    db.add(a)
    db.commit()

    stats = consolidation.consolidate(owner="ada", db=db)
    assert stats["merged_entities"] == 1
    remaining = db.query(EntityNode).all()
    assert {n.id for n in remaining} == {keep.id, other.id}   # oldest kept
    db.refresh(a)
    assert a.object_id == keep.id                              # repointed
    assert db.get(EntityNode, keep.id).meta == {"flavor": "mint", "origin": "chat"}


def test_decays_stale_inferred_and_invalidates_below_threshold(db):
    fresh = _insight(db, "fresh insight", days_old=5, confidence=0.9)
    stale = _insight(db, "stale insight", days_old=90, confidence=0.9)
    dying = _insight(db, "nearly dead", days_old=90, confidence=0.2)

    stats = consolidation.consolidate(owner="ada", db=db)
    assert stats["decayed"] == 2 and stats["invalidated"] == 1
    db.refresh(fresh); db.refresh(stale); db.refresh(dying)
    assert fresh.confidence == 0.9                # untouched (<60d)
    assert stale.confidence == pytest.approx(0.72)  # x0.8
    assert stale.invalidated_at is None
    assert dying.confidence == pytest.approx(0.16)
    assert dying.invalidated_at is not None        # invalidated, NOT deleted
    assert dying.invalidation_reason == "decayed"
    assert db.query(Assertion).count() == 3        # nothing erased (bi-temporal)


def test_stated_assertions_never_decay(db):
    a = Assertion(id=new_id(), subject_type="student", subject_id="ada",
                  relation="likes", literal="ice cream", kind="stated",
                  quote="I like ice cream",
                  valid_from=utcnow() - timedelta(days=400), owner="ada")
    db.add(a)
    db.commit()
    consolidation.consolidate(owner="ada", db=db)
    db.refresh(a)
    assert a.invalidated_at is None and a.confidence is None


def test_owner_scoping(db):
    _entity(db, "guitar", owner="ada")
    _entity(db, "guitar", owner="ada")
    _entity(db, "guitar", owner="bob")
    _entity(db, "guitar", owner="bob")
    stats = consolidation.consolidate(owner="ada", db=db)
    assert stats["merged_entities"] == 1           # only ada's pair merged
    assert db.query(EntityNode).filter_by(owner="bob").count() == 2


def test_builtin_action_wrapper(db, monkeypatch):
    import core.database as cdb
    _entity(db, "cat"); _entity(db, "cat")
    db.commit()
    bind = db.get_bind()
    monkeypatch.setattr(cdb, "SessionLocal", sessionmaker(bind=bind))
    msg, ok = asyncio.run(consolidation.action_graph_consolidation("ada"))
    assert ok is True
    assert "merged 1 duplicate" in msg


def test_action_registered_with_scheduler_defaults():
    from src.builtin_actions import BUILTIN_ACTIONS, BUILTIN_ACTION_INFO
    from src.task_scheduler import HOUSEKEEPING_DEFAULTS
    assert BUILTIN_ACTIONS["graph_consolidation"] is consolidation.action_graph_consolidation
    assert "graph_consolidation" in BUILTIN_ACTION_INFO
    defaults = HOUSEKEEPING_DEFAULTS["graph_consolidation"]
    assert defaults["schedule"] == "cron"          # weekly tidy
    assert defaults["cron_expression"].split()[-1] == "0"
