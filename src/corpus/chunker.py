"""
chunker.py — pure markdown -> ChunkRecord splitter for Marker textbook output.

This is the testable core of the corpus subsystem (no DB / embeddings / filesystem).
Its behaviour is pinned by tests/test_corpus_chunker.py, which is the spec.

Design (see docs/adr/0003-corpus-schema.md §Chunking):
  * Hierarchy comes from the section NUMBER in the heading text (1, 1.1, 1.2.3),
    never from the markdown '#' depth — Marker emits inconsistent '#' levels.
  * Pedagogical blocks (Example/Try-It/Note/Key-Terms/Objective/Exercise) are ATOMIC:
    one typed chunk each, never split. An EXAMPLE folds its Problem+Solution in.
  * Prose between blocks accumulates under the current section and splits on paragraph
    boundaries to a ~500-token budget.
  * Page locators are tracked from `<span id="page-N-…">` anchors and `_page_N_` image
    names; asset paths are the bare image basenames referenced in the slice.
  * Front matter (cover/TOC/preface) is skipped until the first real content heading.
"""

from __future__ import annotations

import re

from src.corpus.records import ChunkRecord, Kind, estimate_tokens

# Prose / container packing target.
_MAX_PROSE_TOKENS = 500
# Atomic pedagogical blocks are kept whole up to this safety ceiling; beyond it they
# are paragraph-split so a mis-detected / runaway block can't become a giant chunk.
# Sized from the real textbook: legitimate worked examples top out ~1500 tokens, so a
# generous 2000 keeps every genuine example/try-it/note/objective intact.
_ATOMIC_CEILING = 2000

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")
_SPAN_RE = re.compile(r"</?span[^>]*>")
_PAGE_ANCHOR_RE = re.compile(r'id="page-(\d+)-\d+"')
_PAGE_IMAGE_RE = re.compile(r"_page_(\d+)_")
_IMAGE_REF_RE = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")
# A body section heading is a DOTTED number ("1.1", "4.8.2") + title. Bare-integer
# headings ("4 Preface", "7 • Solutions") are Marker running-header/page artifacts, not
# sections — chapter headings never appear in the body of this textbook family, so
# requiring a dot cleanly rejects the artifacts. (See ADR 0003: numbers, not '#' depth.)
_SECTION_RE = re.compile(r"^(\d+(?:\.\d+)+)\s+(.+)$")

# Pedagogical-heading label -> kind. Matched on the cleaned, upper-cased heading text.
# Order matters only for readability; patterns are anchored and mutually exclusive.
_PED_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"^EXAMPLE\b"), Kind.EXAMPLE),
    (re.compile(r"^TRY IT\b"), Kind.TRY_IT),
    (re.compile(r"^NOTE\b"), Kind.NOTE),
    (re.compile(r"^KEY TERMS\b"), Kind.KEY_TERMS),
    (re.compile(r"^CHAPTER OBJECTIVES\b"), Kind.OBJECTIVE),
    (re.compile(r"^(COLLABORATIVE EXERCISE|PRACTICE|HOMEWORK|BRINGING IT TOGETHER)\b"), Kind.EXERCISE),
]

# Kinds whose heading opens a NEW atomic block (and therefore closes whatever is open).
# Problem/Solution are deliberately absent: they fold into the enclosing example/prose.
_BOUNDARY_KINDS = frozenset({
    Kind.EXAMPLE, Kind.TRY_IT, Kind.NOTE, Kind.KEY_TERMS, Kind.OBJECTIVE, Kind.EXERCISE,
})

# "Container" kinds are collections of independent items (Homework/Practice problem sets)
# rather than one coherent block, so they are paragraph-split to the budget like prose —
# splitting them is pedagogically correct, not a compromise.
_CONTAINER_KINDS = frozenset({Kind.EXERCISE})


def _clean_heading(raw_text: str) -> str:
    """Strip span anchors and bold markers from heading text; collapse whitespace."""
    s = _SPAN_RE.sub("", raw_text)
    s = s.replace("**", "").replace("__", "")
    return re.sub(r"\s+", " ", s).strip()


def _classify_heading(clean: str):
    """Return ('section', number, title) | ('ped', kind, clean) | None for a heading."""
    # Section headings: a leading dotted number + title, and NOT a TOC link line.
    if "](#" not in clean:
        m = _SECTION_RE.match(clean)
        if m:
            return ("section", m.group(1), clean)
    upper = clean.upper()
    for pat, kind in _PED_PATTERNS:
        if pat.match(upper):
            return ("ped", kind, clean)
    return None


def _page_for_lines(page_at: list, start: int, end: int):
    """(min_page, max_page) over lines[start:end], skipping unknown (None) pages.

    min/max rather than first/last so provenance stays well-ordered even when an image
    name (`_page_N_`) momentarily references a neighbouring page out of sequence.
    """
    known = [p for p in page_at[start:end] if p is not None]
    if not known:
        return None
    return min(known), max(known)


def _assets_in(lines: list[str], start: int, end: int) -> list[str]:
    out: list[str] = []
    for ln in lines[start:end]:
        for ref in _IMAGE_REF_RE.findall(ln):
            if ref not in out:
                out.append(ref)
    return out


def _make_chunk(ordinal, kind, heading_path, lines, page_at, start, end) -> ChunkRecord | None:
    text = "\n".join(lines[start:end]).strip()
    if not text:
        return None
    page = _page_for_lines(page_at, start, end)
    locator = {"kind": "page", "start": page[0], "end": page[1]} if page else None
    return ChunkRecord(
        ordinal=ordinal,
        kind=kind,
        heading_path=list(heading_path),
        text=text,
        locator=locator,
        asset_paths=_assets_in(lines, start, end),
    )


