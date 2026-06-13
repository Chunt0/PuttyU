"""Phase-2 T2a — corpus library + materials routes (SPEC F2, ADR 0003/0004):
list (kind discriminator + owner scoping), TOC tree, PDF serving, course/tag-scoped
search with keyword fallback, and the materials upload→tag→delete lifecycle.

Same direct-endpoint pattern as test_course_routes.py (TestClient threadpools can
hang in CI): handlers extracted from the router, temp-file sqlite engine.
"""

import io
import json
import tempfile
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

import core.database as cdb
import routes.corpus_routes as xroutes
import src.corpus.retriever as retriever_mod
from core.database import Course, CourseSource
from src.corpus.models import CorpusChunk, CorpusSource, chunk_id
from src.request_models import CorpusSearchRequest, CorpusTagsUpdateRequest

_TMPDB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_ENGINE = create_engine(
    f"sqlite:///{_TMPDB.name}",
    connect_args={"check_same_thread": False},
    poolclass=NullPool,
)
cdb.Base.metadata.create_all(_ENGINE)
_TS = sessionmaker(bind=_ENGINE, autoflush=False, autocommit=False)
xroutes.SessionLocal = _TS

_ROUTER = xroutes.setup_corpus_routes()


def _endpoint(method, suffix):
    for r in _ROUTER.routes:
        if getattr(r, "path", "").endswith(suffix) and method in getattr(r, "methods", set()):
            return r.endpoint
    raise RuntimeError(f"{method} *{suffix} not found")


list_sources = _endpoint("GET", "/sources")
source_toc = _endpoint("GET", "/{source_id}/toc")
source_pdf = _endpoint("GET", "/{source_id}/pdf")
search_corpus = _endpoint("POST", "/search")
upload_material = _endpoint("POST", "/materials")
replace_tags = _endpoint("PATCH", "/{source_id}/tags")
delete_material = _endpoint("DELETE", "/materials/{source_id}")


def _req(user="ada"):
    return SimpleNamespace(state=SimpleNamespace(current_user=user))


@pytest.fixture(autouse=True)
def _clean_tables():
    db = _TS()
    try:
        for t in (CorpusChunk, CorpusSource, CourseSource, Course):
            db.query(t).delete()
        db.commit()
    finally:
        db.close()
    yield


def _seed(pdf_path=None):
    """Library book (2 chunks) + ada's material (course c1, tag syllabus) +
    bob's material. Returns ids."""
    db = _TS()
    try:
        db.add(Course(id="c1", name="Physics 1", status="active", owner="ada", settings="{}"))
        db.add(CorpusSource(id="lib1", source_type="textbook", title="Intro Stats",
                            authors="OpenStax", subject="statistics",
                            content_hash="h-lib", status="ready",
                            original_path=pdf_path))
        db.add(CorpusChunk(id=chunk_id("lib1", 0), source_id="lib1", ordinal=0,
                           kind="prose", heading_path=["1 Sampling", "1.1 Definitions"],
                           text="A parameter describes a population.",
                           locator={"kind": "page", "start": 9, "end": 9},
                           content_hash="hc0"))
        db.add(CorpusChunk(id=chunk_id("lib1", 1), source_id="lib1", ordinal=1,
                           kind="example", heading_path=["1 Sampling", "1.2 Statistics"],
                           text="A statistic describes a sample.",
                           locator={"kind": "page", "start": 12, "end": 12},
                           content_hash="hc1"))
        db.add(CorpusSource(id="mat-ada", source_type="material", title="Week 3 sheet",
                            owner="ada", course_id="c1", content_hash="h-ada",
                            status="ready", meta={"tags": ["syllabus", "week-3"]}))
        db.add(CorpusChunk(id=chunk_id("mat-ada", 0), source_id="mat-ada", ordinal=0,
                           kind="prose", heading_path=["Week 3 sheet"],
                           text="Problem 3 covers projectile motion.",
                           locator={"kind": "page", "start": 2, "end": 2},
                           content_hash="hma"))
        db.add(CorpusSource(id="mat-bob", source_type="material", title="Bob's notes",
                            owner="bob", content_hash="h-bob", status="ready",
                            meta={"tags": ["syllabus"]}))
        db.add(CorpusChunk(id=chunk_id("mat-bob", 0), source_id="mat-bob", ordinal=0,
                           kind="prose", heading_path=["Bob's notes"],
                           text="Bob's secret projectile notes.", content_hash="hmb"))
        db.add(CourseSource(course_id="c1", source_id="lib1"))
        db.commit()
    finally:
        db.close()


# ---------------------------------------------------------------- list

