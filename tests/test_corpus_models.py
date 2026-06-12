"""
Corpus ORM tests: table creation is idempotent, rows round-trip, the (source_id,
ordinal) natural key is unique, and deleting a source cascades to its chunks.

Uses an isolated temp-file SQLite engine so it never touches the app DB. The global
`PRAGMA foreign_keys=ON` listener (registered on the Engine class in core.database)
applies here too, so ON DELETE CASCADE is exercised for real.
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import IntegrityError

from src.corpus.models import (
    CorpusSource, CorpusChunk, ensure_corpus_tables, chunk_id,
)
from src.corpus.records import Kind, SourceType


@pytest.fixture
def session(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path/'corpus.db'}")
    ensure_corpus_tables(bind=engine)
    ensure_corpus_tables(bind=engine)  # idempotent: second call must not raise
    Session = sessionmaker(bind=engine)
    db = Session()
    yield db
    db.close()


def _source(**kw):
    base = dict(
        id="openstax-statistics", source_type=SourceType.TEXTBOOK,
        title="Statistics", content_hash="abc123", subject="statistics",
    )
    base.update(kw)
    return CorpusSource(**base)


def test_source_and_chunks_round_trip(session):
    session.add(_source())
    for ordinal in range(3):
        session.add(CorpusChunk(
            id=chunk_id("openstax-statistics", ordinal),
            source_id="openstax-statistics",
            ordinal=ordinal, kind=Kind.PROSE,
            heading_path=["1.1 Defs"], text=f"chunk {ordinal}",
            locator={"kind": "page", "start": 16, "end": 16},
            asset_paths=["_page_16_Figure_1.jpeg"],
            token_estimate=3, char_count=7, content_hash=f"h{ordinal}",
        ))
    session.commit()

    src = session.get(CorpusSource, "openstax-statistics")
    assert src.title == "Statistics" and src.owner is None and src.course_id is None
    chunks = session.query(CorpusChunk).order_by(CorpusChunk.ordinal).all()
    assert [c.ordinal for c in chunks] == [0, 1, 2]
    # JSON columns round-trip as native python structures
    assert chunks[0].heading_path == ["1.1 Defs"]
    assert chunks[0].locator["start"] == 16
    assert chunks[0].asset_paths == ["_page_16_Figure_1.jpeg"]


def test_source_ordinal_is_unique(session):
    session.add(_source())
    session.commit()
    session.add(CorpusChunk(id="a", source_id="openstax-statistics", ordinal=0,
                            kind=Kind.PROSE, text="x", content_hash="h"))
    session.commit()
    # same (source_id, ordinal) with a different id must violate the unique index
    session.add(CorpusChunk(id="b", source_id="openstax-statistics", ordinal=0,
                            kind=Kind.PROSE, text="y", content_hash="h2"))
    with pytest.raises(IntegrityError):
        session.commit()


def test_delete_source_cascades_to_chunks(session):
    session.add(_source())
    session.add(CorpusChunk(id="a", source_id="openstax-statistics", ordinal=0,
                            kind=Kind.PROSE, text="x", content_hash="h"))
    session.commit()
    assert session.query(CorpusChunk).count() == 1

    session.delete(session.get(CorpusSource, "openstax-statistics"))
    session.commit()
    assert session.query(CorpusChunk).count() == 0  # cascaded
