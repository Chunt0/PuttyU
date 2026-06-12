"""
retriever.py — query the corpus (ADR 0003 §Retrieval).

search()   : embed the query, ask Chroma for top-k chunk ids + citation metadata.
expand()   : pull neighbour chunks from SQLite by (source_id, ordinal±radius) — pure SQL,
             so the tutor can widen a hit to its surrounding context.
retrieve() : the convenience path — search, then hydrate each hit with its canonical
             SQLite text + neighbours + served-PDF reference.

The vector half is injectable (embedder, collection) so tests exercise ranking logic
without a live Chroma; expand()/hydrate run against SQLite alone.
"""

from __future__ import annotations

from src.corpus.indexer import DEFAULT_COLLECTION, _default_collection, _default_embedder
from src.corpus.models import CorpusChunk, CorpusSource


def expand(db, source_id: str, ordinal: int, radius: int = 1) -> list[CorpusChunk]:
    """Neighbour chunks within ±radius ordinals of (source_id, ordinal), in order."""
    if radius <= 0:
        hit = db.query(CorpusChunk).filter(
            CorpusChunk.source_id == source_id, CorpusChunk.ordinal == ordinal
        ).all()
        return hit
    return (db.query(CorpusChunk)
            .filter(CorpusChunk.source_id == source_id,
                    CorpusChunk.ordinal >= ordinal - radius,
                    CorpusChunk.ordinal <= ordinal + radius)
            .order_by(CorpusChunk.ordinal).all())


def search(query: str, k: int = 8, where: dict | None = None,
           embedder=None, collection=None) -> list[dict]:
    """Top-k corpus hits as dicts: {id, distance, metadata, document}."""
    embedder = embedder or _default_embedder()
    collection = collection or _default_collection()
    vec = embedder.encode([query])[0]
    res = collection.query(
        query_embeddings=[vec.tolist() if hasattr(vec, "tolist") else list(vec)],
        n_results=k,
        where=where or None,
    )
    # Chroma returns one list-per-query; we issued a single query.
    ids = (res.get("ids") or [[]])[0]
    dists = (res.get("distances") or [[None] * len(ids)])[0]
    metas = (res.get("metadatas") or [[{}] * len(ids)])[0]
    docs = (res.get("documents") or [[None] * len(ids)])[0]
    return [
        {"id": i, "distance": d, "metadata": m or {}, "document": doc}
        for i, d, m, doc in zip(ids, dists, metas, docs)
    ]


def retrieve(query: str, db, k: int = 8, where: dict | None = None, radius: int = 1,
             embedder=None, collection=None) -> list[dict]:
    """search() + hydrate each hit from SQLite: canonical text, neighbours, PDF reference."""
    hits = search(query, k=k, where=where, embedder=embedder, collection=collection)
    out = []
    for h in hits:
        chunk = db.get(CorpusChunk, h["id"])
        if chunk is None:
            continue  # Chroma drifted ahead of SQLite; canonical store wins
        src = db.get(CorpusSource, chunk.source_id)
        neighbours = expand(db, chunk.source_id, chunk.ordinal, radius=radius)
        out.append({
            "id": chunk.id,
            "distance": h["distance"],
            "kind": chunk.kind,
            "heading_path": chunk.heading_path,
            "text": chunk.text,                       # canonical, full (not truncated)
            "locator": chunk.locator,
            "asset_paths": chunk.asset_paths,
            "citation": h["metadata"].get("citation"),
            "source_id": chunk.source_id,
            "pdf": src.original_path if src else None,
            "context": [{"ordinal": n.ordinal, "kind": n.kind, "text": n.text}
                        for n in neighbours],
        })
    return out


__all__ = ["search", "expand", "retrieve", "DEFAULT_COLLECTION"]
