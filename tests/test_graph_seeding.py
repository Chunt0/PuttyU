"""Phase-2 T3a (ADR 0005 §6 Q1) — structure-only seeding: heading levels ->
concepts, KEY-TERMS -> leaf concepts, book order -> prerequisite assertions,
normalized-name reuse across sources, idempotency, no mastery_state rows,
and the plain-paragraph-material skip."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import core.database as cdb
from src.corpus.models import CorpusChunk, CorpusSource, chunk_id
from src.graph.models import Assertion, ConceptNode, MasteryState
from src.graph.seeding import seed_course_region


@pytest.fixture
def db(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path/'g.db'}")
    cdb.Base.metadata.create_all(engine)   # corpus + graph share the Base
    sess = sessionmaker(bind=engine)()
    yield sess
    sess.close()


KEY_TERMS_TEXT = (
    "# **Key Terms**\n\n"
    "**average** also called mean; a number that describes central tendency\n\n"
    '<span id="page-55-0"></span>**blinding** not telling participants the treatment\n\n'
    "**categorical variable** values that are names or labels\n"
)


def _mk_source(db, sid="stats", owner=None):
    db.add(CorpusSource(id=sid, source_type="textbook", title=sid,
                        content_hash="h-" + sid, status="ready", owner=owner))
    db.commit()


def _mk_chunk(db, sid, ordinal, heading_path, kind="prose", text="Prose."):
    db.add(CorpusChunk(id=chunk_id(sid, ordinal), source_id=sid, ordinal=ordinal,
                       kind=kind, heading_path=heading_path, text=text,
                       content_hash=f"ch-{sid}-{ordinal}"))
    db.commit()


def _seed_textbook(db, sid="stats"):
    _mk_source(db, sid)
    _mk_chunk(db, sid, 0, ["1.1 Definitions"], text="Stats is the study of data.")
    _mk_chunk(db, sid, 1, ["1.1 Definitions"], kind="example", text="EXAMPLE 1.1")
    _mk_chunk(db, sid, 2, ["1.2 Sampling"], text="Sampling prose.")
    _mk_chunk(db, sid, 3, ["1.2 Sampling", "1.2.1 Cluster Sampling"], text="Deeper.")
    _mk_chunk(db, sid, 4, ["Key Terms"], kind="key_terms", text=KEY_TERMS_TEXT)


def test_seed_creates_section_and_key_term_concepts(db):
    _seed_textbook(db)
    stats = seed_course_region("course1", "stats", owner="ada", db=db)
    names = {c.name for c in db.query(ConceptNode).all()}
    assert {"1.1 Definitions", "1.2 Sampling", "1.2.1 Cluster Sampling"} <= names
    assert {"average", "blinding", "categorical variable"} <= names
    assert stats["key_terms"] == 3 and stats["created"] >= 6
    # every node carries the seeding source + an ordinal, owner-scoped
    for node in db.query(ConceptNode).all():
        assert node.owner == "ada"
        assert "stats" in node.meta["sources"]
        assert "ordinal" in node.meta


def test_book_order_becomes_prereq_assertions_inferred_half_confidence(db):
    _seed_textbook(db)
    seed_course_region("course1", "stats", owner="ada", db=db)
    prereqs = db.query(Assertion).filter_by(relation="prerequisite_of").all()
    assert prereqs, "book order must produce prerequisite edges"
    by_name = {c.id: c.name for c in db.query(ConceptNode).all()}
    pairs = {(by_name[a.subject_id], by_name[a.object_id]) for a in prereqs}
    assert ("1.1 Definitions", "1.2 Sampling") in pairs   # earlier -> later
    for a in prereqs:
        assert a.kind == "inferred"
        assert a.confidence == 0.5
        assert a.episode_refs == []        # structure, not evidence
        assert a.invalidated_at is None


def test_seeded_nodes_start_unknown_no_mastery_state(db):
    _seed_textbook(db)
    seed_course_region("course1", "stats", owner="ada", db=db)
    assert db.query(MasteryState).count() == 0   # unknown != zero


def test_seeding_is_idempotent(db):
    _seed_textbook(db)
    first = seed_course_region("course1", "stats", owner="ada", db=db)
    n_concepts = db.query(ConceptNode).count()
    n_assertions = db.query(Assertion).count()
    again = seed_course_region("course1", "stats", owner="ada", db=db)
    assert db.query(ConceptNode).count() == n_concepts
    assert db.query(Assertion).count() == n_assertions
    assert again["created"] == 0 and again["prereqs"] == 0
    assert first["created"] > 0


def test_normalized_name_match_reuses_node_and_appends_source(db):
    _seed_textbook(db, "stats")
    seed_course_region("course1", "stats", owner="ada", db=db)
    # a second source covering the SAME section name (different case/spacing)
    _mk_source(db, "methods")
    _mk_chunk(db, "methods", 0, ["1.2  SAMPLING"], text="Methods view of sampling.")
    _mk_chunk(db, "methods", 1, ["2.1 Study Design"], text="Design prose.")
    seed_course_region("course2", "methods", owner="ada", db=db)

    sampling = [c for c in db.query(ConceptNode).all()
                if c.normalized_name == "1.2 sampling"]
    assert len(sampling) == 1                       # reused, not duplicated
    assert set(sampling[0].meta["sources"]) == {"stats", "methods"}


def test_reuse_is_per_owner(db):
    _seed_textbook(db, "stats")
    seed_course_region("course1", "stats", owner="ada", db=db)
    seed_course_region("course9", "stats", owner="bob", db=db)
    sampling = [c for c in db.query(ConceptNode).all()
                if c.normalized_name == "1.2 sampling"]
    assert {c.owner for c in sampling} == {"ada", "bob"}   # one region each


def test_plain_paragraph_material_skips_seeding(db):
    # the upload importer's shape: every chunk kind=prose under one [title] path
    _mk_source(db, "wk3", owner="ada")
    for i in range(3):
        _mk_chunk(db, "wk3", i, ["Week 3 sheet"], text=f"Problem {i}.")
    stats = seed_course_region("course1", "wk3", owner="ada", db=db)
    assert stats["skipped"] is True
    assert db.query(ConceptNode).count() == 0
    assert db.query(Assertion).count() == 0


def test_material_with_key_terms_still_seeds_leaves(db):
    _mk_source(db, "glossary", owner="ada")
    _mk_chunk(db, "glossary", 0, ["My glossary"], kind="key_terms",
              text="**average** the mean\n\n**blinding** hiding the treatment\n")
    stats = seed_course_region("course1", "glossary", owner="ada", db=db)
    assert stats["skipped"] is False and stats["key_terms"] == 2
    assert {c.name for c in db.query(ConceptNode).all()} == {"average", "blinding"}


def test_furniture_headings_are_not_concepts(db):
    _mk_source(db, "b")
    _mk_chunk(db, "b", 0, ["1.1 Real Section"], text="x")
    _mk_chunk(db, "b", 1, ["Chapter Review"], text="review text")
    _mk_chunk(db, "b", 2, ["Homework"], kind="exercise", text="hw")
    seed_course_region("c", "b", owner=None, db=db)
    names = {c.name for c in db.query(ConceptNode).all()}
    assert names == {"1.1 Real Section"}
