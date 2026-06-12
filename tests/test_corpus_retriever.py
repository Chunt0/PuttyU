"""Retriever: pure SQLite neighbour expansion + Chroma search/hydrate with fakes."""
import numpy as np
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.corpus import retriever
from src.corpus.models import CorpusChunk, CorpusSource, chunk_id, ensure_corpus_tables


@pytest.fixture
def db(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path/'c.db'}")
    ensure_corpus_tables(bind=engine)
    sess = sessionmaker(bind=engine)()
    sess.add(CorpusSource(id="bk", source_type="textbook", title="Stats",
                          content_hash="h", original_path="/data/bk/source.pdf"))
    for i in range(5):
        sess.add(CorpusChunk(id=chunk_id("bk", i), source_id="bk", ordinal=i,
                             kind="prose", heading_path=["1.1 Defs"], text=f"chunk-{i}",
                             content_hash=f"h{i}", locator={"kind": "page", "start": 16 + i, "end": 16 + i}))
    sess.commit()
    yield sess
    sess.close()


class FakeEmbedder:
    def encode(self, texts, normalize_embeddings=True):
        return np.array([[1.0, 0.0]] * len(texts), dtype="float32")


class FakeCollection:
    """Returns a canned ranking; records the `where` filter it was queried with."""
    def __init__(self, ids):
        self.ids = ids
        self.last_where = "unset"
    def query(self, query_embeddings, n_results, where=None):
        self.last_where = where
        ids = self.ids[:n_results]
        return {
            "ids": [ids],
            "distances": [[0.1 * (i + 1) for i in range(len(ids))]],
            "metadatas": [[{"citation": f"Stats — 1.1 (p.{16})", "kind": "prose"} for _ in ids]],
            "documents": [[f"doc {i}" for i in ids]],
        }


# --- expand() : pure SQLite ----------------------------------------------------------- #
def test_expand_radius(db):
    got = retriever.expand(db, "bk", 2, radius=1)
    assert [c.ordinal for c in got] == [1, 2, 3]


def test_expand_clamps_at_boundaries(db):
    assert [c.ordinal for c in retriever.expand(db, "bk", 0, radius=2)] == [0, 1, 2]
    assert [c.ordinal for c in retriever.expand(db, "bk", 4, radius=2)] == [2, 3, 4]


def test_expand_radius_zero_is_single(db):
    assert [c.ordinal for c in retriever.expand(db, "bk", 3, radius=0)] == [3]


# --- search() : Chroma parsing -------------------------------------------------------- #
def test_search_parses_hits(db):
    coll = FakeCollection(ids=[chunk_id("bk", 1), chunk_id("bk", 2)])
    hits = retriever.search("what is a sample", k=2, embedder=FakeEmbedder(), collection=coll)
    assert [h["id"] for h in hits] == ["bk:1", "bk:2"]
    assert hits[0]["distance"] == pytest.approx(0.1)
    assert hits[0]["metadata"]["kind"] == "prose"


def test_search_passes_where_filter(db):
    coll = FakeCollection(ids=[chunk_id("bk", 0)])
    retriever.search("q", k=1, where={"subject": "statistics"},
                     embedder=FakeEmbedder(), collection=coll)
    assert coll.last_where == {"subject": "statistics"}


# --- retrieve() : hydrate from canonical store ---------------------------------------- #
def test_retrieve_hydrates_text_neighbours_and_pdf(db):
    coll = FakeCollection(ids=[chunk_id("bk", 2)])
    out = retriever.retrieve("q", db, k=1, radius=1, embedder=FakeEmbedder(), collection=coll)
    assert len(out) == 1
    hit = out[0]
    assert hit["text"] == "chunk-2"                       # canonical SQLite text
    assert hit["pdf"] == "/data/bk/source.pdf"            # served PDF reference
    assert [c["ordinal"] for c in hit["context"]] == [1, 2, 3]   # neighbours
    assert hit["citation"] and "Stats" in hit["citation"]


def test_retrieve_skips_chunks_missing_from_sqlite(db):
    # Chroma references an id that isn't in the canonical store -> dropped, no crash.
    coll = FakeCollection(ids=["bk:999", chunk_id("bk", 0)])
    out = retriever.retrieve("q", db, k=2, embedder=FakeEmbedder(), collection=coll)
    assert [h["id"] for h in out] == ["bk:0"]
