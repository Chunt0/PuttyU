"""Phase-2 T3a (ADR 0005) — graph tables: idempotent creation, the required
indexes, owner-nullable columns, and the normalize_name reuse key."""

from sqlalchemy import create_engine, inspect

from src.graph.models import (
    Assertion, ConceptNode, EntityNode, MasteryEvidence, MasteryState,
    ensure_graph_tables, episode_ref, normalize_name,
)


def _engine(tmp_path):
    return create_engine(f"sqlite:///{tmp_path/'g.db'}")


def test_ensure_graph_tables_creates_all_five_and_is_idempotent(tmp_path):
    engine = _engine(tmp_path)
    ensure_graph_tables(bind=engine)
    ensure_graph_tables(bind=engine)  # second call: no error, no duplication
    tables = set(inspect(engine).get_table_names())
    assert {"concept_node", "entity_node", "assertion",
            "mastery_evidence", "mastery_state"} <= tables


def test_required_indexes_exist(tmp_path):
    engine = _engine(tmp_path)
    ensure_graph_tables(bind=engine)
    insp = inspect(engine)

    def index_cols(table):
        return {tuple(ix["column_names"]) for ix in insp.get_indexes(table)}

    assert ("subject_type", "subject_id") in index_cols("assertion")   # assertion(subject)
    assert ("invalidated_at",) in index_cols("assertion")
    assert ("concept_id",) in index_cols("mastery_evidence")
    assert ("normalized_name", "owner") in index_cols("concept_node")


def test_all_tables_owner_nullable(tmp_path):
    engine = _engine(tmp_path)
    ensure_graph_tables(bind=engine)
    insp = inspect(engine)
    for table in ("concept_node", "entity_node", "assertion",
                  "mastery_evidence", "mastery_state"):
        owner = next(c for c in insp.get_columns(table) if c["name"] == "owner")
        assert owner["nullable"], f"{table}.owner must be nullable (Gate-5 seam)"


def test_normalize_name_reuse_key():
    assert normalize_name("  Confidence   Intervals ") == "confidence intervals"
    assert normalize_name("Z-Scores!") == "z-scores"
    assert normalize_name("'quoted'") == "quoted"
    assert normalize_name("") == ""


def test_episode_ref_shape():
    assert episode_ref("chat_message", 42) == {"type": "chat_message", "id": 42}


def test_model_defaults(tmp_path):
    from sqlalchemy.orm import sessionmaker
    engine = _engine(tmp_path)
    ensure_graph_tables(bind=engine)
    db = sessionmaker(bind=engine)()
    try:
        db.add(ConceptNode(id="c1", name="Z", normalized_name="z"))
        db.add(EntityNode(id="e1", name="ice cream", normalized_name="ice cream"))
        db.add(Assertion(id="a1", subject_type="student", subject_id="",
                         relation="likes", kind="stated", quote="I like ice cream"))
        db.add(MasteryEvidence(id="m1", concept_id="c1", signal="correct"))
        db.add(MasteryState(concept_id="c1", p_known=0.5, state="learning"))
        db.commit()
        a = db.get(Assertion, "a1")
        assert a.invalidated_at is None and a.valid_from is not None
        assert db.get(MasteryEvidence, "m1").weight == 1.0
    finally:
        db.close()
