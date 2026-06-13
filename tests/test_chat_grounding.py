"""Phase-2 T2a — retrieval→chat grounding (SPEC F3, §5.4): the GROUNDING block is
injected for course-bound turns, citations carry the typed contract and stream
BEFORE tokens, retrieval failure degrades to an ungrounded turn, and a course-less
chat is byte-identical to today."""

import importlib
from pathlib import Path
from types import SimpleNamespace

import pytest

import src.corpus.grounding as grounding
from src.corpus import course_search

_ITEMS = [
    {"chunk_id": "lib1:0", "source_id": "lib1", "title": "Intro Stats",
     "heading": "1 Sampling > 1.1 Definitions", "page_start": 9,
     "citation": "Intro Stats — 1.1 Definitions (p. 9)",
     "text": "A parameter describes a population."},
    {"chunk_id": "mat:0", "source_id": "mat", "title": "Week 3 sheet",
     "heading": "Week 3 sheet", "page_start": 2,
     "citation": "Week 3 sheet (p. 2)", "text": "Problem 3 wants a free-body diagram."},
]


# ------------------------------------------------------------ maybe_ground

@pytest.fixture
def stubbed_retrieval(monkeypatch):
    monkeypatch.setattr(grounding, "session_course_id",
                        lambda sid, fallback=None: "c1" if (sid == "s-course" or fallback) else None)
    monkeypatch.setattr(course_search, "resolve_scope",
                        lambda db, user, course_id=None, tags=None: ["lib1", "mat"])
    monkeypatch.setattr(course_search, "search_scoped",
                        lambda db, q, scope, top_k=6: (list(_ITEMS), False))


def test_grounding_block_and_citation_contract(stubbed_retrieval):
    msg, citations = grounding.maybe_ground("s-course", "what is a parameter?", "ada")
    assert msg["role"] == "system"
    body = msg["content"]
    assert body.startswith(grounding.GROUNDING_OPEN) and body.endswith(grounding.GROUNDING_CLOSE)
    # F3 rules ride along verbatim
    assert "not in your course library — answering from my own knowledge" in body
    assert "Never invent citations" in body
    assert "[Intro Stats §1.1 Definitions, p. 9]" in body
    assert "A parameter describes a population." in body
    # §5.4 typed contract: exactly these keys, no chunk text leaking into the event
    assert [set(c) for c in citations] == [
        {"chunk_id", "source_id", "title", "heading", "page_start", "citation"}] * 2
    assert citations[0]["chunk_id"] == "lib1:0" and citations[0]["page_start"] == 9


def test_no_course_means_no_grounding_and_no_search(monkeypatch):
    monkeypatch.setattr(grounding, "session_course_id", lambda sid, fallback=None: None)
    def explode(*a, **k):
        raise AssertionError("course-less turns must not touch retrieval")
    monkeypatch.setattr(course_search, "search_scoped", explode)
    assert grounding.maybe_ground("s-plain", "hello", "ada") == (None, [])


def test_request_course_id_fallback_grounds(stubbed_retrieval):
    msg, citations = grounding.maybe_ground("s-plain", "param?", "ada", course_id="c1")
    assert msg is not None and len(citations) == 2


def test_retrieval_failure_degrades_to_ungrounded(monkeypatch):
    monkeypatch.setattr(grounding, "session_course_id", lambda sid, fallback=None: "c1")
    def boom(*a, **k):
        raise RuntimeError("retrieval exploded")
    monkeypatch.setattr(course_search, "resolve_scope", boom)
    assert grounding.maybe_ground("s-course", "q", "ada") == (None, [])  # never blocks chat


def test_empty_hits_mean_no_block(monkeypatch):
    monkeypatch.setattr(grounding, "session_course_id", lambda sid, fallback=None: "c1")
    monkeypatch.setattr(course_search, "resolve_scope", lambda *a, **k: ["lib1"])
    monkeypatch.setattr(course_search, "search_scoped", lambda *a, **k: ([], True))
    assert grounding.maybe_ground("s-course", "q", "ada") == (None, [])


