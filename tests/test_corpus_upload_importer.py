"""Phase-2 T2a — upload importer (SPEC F2 second block): PDF/images → ONE PDF →
owner-scoped material with paragraph chunks; idempotent by content hash; a scan
with no text layer ingests with a needs_ocr note instead of failing."""

import io

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.corpus.importers.upload_importer import (
    UploadError,
    assemble_pdf,
    ingest_material,
    paragraph_chunks,
)
from src.corpus.models import CorpusChunk, CorpusSource, ensure_corpus_tables


@pytest.fixture
def db(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path/'u.db'}")
    ensure_corpus_tables(bind=engine)
    sess = sessionmaker(bind=engine)()
    yield sess
    sess.close()


def _png_bytes(color=(200, 60, 60)):
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), color).save(buf, format="PNG")
    return buf.getvalue()


# ------------------------------------------------------------------ assembly

def test_assemble_single_pdf_passthrough():
    data, title = assemble_pdf([("Week-3 Homework.pdf", b"%PDF-fake")])
    assert data == b"%PDF-fake"
    assert title == "Week-3 Homework"


def test_assemble_images_into_one_pdf():
    from pypdf import PdfReader
    data, title = assemble_pdf([
        ("scan-page-1.png", _png_bytes()),
        ("scan-page-2.png", _png_bytes((10, 120, 10))),
    ])
    reader = PdfReader(io.BytesIO(data))
    assert len(reader.pages) == 2  # multi-page capture -> ONE material
    assert title == "scan-page-1"


@pytest.mark.parametrize("files", [
    [],
    [("a.pdf", b"x"), ("b.pdf", b"y")],                # one PDF at a time
    [("a.pdf", b"x"), ("b.png", b"y")],                # no mixing
    [("notes.docx", b"x")],                            # unsupported type
])
def test_assemble_rejects_bad_shapes(files):
    with pytest.raises(UploadError):
        assemble_pdf(files)


# ------------------------------------------------------------------ chunking

def test_paragraph_chunks_track_page_locators():
    text = (
        "[Page 1 text]:\nIntro paragraph.\n\nSecond paragraph.\n\n"
        "[Page 2 text]:\nThird paragraph on page two."
    )
    chunks = paragraph_chunks(text, "Syllabus")
    assert [c.ordinal for c in chunks] == [0, 1]
    assert chunks[0].locator == {"kind": "page", "start": 1, "end": 1}
    assert chunks[1].locator == {"kind": "page", "start": 2, "end": 2}
    assert chunks[0].heading_path == ["Syllabus"]
    assert "Intro paragraph." in chunks[0].text and "Second paragraph." in chunks[0].text


def test_paragraph_chunks_split_to_token_budget():
    big_para = "statistics " * 120  # ~240 tokens each
    text = "[Page 1 text]:\n" + "\n\n".join([big_para] * 4)
    chunks = paragraph_chunks(text, "T")
    assert len(chunks) > 1  # packed to ~450-token budget, not one giant chunk
    assert all(c.locator["start"] == 1 for c in chunks)


def test_paragraph_chunks_empty_and_banner_text():
    assert paragraph_chunks("", "T") == []
    assert paragraph_chunks("[PDF processed but no readable content found]", "T") == []
    assert paragraph_chunks("[PDF processing failed: boom]", "T") == []


# ------------------------------------------------------------------ ingest

def _ingest(db, tmp_path, text="[Page 1 text]:\nNewton's laws.", **kw):
    kw.setdefault("files", [("hw.pdf", b"%PDF-fake-bytes")])
    kw.setdefault("owner", "ada")
    kw.setdefault("extractor", lambda path: text)
    kw.setdefault("embed", False)
    kw.setdefault("data_root", str(tmp_path / "corpus"))
    return ingest_material(db, **kw)


def test_ingest_creates_material_with_tags_and_pdf(db, tmp_path):
    res = _ingest(db, tmp_path, course_id="c1", tags=["homework", "week-3"])
    assert res["created"] is True and res["chunks"] == 1 and res["needs_ocr"] is False
    src = db.get(CorpusSource, res["source_id"])
    assert src.source_type == "material" and src.owner == "ada"
    assert src.course_id == "c1" and src.status == "ready"
    assert src.meta["tags"] == ["homework", "week-3"]
    assert src.original_path.endswith("source.pdf")
    with open(src.original_path, "rb") as f:
        assert f.read() == b"%PDF-fake-bytes"
    chunk = db.query(CorpusChunk).filter(CorpusChunk.source_id == src.id).one()
    assert "Newton's laws." in chunk.text


def test_ingest_is_idempotent_by_content_hash(db, tmp_path):
    first = _ingest(db, tmp_path)
    again = _ingest(db, tmp_path, tags=["different"])
    assert again["source_id"] == first["source_id"]
    assert again["created"] is False
    assert db.query(CorpusSource).count() == 1
    assert db.query(CorpusChunk).count() == 1


def test_ingest_same_bytes_different_owner_is_separate(db, tmp_path):
    a = _ingest(db, tmp_path, owner="ada")
    b = _ingest(db, tmp_path, owner="bob")
    assert a["created"] and b["created"]
    assert a["source_id"] != b["source_id"]  # owner-salted id: no cross-user collision
    assert db.query(CorpusSource).count() == 2


def test_ingest_no_text_layer_lands_as_needs_ocr(db, tmp_path):
    res = _ingest(db, tmp_path, text="[PDF processed but no readable content found]")
    assert res["needs_ocr"] is True and res["chunks"] == 0
    src = db.get(CorpusSource, res["source_id"])
    assert src.status == "needs_ocr"
    assert "needs_ocr" in src.meta["note"]


def test_ingest_extractor_crash_degrades_to_needs_ocr(db, tmp_path):
    def boom(path):
        raise RuntimeError("no pypdf")
    res = _ingest(db, tmp_path, extractor=boom)
    assert res["needs_ocr"] is True  # ingest never fails on extraction


def test_ingest_embeds_best_effort(db, tmp_path):
    import numpy as np

    class Embedder:
        def encode(self, texts):
            return np.ones((len(texts), 3), dtype="float32")

    class Collection:
        def __init__(self):
            self.upserts = []
        def upsert(self, ids, embeddings, documents, metadatas):
            self.upserts.append(ids)

    coll = Collection()
    res = _ingest(db, tmp_path, embed=True, embedder=Embedder(), collection=coll)
    assert coll.upserts and coll.upserts[0] == [f"{res['source_id']}:0"]
    chunk = db.query(CorpusChunk).one()
    assert chunk.embedded_at is not None


def test_ingest_embedding_failure_keeps_canonical_store(db, tmp_path):
    class BadEmbedder:
        def encode(self, texts):
            raise RuntimeError("chroma down")
    res = _ingest(db, tmp_path, embed=True, embedder=BadEmbedder(), collection=object())
    assert res["created"] is True and res["chunks"] == 1  # degraded, not failed
