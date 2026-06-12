"""
The chunker spec (ADR 0003 §Chunking). These tests ARE the specification for
src/corpus/chunker.parse_chunks — fixture strings pin each rule, then a slow
integration test asserts the rules hold on the real example textbook.

Run just this file:  .venv/bin/python -m pytest tests/test_corpus_chunker.py -q
"""
import os
import pytest

from src.corpus.chunker import parse_chunks
from src.corpus.records import Kind

EXAMPLE_BOOK = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "example-textbook", "statistics", "book.md",
)


# --------------------------------------------------------------------------- #
# Rule 1: hierarchy comes from section NUMBERS, not markdown '#' depth.        #
# --------------------------------------------------------------------------- #
def test_hierarchy_from_section_numbers_not_hash_depth():
    md = (
        "## **2.1 Display Data**\n\n"                   # depth-2 hashes
        "Prose under two-point-one explaining stem plots.\n\n"
        "# **2.1.3 Bar Graphs**\n\n"                    # depth-1 hash, but number => deeper
        "Prose under the subsection about bars.\n"
    )
    chunks = parse_chunks(md, skip_front_matter=False)
    paths = [c.heading_path for c in chunks if c.kind == Kind.PROSE]
    # 2.1.3 content must nest UNDER 2.1 despite the inverted '#' levels.
    assert ["2.1 Display Data"] in paths
    assert ["2.1 Display Data", "2.1.3 Bar Graphs"] in paths


def test_section_number_depth_pops_stack():
    md = (
        "# **3.1 Terminology**\n\ns1 prose\n\n"
        "# **3.1.1 Detail**\n\ndeep prose\n\n"
        "# **3.2 Events**\n\ns2 prose\n\n"          # sibling of 3.1 — 3.1/3.1.1 must pop
    )
    chunks = parse_chunks(md, skip_front_matter=False)
    by_text = {c.text.split()[0]: c.heading_path for c in chunks if c.kind == Kind.PROSE}
    assert by_text["s1"] == ["3.1 Terminology"]
    assert by_text["deep"] == ["3.1 Terminology", "3.1.1 Detail"]
    assert by_text["s2"] == ["3.2 Events"]  # NOT nested under 3.1 or 3.1.1


def test_bare_integer_heading_is_not_a_section():
    # Marker emits running-header artifacts like "#### **4 Preface**" (page 4, header
    # "Preface"). A bare integer is NOT a section — it must not pollute the stack.
    md = (
        "# **1.1 Defs**\n\nreal section prose\n\n"
        "#### **4 Preface**\n\nartifact line that is really front-matter noise\n\n"
        "# **1.2 More**\n\nmore real prose\n"
    )
    chunks = parse_chunks(md, skip_front_matter=False)
    # "4 Preface" must never appear as an ancestor of a real section.
    assert all("4 Preface" not in p for c in chunks for p in c.heading_path)
    s12 = next(c for c in chunks if "more real prose" in c.text)
    assert s12.heading_path == ["1.2 More"]


# --------------------------------------------------------------------------- #
# Rule 2: pedagogical blocks are atomic, typed, and never split.              #
# --------------------------------------------------------------------------- #
def test_example_folds_problem_and_solution_into_one_atomic_chunk():
    md = (
        "# **1.1 Key Terms**\n\nSome defining prose.\n\n"
        "#### **EXAMPLE 1.1**\n\n"
        "#### **Problem**\n\nDetermine the population and sample.\n\n"
        "#### **Solution**\n\nThe population is all students.\n\n"
        "#### **TRY IT 1.1**\n\nFind an article online.\n"
    )
    chunks = parse_chunks(md, skip_front_matter=False)
    examples = [c for c in chunks if c.kind == Kind.EXAMPLE]
    assert len(examples) == 1
    ex = examples[0]
    # Problem AND Solution live inside the single example chunk (atomic).
    assert "Determine the population" in ex.text
    assert "The population is all students" in ex.text
    # The Try-It that follows is a separate, typed chunk — not folded in.
    assert "Find an article" not in ex.text
    assert ex.heading_path == ["1.1 Key Terms"]


