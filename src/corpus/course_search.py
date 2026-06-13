"""
course_search.py — course-scoped corpus retrieval for the library routes and chat
grounding (SPEC Phase-2 F2/F3, ADR 0004).

Scope resolution: a course's sources are the course_source link rows (shared-library
sources the user linked) ∪ the user's own materials carrying that course_id. Visibility
is the repo-wide owner rule: owner-NULL rows are the shared library (visible to all),
owned rows are materials (visible to their owner only).

search_scoped() tries the vector path (ADR 0003 Chroma `corpus` collection, filtered by
source_id) and degrades to a SQL keyword search when Chroma/embeddings are unavailable —
the same graceful-degradation contract as src/rag_vector (`_keyword_search_fallback`).
"""

from __future__ import annotations

import logging
import re

from sqlalchemy import or_

from src.corpus.models import CorpusChunk, CorpusSource

logger = logging.getLogger(__name__)

# Keyword fallback: cap candidate rows pulled into Python for scoring.
_KEYWORD_CANDIDATES = 400
_KEYWORD_MAX_TERMS = 8


# --------------------------------------------------------------------------- #
# Visibility + scope resolution                                               #
# --------------------------------------------------------------------------- #
def visible_sources_query(db, user):
    """Library sources (owner NULL) + the caller's own materials (Gate-5 rule)."""
    q = db.query(CorpusSource)
    if user:
        q = q.filter(or_(CorpusSource.owner == None, CorpusSource.owner == user))  # noqa: E711
    return q


def source_tags(src: CorpusSource) -> list[str]:
    """User tags from the source's meta JSON (SPEC F2 'tags steer the search')."""
    meta = src.meta if isinstance(src.meta, dict) else {}
    tags = meta.get("tags")
    return [str(t) for t in tags] if isinstance(tags, list) else []


def course_source_ids(db, course_id: str, user) -> list[str]:
    """course → source ids: link-table rows ∪ owned materials with that course_id.

    Link rows are kept only when they point at a VISIBLE source (a link to a
    since-deleted or foreign source must not widen retrieval).
    """
    from core.database import CourseSource

    linked = [r.source_id for r in db.query(CourseSource)
              .filter(CourseSource.course_id == course_id).all()]
    visible = visible_sources_query(db, user)
    rows = visible.filter(or_(CorpusSource.id.in_(linked or [""]),
                              CorpusSource.course_id == course_id)).all()
    return [s.id for s in rows]


def resolve_scope(db, user, course_id: str | None = None,
                  tags: list[str] | None = None) -> list[str]:
    """The source-id set a search runs against. No course → everything visible.

    Tags narrow by SQL on the sources' meta (no Chroma schema change — ADR 0004):
    a source passes when it carries at least one requested tag.
    """
    if course_id:
        ids = course_source_ids(db, course_id, user)
    else:
        ids = [s.id for s in visible_sources_query(db, user).all()]
    if tags:
        wanted = {t.strip().lower() for t in tags if t and t.strip()}
        if wanted:
            by_id = {s.id: s for s in visible_sources_query(db, user)
                     .filter(CorpusSource.id.in_(ids or [""])).all()}
            ids = [i for i in ids if i in by_id
                   and wanted & {t.lower() for t in source_tags(by_id[i])}]
    return ids


# --------------------------------------------------------------------------- #
# Citation / item shaping (mirrors indexer.chroma_metadata)                   #
# --------------------------------------------------------------------------- #
def chunk_page_start(chunk: CorpusChunk):
    loc = chunk.locator if isinstance(chunk.locator, dict) else None
    return loc.get("start") if loc else None


def build_citation(src: CorpusSource, chunk: CorpusChunk) -> str:
    citation = src.title + (f" — {chunk.heading_path[-1]}" if chunk.heading_path else "")
    page = chunk_page_start(chunk)
    if page is not None:
        citation += f" (p. {page})"
    return citation


def chunk_item(src: CorpusSource, chunk: CorpusChunk, citation: str | None = None) -> dict:
    """The typed search-hit shape (SPEC §5.4): citation contract, not prose."""
    return {
        "chunk_id": chunk.id,
        "source_id": src.id,
        "title": src.title,
        "heading": " > ".join(chunk.heading_path or []),
        "page_start": chunk_page_start(chunk),
        "citation": citation or build_citation(src, chunk),
        "text": chunk.text,
    }


