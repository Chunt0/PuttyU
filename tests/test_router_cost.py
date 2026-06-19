"""Phase-2 T5 vertical-6 — cost meter (SPEC F7 "spend is visible").

record_usage computes est_cost from a per-endpoint rate, the tier default, AND
local=free; it appends a row + is best-effort (never raises). cost_summary
aggregates by feature within a window, owner-scoped, with the real/estimated/mixed
usage_source rule. Plus an integration check that at least one router adopter
(the graph extractor) records a usage row when its LLM call is monkeypatched.
"""

import asyncio
import json
import os
from types import SimpleNamespace

import pytest

import src.model_router as mr
from src.model_router import RoutedModel, RouterConfig, TaskProfile


@pytest.fixture(autouse=True)
def _isolated_usage(tmp_path, monkeypatch):
    monkeypatch.setattr(mr, "CONFIG_PATH", str(tmp_path / "router.json"))
    monkeypatch.setattr(mr, "LOG_PATH", str(tmp_path / "router_log.jsonl"))
    monkeypatch.setattr(mr, "USAGE_LOG_PATH", str(tmp_path / "router_usage.jsonl"))
    mr._recent.clear()
    mr._recent_usage.clear()
    yield


def _routed(endpoint_id="ep-cloud", model="auto-x"):
    return RoutedModel(endpoint_id=endpoint_id, model=model, token_budget=0, why="")


