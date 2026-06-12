"""
textbook_marker.py — import a Marker-converted textbook directory.

Layout (ADR 0003):
    <book>/ source.pdf · book.md · images/_page_<N>_<...>.jpeg · marker/output.md

`book.md` is the whole book; we chunk it (src.corpus.chunker) and best-effort scrape a
little front-matter metadata (title, authors, license, ISBN, year). Anything not reliably
in the text (subject, level, language) is taken from caller overrides, defaulting safely.
"""

from __future__ import annotations

import os
import re

from src.corpus.chunker import parse_chunks
from src.corpus.importers.base import BaseImporter, slugify
from src.corpus.records import ChunkRecord, SourceRecord, SourceType, content_hash


class TextbookMarkerImporter(BaseImporter):
    #: book text candidates, in preference order
    _BOOK_CANDIDATES = ("book.md", os.path.join("marker", "output.md"))

    def _book_path(self, source_dir: str) -> str | None:
        for rel in self._BOOK_CANDIDATES:
            p = os.path.join(source_dir, rel)
            if os.path.exists(p):
                return p
        return None

    def can_handle(self, source_dir: str) -> bool:
        return self._book_path(source_dir) is not None

    def parse(self, source_dir: str, **overrides) -> tuple[SourceRecord, list[ChunkRecord]]:
        book_path = self._book_path(source_dir)
        if not book_path:
            raise FileNotFoundError(f"no book.md / marker/output.md under {source_dir}")
        markdown = open(book_path, encoding="utf-8").read()

        chunks = parse_chunks(markdown)

        source_id = overrides.get("source_id") or slugify(os.path.basename(os.path.abspath(source_dir)))
        meta = self._scrape_meta(markdown)
        pdf = os.path.join(source_dir, "source.pdf")

        source = SourceRecord(
            id=source_id,
            source_type=SourceType.TEXTBOOK,
            title=overrides.get("title") or self._scrape_title(markdown) or source_id,
            content_hash=content_hash(markdown),
            language=overrides.get("language", "en"),
            subject=overrides.get("subject"),
            level=overrides.get("level"),
            original_path=pdf if os.path.exists(pdf) else None,
            license=overrides.get("license") or meta.pop("license", None),
            authors=overrides.get("authors") or meta.pop("authors", None),
            course_id=overrides.get("course_id"),
            owner=overrides.get("owner"),
            status="importing",
            meta=meta,
        )
        return source, chunks

    # --- best-effort front-matter scraping (never raises; missing -> None) ----------- #

    @staticmethod
    def _scrape_title(md: str) -> str | None:
        m = re.search(r"^#\s+\*\*(.+?)\*\*\s*$", md, re.MULTILINE)
        return m.group(1).strip() if m else None

    @staticmethod
    def _scrape_meta(md: str) -> dict:
        meta: dict = {}
        head = md[:4000]  # metadata lives in the first page or two

        m = re.search(r"SENIOR CONTRIBUTING AUTHORS\s*\n+\s*\*?\*?(.+)", head)
        if m:
            authors = m.group(1).replace("**", "").strip()
            if authors:
                meta["authors"] = authors

        if "Creative Commons Attribution 4.0" in head:
            cc = re.search(r"\(CC BY[^)]*\)", head)
            meta["license"] = cc.group(0).strip("()") if cc else "CC BY 4.0"

        m = re.search(r"DIGITAL VERSION ISBN-13\s+([\d-]+)", head)
        if m:
            meta["isbn"] = m.group(1)

        m = re.search(r"PUBLICATION YEAR\s+(\d{4})", head)
        if m:
            meta["year"] = int(m.group(1))

        return meta
