"""
Indexer: SQLite store (idempotent + cascade replace), asset copy, and the embed stage
with an injected fake embedder + Chroma collection (no live services).
"""
import os
import numpy as np
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.corpus import indexer
from src.corpus.indexer import store_source, embed_source, chroma_metadata
from src.corpus.models import CorpusChunk, CorpusSource, ensure_corpus_tables

EXAMPLE_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "example-textbook", "statistics",
)


@pytest.fixture
def db(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path/'c.db'}")
    ensure_corpus_tables(bind=engine)
    sess = sessionmaker(bind=engine)()
    yield sess
    sess.close()


def make_book(tmp_path, body, images=None):
    d = tmp_path / "book"
    d.mkdir()
    (d / "book.md").write_text(body, encoding="utf-8")
    (d / "images").mkdir()
    for name, data in (images or {}).items():
        (d / "images" / name).write_bytes(data)
    return str(d)


class FakeEmbedder:
    """Deterministic 4-dim vectors; records the docs it was asked to embed."""
    def __init__(self):
        self.seen = []
    def encode(self, texts, normalize_embeddings=True):
        self.seen.extend(texts)
        return np.array([[float(len(t)), 1.0, 2.0, 3.0] for t in texts], dtype="float32")


class FakeCollection:
    def __init__(self):
        self.upserts = []
    def upsert(self, ids, embeddings, documents, metadatas):
        self.upserts.append({"ids": ids, "embeddings": embeddings,
                             "documents": documents, "metadatas": metadatas})


# --- Stage 1: SQLite + assets --------------------------------------------------------- #
def test_store_small_book_and_idempotency(tmp_path, db):
    body = "# **T**\n\n# **1.1 Basics**\n\nProse.\n\n#### **EXAMPLE 1.1**\n\nWorked.\n"
    d = make_book(tmp_path, body)

    stats = store_source(d, db, copy_assets=False)
    assert stats["skipped"] is False and stats["chunks"] >= 2
    src = db.get(CorpusSource, stats["source_id"])
    assert src.status == "ready"
    assert db.query(CorpusChunk).count() == stats["chunks"]

    # re-store unchanged -> skipped, no duplication
    again = store_source(d, db, copy_assets=False)
    assert again["skipped"] is True
    assert db.query(CorpusChunk).count() == stats["chunks"]


def test_store_replaces_chunks_on_content_change(tmp_path, db):
    d = make_book(tmp_path, "# **T**\n\n# **1.1 A**\n\nfirst.\n")
    s1 = store_source(d, db, copy_assets=False)
    first_count = s1["chunks"]

    # rewrite the book with more sections -> different content_hash -> clean replace
    open(os.path.join(d, "book.md"), "w").write(
        "# **T**\n\n# **1.1 A**\n\nfirst.\n\n# **1.2 B**\n\nsecond.\n\n# **1.3 C**\n\nthird.\n")
    s2 = store_source(d, db, copy_assets=False)
    assert s2["skipped"] is False
    assert s2["chunks"] > first_count
    # no stale chunks linger from the old version
    assert db.query(CorpusChunk).count() == s2["chunks"]


def test_asset_copy(tmp_path, db):
    body = "# **T**\n\n# **1.1 Figs**\n\nSee ![](_page_3_Figure_1.jpeg) here.\n"
    d = make_book(tmp_path, body, images={"_page_3_Figure_1.jpeg": b"\xff\xd8jpegdata"})
    assets_root = str(tmp_path / "assets")

    stats = store_source(d, db, copy_assets=True, assets_root=assets_root)
    copied = os.path.join(assets_root, stats["source_id"], "images", "_page_3_Figure_1.jpeg")
    assert os.path.exists(copied)
    src = db.get(CorpusSource, stats["source_id"])
    assert src.assets_dir and src.assets_dir.endswith(os.path.join(stats["source_id"], "images"))


# --- Stage 2: embed + Chroma (injected fakes) ----------------------------------------- #
def test_embed_source_upserts_and_stamps(tmp_path, db):
    body = "# **T**\n\n# **1.1 Basics**\n\nProse.\n\n#### **EXAMPLE 1.1**\n\nWorked.\n"
    d = make_book(tmp_path, body)
    stats = store_source(d, db, copy_assets=False)

    emb, coll = FakeEmbedder(), FakeCollection()
    res = embed_source(stats["source_id"], db, embedder=emb, collection=coll)

    assert res["embedded"] == stats["chunks"]
    assert coll.upserts, "expected a Chroma upsert"
    up = coll.upserts[0]
    assert len(up["ids"]) == stats["chunks"]
    assert all(len(v) == 4 for v in up["embeddings"])          # fake dim
    # documents carry the heading breadcrumb prefix
    assert any("1.1 Basics" in doc for doc in up["documents"])
    # every chunk got an embedded_at stamp
    assert db.query(CorpusChunk).filter(CorpusChunk.embedded_at.isnot(None)).count() == stats["chunks"]


def test_embed_truncates_giant_chunk(tmp_path, db):
    big = "word " * 5000  # ~25k chars, one paragraph
    d = make_book(tmp_path, f"# **T**\n\n# **1.1 Big**\n\n{big}\n")
    stats = store_source(d, db, copy_assets=False)
    emb, coll = FakeEmbedder(), FakeCollection()
    embed_source(stats["source_id"], db, embedder=emb, collection=coll)
    assert all(len(doc) <= indexer._MAX_EMBED_CHARS for doc in coll.upserts[0]["documents"])


def test_chroma_metadata_is_scalar_and_drops_none(db):
    src = CorpusSource(id="s", source_type="textbook", title="Stats",
                       content_hash="h", subject=None)  # subject None -> dropped
    chunk = CorpusChunk(id="s:0", source_id="s", ordinal=0, kind="example",
                        heading_path=["1.1 Defs", "Example"], text="x", content_hash="h",
                        locator={"kind": "page", "start": 17, "end": 18}, asset_paths=["a.jpg"])
    md = chroma_metadata(src, chunk)
    assert "subject" not in md                          # None dropped
    assert md["page_start"] == 17 and md["kind"] == "example"
    assert md["heading"] == "1.1 Defs > Example"
    assert "p. 17" in md["citation"]
    assert all(isinstance(v, (str, int, float, bool)) for v in md.values())  # scalar-only


@pytest.mark.skipif(not os.path.exists(EXAMPLE_DIR), reason="example textbook not present")
def test_store_real_textbook(db):
    stats = store_source(EXAMPLE_DIR, db, copy_assets=False)
    assert stats["chunks"] > 800
    src = db.get(CorpusSource, "statistics")
    assert src.status == "ready" and src.title == "Statistics"
    # ordinals are contiguous in the canonical store
    ords = [o for (o,) in db.query(CorpusChunk.ordinal).order_by(CorpusChunk.ordinal).all()]
    assert ords == list(range(len(ords)))