def test_try_it_note_key_terms_objective_get_their_own_kinds():
    md = (
        "# **Chapter Objectives**\n\nBy the end you can do X.\n\n"
        "# **1.1 Defs**\n\nprose\n\n"
        "#### **NOTE**\n\nmean and average are interchangeable.\n\n"
        "#### **TRY IT 1.2**\n\npractice this.\n\n"
        "## **Key Terms**\n\npopulation, sample, statistic.\n"
    )
    chunks = parse_chunks(md, skip_front_matter=False)
    kinds = {c.kind for c in chunks}
    assert Kind.OBJECTIVE in kinds
    assert Kind.NOTE in kinds
    assert Kind.TRY_IT in kinds
    assert Kind.KEY_TERMS in kinds


def test_pedagogical_block_does_not_alter_section_stack():
    # In the real format a pedagogical block is always bounded by the next heading,
    # so the invariant under test is: blocks read the section path but never push onto
    # it. A NOTE following an EXAMPLE under 1.1 must report the SAME path as the example.
    md = (
        "# **1.1 Defs**\n\nintro prose\n\n"
        "#### **EXAMPLE 1.1**\n\nworked example body\n\n"
        "#### **NOTE**\n\na clarifying note\n"
    )
    chunks = parse_chunks(md, skip_front_matter=False)
    ex = next(c for c in chunks if c.kind == Kind.EXAMPLE)
    note = next(c for c in chunks if c.kind == Kind.NOTE)
    assert ex.heading_path == ["1.1 Defs"]
    assert note.heading_path == ["1.1 Defs"]  # block did not deepen the stack


# --------------------------------------------------------------------------- #
# Rule 3: page locators from <span id="page-N"> anchors and _page_N_ images.   #
# --------------------------------------------------------------------------- #
def test_page_locator_from_span_anchor():
    md = (
        '# <span id="page-16-2"></span>**1.1 Defs**\n\n'
        "prose on page sixteen\n\n"
        '<span id="page-17-0"></span>more prose now on page seventeen\n'
    )
    chunks = parse_chunks(md, skip_front_matter=False)
    prose = [c for c in chunks if c.kind == Kind.PROSE]
    assert prose, "expected at least one prose chunk"
    loc = prose[0].locator
    assert loc is not None and loc["kind"] == "page"
    assert loc["start"] == 16
    assert loc["end"] == 17


# --------------------------------------------------------------------------- #
# Rule 4: image refs collected into asset_paths (bare basenames).             #
# --------------------------------------------------------------------------- #
def test_asset_paths_collected_from_image_refs():
    md = (
        "# **1.1 Defs**\n\n"
        "Here is a figure ![](_page_17_Figure_3.jpeg) inline.\n\n"
        "And another ![](_page_18_Picture_1.jpeg) one.\n"
    )
    chunks = parse_chunks(md, skip_front_matter=False)
    assets = [a for c in chunks for a in c.asset_paths]
    assert "_page_17_Figure_3.jpeg" in assets
    assert "_page_18_Picture_1.jpeg" in assets


# --------------------------------------------------------------------------- #
# Rule 5: front matter (cover/TOC/preface) skipped by default.                #
# --------------------------------------------------------------------------- #
def test_front_matter_skipped_by_default():
    md = (
        "# **Statistics**\n\nSENIOR CONTRIBUTING AUTHORS\n\n"
        "# **[1](#page-16-0) [Sampling and Data](#page-16-0) 5**\n\n"   # TOC line
        "# **Chapter Objectives**\n\nobjectives text\n\n"               # real content starts
        "# **1.1 Defs**\n\nreal prose\n"
    )
    skipped = parse_chunks(md, skip_front_matter=True)
    kept = parse_chunks(md, skip_front_matter=False)
    # Default drops the cover + TOC; "SENIOR CONTRIBUTING AUTHORS" must not survive.
    assert not any("CONTRIBUTING AUTHORS" in c.text for c in skipped)
    # No chunk should ever contain TOC link markup.
    assert not any("](#page-" in c.text for c in skipped)
    # Without skipping, the cover prose is retained (proves the flag is doing the work).
    assert any("CONTRIBUTING AUTHORS" in c.text for c in kept)


