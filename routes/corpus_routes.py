# routes/corpus_routes.py
"""Corpus library + course materials routes (Phase-2 T2a — SPEC F2, ADR 0003/0004).

Born small and typed: response_models on every endpoint (Gate 6b), Pydantic bodies
(Gate 6c), owner_scoped/visibility rules throughout (Gate 5). The shared library
(owner NULL) is read-only over HTTP — admin import stays CLI-first
(`python -m src.corpus`); only the caller's own MATERIALS are mutable here.
"""

import json
import logging
import os
import shutil

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func

from core.database import SessionLocal, Course
from src.auth_helpers import get_current_user, owner_scoped, require_user
from src.corpus import course_search
from src.corpus.models import CorpusChunk, CorpusSource
from src.request_models import (
    CorpusMaterialUploadResponse,
    CorpusSearchRequest,
    CorpusSearchResponse,
    CorpusSourceItem,
    CorpusSourceListResponse,
    CorpusTagsUpdateRequest,
    CorpusTocResponse,
)

logger = logging.getLogger(__name__)


def _source_to_item(src: CorpusSource, chunk_count: int = 0) -> dict:
    return {
        "id": src.id,
        "kind": "material" if src.owner else "library",
        "title": src.title,
        "source_type": src.source_type,
        "subject": src.subject,
        "authors": src.authors,
        "status": src.status,
        "course_id": src.course_id,
        "tags": course_search.source_tags(src),
        "has_pdf": bool(src.original_path and os.path.exists(src.original_path)),
        "chunk_count": chunk_count,
    }


def _visible_source_or_404(db, source_id: str, user) -> CorpusSource:
    src = (course_search.visible_sources_query(db, user)
           .filter(CorpusSource.id == source_id).first())
    if not src:
        raise HTTPException(404, "Source not found")
    return src


def _owned_material_or_404(db, source_id: str, user) -> CorpusSource:
    """A MATERIAL the caller may mutate. Library rows (owner NULL) are read-only
    over HTTP, so visibility is not enough here — 404 on them too."""
    src = _visible_source_or_404(db, source_id, user)
    if not src.owner or (user and src.owner != user):
        raise HTTPException(404, "Material not found")
    return src


def _verify_course_visible(db, course_id: str, user) -> None:
    q = db.query(Course).filter(Course.id == course_id)
    if not owner_scoped(q, Course, user).first():
        raise HTTPException(404, "Course not found")


