"""Phase-2 T3a (ADR 0005) — the after-turn extraction pass, with a stubbed
LLM (no network): robust-JSON parsing, closed-world concept matching,
observation persistence (entity ADD/NOOP + stated assertion w/ verbatim quote
+ episode refs), inferred insights, the supersede contradiction rule, and the
no-LLM / quiet-skip contracts."""

import asyncio
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import src.graph.extractor as extractor
from src.graph.models import (
    Assertion, ConceptNode, EntityNode, MasteryEvidence, MasteryState,
    ensure_graph_tables, new_id,
)


@pytest.fixture
def db(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path/'g.db'}")
    import core.database as cdb
    cdb.Base.metadata.create_all(engine)
    sess = sessionmaker(bind=engine)()
    yield sess
    sess.close()


def _concept(db, name, owner="ada", ordinal=0):
    node = ConceptNode(id=new_id(), name=name,
                       normalized_name=extractor.normalize_name(name),
                       owner=owner, meta={"sources": ["s1"], "ordinal": ordinal})
    db.add(node)
    db.commit()
    return node


REFS = [{"type": "chat_message", "id": 7}]


# ---------------------------------------------------------------- parsing

def test_parse_extraction_tolerates_noise():
    obj = {"evidence": [], "observations": [], "insights": []}
    raw = '{"evidence": [], "observations": [], "insights": []}'
    assert extractor.parse_extraction(raw) == obj
    assert extractor.parse_extraction(f"```json\n{raw}\n```") == obj
    assert extractor.parse_extraction(f"<think>hmm…</think>\n{raw}") == obj
    assert extractor.parse_extraction(f"Sure! Here you go: {raw} Hope that helps!") == obj
    assert extractor.parse_extraction('{"evidence": [],}') == {"evidence": []}  # trailing comma
    assert extractor.parse_extraction("no json here") is None
    assert extractor.parse_extraction("[1, 2]") is None   # object required
    assert extractor.parse_extraction("") is None


# ---------------------------------------------------------------- persistence

def test_evidence_closed_world_and_mastery_update(db):
    ci = _concept(db, "Confidence Intervals")
    counts = extractor.persist_extraction(db, {
        "evidence": [
            {"concept": "confidence intervals", "signal": "correct", "note": "worked two problems"},
            {"concept": "Quantum Gravity", "signal": "correct"},      # not in shortlist -> drop
            {"concept": "Confidence Intervals", "signal": "vibes"},   # bad signal -> drop
            {"concept": "Confidence Intervals", "signal": "override_known"},  # overrides are user-only
        ],
    }, owner="ada", concepts=[ci], refs=REFS)
    assert counts["evidence"] == 1
    rows = db.query(MasteryEvidence).all()
    assert len(rows) == 1
    assert rows[0].concept_id == ci.id and rows[0].signal == "correct"
    assert rows[0].episode_ref == REFS[0]
    assert rows[0].context["source"] == "chat"
    assert db.get(MasteryState, ci.id) is not None


def test_observation_persists_verbatim_with_entity_and_episode(db):
    counts = extractor.persist_extraction(db, {
        "observations": [{"quote": "I like ice cream", "relation": "likes",
                          "entity": "ice cream"}],
    }, owner="ada", concepts=[], refs=REFS)
    assert counts["observations"] == 1
    a = db.query(Assertion).one()
    assert a.kind == "stated"
    assert a.quote == "I like ice cream"      # verbatim, with provenance
    assert a.relation == "likes"
    assert a.episode_refs == REFS
    e = db.query(EntityNode).one()
    assert e.normalized_name == "ice cream" and a.object_id == e.id


def test_entity_reconciliation_is_add_or_noop(db):
    payload = {"observations": [{"quote": "I like ice cream", "relation": "likes",
                                 "entity": "Ice  Cream"}]}
    extractor.persist_extraction(db, payload, owner="ada", concepts=[], refs=REFS)
    extractor.persist_extraction(db, payload, owner="ada", concepts=[], refs=REFS)
    assert db.query(EntityNode).count() == 1          # normalized match -> NOOP
    assert db.query(Assertion).count() == 1           # identical fact -> NOOP too


def test_insight_persists_inferred_with_confidence(db):
    ht = _concept(db, "Hypothesis Testing")
    counts = extractor.persist_extraction(db, {
        "insights": [{"statement": "breakthrough with hypothesis testing",
                      "relation": "breakthrough_on",
                      "concept": "hypothesis testing", "confidence": 0.8}],
    }, owner="ada", concepts=[ht], refs=REFS)
    assert counts["insights"] == 1
    a = db.query(Assertion).one()
    assert a.kind == "inferred" and a.confidence == 0.8
    assert a.object_type == "concept" and a.object_id == ht.id
    assert a.quote is None                            # stated/inferred never merged
    assert a.episode_refs == REFS


