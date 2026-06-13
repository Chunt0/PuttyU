"""
upload_importer.py — ingest user uploads as course MATERIALS (Phase-2 T2a, SPEC F2).

Input is an uploaded PDF, or several images assembled server-side into ONE PDF
(Pillow `save(..., save_all=True)`), so every material has a single canonical
`original_path` the PDF viewer can open. Text comes from the same extraction the
documents PDF-import uses (`document_processor._process_pdf`: pypdf text layer +
best-effort VL on image-heavy pages). A scan with no text layer and no VL model
still ingests — with a `needs_ocr` status note — rather than failing.

Idempotent by content hash: re-uploading byte-identical content returns the
existing source. Unlike the directory importers (BaseImporter), this one starts
from in-memory bytes, so it persists directly via the ORM (same row shapes as
indexer._to_source_model / _to_chunk_model).
"""

from __future__ import annotations

import hashlib
import io
import logging
import os
import re

from src.corpus.models import CorpusChunk, CorpusSource, chunk_id
from src.corpus.records import ChunkRecord, Kind, SourceType, estimate_tokens

logger = logging.getLogger(__name__)

DEFAULT_DATA_ROOT = os.path.join("data", "corpus")
_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"}
_MAX_CHUNK_TOKENS = 450  # paragraph-pack target (ADR 0003: prose ~200–500 tokens)

# Markers document_processor._process_pdf writes into extracted text.
_PAGE_MARK_RE = re.compile(r"\[Page (\d+)(?: image \d+)? text\]:\s*")
_NO_TEXT_BANNERS = (
    "[PDF processed but no readable content found]",
    "[PDF processing failed",
)


class UploadError(ValueError):
    """Bad upload shape (mixed/unsupported types, empty payload)."""


# --------------------------------------------------------------------------- #
# Assembly: uploads -> one PDF                                                #
# --------------------------------------------------------------------------- #
def assemble_pdf(files: list[tuple[str, bytes]]) -> tuple[bytes, str]:
    """(filename, bytes) uploads -> (single PDF bytes, inferred title).

    Exactly one PDF passes through; one or more images become one PDF, a page
    per image, in the order given (the webcam multi-page capture path, F4).
    """
    if not files:
        raise UploadError("No files uploaded")
    exts = [os.path.splitext(name or "")[1].lower() for name, _ in files]
    if exts.count(".pdf") == len(files):
        if len(files) != 1:
            raise UploadError("Upload one PDF at a time (or a set of images)")
        name, data = files[0]
        return data, os.path.splitext(os.path.basename(name))[0]
    if all(e in _IMAGE_EXTS for e in exts):
        try:
            from PIL import Image
        except ImportError as e:  # pragma: no cover - Pillow ships via qrcode[pil]
            raise UploadError(f"Image assembly needs Pillow: {e}")
        pages = []
        for name, data in files:
            try:
                img = Image.open(io.BytesIO(data))
                img.load()
            except Exception:
                raise UploadError(f"Unreadable image: {name}")
            if img.mode != "RGB":
                img = img.convert("RGB")
            pages.append(img)
        buf = io.BytesIO()
        pages[0].save(buf, format="PDF", save_all=True, append_images=pages[1:])
        title = os.path.splitext(os.path.basename(files[0][0]))[0]
        return buf.getvalue(), title
    raise UploadError("Upload a single PDF, or images only (assembled into one PDF)")


# --------------------------------------------------------------------------- #
# Extraction + paragraph chunking                                             #
# --------------------------------------------------------------------------- #
def default_extractor(pdf_path: str) -> str:
    """The documents PDF-import path: pypdf text layer + VL on image-heavy pages."""
    from src.document_processor import _process_pdf, strip_pdf_content_marker
    return strip_pdf_content_marker(_process_pdf(pdf_path))


def _pages_from_text(text: str) -> list[tuple[int | None, str]]:
    """Split extractor output into (page_number, text) segments via its markers."""
    text = (text or "").strip()
    if not text or any(text.startswith(b) for b in _NO_TEXT_BANNERS):
        return []
    marks = list(_PAGE_MARK_RE.finditer(text))
    if not marks:
        return [(None, text)]
    pages: list[tuple[int | None, str]] = []
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        body = text[m.end():end].strip()
        if body:
            pages.append((int(m.group(1)), body))
    return pages


