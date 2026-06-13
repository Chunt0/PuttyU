"""Phase-2 T3a (SPEC F6, ADR 0005) — the student-context assembler: tier
assembly (profile/focus/periphery-stub/ambient), budget degradation order
(ambient first, focus compresses, profile+focus always survive), the
no-course no-op, never-raises, and the chat injection seam."""

import importlib
import json
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import core.database as cdb
import src.student_context as sc
from core.database import Course, CourseSource
from src.corpus.models import CorpusSource
from src.graph import mastery
from src.graph.models import Assertion, ConceptNode, new_id


@pytest.fixture
def db(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path/'g.db'}")
    cdb.Base.metadata.create_all(engine)
    maker = sessionmaker(bind=engine)
    monkeypatch.setattr(cdb, "SessionLocal", maker)
    sess = maker()
    yield sess
    sess.close()


def _fixture_world(db, owner="ada"):
    db.add(Course(id="c1", name="AP Statistics", owner=owner,
                  settings=json.dumps({"scaffolding": "high", "pace": "steady"})))
    db.add(CorpusSource(id="s1", source_type="textbook", title="Intro Stats",
                        content_hash="h", status="ready"))
    db.add(CourseSource(course_id="c1", source_id="s1"))
    concepts = []
    for i, name in enumerate(["1.1 Definitions", "1.2 Sampling", "1.3 Frequency"]):
        node = ConceptNode(id=f"k{i}", name=name, normalized_name=name.lower(),
                           source_id="s1", owner=owner,
                           meta={"sources": ["s1"], "ordinal": i})
        db.add(node)
        concepts.append(node)
    db.commit()
    # k0 mastered, k1 shaky-ish, k2 unknown (no evidence)
    mastery.apply_evidence("k0", "override_known", owner=owner, db=db)
    mastery.apply_evidence("k1", "correct", owner=owner, db=db)
    # stated preference (profile tier) + plain observation (ambient tier)
    db.add(Assertion(id=new_id(), subject_type="student", subject_id=owner,
                     relation="likes", literal="ice cream", kind="stated",
                     quote="I like ice cream", owner=owner))
    db.add(Assertion(id=new_id(), subject_type="student", subject_id=owner,
                     relation="believes", literal=None, kind="stated",
                     quote="my exam is on Friday", owner=owner))
    # an inferred insight (focus tier)
    db.add(Assertion(id=new_id(), subject_type="student", subject_id=owner,
                     relation="struggles_with", literal="rushes word problems",
                     kind="inferred", confidence=0.7, owner=owner))
    db.commit()
    return concepts


# ---------------------------------------------------------------- assembly

def test_tier_assembly(db):
    _fixture_world(db)
    block = sc.student_context("ada", "c1")
    assert block.startswith(sc.CONTEXT_OPEN) and block.endswith(sc.CONTEXT_CLOSE)
    # T0 profile: course + dial + stated preference
    assert "AP Statistics" in block and "scaffolding=high" in block
    assert 'I like ice cream' in block
    # T1 focus: frontier in ordinal order, EXCLUDING the mastered node
    assert "Frontier" in block
    frontier_line = next(l for l in block.splitlines() if "Frontier" in l)
    assert "1.2 Sampling" in frontier_line and "1.3 Frequency" in frontier_line
    assert "1.1 Definitions" not in frontier_line          # mastered -> not frontier
    assert "1.3 Frequency (unknown)" in frontier_line       # unknown != zero
    # recent evidence + insight lines
    assert "Recent:" in block
    assert "rushes word problems" in block
    # T3 ambient: the plain observation
    assert "my exam is on Friday" in block


def test_budget_degradation_drops_ambient_first_keeps_profile_focus(db):
    _fixture_world(db)
    full = sc.student_context("ada", "c1", token_budget=5000)
    assert "my exam is on Friday" in full                  # ambient present
    small = sc.student_context("ada", "c1", token_budget=60)
    assert small                                            # never empty for a course
    assert "my exam is on Friday" not in small              # ambient dropped FIRST
    assert "AP Statistics" in small                         # profile survives
    assert "Frontier" in small                              # focus survives
    assert len(small) < len(full)


def test_no_course_is_a_noop(db):
    _fixture_world(db)
    assert sc.student_context("ada", None) == ""
    assert sc.student_context("ada", "") == ""


def test_empty_graph_returns_empty_not_headers(db):
    db.add(Course(id="c9", name="Empty", owner="ada", settings="{}"))
    db.commit()
    block = sc.student_context("ada", "c9")
    # only the course name line exists -> still a valid tiny block
    assert ("Empty" in block) or block == ""