def test_list_sources_discriminates_and_owner_scopes():
    _seed()
    out = list_sources(_req("ada"))
    by_id = {s["id"]: s for s in out["sources"]}
    assert by_id["lib1"]["kind"] == "library" and by_id["lib1"]["chunk_count"] == 2
    assert by_id["mat-ada"]["kind"] == "material"
    assert by_id["mat-ada"]["tags"] == ["syllabus", "week-3"]
    assert by_id["mat-ada"]["course_id"] == "c1"
    assert "mat-bob" not in by_id  # cross-user materials are invisible
    assert "mat-bob" in {s["id"] for s in list_sources(_req("bob"))["sources"]}


# ---------------------------------------------------------------- toc

def test_toc_is_a_heading_tree_with_pages():
    _seed()
    out = source_toc(_req("ada"), "lib1")
    assert out["source_id"] == "lib1"
    (root,) = out["toc"]
    assert root["heading"] == "1 Sampling" and root["page_start"] == 9
    kids = [c["heading"] for c in root["children"]]
    assert kids == ["1.1 Definitions", "1.2 Statistics"]
    assert root["children"][1]["page_start"] == 12


def test_toc_of_foreign_material_404s():
    _seed()
    with pytest.raises(HTTPException) as e:
        source_toc(_req("ada"), "mat-bob")
    assert e.value.status_code == 404


# ---------------------------------------------------------------- pdf

def test_pdf_served_when_present_404_when_absent(tmp_path):
    pdf = tmp_path / "source.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    _seed(pdf_path=str(pdf))
    resp = source_pdf(_req("ada"), "lib1")
    assert resp.path == str(pdf) and resp.media_type == "application/pdf"
    with pytest.raises(HTTPException) as e:
        source_pdf(_req("ada"), "mat-ada")  # no original_path stored
    assert e.value.status_code == 404


# ---------------------------------------------------------------- search

class _FakeVectorSearch:
    """Stands in for retriever.search — returns canned chunk ids, records `where`."""

    def __init__(self, ids):
        self.ids = ids
        self.last_where = "unset"

    def __call__(self, query, k=8, where=None, embedder=None, collection=None):
        self.last_where = where
        return [{"id": i, "distance": 0.1, "metadata": {"citation": f"cite:{i}"},
                 "document": "d"} for i in self.ids[:k]]


def test_search_scopes_to_course_sources(monkeypatch):
    _seed()
    fake = _FakeVectorSearch([chunk_id("lib1", 0), chunk_id("mat-ada", 0),
                              chunk_id("mat-bob", 0)])
    monkeypatch.setattr(retriever_mod, "search", fake)
    out = search_corpus(_req("ada"), CorpusSearchRequest(query="parameters", course_id="c1"))
    ids = [i["chunk_id"] for i in out["items"]]
    assert chunk_id("lib1", 0) in ids and chunk_id("mat-ada", 0) in ids
    assert chunk_id("mat-bob", 0) not in ids  # drift outside scope filtered out
    assert out["keyword_fallback"] is False
    scoped = set(fake.last_where["source_id"]["$in"])
    assert scoped == {"lib1", "mat-ada"}  # link table ∪ course materials
    item = next(i for i in out["items"] if i["chunk_id"] == chunk_id("lib1", 0))
    assert item["title"] == "Intro Stats" and item["page_start"] == 9
    assert item["citation"] == f"cite:{chunk_id('lib1', 0)}"
    assert item["heading"] == "1 Sampling > 1.1 Definitions"


def test_search_keyword_fallback_when_chroma_down(monkeypatch):
    _seed()
    def broken(*a, **kw):
        raise RuntimeError("chromadb unavailable")
    monkeypatch.setattr(retriever_mod, "search", broken)
    out = search_corpus(_req("ada"), CorpusSearchRequest(query="projectile motion"))
    assert out["keyword_fallback"] is True
    ids = [i["chunk_id"] for i in out["items"]]
    assert chunk_id("mat-ada", 0) in ids
    assert chunk_id("mat-bob", 0) not in ids  # owner scoping holds in fallback too


def test_search_tag_filter_narrows_sources(monkeypatch):
    _seed()
    monkeypatch.setattr(retriever_mod, "search",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("off")))
    out = search_corpus(_req("ada"),
                        CorpusSearchRequest(query="projectile parameter", tags=["week-3"]))
    assert {i["source_id"] for i in out["items"]} == {"mat-ada"}


def test_search_foreign_course_404s():
    _seed()
    db = _TS()
    try:
        db.add(Course(id="cb", name="Bob's course", status="active", owner="bob",
                      settings="{}"))
        db.commit()
    finally:
        db.close()
    with pytest.raises(HTTPException) as e:
        search_corpus(_req("ada"), CorpusSearchRequest(query="x", course_id="cb"))
    assert e.value.status_code == 404


# ---------------------------------------------------------------- materials lifecycle

def _upload_files(*specs):
    return [UploadFile(file=io.BytesIO(data), filename=name) for name, data in specs]


