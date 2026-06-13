# routes/graph_routes.py
"""Ensemble-graph routes (Phase-2 T3a — SPEC F5, ADR 0005): the Progress
panel's read side plus the two student-outranks-the-model write doors
(mastery override, insight challenge).

Born small and typed: response_models on every endpoint (Gate 6b), Pydantic
bodies (Gate 6c), owner_scoped on every query (Gate 5). This file is on the
graph-one-door allowlist (.fitness/graph-one-door.sh) — together with
src/graph/ and src/student_context.py it is the only code allowed to touch
the graph tables.
"""

import logging

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import func

from core.database import SessionLocal
from src.auth_helpers import get_current_user, owner_scoped
from src.graph import mastery
from src.graph.models import (
    Assertion, ConceptNode, MasteryEvidence, MasteryState, ensure_graph_tables,
    episode_ref, new_id, utcnow,
)
from src.request_models import (
    GraphAssertionItem,
    GraphChallengeRequest,
    GraphChallengeResponse,
    GraphConceptDetailResponse,
    GraphConceptsResponse,
    GraphObservationsResponse,
    GraphOverrideRequest,
    GraphOverrideResponse,
)

logger = logging.getLogger(__name__)


def _iso(dt):
    return dt.isoformat() if dt else None


def _region_concepts(db, course_id, user) -> list:
    """course region (extractor's shortlist, uncapped) or ALL owner concepts."""
    all_nodes = owner_scoped(db.query(ConceptNode), ConceptNode, user).all()
    if course_id:
        from src.corpus.course_search import course_source_ids
        source_ids = set(course_source_ids(db, course_id, user))
        nodes = []
        for n in all_nodes:
            meta = n.meta if isinstance(n.meta, dict) else {}
            node_sources = set(meta.get("sources") or [])
            if n.source_id:
                node_sources.add(n.source_id)
            if node_sources & source_ids:
                nodes.append(n)
    else:
        nodes = all_nodes
    nodes.sort(key=lambda n: ((n.meta or {}).get("ordinal", 0)
                              if isinstance(n.meta, dict) else 0))
    return nodes


def _concept_or_404(db, concept_id: str, user) -> ConceptNode:
    q = db.query(ConceptNode).filter(ConceptNode.id == concept_id)
    node = owner_scoped(q, ConceptNode, user).first()
    if node is None:
        raise HTTPException(404, "Concept not found")
    return node


def _assertion_item(a: Assertion, names: dict | None = None) -> dict:
    names = names or {}
    statement = (a.quote or a.literal or "").strip()
    if not statement and a.object_id:
        statement = f"{a.relation} {names.get(a.object_id, a.object_id)}".strip()
    return {
        "id": a.id, "kind": a.kind, "relation": a.relation,
        "statement": statement, "quote": a.quote, "confidence": a.confidence,
        "subject_type": a.subject_type, "object_type": a.object_type,
        "object_id": a.object_id, "object_name": names.get(a.object_id),
        "valid_from": _iso(a.valid_from), "invalidated_at": _iso(a.invalidated_at),
        "invalidation_reason": a.invalidation_reason,
        "episode_refs": a.episode_refs if isinstance(a.episode_refs, list) else [],
    }


def _state_summary(db, concept_id: str) -> tuple[str, float | None, int]:
    state, ep = mastery.state_of(db.get(MasteryState, concept_id))
    count = (db.query(MasteryEvidence)
             .filter(MasteryEvidence.concept_id == concept_id).count())
    return state, ep, count