# --------------------------------------------------------------------------- #
# Search: vector first, keyword fallback                                      #
# --------------------------------------------------------------------------- #
def search_scoped(db, query: str, source_ids: list[str], top_k: int = 6,
                  embedder=None, collection=None) -> tuple[list[dict], bool]:
    """Top-k hits restricted to `source_ids`. Returns (items, used_keyword_fallback).

    Vector path: Chroma `corpus` collection filtered with source_id $in (ADR 0004 —
    the scalar metadata needs no change). Any failure there (no chromadb, no
    embedding client, empty index) degrades to the SQL keyword search, like
    src/rag_vector does for personal docs.
    """
    if not source_ids:
        return [], False
    try:
        from src.corpus.retriever import search as vector_search
        where = ({"source_id": {"$in": list(source_ids)}}
                 if len(source_ids) > 1 else {"source_id": source_ids[0]})
        hits = vector_search(query, k=top_k, where=where,
                             embedder=embedder, collection=collection)
        items = []
        for h in hits:
            chunk = db.get(CorpusChunk, h["id"])
            if chunk is None or chunk.source_id not in source_ids:
                continue  # Chroma drifted ahead of SQLite; canonical store wins
            src = db.get(CorpusSource, chunk.source_id)
            if src is None:
                continue
            items.append(chunk_item(src, chunk, citation=h["metadata"].get("citation")))
        return items, False
    except Exception as e:
        logger.info("corpus vector search unavailable (%s); keyword fallback", e)
        return keyword_search(db, query, source_ids, top_k=top_k), True


def keyword_search(db, query: str, source_ids: list[str], top_k: int = 6) -> list[dict]:
    """SQL LIKE candidates scored by term overlap — no Chroma/embeddings needed."""
    terms = [t for t in re.findall(r"[\w]+", (query or "").lower()) if len(t) > 2]
    terms = terms[:_KEYWORD_MAX_TERMS]
    if not terms or not source_ids:
        return []
    like_filters = [CorpusChunk.text.ilike(f"%{t}%") for t in terms]
    rows = (db.query(CorpusChunk)
            .filter(CorpusChunk.source_id.in_(source_ids), or_(*like_filters))
            .limit(_KEYWORD_CANDIDATES).all())
    scored = []
    for c in rows:
        text = (c.text or "").lower()
        score = sum(1 for t in terms if t in text)
        if score:
            scored.append((score, c.ordinal, c))
    scored.sort(key=lambda x: (-x[0], x[1]))
    items = []
    for _score, _ord, chunk in scored[:top_k]:
        src = db.get(CorpusSource, chunk.source_id)
        if src is not None:
            items.append(chunk_item(src, chunk))
    return items


# --------------------------------------------------------------------------- #
# Table of contents (heading tree from chunks)                                #
# --------------------------------------------------------------------------- #
def toc_tree(db, source_id: str) -> list[dict]:
    """Nested heading tree from the source's chunks, in document order.

    A node is created the first time its heading path appears; it carries the
    ordinal + page_start of that first chunk (the 'open PDF at page' door).
    """
    chunks = (db.query(CorpusChunk)
              .filter(CorpusChunk.source_id == source_id)
              .order_by(CorpusChunk.ordinal).all())
    roots: list[dict] = []
    index: dict[tuple, dict] = {}
    for c in chunks:
        path = [h for h in (c.heading_path or []) if h]
        for depth in range(len(path)):
            key = tuple(path[:depth + 1])
            if key in index:
                continue
            node = {"heading": path[depth], "ordinal": c.ordinal,
                    "page_start": chunk_page_start(c), "children": []}
            index[key] = node
            parent = index.get(key[:-1])
            (parent["children"] if parent else roots).append(node)
    return roots


__all__ = [
    "visible_sources_query", "source_tags", "course_source_ids", "resolve_scope",
    "build_citation", "chunk_item", "chunk_page_start",
    "search_scoped", "keyword_search", "toc_tree",
]