@pytest.mark.asyncio
async def test_upload_list_search_by_tag_delete_flow(monkeypatch, tmp_path):
    _seed()
    monkeypatch.chdir(tmp_path)  # materials land under ./data/corpus
    import src.corpus.importers.upload_importer as ui
    monkeypatch.setattr(ui, "default_extractor",
                        lambda p: "[Page 1 text]:\nKinematics worksheet problems.")
    import src.corpus.indexer as idx
    monkeypatch.setattr(idx, "embed_source",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no chroma")))
    monkeypatch.setattr(retriever_mod, "search",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no chroma")))

    res = await upload_material(
        _req("ada"), files=_upload_files(("hw3.pdf", b"%PDF-hw3")),
        course_id="c1", tags=json.dumps(["homework", "week-3"]), title="")
    assert res["created"] is True and res["chunks"] == 1 and res["needs_ocr"] is False
    sid = res["source"]["id"]
    assert res["source"]["kind"] == "material" and res["source"]["has_pdf"] is True
    assert res["source"]["tags"] == ["homework", "week-3"]

    assert sid in {s["id"] for s in list_sources(_req("ada"))["sources"]}

    out = search_corpus(_req("ada"), CorpusSearchRequest(query="kinematics", tags=["homework"]))
    assert [i["source_id"] for i in out["items"]] == [sid]

    # idempotent re-upload returns the SAME source, creates nothing
    again = await upload_material(
        _req("ada"), files=_upload_files(("hw3-copy.pdf", b"%PDF-hw3")),
        course_id="c1", tags="", title="")
    assert again["created"] is False and again["source"]["id"] == sid

    gone = delete_material(_req("ada"), sid)
    assert gone["id"] == sid
    assert sid not in {s["id"] for s in list_sources(_req("ada"))["sources"]}
    db = _TS()
    try:
        assert db.query(CorpusChunk).filter(CorpusChunk.source_id == sid).count() == 0
    finally:
        db.close()


@pytest.mark.asyncio
async def test_upload_images_assemble_into_one_material(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    import src.corpus.importers.upload_importer as ui
    monkeypatch.setattr(ui, "default_extractor", lambda p: "")
    from PIL import Image

    def png():
        buf = io.BytesIO()
        Image.new("RGB", (20, 20), (9, 9, 9)).save(buf, format="PNG")
        return buf.getvalue()

    res = await upload_material(
        _req("ada"), files=_upload_files(("p1.png", png()), ("p2.png", png())),
        course_id="", tags="", title="Scanned worksheet")
    assert res["source"]["title"] == "Scanned worksheet"
    assert res["needs_ocr"] is True  # no text layer, no VL -> ingested, flagged
    assert res["source"]["status"] == "needs_ocr"
    from pypdf import PdfReader
    db = _TS()
    try:
        src = db.get(CorpusSource, res["source"]["id"])
        assert len(PdfReader(src.original_path).pages) == 2  # ONE PDF, page per image
    finally:
        db.close()


@pytest.mark.asyncio
async def test_upload_rejects_bad_payloads(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    with pytest.raises(HTTPException) as e:
        await upload_material(_req("ada"), files=_upload_files(("a.pdf", b"x"), ("b.pdf", b"y")),
                              course_id="", tags="", title="")
    assert e.value.status_code == 400
    with pytest.raises(HTTPException) as e:
        await upload_material(_req("ada"), files=_upload_files(("a.pdf", b"x")),
                              course_id="", tags="not-json", title="")
    assert e.value.status_code == 400
    with pytest.raises(HTTPException) as e:
        await upload_material(_req("ada"), files=_upload_files(("a.pdf", b"x")),
                              course_id="missing-course", tags="", title="")
    assert e.value.status_code == 404


def test_retag_replaces_list_and_dedupes():
    _seed()
    out = replace_tags(_req("ada"), "mat-ada",
                       CorpusTagsUpdateRequest(tags=["Exam", "exam", " review ", ""]))
    assert out["tags"] == ["Exam", "review"]
    db = _TS()
    try:
        assert db.get(CorpusSource, "mat-ada").meta["tags"] == ["Exam", "review"]
    finally:
        db.close()


def test_materials_mutations_are_owner_scoped_and_library_readonly():
    _seed()
    for fn, args in ((replace_tags, (CorpusTagsUpdateRequest(tags=["x"]),)),
                     (delete_material, ())):
        with pytest.raises(HTTPException) as e:
            fn(_req("ada"), "mat-bob", *args)
        assert e.value.status_code == 404
        with pytest.raises(HTTPException) as e:
            fn(_req("ada"), "lib1", *args)  # the shared library is read-only over HTTP
        assert e.value.status_code == 404


# ---------------------------------------------------------------- init_db wiring

def test_init_db_creates_corpus_tables():
    from sqlalchemy import inspect
    cdb.init_db()  # idempotent; earlier test modules may have touched the shared DB
    insp = inspect(cdb.engine)
    assert insp.has_table("corpus_source") and insp.has_table("corpus_chunk")