def test_session_course_id_prefers_session_binding(monkeypatch):
    class _Q:
        def __init__(self, row):
            self._row = row
        def filter(self, *a):
            return self
        def first(self):
            return self._row
    class _Db:
        def __init__(self, row):
            self._row = row
        def query(self, *a):
            return _Q(self._row)
        def close(self):
            pass
    import core.database as cdb
    monkeypatch.setattr(cdb, "SessionLocal", lambda: _Db(("course-from-session",)))
    assert grounding.session_course_id("sid", fallback="other") == "course-from-session"
    monkeypatch.setattr(cdb, "SessionLocal", lambda: _Db((None,)))
    assert grounding.session_course_id("sid", fallback=" c2 ") == "c2"
    assert grounding.session_course_id("sid") is None


# ------------------------------------------------------------ build_chat_context wiring

async def _run_build_chat_context(monkeypatch, ground_result, incognito=False,
                                  course_id=None, ground_calls=None):
    chat_helpers = importlib.import_module("routes.chat_helpers")

    async def fake_preprocess(chat_handler, message, att_ids, sess, **kwargs):
        return chat_helpers.PreprocessedMessage(
            enhanced_message=message, user_content=message, text_for_context=message,
            youtube_transcripts=[], attachment_meta=[])

    async def fake_maybe_compact(sess, endpoint_url, model, messages, headers):
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

    def fake_ground(session_id, message, user, course_id_arg, **kw):
        if ground_calls is not None:
            ground_calls.append((session_id, message, user, course_id_arg))
        return ground_result

    monkeypatch.setattr(grounding, "maybe_ground", fake_ground)

    sess = SimpleNamespace(endpoint_url="http://localhost:1234/v1", model="m",
                           headers={}, get_context_messages=lambda: [])
    chat_processor = SimpleNamespace(build_context_preface=lambda **kw: ([], [], []))
    return await chat_helpers.build_chat_context(
        sess=sess, request=SimpleNamespace(), chat_handler=SimpleNamespace(),
        chat_processor=chat_processor, message="what is a parameter?",
        session_id="s1", incognito=incognito, course_id=course_id)


@pytest.mark.asyncio
async def test_build_chat_context_injects_grounding(monkeypatch):
    g_msg = {"role": "system", "content": "GROUND"}
    cites = [{"chunk_id": "lib1:0"}]
    calls = []
    ctx = await _run_build_chat_context(monkeypatch, (g_msg, cites),
                                        course_id="c9", ground_calls=calls)
    assert ctx.citations == cites
    assert g_msg in ctx.preface and g_msg in ctx.messages
    assert calls == [("s1", "what is a parameter?", "ada", "c9")]


@pytest.mark.asyncio
async def test_build_chat_context_course_less_is_unchanged(monkeypatch):
    ctx = await _run_build_chat_context(monkeypatch, (None, []))
    assert ctx.citations == []
    assert ctx.preface == []  # nothing added: byte-identical to today


@pytest.mark.asyncio
async def test_build_chat_context_incognito_skips_grounding(monkeypatch):
    calls = []
    ctx = await _run_build_chat_context(monkeypatch, ({"role": "system", "content": "G"},
                                                      [{"chunk_id": "x"}]),
                                        incognito=True, ground_calls=calls)
    assert calls == [] and ctx.citations == []


# ------------------------------------------------------------ SSE contract (source-level)

_CHAT_ROUTES_SRC = (Path(__file__).resolve().parent.parent
                    / "routes" / "chat_routes.py").read_text(encoding="utf-8")


def test_citations_event_emitted_before_token_streaming():
    """The `citations` control event must ride the same SSE channel as
    tool_start/plan_update and fire BEFORE model_info / token streaming
    (same source-contract style as test_research_chat_stream_owner)."""
    cit = _CHAT_ROUTES_SRC.index("'type': 'citations'")
    rag = _CHAT_ROUTES_SRC.index("'type': 'rag_sources'")
    model_info = _CHAT_ROUTES_SRC.index('"type": "model_info"')
    assert rag < cit < model_info
    assert "ctx.citations" in _CHAT_ROUTES_SRC


def test_chat_stream_accepts_course_id_form_field():
    assert 'form_data.get("course_id")' in _CHAT_ROUTES_SRC
    assert "course_id=course_id" in _CHAT_ROUTES_SRC