def _rows():
    with open(mr.USAGE_LOG_PATH, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


# --------------------------------------------------------------- rate resolution
def test_record_usage_tier_default_rate():
    """No per-endpoint rate configured -> DEFAULT_TIER_RATES[tier]."""
    mr.record_usage(TaskProfile(tier="standard"), _routed(),
                    input_tokens=1_000_000, output_tokens=1_000_000,
                    feature="extraction")
    rows = _rows()
    assert len(rows) == 1
    r = rows[0]
    # standard = (1.00, 3.00) per Mtok -> 1.00 + 3.00 = 4.00
    assert r["est_cost_usd"] == pytest.approx(4.0)
    assert r["feature"] == "extraction" and r["tier"] == "standard"
    assert r["local"] is False and r["usage_source"] == "estimated"


def test_record_usage_per_endpoint_rate_overrides_default():
    """A capability cost_in/out_per_mtok wins over the tier default."""
    RouterConfig().save({"capabilities": {"ep-cloud": {
        "reasoning": "standard", "cost_in_per_mtok": 5.0, "cost_out_per_mtok": 10.0}}})
    mr.record_usage(TaskProfile(tier="standard"), _routed("ep-cloud"),
                    input_tokens=1_000_000, output_tokens=1_000_000,
                    feature="practice")
    r = _rows()[0]
    # 1M * 5/1e6 + 1M * 10/1e6 = 15.0 (NOT the 4.0 tier default)
    assert r["est_cost_usd"] == pytest.approx(15.0)


def test_record_usage_local_is_free():
    """A local endpoint (capability.local=True) -> cost 0 + local=True."""
    RouterConfig().save({"capabilities": {"ep-local": {
        "reasoning": "deep", "local": True,
        "cost_in_per_mtok": 99.0, "cost_out_per_mtok": 99.0}}})
    mr.record_usage(TaskProfile(tier="deep"), _routed("ep-local"),
                    input_tokens=5_000_000, output_tokens=5_000_000,
                    feature="deep_research")
    r = _rows()[0]
    assert r["est_cost_usd"] == 0.0 and r["local"] is True


def test_record_usage_local_via_base_url_heuristic(monkeypatch):
    """No capability.local flag, but the endpoint base_url is localhost -> free."""
    ep = SimpleNamespace(id="ep-ollama", base_url="http://localhost:11434/v1",
                         is_enabled=True)
    monkeypatch.setattr(mr, "_enabled_endpoints", lambda owner=None: [ep])
    mr.record_usage(TaskProfile(tier="light"), _routed("ep-ollama"),
                    input_tokens=1_000_000, output_tokens=0, feature="extraction")
    r = _rows()[0]
    assert r["est_cost_usd"] == 0.0 and r["local"] is True


# --------------------------------------------------------------- best-effort
def test_record_usage_never_raises_on_bad_input():
    """Garbage tokens / a None routed-like must not raise — cost logging must
    never break a feature."""
    # bad token types
    mr.record_usage(TaskProfile(tier="standard"), _routed(),
                    input_tokens="not-an-int", output_tokens=None,
                    feature="extraction")  # must not raise
    # a routed object missing attributes
    broken = SimpleNamespace()  # no endpoint_id / model
    mr.record_usage(TaskProfile(tier="standard"), broken,
                    input_tokens=10, output_tokens=10, feature="x")  # must not raise


def test_cost_summary_never_raises_on_bad_window():
    assert isinstance(mr.cost_summary(window_days="oops"), dict)
    assert isinstance(mr.cost_summary(window_days=0), dict)


# --------------------------------------------------------------- cost_summary agg
def test_cost_summary_aggregates_by_feature_and_window():
    mr.record_usage(TaskProfile(tier="standard"), _routed(),
                    input_tokens=1_000_000, output_tokens=0, feature="extraction")
    mr.record_usage(TaskProfile(tier="standard"), _routed(),
                    input_tokens=1_000_000, output_tokens=0, feature="extraction")
    mr.record_usage(TaskProfile(tier="micro"), _routed(),
                    input_tokens=1_000_000, output_tokens=0, feature="practice")
    s = mr.cost_summary(window_days=7)
    by = {f["feature"]: f for f in s["by_feature"]}
    assert set(by) == {"extraction", "practice"}
    # extraction: 2 x (1M in @ 1.00/Mtok) = 2.00
    assert by["extraction"]["est_cost_usd"] == pytest.approx(2.0)
    assert by["extraction"]["input_tokens"] == 2_000_000
    # micro = (0.10, 0.30) -> 1M in = 0.10
    assert by["practice"]["est_cost_usd"] == pytest.approx(0.10)
    assert s["total_cost_usd"] == pytest.approx(2.10)
    assert s["window_days"] == 7


def test_cost_summary_window_excludes_old_rows():
    # an old row, written directly with a stale ts
    import time
    old = {"ts": time.time() - 30 * 86400, "feature": "extraction",
           "tier": "standard", "endpoint_id": "ep", "model": "m",
           "input_tokens": 1_000_000, "output_tokens": 0, "est_cost_usd": 1.0,
           "usage_source": "estimated", "local": False, "owner": None}
    mr._append_usage_log(old)
    mr.record_usage(TaskProfile(tier="standard"), _routed(),
                    input_tokens=1_000_000, output_tokens=0, feature="extraction")
    s = mr.cost_summary(window_days=7)
    # only the fresh row counts
    assert s["total_cost_usd"] == pytest.approx(1.0)


def test_cost_summary_owner_scoped():
    mr.record_usage(TaskProfile(tier="standard"), _routed(),
                    input_tokens=1_000_000, output_tokens=0,
                    feature="extraction", owner="alice")
    mr.record_usage(TaskProfile(tier="standard"), _routed(),
                    input_tokens=1_000_000, output_tokens=0,
                    feature="extraction", owner="bob")
    # owner=None spans everything (single-user)
    assert mr.cost_summary(owner=None)["total_cost_usd"] == pytest.approx(2.0)
    # a specific owner keeps only its own rows
    assert mr.cost_summary(owner="alice")["total_cost_usd"] == pytest.approx(1.0)


def test_cost_summary_usage_source_real_estimated_mixed():
    # feature A: all estimated
    mr.record_usage(TaskProfile(tier="micro"), _routed(),
                    input_tokens=10, output_tokens=10, feature="a",
                    usage_source="estimated")
    # feature B: all real
    mr.record_usage(TaskProfile(tier="micro"), _routed(),
                    input_tokens=10, output_tokens=10, feature="b",
                    usage_source="real")
    # feature C: one of each -> mixed
    mr.record_usage(TaskProfile(tier="micro"), _routed(),
                    input_tokens=10, output_tokens=10, feature="c",
                    usage_source="estimated")
    mr.record_usage(TaskProfile(tier="micro"), _routed(),
                    input_tokens=10, output_tokens=10, feature="c",
                    usage_source="real")
    by = {f["feature"]: f["usage_source"] for f in mr.cost_summary()["by_feature"]}
    assert by == {"a": "estimated", "b": "real", "c": "mixed"}


# --------------------------------------------------------------- integration
def test_extractor_records_a_usage_row(monkeypatch):
    """The graph extractor must call record_usage after its LLM turn. Monkeypatch
    the LLM call + the graph persistence and assert a usage row landed."""
    from src.graph import extractor

    # Force the router to a usable (remote) endpoint without touching the DB.
    routed = RoutedModel(endpoint_id="ep-cloud", model="auto-x", token_budget=4096,
                         why="test", endpoint_url="http://ep-cloud/chat",
                         headers={})
    monkeypatch.setattr(mr, "resolve", lambda *a, **k: routed)

    async def fake_llm(url, model, messages, **kwargs):
        return '{"items": []}'

    monkeypatch.setattr("src.llm_core.llm_call_async", fake_llm)
    # The extractor imports these lazily; stub the heavy graph machinery.
    monkeypatch.setattr(extractor, "ensure_graph_tables", lambda: None)
    monkeypatch.setattr(extractor, "course_concept_shortlist",
                        lambda db, cid, owner: [])
    monkeypatch.setattr("src.corpus.grounding.session_course_id",
                        lambda sid: "course-1")

    class _FakeSession:
        pass

    class _FakeDB:
        def close(self):
            pass

    monkeypatch.setattr("core.database.SessionLocal", lambda: _FakeDB())

    sess = _FakeSession()
    # two turns so the >=2 gate passes
    monkeypatch.setattr(extractor, "_recent_turns",
                        lambda s: [{"role": "user", "content": "what is a mean?"},
                                   {"role": "assistant", "content": "the average"}])
    monkeypatch.setattr(extractor, "_episode_refs_for", lambda s, sid: [])

    asyncio.run(extractor.extract_after_turn(sess, "session-1", owner=None))

    rows = _rows()
    assert any(r["feature"] == "extraction" for r in rows), \
        "extractor did not record a usage row"


# --------------------------------------------------------------- review fixes (F1/F2)
def test_record_call_usage_local_url_is_free():
    """F1: the legacy-resolved deep-research path has an EMPTY endpoint_id but a
    localhost endpoint_url -> must be detected local -> FREE (no phantom cloud spend)."""
    mr.record_call_usage(tier="deep", endpoint_id="",
                         endpoint_url="http://localhost:11434/v1",
                         model="qwen2.5",
                         messages=[{"role": "user", "content": "x" * 400}],
                         raw="y" * 400, feature="deep_research")
    r = _rows()[0]
    assert r["local"] is True
    assert r["est_cost_usd"] == pytest.approx(0.0)
    assert r["feature"] == "deep_research"


def test_cost_summary_reads_rotated_usage_file():
    """F2: after the usage jsonl rotates to .1, cost_summary still counts those rows."""
    import os
    mr.record_usage(TaskProfile(tier="standard"), _routed(),
                    input_tokens=1_000_000, output_tokens=0, feature="extraction")  # $1.00
    os.replace(mr.USAGE_LOG_PATH, mr.USAGE_LOG_PATH + ".1")  # simulate rotation
    mr.record_usage(TaskProfile(tier="standard"), _routed(),
                    input_tokens=0, output_tokens=1_000_000, feature="practice")  # $3.00
    mr._recent_usage.clear()  # force the disk read, not the in-memory deque
    s = mr.cost_summary(window_days=7)
    assert {f["feature"] for f in s["by_feature"]} == {"extraction", "practice"}
    assert s["total_cost_usd"] == pytest.approx(4.0)