def test_never_raises_into_chat(monkeypatch):
    def explode():
        raise RuntimeError("db on fire")
    monkeypatch.setattr(cdb, "SessionLocal", explode)
    assert sc.student_context("ada", "c1") == ""


def test_periphery_seam_is_stubbed_empty(db):
    _fixture_world(db)
    assert sc.periphery_tier(db, "ada", "c1") == []         # T4 fills this


def test_owner_scoping(db):
    _fixture_world(db, owner="ada")
    block = sc.student_context("bob", "c1")
    # bob can't see ada's course (owner_scoped) -> nothing leaks
    assert "I like ice cream" not in block


# ---------------------------------------------------------------- chat seam

@pytest.mark.asyncio
async def test_build_chat_context_injects_student_context(monkeypatch):
    """The assembler block rides the preface beside grounding (one door —
    same harness as test_chat_grounding's wiring tests)."""
    chat_helpers = importlib.import_module("routes.chat_helpers")
    import src.corpus.grounding as grounding

    async def fake_preprocess(chat_handler, message, att_ids, s, **kwargs):
        return chat_helpers.PreprocessedMessage(
            enhanced_message=message, user_content=message,
            text_for_context=message, youtube_transcripts=[], attachment_meta=[])

    async def fake_maybe_compact(s, endpoint_url, model, messages, headers):
        return messages, 123, False

    monkeypatch.setattr(chat_helpers, "preprocess", fake_preprocess)
    monkeypatch.setattr(chat_helpers, "extract_preset",
                        lambda h, p: chat_helpers.PresetInfo(0.7, 1024, None, None))
    monkeypatch.setattr(chat_helpers, "add_user_message", lambda *a, **k: None)
    monkeypatch.setattr(chat_helpers, "fire_message_event", lambda *a, **k: None)
    monkeypatch.setattr(chat_helpers, "load_prefs_for_user", lambda user: {})
    monkeypatch.setattr(chat_helpers, "get_current_user", lambda request: "ada")
    monkeypatch.setattr(chat_helpers, "normalize_model_id", lambda u, m: None)
    monkeypatch.setattr(chat_helpers, "_normalize_model_id_from_cache", lambda s: None)
    monkeypatch.setattr(chat_helpers, "maybe_compact", fake_maybe_compact)
    monkeypatch.setattr(chat_helpers, "trim_for_context", lambda m, c: m)
    monkeypatch.setattr(grounding, "maybe_ground", lambda *a, **k: (None, []))

    sc_calls = []
    sc_msg = {"role": "system", "content": f"{sc.CONTEXT_OPEN}\n- x\n{sc.CONTEXT_CLOSE}"}

    def fake_msc(session_id, user, course_id=None):
        sc_calls.append((session_id, user, course_id))
        return sc_msg
    monkeypatch.setattr(sc, "maybe_student_context", fake_msc)

    sess = SimpleNamespace(endpoint_url="http://localhost:1234/v1", model="m",
                           headers={}, get_context_messages=lambda: [])
    chat_processor = SimpleNamespace(build_context_preface=lambda **kw: ([], [], []))

    ctx = await chat_helpers.build_chat_context(
        sess=sess, request=SimpleNamespace(), chat_handler=SimpleNamespace(),
        chat_processor=chat_processor, message="chain rule?",
        session_id="s1", course_id="c1")
    assert sc_msg in ctx.preface and sc_msg in ctx.messages
    assert sc_calls == [("s1", "ada", "c1")]

    # incognito: the assembler is never consulted
    sc_calls.clear()
    ctx = await chat_helpers.build_chat_context(
        sess=sess, request=SimpleNamespace(), chat_handler=SimpleNamespace(),
        chat_processor=chat_processor, message="q",
        session_id="s1", incognito=True, course_id="c1")
    assert sc_calls == [] and sc_msg not in ctx.preface


def test_maybe_student_context_resolves_course_and_wraps(monkeypatch):
    import src.corpus.grounding as grounding
    monkeypatch.setattr(grounding, "session_course_id",
                        lambda sid, fallback=None: "c1" if fallback != "none" else None)
    monkeypatch.setattr(sc, "student_context",
                        lambda owner, course, call_type="chat", token_budget=1200:
                        "BLOCK" if course == "c1" else "")
    msg = sc.maybe_student_context("s1", "ada", course_id="c1")
    assert msg == {"role": "system", "content": "BLOCK"}
    # no resolvable course -> None (course-less chat is byte-identical)
    monkeypatch.setattr(grounding, "session_course_id", lambda sid, fallback=None: None)
    assert sc.maybe_student_context("s1", "ada") is None