# --------------------------------------------------------------------------- #
# Rule 6: long prose splits on paragraph boundaries, same path, contiguous.    #
# --------------------------------------------------------------------------- #
def test_long_prose_splits_on_paragraph_boundaries():
    para = "word " * 120  # ~600 chars ~150 tokens per paragraph
    md = "# **1.1 Defs**\n\n" + "\n\n".join(para.strip() for _ in range(8))
    chunks = parse_chunks(md, skip_front_matter=False)
    prose = [c for c in chunks if c.kind == Kind.PROSE]
    assert len(prose) >= 2, "long section should split into multiple prose chunks"
    assert all(c.heading_path == ["1.1 Defs"] for c in prose)
    # No single prose chunk blows far past the budget.
    assert all(c.token_estimate <= 700 for c in prose)


# --------------------------------------------------------------------------- #
# Rule 7: invariants every chunk must satisfy.                                 #
# --------------------------------------------------------------------------- #
def test_chunk_invariants():
    md = (
        "# **1.1 Defs**\n\nprose here\n\n"
        "#### **EXAMPLE 1.1**\n\nbody\n"
    )
    chunks = parse_chunks(md, skip_front_matter=False)
    assert chunks
    for i, c in enumerate(chunks):
        assert c.ordinal == i                      # contiguous, document-ordered, 0-based
        assert c.text.strip()                      # never empty
        assert c.kind in Kind.ALL
        assert c.content_hash and len(c.content_hash) == 64
        assert c.char_count == len(c.text)
        assert c.token_estimate >= 1


# --------------------------------------------------------------------------- #
# Integration: the rules must hold on the real example textbook.              #
# --------------------------------------------------------------------------- #
@pytest.mark.skipif(not os.path.exists(EXAMPLE_BOOK), reason="example textbook not present")
def test_integration_real_textbook():
    md = open(EXAMPLE_BOOK, encoding="utf-8").read()
    chunks = parse_chunks(md)  # default skip_front_matter=True

    assert len(chunks) > 500, "a full statistics textbook should yield many chunks"

    # ordinals contiguous from 0
    assert [c.ordinal for c in chunks] == list(range(len(chunks)))

    # all kinds valid; the pedagogical variety we rely on is present
    kinds = {c.kind for c in chunks}
    assert kinds <= Kind.ALL
    for required in (Kind.PROSE, Kind.EXAMPLE, Kind.TRY_IT, Kind.NOTE, Kind.OBJECTIVE):
        assert required in kinds, f"expected at least one {required} chunk"

    # front matter dropped: cover / preface / author-bio markers never survive.
    # (Inline cross-references like "[Figure 1.3](#page-23-0)" ARE legitimate body
    # prose and appear ~1900x, so we check the front-matter content itself, not "](#page-".)
    for marker in ("PHILANTHROPIC SUPPORT", "SENIOR CONTRIBUTING AUTHORS", "B&W PAPERBACK"):
        assert not any(marker in c.text for c in chunks), f"front matter leaked: {marker}"
    # the first content chunk is chapter-1 material (objectives/introduction), not cover
    assert chunks[0].kind in (Kind.OBJECTIVE, Kind.PROSE)

    # Example 1.1 is recoverable and carries its section path + folded solution
    ex11 = [c for c in chunks if c.kind == Kind.EXAMPLE and "EXAMPLE 1.1" in c.text]
    assert ex11, "EXAMPLE 1.1 should be parsed as an example chunk"
    assert any("high school students" in c.text for c in ex11)
    assert any(
        "1.1 Definitions of Statistics, Probability, and Key Terms" in c.heading_path
        for c in ex11
    )

    # no monster chunks: containers (Homework/Practice) are split, atomics are ceiling-
    # bounded. A lone giant paragraph (e.g. a wide table) can exceed, but those are rare.
    oversized = [c for c in chunks if c.token_estimate > 3000]
    assert len(oversized) < 15, f"too many oversized chunks: {len(oversized)}"

    # page locators sane: present on most chunks, within the book's page range
    located = [c for c in chunks if c.locator]
    assert len(located) > len(chunks) * 0.8
    for c in located:
        assert c.locator["kind"] == "page"
        assert 1 <= c.locator["start"] <= c.locator["end"] <= 900

    # every referenced asset is a real file on disk
    images_dir = os.path.join(os.path.dirname(EXAMPLE_BOOK), "images")
    refs = {a for c in chunks for a in c.asset_paths}
    assert refs, "the textbook has figures; some chunks must reference them"
    missing = [a for a in refs if not os.path.exists(os.path.join(images_dir, a))]
    assert not missing, f"asset refs with no file: {missing[:5]}"
