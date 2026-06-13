"""
seeding.py — corpus structure -> a course's graph region (ADR 0005 §6 Q1).

STRUCTURE-ONLY seeding: chapter/section names (heading_path levels) become
concept nodes, KEY-TERMS chunks contribute leaf concepts, and book order
becomes `prerequisite_of` assertions (kind=inferred, confidence 0.5,
episode_refs=[] — a first approximation the evidence engine can overrule).

Reuse rule: an exact normalized_name match per owner REUSES the existing node
and appends this source to meta.sources — that's what makes cross-course
shared nodes (the F6 periphery) real.

Every node starts with NO mastery_state row: unknown ≠ zero — the tutor
probes before it assumes.

Idempotent: re-seeding the same source creates nothing new. Plain-paragraph
materials (no headings, no key terms) seed nothing at all.
"""

from __future__ import annotations

import logging
import re

from src.graph.models import (
    Assertion, ConceptNode, ensure_graph_tables, new_id, normalize_name,
    utcnow,
)

logger = logging.getLogger(__name__)

# `**term** definition` lines inside a KEY-TERMS chunk (the Marker textbook
# format; bold term at line start, optionally behind a span anchor).
_KEY_TERM_RE = re.compile(r"(?m)^(?:<span[^>]*></span>\s*)?\*\*([^*\n]{2,60}?)\*\*\s")

# Headings that are book furniture, not concepts.
_FURNITURE = frozenset({
    "key terms", "chapter review", "practice", "homework", "solutions",
    "references", "bringing it together", "review", "introduction",
    "chapter objectives", "table of contents", "preface", "index",
})

PREREQ_CONFIDENCE = 0.5


def _is_concept_heading(heading: str) -> bool:
    n = normalize_name(heading)
    if not n or n in _FURNITURE:
        return False
    # "1.1 Definitions of ..." passes; bare numbers don't.
    return bool(re.search(r"[a-z]", n))


def _get_or_create_concept(db, cache: dict, name: str, *, source_id: str,
                           heading_path: list, owner, ordinal: int, stats: dict):
    """The reuse rule: normalized-name match per owner reuses the node and
    appends this source to meta.sources; otherwise a new node is created."""
    norm = normalize_name(name)
    if not norm:
        return None
    if norm in cache:
        node = cache[norm]
    else:
        q = db.query(ConceptNode).filter(ConceptNode.normalized_name == norm)
        node = q.filter(ConceptNode.owner == owner).first() if owner else \
            q.filter(ConceptNode.owner.is_(None)).first()
    if node is not None:
        meta = dict(node.meta) if isinstance(node.meta, dict) else {}
        sources = list(meta.get("sources") or [])
        if source_id not in sources:
            sources.append(source_id)
            meta["sources"] = sources
            node.meta = meta  # reassign: JSON columns don't track mutation
            stats["reused"] += 1
        cache[norm] = node
        return node
    node = ConceptNode(
        id=new_id(), name=name.strip(), normalized_name=norm,
        source_id=source_id, heading_path=list(heading_path), owner=owner,
        meta={"sources": [source_id], "ordinal": ordinal},
    )
    db.add(node)
    db.flush()
    cache[norm] = node
    stats["created"] += 1
    return node


def _prereq_exists(db, subj_id: str, obj_id: str, owner) -> bool:
    q = (db.query(Assertion)
         .filter(Assertion.subject_type == "concept",
                 Assertion.subject_id == subj_id,
                 Assertion.relation == "prerequisite_of",
                 Assertion.object_id == obj_id,
                 Assertion.invalidated_at.is_(None)))
    return q.first() is not None


def _add_prereq_chain(db, ordered_nodes: list, owner, stats: dict) -> None:
    """Book order -> prerequisite_of edges between consecutive concepts
    (kind=inferred, confidence 0.5, no episodes — structure, not evidence)."""
    for earlier, later in zip(ordered_nodes, ordered_nodes[1:]):
        if earlier.id == later.id:
            continue
        if _prereq_exists(db, earlier.id, later.id, owner):
            continue
        db.add(Assertion(
            id=new_id(), subject_type="concept", subject_id=earlier.id,
            relation="prerequisite_of", object_type="concept",
            object_id=later.id, kind="inferred",
            confidence=PREREQ_CONFIDENCE, valid_from=utcnow(),
            episode_refs=[], owner=owner,
        ))
        stats["prereqs"] += 1


