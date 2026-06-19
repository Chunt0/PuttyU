"""
dashboard.py — pure read helpers for the Dashboard aggregator (Phase-2 T5,
SPEC F11). The join logic for the reading-recommendation card lives here so the
HTTP route stays a thin adapter.

One-door discipline (CLAUDE.md):
  * Graph access ONLY through src.graph.queries / src.practice.items (which uses
    queries) — never the graph ORM, never raw SQL on graph tables (Gate 6f).
  * Corpus reads ONLY through src.corpus.course_search (Gate 6f).
  * owner is threaded through every call (Gate 5).

Every function is a pure read and degrades quietly (returns []), mirroring
student_context's never-raise contract: a dashboard card failing must never
500 the landing page.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# How many frontier concepts get a reading recommendation on the dashboard.
READING_RECS = 2


def _toc_index(nodes: list[dict], acc: dict, prefix: tuple = ()) -> dict:
    """Flatten a course_search.toc_tree into {full_heading_path_tuple: node} for
    page lookup. Keying by the FULL path (carried down via `prefix`) — not the
    bare leaf heading — keeps a duplicate leaf ("Summary") under two different
    chapters distinct, so a concept resolves to its OWN chapter's page."""
    for node in nodes or []:
        heading = node.get("heading")
        path = prefix + (heading,) if heading else prefix
        if heading and path not in acc:
            acc[path] = node
        _toc_index(node.get("children") or [], acc, path)
    return acc


def reading_recs(db, owner, concepts: list[dict], *, limit: int = READING_RECS) -> list[dict]:
    """Reading recommendations for the top frontier `concepts` (CONTRACT D3).

    `concepts` are due_concepts / region_concepts dicts (carry concept id, name,
    sources, heading_path). For each, resolve its source's TOC (via
    course_search.toc_tree) and find the page_start of the deepest heading in its
    breadcrumb that the TOC knows. page_end is best-effort: the next sibling's
    page_start when discoverable, else omitted (degrade to page_start only).

    Returns dicts: {concept_id, concept_name, source_id, title, heading,
    page_start, page_end?, citation}. Empty list on any trouble (never raises)."""
    from src.corpus.course_search import toc_tree
    from src.corpus.models import CorpusSource

    out: list[dict] = []
    toc_cache: dict[str, dict] = {}     # source_id -> flattened heading index
    toc_roots: dict[str, list] = {}     # source_id -> ordered roots (for page_end)
    src_cache: dict[str, object] = {}   # source_id -> CorpusSource

    for c in concepts:
        if len(out) >= max(1, int(limit)):
            break
        concept_id = c.get("concept_id") or c.get("id")
        concept_name = c.get("name") or ""
        sources = c.get("sources") or []
        source_id = c.get("source_id") or (sources[0] if sources else None)
        if not source_id:
            continue
        try:
            if source_id not in toc_cache:
                roots = toc_tree(db, source_id)
                toc_roots[source_id] = roots
                toc_cache[source_id] = _toc_index(roots, {})
            index = toc_cache[source_id]

            heading_path = [h for h in (c.get("heading_path") or []) if h]
            # Deepest path-prefix the TOC actually knows: try the full breadcrumb,
            # then drop one trailing segment at a time. Matching by FULL path (not
            # the bare leaf) lands on the concept's OWN chapter when a leaf heading
            # repeats across chapters.
            tnode = None
            heading = ""
            for depth in range(len(heading_path), 0, -1):
                key = tuple(heading_path[:depth])
                if key in index:
                    tnode = index[key]
                    heading = key[-1]
                    break
            page_start = tnode.get("page_start") if tnode else None

            if source_id not in src_cache:
                src_cache[source_id] = db.get(CorpusSource, source_id)
            src = src_cache[source_id]
            title = src.title if src is not None else source_id

            citation = title + (f" — {heading}" if heading else "")
            if page_start is not None:
                citation += f" (p. {page_start})"

            rec = {
                "concept_id": concept_id,
                "concept_name": concept_name,
                "source_id": source_id,
                "title": title,
                "heading": heading,
                "page_start": page_start,
                "citation": citation,
            }
            # page_end best-effort: the next ordinal node's page_start.
            page_end = _next_page(toc_roots.get(source_id) or [], tnode)
            if page_end is not None and page_start is not None and page_end > page_start:
                rec["page_end"] = page_end
            out.append(rec)
        except Exception as e:
            logger.debug("[dashboard] reading-rec join failed for %s: %s", concept_id, e)
            continue
    return out


def _next_page(roots: list[dict], tnode: dict | None):
    """Best-effort page_end: the page_start of the next TOC node (by ordinal)
    after `tnode`. Flatten the tree to an ordinal-sorted list and look one ahead.
    Returns None when undiscoverable (degrade to page_start only)."""
    if not tnode:
        return None
    flat: list[dict] = []

    def _walk(nodes):
        for n in nodes or []:
            flat.append(n)
            _walk(n.get("children") or [])

    _walk(roots)
    flat.sort(key=lambda n: (n.get("ordinal") if n.get("ordinal") is not None else 0))
    target_ord = tnode.get("ordinal")
    if target_ord is None:
        return None
    for n in flat:
        if (n.get("ordinal") or 0) > target_ord and n.get("page_start") is not None:
            return n["page_start"]
    return None
