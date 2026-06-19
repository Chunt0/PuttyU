"""
queries.py — the graph's PUBLIC read/write API for non-graph subsystems
(Phase-2 T4a). Gate 6f allows only src/graph/, src/student_context.py and
routes/graph_routes.py to touch the graph tables; everything the practice
engine (src/practice/) needs comes through these functions as PLAIN DICTS /
tuples — no ORM objects leak out, so call sites stay inside the one-door rule.

All functions take an open SQLAlchemy session (callers own the lifecycle) and
are pure reads, except record_evidence (a thin wrapper over the mastery write
door that returns the derived state as a plain tuple).
"""

from __future__ import annotations

from src.graph import mastery
from src.graph.models import (
    Assertion, ConceptNode, MasteryEvidence, MasteryState,
)


def _concept_dict(node: ConceptNode) -> dict:
    meta = node.meta if isinstance(node.meta, dict) else {}
    sources = list(meta.get("sources") or [])
    if node.source_id and node.source_id not in sources:
        sources.append(node.source_id)
    return {
        "id": node.id,
        "name": node.name,
        "heading_path": [h for h in (node.heading_path or []) if h],
        "ordinal": meta.get("ordinal", 0) if isinstance(meta.get("ordinal", 0), int) else 0,
        "sources": sources,
    }


def region_concepts(db, course_id: str, owner) -> list[dict]:
    """The course's concept region (uncapped, book/ordinal order) as dicts.
    Mirrors the extractor's source-intersection rule."""
    from src.corpus.course_search import course_source_ids
    source_ids = set(course_source_ids(db, course_id, owner))
    if not source_ids:
        return []
    q = db.query(ConceptNode)
    q = q.filter(ConceptNode.owner == owner) if owner else \
        q.filter(ConceptNode.owner.is_(None))
    out = []
    for node in q.all():
        d = _concept_dict(node)
        if set(d["sources"]) & source_ids:
            out.append(d)
    out.sort(key=lambda d: (d["ordinal"], d["id"]))
    return out


def concept_brief(db, concept_id: str, owner) -> dict | None:
    """One concept as a dict (with current state), or None / not visible."""
    q = db.query(ConceptNode).filter(ConceptNode.id == concept_id)
    q = q.filter(ConceptNode.owner == owner) if owner else \
        q.filter(ConceptNode.owner.is_(None))
    node = q.first()
    if node is None:
        return None
    d = _concept_dict(node)
    state, ep = mastery.state_of(db.get(MasteryState, node.id))
    d["state"], d["effective_p"] = state, ep
    return d


def states_for(db, concept_ids: list[str]) -> dict:
    """{concept_id: (state, effective_p, last_evidence_at)} — missing rows
    read as ("unknown", None, None), the unknown-is-not-zero rule."""
    rows = (db.query(MasteryState)
            .filter(MasteryState.concept_id.in_(concept_ids or [""])).all())
    by_id = {r.concept_id: r for r in rows}
    out = {}
    for cid in concept_ids:
        row = by_id.get(cid)
        state, ep = mastery.state_of(row)
        out[cid] = (state, ep, row.last_evidence_at if row else None)
    return out


def prereq_out_degree(db, concept_ids: list[str]) -> dict:
    """{concept_id: number of region concepts it is prerequisite_of} — the
    'foundational-ness' signal for due-item ranking."""
    ids = set(concept_ids or [])
    rows = (db.query(Assertion.subject_id, Assertion.object_id)
            .filter(Assertion.relation == "prerequisite_of",
                    Assertion.subject_type == "concept",
                    Assertion.invalidated_at.is_(None),
                    Assertion.subject_id.in_(ids or {""})).all())
    out: dict = {}
    for subj, obj in rows:
        if obj in ids:
            out[subj] = out.get(subj, 0) + 1
    return out


def error_counts(db, concept_ids: list[str], owner) -> dict:
    """{concept_id: count of 'incorrect' evidence rows} — the gym coach's
    'evidence of errors' signal."""
    q = (db.query(MasteryEvidence.concept_id)
         .filter(MasteryEvidence.concept_id.in_(concept_ids or [""]),
                 MasteryEvidence.signal == "incorrect"))
    if owner:
        q = q.filter(MasteryEvidence.owner == owner)
    out: dict = {}
    for (cid,) in q.all():
        out[cid] = out.get(cid, 0) + 1
    return out


def recent_insights(db, owner, course_id=None, limit: int = 5) -> list[dict]:
    """Recent INFERRED student insights — the dashboard's 'what the tutor has
    noticed' card (CONTRACT D4). Mirrors student_context._focus_lines' filter:
    kind="inferred", subject_type="student", invalidated_at IS NULL, excluding
    the structural prerequisite_of edges; newest by valid_from. Owner-scoped
    (Gate 5). When `course_id` is given, only insights whose object concept is
    in that course's region are kept (course-less call → all of the owner's).

    Returns plain dicts (no ORM leaks): {id, relation, literal, confidence,
    valid_from, concept_id?, concept_name?}. concept_id/name are filled when the
    insight points at a concept node (object_type="concept")."""
    from src.auth_helpers import owner_scoped

    q = owner_scoped(db.query(Assertion), Assertion, owner).filter(
        Assertion.kind == "inferred",
        Assertion.subject_type == "student",
        Assertion.invalidated_at.is_(None),
        Assertion.relation != "prerequisite_of",
    ).order_by(Assertion.valid_from.desc())

    region_ids = None
    if course_id:
        region_ids = {c["id"] for c in region_concepts(db, course_id, owner)}

    cap = max(1, int(limit))
    out: list[dict] = []
    # Pull a generous window so a course filter still fills `limit`; insights are
    # sparse so the over-fetch is cheap.
    for a in q.limit(cap * 10 if region_ids is not None else cap).all():
        concept_id = a.object_id if a.object_type == "concept" else None
        # The region filter applies ONLY to concept-anchored insights — a
        # concept-less inferred insight (object_type != "concept") carries no
        # anchor to filter on, so it is always kept (mirrors
        # student_context._focus_lines, which applies no region filter here).
        if (region_ids is not None and concept_id is not None
                and concept_id not in region_ids):
            continue
        concept_name = None
        if concept_id:
            node = db.get(ConceptNode, concept_id)
            concept_name = node.name if node is not None else None
        d = {
            "id": a.id,
            "relation": a.relation,
            "literal": (a.literal or "").strip() or None,
            "confidence": a.confidence,
            "valid_from": a.valid_from.isoformat() if a.valid_from else None,
        }
        if concept_id:
            d["concept_id"] = concept_id
            d["concept_name"] = concept_name
        out.append(d)
        if len(out) >= cap:
            break
    return out


def record_evidence(concept_id: str, signal: str, *, weight: float = 1.0,
                    episode_ref: dict | None = None, context: dict | None = None,
                    owner=None, db=None) -> tuple[str, float | None]:
    """Write one evidence row through the mastery engine and return the
    derived (state, effective_p) as plain values."""
    row = mastery.apply_evidence(
        concept_id, signal, weight=weight, episode_ref=episode_ref,
        context=context or {}, owner=owner, db=db)
    return mastery.state_of(row)


__all__ = [
    "region_concepts", "concept_brief", "states_for",
    "prereq_out_degree", "error_counts", "recent_insights", "record_evidence",
]