def _paragraph_split(ordinal_start, kind, heading_path, lines, page_at, start, end) -> list[ChunkRecord]:
    """Split a line-range into ~_MAX_PROSE_TOKENS chunks on blank-line boundaries.

    Paragraphs are kept whole (a single over-long paragraph becomes its own chunk rather
    than being cut mid-sentence). Page locators / assets are recomputed per emitted slice.
    The emitted chunks keep the given `kind` (prose, or a split container like exercise).
    """
    # Paragraph = maximal run of non-blank lines; record its [lo, hi) line span.
    paras: list[tuple[int, int]] = []
    i = start
    while i < end:
        if not lines[i].strip():
            i += 1
            continue
        lo = i
        while i < end and lines[i].strip():
            i += 1
        paras.append((lo, i))
    if not paras:
        return []

    chunks: list[ChunkRecord] = []
    ordinal = ordinal_start
    group_lo = paras[0][0]
    group_hi = paras[0][1]
    group_tokens = estimate_tokens("\n".join(lines[group_lo:group_hi]))

    def flush(lo, hi):
        nonlocal ordinal
        c = _make_chunk(ordinal, kind, heading_path, lines, page_at, lo, hi)
        if c is not None:
            chunks.append(c)
            ordinal += 1

    for lo, hi in paras[1:]:
        ptok = estimate_tokens("\n".join(lines[lo:hi]))
        if group_tokens and group_tokens + ptok > _MAX_PROSE_TOKENS:
            flush(group_lo, group_hi)
            group_lo, group_hi, group_tokens = lo, hi, ptok
        else:
            group_hi = hi
            group_tokens += ptok
    flush(group_lo, group_hi)
    return chunks


def _emit_block(ordinal_start, kind, heading_path, lines, page_at, start, end) -> list[ChunkRecord]:
    """Turn a line-range into chunks, applying the keep-whole-vs-split policy by kind.

    prose / container kinds  -> always paragraph-split to the budget;
    atomic pedagogical kinds -> kept whole, UNLESS over the safety ceiling (then split).
    """
    text = "\n".join(lines[start:end]).strip()
    if not text:
        return []
    if kind == Kind.PROSE or kind in _CONTAINER_KINDS or estimate_tokens(text) > _ATOMIC_CEILING:
        return _paragraph_split(ordinal_start, kind, heading_path, lines, page_at, start, end)
    c = _make_chunk(ordinal_start, kind, heading_path, lines, page_at, start, end)
    return [c] if c is not None else []


def parse_chunks(markdown: str, skip_front_matter: bool = True) -> list[ChunkRecord]:
    """Parse Marker textbook markdown into ordered ChunkRecords. Pure function.

    skip_front_matter: when True (default) nothing is emitted until the first real
    content heading (a numbered section or a 'Chapter Objectives' block), dropping the
    cover, table of contents, and preface.
    """
    lines = markdown.split("\n")
    n = len(lines)

    # Precompute the page number in effect at each line (carried forward from the last
    # anchor / image seen). Anchors and image names both advance the page cursor.
    page_at: list = []
    cur_page = None
    for ln in lines:
        for m in _PAGE_ANCHOR_RE.finditer(ln):
            cur_page = int(m.group(1))
        for m in _PAGE_IMAGE_RE.finditer(ln):
            cur_page = int(m.group(1))
        page_at.append(cur_page)

    chunks: list[ChunkRecord] = []
    stack: list[tuple[int, str]] = []   # (depth, "<num> <title>") section hierarchy
    started = not skip_front_matter
    prose_lo: int | None = None         # open prose accumulation start index

    def current_path() -> list[str]:
        return [title for _, title in stack]

    def emit(kind: str, start: int, end: int):
        for c in _emit_block(len(chunks), kind, current_path(), lines, page_at, start, end):
            c.ordinal = len(chunks)
            chunks.append(c)

    def flush_prose(upto: int):
        nonlocal prose_lo
        if prose_lo is not None and upto > prose_lo:
            emit(Kind.PROSE, prose_lo, upto)
        prose_lo = None

    i = 0
    while i < n:
        ln = lines[i]
        hm = _HEADING_RE.match(ln)
        cls = _classify_heading(_clean_heading(hm.group(2))) if hm else None

        if cls is None:
            # ordinary content line (or a prose sub-heading) — accumulate once started
            if started and prose_lo is None:
                prose_lo = i
            i += 1
            continue

        kind = cls[0]
        # Front-matter gate: begin at the first section or objective heading.
        if not started:
            if kind == "section" or (kind == "ped" and cls[1] == Kind.OBJECTIVE):
                started = True
            else:
                i += 1
                continue

        if kind == "section":
            flush_prose(i)
            _, number, title = cls
            depth = number.count(".") + 1
            while stack and stack[-1][0] >= depth:
                stack.pop()
            stack.append((depth, title))
            i += 1
            continue

        # pedagogical heading
        ped_kind = cls[1]
        if ped_kind in _BOUNDARY_KINDS:
            flush_prose(i)
            # consume to the next boundary heading (section, or a top-level ped block).
            j = i + 1
            while j < n:
                jm = _HEADING_RE.match(lines[j])
                if jm:
                    jcls = _classify_heading(_clean_heading(jm.group(2)))
                    if jcls and (jcls[0] == "section" or
                                 (jcls[0] == "ped" and jcls[1] in _BOUNDARY_KINDS)):
                        break
                j += 1
            emit(ped_kind, i, j)
            i = j
            continue

        # a classified-but-non-boundary heading (shouldn't occur given current patterns):
        # treat as prose content.
        if prose_lo is None:
            prose_lo = i
        i += 1

    flush_prose(n)
    return chunks