def setup_graph_routes() -> APIRouter:
    router = APIRouter(prefix="/api/graph", tags=["graph"])
    ensure_graph_tables()

    # --- CONCEPT TREE (the Progress panel — §6 Q6: tree/list, no node-graph) --
    @router.get("/concepts", response_model=GraphConceptsResponse)
    def concept_tree(request: Request, course_id: str | None = None):
        """State-colored concept tree for a course region (or everything the
        caller owns), nested by heading_path. `state` is the only mastery
        vocabulary exposed; no-evidence nodes are "unknown", not zero."""
        user = get_current_user(request)
        db = SessionLocal()
        try:
            nodes = _region_concepts(db, course_id, user)
            ids = [n.id for n in nodes]
            states = {s.concept_id: s for s in db.query(MasteryState)
                      .filter(MasteryState.concept_id.in_(ids or [""])).all()}
            counts = dict(
                db.query(MasteryEvidence.concept_id, func.count())
                .filter(MasteryEvidence.concept_id.in_(ids or [""]))
                .group_by(MasteryEvidence.concept_id).all())

            roots, index = [], {}
            for n in nodes:
                state, ep = mastery.state_of(states.get(n.id))
                item = {"id": n.id, "name": n.name, "state": state,
                        "p_known": round(ep, 3) if ep is not None else None,
                        "evidence_count": counts.get(n.id, 0), "children": []}
                path = tuple(n.heading_path or [n.name])
                index[path] = item
                parent = index.get(path[:-1])
                (parent["children"] if parent else roots).append(item)
            return {"course_id": course_id, "concepts": roots}
        finally:
            db.close()

    # --- CONCEPT DETAIL (evidence + assertion timeline — the trajectory) -----
    @router.get("/concepts/{concept_id}", response_model=GraphConceptDetailResponse)
    def concept_detail(request: Request, concept_id: str):
        """Everything behind a node's state: the evidence rows and the full
        assertion timeline INCLUDING invalidated entries — 'used to confuse
        these; resolved around June 10' stays queryable (bi-temporal)."""
        user = get_current_user(request)
        db = SessionLocal()
        try:
            node = _concept_or_404(db, concept_id, user)
            state, ep, count = _state_summary(db, node.id)
            ev_rows = (owner_scoped(db.query(MasteryEvidence), MasteryEvidence, user)
                       .filter(MasteryEvidence.concept_id == node.id)
                       .order_by(MasteryEvidence.created_at.desc()).limit(200).all())
            evidence = [{
                "id": e.id, "signal": e.signal, "weight": e.weight,
                "created_at": _iso(e.created_at),
                "source": (e.context or {}).get("source") if isinstance(e.context, dict) else None,
                "note": (e.context or {}).get("note") if isinstance(e.context, dict) else None,
                "indirect": bool((e.context or {}).get("indirect")) if isinstance(e.context, dict) else False,
                "episode_ref": e.episode_ref if isinstance(e.episode_ref, dict) else None,
            } for e in ev_rows]
            a_rows = (owner_scoped(db.query(Assertion), Assertion, user)
                      .filter(((Assertion.subject_type == "concept")
                               & (Assertion.subject_id == node.id))
                              | (Assertion.object_id == node.id))
                      .order_by(Assertion.valid_from.asc()).limit(200).all())
            names = {node.id: node.name}
            return {
                "id": node.id, "name": node.name,
                "heading_path": list(node.heading_path or []),
                "state": state, "p_known": round(ep, 3) if ep is not None else None,
                "evidence": evidence,
                "assertions": [_assertion_item(a, names) for a in a_rows],
            }
        finally:
            db.close()

    # --- OVERRIDE ("I know this" / "I never learned this") -------------------
    @router.post("/concepts/{concept_id}/override", response_model=GraphOverrideResponse)
    def override_concept(request: Request, concept_id: str, body: GraphOverrideRequest):
        """The student is an authority on themself — overrides are evidence
        too (an append-only row, not an edit), so the log keeps the receipt."""
        user = get_current_user(request)
        db = SessionLocal()
        try:
            node = _concept_or_404(db, concept_id, user)
            signal = "override_known" if body.known else "override_unknown"
            mastery.apply_evidence(
                node.id, signal, weight=1.0,
                episode_ref=episode_ref("user_override", None),
                context={"source": "override"}, owner=user or None, db=db)
            state, ep, count = _state_summary(db, node.id)
            return {"id": node.id, "state": state,
                    "p_known": round(ep, 3) if ep is not None else None,
                    "evidence_count": count}
        finally:
            db.close()

    # --- OBSERVATIONS (kind=stated — what the user actually said) ------------
    @router.get("/observations", response_model=GraphObservationsResponse)
    def list_observations(request: Request, course_id: str | None = None):
        """Stated assertions, newest first (invalidated ones ride along with
        invalidated_at set). With course_id, concept-object rows are filtered
        to the course region; non-concept observations always pass."""
        user = get_current_user(request)
        db = SessionLocal()
        try:
            rows = (owner_scoped(db.query(Assertion), Assertion, user)
                    .filter(Assertion.kind == "stated")
                    .order_by(Assertion.valid_from.desc()).limit(200).all())
            if course_id:
                region = {n.id for n in _region_concepts(db, course_id, user)}
                rows = [a for a in rows
                        if a.object_type != "concept" or a.object_id in region]
            ids = {a.object_id for a in rows if a.object_id}
            names = {}
            if ids:
                from src.graph.models import EntityNode
                for n in db.query(ConceptNode).filter(ConceptNode.id.in_(ids)).all():
                    names[n.id] = n.name
                for n in db.query(EntityNode).filter(EntityNode.id.in_(ids)).all():
                    names[n.id] = n.name
            return {"observations": [_assertion_item(a, names) for a in rows]}
        finally:
            db.close()

    # --- CHALLENGE an insight (F5 — the student outranks the inference) ------
    @router.post("/assertions/{assertion_id}/challenge",
                 response_model=GraphChallengeResponse)
    def challenge_assertion(request: Request, assertion_id: str,
                            body: GraphChallengeRequest):
        """Invalidate the assertion (never delete) and record the user's
        correction as a NEW stated assertion whose episode ref points at the
        challenged row — no hidden student model."""
        user = get_current_user(request)
        db = SessionLocal()
        try:
            q = db.query(Assertion).filter(Assertion.id == assertion_id)
            old = owner_scoped(q, Assertion, user).first()
            if old is None:
                raise HTTPException(404, "Assertion not found")
            if old.invalidated_at is None:
                old.invalidated_at = utcnow()
                old.invalidation_reason = "challenged by user"
            correction = Assertion(
                id=new_id(), subject_type=old.subject_type,
                subject_id=old.subject_id, relation="corrects",
                object_type=None, object_id=None,
                literal=(old.quote or old.literal or
                         f"{old.relation} {old.object_id or ''}").strip(),
                kind="stated", quote=body.correction.strip(),
                valid_from=utcnow(),
                episode_refs=[episode_ref("assertion", old.id)],
                owner=old.owner if old.owner is not None else (user or None),
            )
            db.add(correction)
            db.commit()
            db.refresh(old)
            db.refresh(correction)
            return {"invalidated": _assertion_item(old),
                    "correction": _assertion_item(correction)}
        finally:
            db.close()

    return router