def setup_corpus_routes() -> APIRouter:
    router = APIRouter(prefix="/api/corpus", tags=["corpus"])

    # --- LIBRARY + MATERIALS LIST ------------------------------------------
    @router.get("/sources", response_model=CorpusSourceListResponse)
    def list_sources(request: Request):
        """Both halves of retrieval in one list: shared library sources
        (kind=library) and the caller's own materials (kind=material)."""
        user = get_current_user(request)
        db = SessionLocal()
        try:
            sources = (course_search.visible_sources_query(db, user)
                       .order_by(CorpusSource.imported_at.asc()).all())
            counts = dict(
                db.query(CorpusChunk.source_id, func.count())
                .group_by(CorpusChunk.source_id).all()
            )
            return {"sources": [_source_to_item(s, counts.get(s.id, 0)) for s in sources]}
        finally:
            db.close()

    # --- TABLE OF CONTENTS --------------------------------------------------
    @router.get("/sources/{source_id}/toc", response_model=CorpusTocResponse)
    def source_toc(request: Request, source_id: str):
        user = get_current_user(request)
        db = SessionLocal()
        try:
            src = _visible_source_or_404(db, source_id, user)
            return {"source_id": src.id, "toc": course_search.toc_tree(db, src.id)}
        finally:
            db.close()

    # --- ORIGINAL PDF (served for direct student access, never embedded) ----
    @router.get("/sources/{source_id}/pdf")
    def source_pdf(request: Request, source_id: str):
        user = require_user(request)
        db = SessionLocal()
        try:
            src = _visible_source_or_404(db, source_id, user)
            path = src.original_path
            title = src.title
        finally:
            db.close()
        if not path or not os.path.exists(path):
            raise HTTPException(404, "No PDF stored for this source")
        return FileResponse(path, media_type="application/pdf",
                            filename=f"{title or source_id}.pdf")

    # --- COURSE-SCOPED SEARCH (the retrieval door — SPEC F2/F3) -------------
    @router.post("/search", response_model=CorpusSearchResponse)
    def search_corpus(request: Request, body: CorpusSearchRequest):
        user = get_current_user(request)
        db = SessionLocal()
        try:
            if body.course_id:
                _verify_course_visible(db, body.course_id, user)
            scope = course_search.resolve_scope(
                db, user, course_id=body.course_id, tags=body.tags)
            items, fallback = course_search.search_scoped(
                db, body.query, scope, top_k=body.top_k)
            return {"items": items, "keyword_fallback": fallback}
        finally:
            db.close()

    # --- MATERIALS: upload / retag / delete (SPEC F2 second block) ----------
    @router.post("/materials", response_model=CorpusMaterialUploadResponse)
    async def upload_material(
        request: Request,
        files: list[UploadFile] = File(...),
        course_id: str = Form(""),
        tags: str = Form(""),
        title: str = Form(""),
    ):
        """Ingest an uploaded PDF — or several images assembled server-side into
        ONE PDF — as an owner-scoped course material. Idempotent by content hash."""
        user = get_current_user(request)
        course_id = (course_id or "").strip()
        try:
            tag_list = [str(t) for t in json.loads(tags)] if tags.strip() else []
        except (json.JSONDecodeError, TypeError):
            raise HTTPException(400, "tags must be a JSON list of strings")
        if not files:
            raise HTTPException(400, "No files uploaded")

        payload = []
        for f in files:
            data = await f.read()
            if not data:
                raise HTTPException(400, f"Empty file: {f.filename}")
            payload.append((f.filename or "upload", data))

        from src.corpus.importers.upload_importer import ingest_material, UploadError
        db = SessionLocal()
        try:
            if course_id:
                _verify_course_visible(db, course_id, user)
            try:
                result = ingest_material(
                    db, files=payload, owner=user or None,
                    course_id=course_id or None, tags=tag_list,
                    title=title.strip() or None,
                )
            except UploadError as e:
                raise HTTPException(400, str(e))
            src = db.get(CorpusSource, result["source_id"])
            item = _source_to_item(src, result["chunks"])
        finally:
            db.close()
        # Phase-2 T3a (ADR 0005): course-bound materials seed the graph region.
        # seed_course_region itself skips plain-paragraph materials (no
        # heading-ish chunks, no key terms); best-effort, never fails the upload.
        if course_id and result["created"]:
            from src.graph.seeding import seed_safely
            seed_safely(course_id, [result["source_id"]], owner=user or None)
        return {
            "source": item,
            "created": result["created"],
            "chunks": result["chunks"],
            "needs_ocr": result["needs_ocr"],
        }

    @router.patch("/materials/{source_id}/tags", response_model=CorpusSourceItem)
    def replace_tags(request: Request, source_id: str, body: CorpusTagsUpdateRequest):
        """Replace the material's tag list (stored in meta.tags; the search tag
        filter reads it via SQL, so no Chroma re-index is needed)."""
        user = get_current_user(request)
        cleaned, seen = [], set()
        for t in body.tags:
            t = (t or "").strip()
            if t and t.lower() not in seen:
                seen.add(t.lower())
                cleaned.append(t)
        db = SessionLocal()
        try:
            src = _owned_material_or_404(db, source_id, user)
            meta = dict(src.meta) if isinstance(src.meta, dict) else {}
            meta["tags"] = cleaned
            src.meta = meta  # reassign: SQLAlchemy JSON columns don't track mutation
            db.commit()
            count = db.query(CorpusChunk).filter(CorpusChunk.source_id == src.id).count()
            return _source_to_item(src, count)
        finally:
            db.close()

    @router.delete("/materials/{source_id}", response_model=CorpusSourceItem)
    def delete_material(request: Request, source_id: str):
        """Remove a material: SQLite rows (chunk cascade), Chroma vectors
        (best-effort — the index is disposable, ADR 0003), and stored files."""
        user = get_current_user(request)
        db = SessionLocal()
        try:
            src = _owned_material_or_404(db, source_id, user)
            chunk_ids = [c.id for c in db.query(CorpusChunk.id)
                         .filter(CorpusChunk.source_id == src.id).all()]
            item = _source_to_item(src, len(chunk_ids))
            paths = {os.path.dirname(p) for p in (src.original_path,) if p}
            if src.assets_dir:
                paths.add(os.path.dirname(src.assets_dir))
            db.delete(src)  # cascade drops chunks
            db.commit()
        finally:
            db.close()
        if chunk_ids:
            try:
                from src.corpus.indexer import _default_collection
                _default_collection().delete(ids=chunk_ids)
            except Exception as e:
                logger.info("corpus: Chroma delete skipped (%s)", e)
        for p in paths:
            if p and os.path.isdir(p) and os.path.basename(os.path.dirname(p)) == "corpus":
                shutil.rmtree(p, ignore_errors=True)
        return item

    return router
