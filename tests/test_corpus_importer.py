"""TextbookMarkerImporter: layout detection + parse + best-effort metadata scrape."""
import os
import pytest

from src.corpus.importers import TextbookMarkerImporter
from src.corpus.importers.base import slugify
from src.corpus.records import SourceType

EXAMPLE_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "example-textbook", "statistics",
)


def make_book(tmp_path, body: str, images: dict | None = None, pdf: bool = False):
    (tmp_path / "book.md").write_text(body, encoding="utf-8")
    img_dir = tmp_path / "images"
    img_dir.mkdir()
    for name, data in (images or {}).items():
        (img_dir / name).write_bytes(data)
    if pdf:
        (tmp_path / "source.pdf").write_bytes(b"%PDF-1.4 fake")
    return str(tmp_path)


@pytest.mark.skipif(not os.path.exists(EXAMPLE_DIR), reason="example textbook not present")
def test_can_handle():
    imp = TextbookMarkerImporter()
    assert imp.can_handle(EXAMPLE_DIR) is True


def test_can_handle_false_for_empty_dir(tmp_path):
    assert TextbookMarkerImporter().can_handle(str(tmp_path)) is False


def test_slugify():
    assert slugify("OpenStax Statistics!") == "openstax-statistics"
    assert slugify("  ") == "source"


def test_parse_small_book(tmp_path):
    body = (
        "# **Intro to Widgets**\n\n"
        "# **1.1 Basics**\n\nThe basics of widgets.\n\n"
        "#### **EXAMPLE 1.1**\n\nA worked widget.\n"
    )
    d = make_book(tmp_path, body, pdf=True)
    source, chunks = TextbookMarkerImporter().parse(d, subject="widgets", level="intro")

    assert source.source_type == SourceType.TEXTBOOK
    assert source.title == "Intro to Widgets"
    assert source.subject == "widgets" and source.level == "intro"
    assert source.id == slugify(os.path.basename(d))
    assert source.content_hash
    assert source.original_path and source.original_path.endswith("source.pdf")
    assert chunks and chunks[0].ordinal == 0
    assert any(c.kind == "example" for c in chunks)


def test_parse_source_id_override(tmp_path):
    d = make_book(tmp_path, "# **T**\n\n# **1.1 X**\n\nprose\n")
    source, _ = TextbookMarkerImporter().parse(d, source_id="custom-id")
    assert source.id == "custom-id"


@pytest.mark.skipif(not os.path.exists(EXAMPLE_DIR), reason="example textbook not present")
def test_parse_real_textbook_metadata():
    source, chunks = TextbookMarkerImporter().parse(EXAMPLE_DIR)
    assert source.id == "statistics"
    assert source.title == "Statistics"
    assert source.source_type == SourceType.TEXTBOOK
    assert len(chunks) > 500
    # best-effort scrape
    assert source.license and "CC BY" in source.license
    assert source.meta.get("isbn", "").startswith("978")
    assert source.meta.get("year") == 2020
    assert source.authors and "ILLOWSKY" in source.authors.upper()
    assert source.original_path and source.original_path.endswith("source.pdf")