def seed_course_region(course_id: str, source_id: str, owner=None, db=None) -> dict:
    """Seed the graph region for one (course, source) pair from corpus chunks.

    Returns {"created", "reused", "key_terms", "prereqs", "skipped"}. A source
    with no heading-bearing chunks and no KEY-TERMS chunks seeds nothing
    (plain paragraph materials skip seeding). Never raises into callers'
    request paths — wrap call sites accordingly.
    """
    from src.corpus.models import CorpusChunk

    stats = {"created": 0, "reused": 0, "key_terms": 0, "prereqs": 0, "skipped": False}
    owner = owner or None
    own_session = db is None
    if own_session:
        from core.database import SessionLocal
        ensure_graph_tables()
        db = SessionLocal()
    try:
        chunks = (db.query(CorpusChunk)
                  .filter(CorpusChunk.source_id == source_id)
                  .order_by(CorpusChunk.ordinal).all())

        # "Heading-ish" gate: a flat material (every chunk under one identical
        # heading — the upload importer's heading_path=[title]) has no
        # structure to seed; only KEY-TERMS chunks could still contribute.
        distinct_paths = {tuple(h for h in (c.heading_path or []) if h)
                          for c in chunks} - {()}
        has_structure = len(distinct_paths) >= 2
        has_key_terms = any(c.kind == "key_terms" for c in chunks)
        if not has_structure and not has_key_terms:
            stats["skipped"] = True   # plain-paragraph material: nothing to seed
            return stats

        cache: dict = {}
        ordered: list = []          # concepts in book order (for prereq edges)
        seen_paths: set = set()

        for chunk in chunks:
            path = [h for h in (chunk.heading_path or []) if h]
            # heading_path levels -> chapter/section concepts (every level —
            # the chunker's paths are section breadcrumbs, no book title).
            for depth in range(len(path) if has_structure else 0):
                key = tuple(normalize_name(p) for p in path[:depth + 1])
                if key in seen_paths:
                    continue
                seen_paths.add(key)
                heading = path[depth]
                if not _is_concept_heading(heading):
                    continue
                node = _get_or_create_concept(
                    db, cache, heading, source_id=source_id,
                    heading_path=path[:depth + 1], owner=owner,
                    ordinal=chunk.ordinal, stats=stats)
                if node is not None and (not ordered or ordered[-1].id != node.id):
                    ordered.append(node)
            # KEY-TERMS chunks -> leaf concepts under the chunk's heading path.
            if chunk.kind == "key_terms":
                for term in _KEY_TERM_RE.findall(chunk.text or ""):
                    node = _get_or_create_concept(
                        db, cache, term, source_id=source_id,
                        heading_path=path + [term.strip()], owner=owner,
                        ordinal=chunk.ordinal, stats=stats)
                    if node is not None:
                        stats["key_terms"] += 1

        if not ordered and not stats["key_terms"]:
            stats["skipped"] = True   # headings were all furniture: nothing real
            return stats

        _add_prereq_chain(db, ordered, owner, stats)
        db.commit()
        logger.info(
            "graph seed: course=%s source=%s created=%d reused=%d key_terms=%d prereqs=%d",
            course_id, source_id, stats["created"], stats["reused"],
            stats["key_terms"], stats["prereqs"],
        )
        return stats
    except Exception:
        db.rollback()
        raise
    finally:
        if own_session:
            db.close()


def seed_safely(course_id: str, source_ids: list, owner=None) -> None:
    """Best-effort seeding for request-path call sites (course source linking,
    material ingest): logs failures, never raises into the HTTP response."""
    for sid in source_ids or []:
        try:
            seed_course_region(course_id, sid, owner=owner)
        except Exception as e:
            logger.warning("graph seed failed for course=%s source=%s: %s",
                           course_id, sid, e)
