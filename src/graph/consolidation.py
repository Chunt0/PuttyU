"""
consolidation.py — the scheduled graph tidy pass (ADR 0005 §Writes).

The "dreaming" step (mandatory consolidation, memory_extractor tidy-pass
precedent), v1 WITHOUT any LLM:

  * merge duplicate entity nodes (same normalized_name per owner): keep the
    oldest, repoint assertions, union meta, delete the duplicates (entity
    nodes are mutable infrastructure — assertions, the receipts, are not);
  * decay stale INFERRED assertion confidences: active inferred assertions
    untouched for >60 days lose 20% confidence per run (x0.8); below 0.2
    they are invalidated (reason="decayed") — invalidated, never deleted.

Gated new-concept proposals join here later (closed-world concept growth).
Registered as the builtin scheduler action "graph_consolidation".
"""

from __future__ import annotations

import logging
from datetime import timedelta

from src.graph.models import (
    Assertion, EntityNode, ensure_graph_tables, utcnow,
)

logger = logging.getLogger(__name__)

STALE_AFTER_DAYS = 60
DECAY_FACTOR = 0.8
INVALIDATE_BELOW = 0.2


def merge_duplicate_entities(db, owner=None) -> int:
    """Merge entity nodes sharing a normalized_name (per owner). Returns the
    number of duplicate rows removed."""
    q = db.query(EntityNode).order_by(EntityNode.created_at, EntityNode.id)
    if owner:
        q = q.filter(EntityNode.owner == owner)
    groups: dict = {}
    for node in q.all():
        groups.setdefault((node.normalized_name, node.owner), []).append(node)
    removed = 0
    for (_norm, _own), nodes in groups.items():
        if len(nodes) < 2:
            continue
        keep, dupes = nodes[0], nodes[1:]
        meta = dict(keep.meta) if isinstance(keep.meta, dict) else {}
        for dupe in dupes:
            if isinstance(dupe.meta, dict):
                for k, v in dupe.meta.items():
                    meta.setdefault(k, v)
            db.query(Assertion).filter(
                Assertion.object_type == "entity",
                Assertion.object_id == dupe.id,
            ).update({Assertion.object_id: keep.id}, synchronize_session=False)
            db.query(Assertion).filter(
                Assertion.subject_type == "entity",
                Assertion.subject_id == dupe.id,
            ).update({Assertion.subject_id: keep.id}, synchronize_session=False)
            db.delete(dupe)
            removed += 1
        keep.meta = meta
    return removed


def decay_stale_insights(db, owner=None, now=None) -> tuple[int, int]:
    """x0.8 on inferred confidences untouched >60d; invalidate below 0.2.
    Returns (decayed, invalidated)."""
    now = now or utcnow()
    cutoff = now - timedelta(days=STALE_AFTER_DAYS)
    q = (db.query(Assertion)
         .filter(Assertion.kind == "inferred",
                 Assertion.invalidated_at.is_(None),
                 Assertion.valid_from < cutoff))
    if owner:
        q = q.filter(Assertion.owner == owner)
    decayed = invalidated = 0
    for a in q.all():
        conf = a.confidence if a.confidence is not None else 0.6
        conf *= DECAY_FACTOR
        a.confidence = round(conf, 4)
        decayed += 1
        if conf < INVALIDATE_BELOW:
            a.invalidated_at = now
            a.invalidation_reason = "decayed"
            invalidated += 1
    return decayed, invalidated


def consolidate(owner=None, db=None) -> dict:
    """Run the full tidy pass. Returns counters."""
    owner = owner or None
    own_session = db is None
    if own_session:
        from core.database import SessionLocal
        ensure_graph_tables()
        db = SessionLocal()
    try:
        merged = merge_duplicate_entities(db, owner)
        decayed, invalidated = decay_stale_insights(db, owner)
        db.commit()
        return {"merged_entities": merged, "decayed": decayed,
                "invalidated": invalidated}
    except Exception:
        db.rollback()
        raise
    finally:
        if own_session:
            db.close()


async def action_graph_consolidation(owner: str, **kwargs):
    """Builtin scheduler action (registered in src/builtin_actions.py).
    Returns (message, ok) like every other builtin action. No LLM in v1."""
    try:
        stats = consolidate(owner=owner or None)
        msg = (f"Graph consolidation: merged {stats['merged_entities']} duplicate "
               f"entit{'y' if stats['merged_entities'] == 1 else 'ies'}, decayed "
               f"{stats['decayed']} stale insight(s), invalidated "
               f"{stats['invalidated']}.")
        return msg, True
    except Exception as e:
        logger.error(f"graph_consolidation failed: {e}")
        return f"Graph consolidation failed: {e}", False