def paragraph_chunks(text: str, title: str) -> list[ChunkRecord]:
    """Page-aware paragraph chunks: pack paragraphs to ~450 tokens, never across
    a page boundary, kind=prose, heading_path=[title] (citations read
    "[<title>, p. N]")."""
    records: list[ChunkRecord] = []
    ordinal = 0
    for page, body in _pages_from_text(text):
        paras = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
        buf: list[str] = []
        buf_tokens = 0
        def flush():
            nonlocal buf, buf_tokens, ordinal
            if not buf:
                return
            chunk_text = "\n\n".join(buf)
            locator = {"kind": "page", "start": page, "end": page} if page else None
            records.append(ChunkRecord(
                ordinal=ordinal, kind=Kind.PROSE, heading_path=[title],
                text=chunk_text, locator=locator,
            ))
            ordinal += 1
            buf, buf_tokens = [], 0
        for p in paras:
            t = estimate_tokens(p)
            if buf and buf_tokens + t > _MAX_CHUNK_TOKENS:
                flush()
            buf.append(p)
            buf_tokens += t
        flush()
    return records


# --------------------------------------------------------------------------- #
# Ingest                                                                      #
# --------------------------------------------------------------------------- #
def ingest_material(
    db,
    *,
    files: list[tuple[str, bytes]],
    owner: str | None = None,
    course_id: str | None = None,
    tags: list[str] | None = None,
    title: str | None = None,
    extractor=None,
    embed: bool = True,
    embedder=None,
    collection=None,
    data_root: str = DEFAULT_DATA_ROOT,
) -> dict:
    """Assemble → store under data/corpus/ → chunk → (best-effort) embed.

    Returns {source_id, created, chunks, needs_ocr}. `created=False` means an
    idempotent re-upload: a source with the same content hash already exists
    for this owner; nothing is written.
    """
    pdf_bytes, inferred_title = assemble_pdf(files)
    content_hash = hashlib.sha256(pdf_bytes).hexdigest()

    existing = (db.query(CorpusSource)
                .filter(CorpusSource.content_hash == content_hash,
                        CorpusSource.owner == owner)
                .first())
    if existing is not None:
        n = db.query(CorpusChunk).filter(CorpusChunk.source_id == existing.id).count()
        return {"source_id": existing.id, "created": False, "chunks": n,
                "needs_ocr": existing.status == "needs_ocr"}

    # Deterministic id (idempotent re-upload overwrites nothing), salted with the
    # owner so two users uploading the same bytes get SEPARATE materials.
    id_hash = hashlib.sha256(f"{owner or ''}:{content_hash}".encode()).hexdigest()
    source_id = f"material-{id_hash[:12]}"
    source_dir = os.path.join(data_root, source_id)
    os.makedirs(source_dir, exist_ok=True)
    pdf_path = os.path.join(source_dir, "source.pdf")
    with open(pdf_path, "wb") as f:
        f.write(pdf_bytes)

    extractor = extractor or default_extractor
    try:
        text = extractor(pdf_path)
    except Exception as e:  # extraction must never kill the upload
        logger.warning("material %s: extraction failed (%s)", source_id, e)
        text = ""
    chunks = paragraph_chunks(text, title or inferred_title)
    needs_ocr = not chunks

    meta = {"tags": [t for t in (tags or []) if t], "original_filename": files[0][0]}
    if needs_ocr:
        meta["note"] = ("no text layer found and no VL model extracted text — "
                        "re-ingest after configuring a vision model (needs_ocr)")
    db.add(CorpusSource(
        id=source_id, source_type=SourceType.MATERIAL,
        title=title or inferred_title, original_path=pdf_path,
        course_id=course_id, owner=owner, content_hash=content_hash,
        status="needs_ocr" if needs_ocr else "ready", meta=meta,
    ))
    db.flush()
    for cr in chunks:
        db.add(CorpusChunk(
            id=chunk_id(source_id, cr.ordinal), source_id=source_id,
            ordinal=cr.ordinal, kind=cr.kind, heading_path=cr.heading_path,
            text=cr.text, locator=cr.locator, asset_paths=cr.asset_paths,
            token_estimate=cr.token_estimate, char_count=cr.char_count,
            content_hash=cr.content_hash, meta=cr.meta or {},
        ))
    db.commit()

    if embed and chunks:
        try:
            from src.corpus.indexer import embed_source
            embed_source(source_id, db, embedder=embedder, collection=collection)
        except Exception as e:  # canonical store succeeded; keyword fallback covers
            logger.info("material %s: embedding skipped (%s)", source_id, e)

    return {"source_id": source_id, "created": True, "chunks": len(chunks),
            "needs_ocr": needs_ocr}


__all__ = ["UploadError", "assemble_pdf", "paragraph_chunks", "ingest_material",
           "default_extractor"]