def test_contradiction_supersedes_never_deletes(db):
    """Same subject+relation+object (the concept anchor) with a conflicting
    statement -> the old assertion is invalidated, never deleted."""
    wp = _concept(db, "Word Problems")
    first = {"insights": [{"statement": "avoids word problems",
                           "relation": "struggles_with",
                           "concept": "Word Problems", "confidence": 0.7}]}
    extractor.persist_extraction(db, first, owner="ada", concepts=[wp], refs=REFS)
    second = {"insights": [{"statement": "now seeks out word problems",
                            "relation": "struggles_with",
                            "concept": "Word Problems", "confidence": 0.6}]}
    extractor.persist_extraction(db, second, owner="ada", concepts=[wp], refs=REFS)
    rows = db.query(Assertion).order_by(Assertion.created_at).all()
    assert len(rows) == 2                              # invalidated, NOT deleted
    old = next(a for a in rows if a.literal == "avoids word problems")
    new = next(a for a in rows if a.literal == "now seeks out word problems")
    assert old.invalidated_at is not None
    assert old.invalidation_reason == "superseded"
    assert new.invalidated_at is None
    # different-object assertions never collide: unanchored statements coexist
    third = {"insights": [{"statement": "enjoys geometry proofs",
                           "relation": "believes", "confidence": 0.5}]}
    extractor.persist_extraction(db, third, owner="ada", concepts=[], refs=REFS)
    assert db.query(Assertion).filter(Assertion.invalidated_at.is_(None)).count() == 2


def test_contradicting_stated_quote_supersedes_on_same_entity(db):
    one = {"observations": [{"quote": "I like ice cream", "relation": "likes",
                             "entity": "ice cream"}]}
    extractor.persist_extraction(db, one, owner="ada", concepts=[], refs=REFS)
    two = {"observations": [{"quote": "I'm actually off ice cream lately",
                             "relation": "likes", "entity": "ice cream"}]}
    extractor.persist_extraction(db, two, owner="ada", concepts=[], refs=REFS)
    rows = db.query(Assertion).all()
    assert len(rows) == 2
    actives = [a for a in rows if a.invalidated_at is None]
    assert [a.quote for a in actives] == ["I'm actually off ice cream lately"]


# ---------------------------------------------------------------- after-turn hook

LLM_JSON = """{"evidence": [{"concept": "Confidence Intervals", "signal": "correct",
"note": "solved both"}],
"observations": [{"quote": "I like ice cream", "relation": "likes", "entity": "ice cream"}],
"insights": []}"""


def _sess(owner="ada"):
    msgs = [{"role": "user", "content": "CI problem?"},
            {"role": "assistant", "content": "Correct, well done."}]
    return SimpleNamespace(owner=owner, get_context_messages=lambda: msgs,
                           history=[])


def _routed(url="http://llm/v1/chat/completions", model="m"):
    from src.model_router import RoutedModel
    return RoutedModel(endpoint_id="e1", model=model, token_budget=4096,
                       why="test", endpoint_url=url, headers={})


def test_extract_after_turn_end_to_end_with_stubbed_llm(db, monkeypatch):
    import core.database as cdb
    import src.corpus.grounding as grounding
    import src.llm_core as llm_core
    from src import model_router

    ci = _concept(db, "Confidence Intervals")
    monkeypatch.setattr(cdb, "SessionLocal", sessionmaker(bind=db.get_bind()))
    monkeypatch.setattr(model_router, "resolve", lambda *a, **k: _routed())
    monkeypatch.setattr(grounding, "session_course_id", lambda sid, fallback=None: "c1")
    monkeypatch.setattr(extractor, "course_concept_shortlist",
                        lambda d, c, o: [ci])

    calls = {}
    async def fake_llm(url, model, messages, **kw):
        calls["messages"] = messages
        return LLM_JSON
    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)

    counts = asyncio.run(extractor.extract_after_turn(_sess(), "s1", owner="ada"))
    assert counts == {"evidence": 1, "observations": 1, "insights": 0}
    # ONE call; the closed-world shortlist + both turns rode in the prompt
    user_block = calls["messages"][-1]["content"]
    assert "Confidence Intervals" in user_block
    assert "USER: CI problem?" in user_block and "ASSISTANT:" in user_block
    assert db.query(MasteryEvidence).count() == 1
    assert db.query(Assertion).filter_by(kind="stated").count() == 1


def test_extract_skips_silently_without_llm(db, monkeypatch):
    from src import model_router
    from src.model_router import RoutedModel
    monkeypatch.setattr(model_router, "resolve",
                        lambda *a, **k: RoutedModel("", "", 0, "no endpoints"))
    called = []
    import src.llm_core as llm_core
    async def boom(*a, **k):
        called.append(1)
        raise AssertionError("must not call the LLM")
    monkeypatch.setattr(llm_core, "llm_call_async", boom)
    assert asyncio.run(extractor.extract_after_turn(_sess(), "s1", owner="ada")) is None
    assert called == []


def test_extract_never_raises(monkeypatch):
    from src import model_router
    def explode(*a, **k):
        raise RuntimeError("router on fire")
    monkeypatch.setattr(model_router, "resolve", explode)
    assert asyncio.run(extractor.extract_after_turn(_sess(), "s1")) is None


def test_post_response_hook_wired_and_incognito_gated():
    """Source contract (the test_chat_grounding style): the graph extraction
    hook rides run_post_response_tasks behind the incognito gate."""
    from pathlib import Path
    src_text = (Path(__file__).resolve().parent.parent
                / "routes" / "chat_helpers.py").read_text(encoding="utf-8")
    assert "schedule_extraction(sess, session_id, owner=owner)" in src_text
    gate = src_text.index("if not incognito:  # ensemble-graph extraction")
    assert gate < src_text.index("schedule_extraction(sess, session_id")
