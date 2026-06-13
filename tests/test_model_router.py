"""Phase-2 T2a — model router v1 (SPEC F7, §5.3d): pins, policy ranking,
nearest-tier degradation (a one-model box still resolves everything), the vision
hard-fail with a setup hint, the transparent unconfigured fallback to the legacy
endpoint_resolver chain, and the observability log (+ rotation guard)."""

import json
import os
from types import SimpleNamespace

import pytest

import src.model_router as mr
from src import endpoint_resolver
from src.model_router import RouterConfig, RouterError, TaskProfile


@pytest.fixture(autouse=True)
def _isolated_router(tmp_path, monkeypatch):
    monkeypatch.setattr(mr, "CONFIG_PATH", str(tmp_path / "router.json"))
    monkeypatch.setattr(mr, "LOG_PATH", str(tmp_path / "router_log.jsonl"))
    mr._recent.clear()
    yield


def _ep(id, base_url="http://api.example.com/v1"):
    return SimpleNamespace(id=id, base_url=base_url, is_enabled=True)


@pytest.fixture
def fake_endpoints(monkeypatch):
    eps = []
    monkeypatch.setattr(mr, "_enabled_endpoints", lambda owner=None: list(eps))

    def fake_by_id(ep_id, model=None, owner=None):
        if any(e.id == ep_id for e in eps):
            return (f"http://{ep_id}/chat", model or f"auto-{ep_id}", {"x": ep_id})
        return None

    monkeypatch.setattr(endpoint_resolver, "resolve_endpoint_by_id", fake_by_id)
    return eps


def _configure(policy="local_first", pins=None, capabilities=None):
    RouterConfig().save({"policy": policy, "pins": pins or {},
                         "capabilities": capabilities or {}})


# ------------------------------------------------------------ unconfigured

def test_unconfigured_fallback_equals_legacy_choice(monkeypatch):
    calls = {}

    def legacy(prefix, fallback_url=None, fallback_model=None,
               fallback_headers=None, owner=None):
        calls["args"] = (prefix, fallback_url, fallback_model, fallback_headers, owner)
        return "http://legacy/v1/chat/completions", "legacy-model", {"k": "v"}

    monkeypatch.setattr(endpoint_resolver, "resolve_endpoint", legacy)
    routed = mr.resolve(TaskProfile(tier="deep", latency="background"),
                        legacy_prefix="research", fallback_url="fb-url",
                        fallback_model="fb-model", fallback_headers={"a": 1})
    # Byte-identical to what the legacy purpose-chain returns today.
    assert routed.endpoint_url == "http://legacy/v1/chat/completions"
    assert routed.model == "legacy-model" and routed.headers == {"k": "v"}
    assert calls["args"] == ("research", "fb-url", "fb-model", {"a": 1}, None)
    assert "unconfigured" in routed.why


def test_unconfigured_vision_does_not_raise(monkeypatch):
    monkeypatch.setattr(endpoint_resolver, "resolve_endpoint",
                        lambda *a, **k: ("http://legacy/chat", "m", {}))
    routed = mr.resolve(TaskProfile(modality="vision"))
    assert routed.model == "m"  # transparent: pre-router behavior unchanged


# ------------------------------------------------------------ pins

def test_pin_wins_over_policy(fake_endpoints):
    fake_endpoints.extend([_ep("big"), _ep("small", "http://localhost:11434")])
    _configure(pins={"micro": {"endpoint_id": "big", "model": "pinned-model"}},
               capabilities={"small": {"reasoning": "micro"}})
    routed = mr.resolve(TaskProfile(tier="micro"))
    assert routed.endpoint_id == "big" and routed.model == "pinned-model"
    assert "pinned" in routed.why


def test_vision_ignores_pin_to_text_only_endpoint(fake_endpoints):
    fake_endpoints.extend([_ep("text-ep"), _ep("vl-ep")])
    _configure(pins={"standard": {"endpoint_id": "text-ep"}},
               capabilities={"vl-ep": {"vision": True, "reasoning": "standard"}})
    routed = mr.resolve(TaskProfile(tier="standard", modality="vision"))
    assert routed.endpoint_id == "vl-ep"  # never send an image to a text-only pin


# ------------------------------------------------------------ policy ranking

def test_local_first_prefers_local_at_equal_tier(fake_endpoints):
    fake_endpoints.extend([_ep("cloud"), _ep("box", "http://192.168.1.20:11434")])
    _configure(policy="local_first",
               capabilities={"cloud": {"reasoning": "standard"},
                             "box": {"reasoning": "standard"}})
    assert mr.resolve(TaskProfile(tier="standard")).endpoint_id == "box"


def test_quality_first_prefers_stronger_reasoner(fake_endpoints):
    fake_endpoints.extend([_ep("claude"), _ep("box", "http://localhost:11434")])
    _configure(policy="quality_first",
               capabilities={"claude": {"reasoning": "deep"},
                             "box": {"reasoning": "standard"}})
    routed = mr.resolve(TaskProfile(tier="deep"))
    assert routed.endpoint_id == "claude"
    # micro still goes to the NEAREST tier (standard box beats deep claude on distance)
    assert mr.resolve(TaskProfile(tier="micro")).endpoint_id == "box"


def test_privacy_local_only_filters_remote(fake_endpoints):
    fake_endpoints.extend([_ep("cloud"), _ep("box", "http://127.0.0.1:11434")])
    _configure(policy="quality_first",
               capabilities={"cloud": {"reasoning": "deep"},
                             "box": {"reasoning": "light"}})
    routed = mr.resolve(TaskProfile(tier="deep", privacy="local_only"))
    assert routed.endpoint_id == "box"


def test_capability_local_override_beats_heuristic(fake_endpoints):
    fake_endpoints.extend([_ep("tailbox", "http://my-gpu-host:8080")])
    _configure(capabilities={"tailbox": {"reasoning": "standard", "local": True}})
    routed = mr.resolve(TaskProfile(tier="standard", privacy="local_only"))
    assert routed.endpoint_id == "tailbox"


# ------------------------------------------------------------ degradation

def test_one_model_box_resolves_every_tier(fake_endpoints):
    fake_endpoints.append(_ep("only", "http://localhost:11434"))
    _configure(capabilities={"only": {"reasoning": "light"}})
    for tier in mr.TIERS:
        routed = mr.resolve(TaskProfile(tier=tier))
        assert routed.endpoint_id == "only"  # no feature is gated on tier availability
        if tier != "light":
            assert "degraded" in routed.why  # observable, never silent


def test_no_candidates_degrades_to_legacy_chain(fake_endpoints, monkeypatch):
    _configure(capabilities={"ghost": {"reasoning": "deep"}})  # configured, but
    # ...no enabled endpoint matches (fake_endpoints is empty)
    monkeypatch.setattr(endpoint_resolver, "resolve_endpoint",
                        lambda *a, **k: ("http://legacy/chat", "legacy-m", {}))
    routed = mr.resolve(TaskProfile(tier="standard"))
    assert routed.model == "legacy-m" and "legacy" in routed.why


# ------------------------------------------------------------ vision hard fail

def test_vision_with_no_vl_candidate_fails_loudly(fake_endpoints):
    fake_endpoints.extend([_ep("text-only", "http://localhost:11434")])
    _configure(capabilities={"text-only": {"reasoning": "deep"}})
    with pytest.raises(RouterError) as e:
        mr.resolve(TaskProfile(modality="vision"))
    msg = str(e.value)
    assert "vision" in msg.lower() and "Setup hint" in msg  # loud + actionable


# ------------------------------------------------------------ token budget

def test_token_budget_from_capability_context_window(fake_endpoints):
    fake_endpoints.append(_ep("big-ctx", "http://localhost:1234"))
    _configure(capabilities={"big-ctx": {"reasoning": "deep", "context_window": 131072}})
    assert mr.resolve(TaskProfile(tier="deep")).token_budget == 131072
    fake_endpoints.append(_ep("plain"))
    _configure(capabilities={"plain": {"reasoning": "micro"}})
    assert mr.resolve(TaskProfile(tier="micro")).token_budget == mr.TIER_BUDGETS["micro"]


# ------------------------------------------------------------ observability

def test_every_resolve_is_logged(fake_endpoints):
    fake_endpoints.append(_ep("only", "http://localhost:11434"))
    _configure(capabilities={"only": {"reasoning": "standard"}})
    mr.resolve(TaskProfile(tier="standard"))
    mr.resolve(TaskProfile(tier="micro", latency="background"))
    with open(mr.LOG_PATH, encoding="utf-8") as f:
        lines = [json.loads(line) for line in f]
    assert len(lines) == 2
    assert lines[0]["endpoint_id"] == "only" and lines[0]["model"] == "auto-only"
    assert lines[1]["profile"]["tier"] == "micro"
    assert {"ts", "profile", "endpoint_id", "model", "why"} <= set(lines[0])
    recent = mr.recent_resolutions(10)
    assert recent[0]["profile"]["tier"] == "micro"  # most recent first


def test_log_rotation_guard(fake_endpoints):
    fake_endpoints.append(_ep("only", "http://localhost:11434"))
    _configure(capabilities={"only": {"reasoning": "standard"}})
    os.makedirs(os.path.dirname(mr.LOG_PATH), exist_ok=True)
    with open(mr.LOG_PATH, "w") as f:
        f.write("x" * (mr.LOG_ROTATE_BYTES + 1))
    mr.resolve(TaskProfile())
    assert os.path.exists(mr.LOG_PATH + ".1")
    assert os.path.getsize(mr.LOG_PATH) < 10_000  # fresh file, one entry


def test_resolution_table_covers_tiers_and_vision(fake_endpoints):
    fake_endpoints.append(_ep("only", "http://localhost:11434"))
    _configure(capabilities={"only": {"reasoning": "standard"}})
    rows = mr.resolution_table()
    assert [r["tier"] for r in rows[:4]] == mr.TIERS
    assert rows[-1]["modality"] == "vision" and "error" in rows[-1]
    assert all(r.get("endpoint_id") == "only" for r in rows[:4])
    # probes don't pollute the log
    assert not os.path.exists(mr.LOG_PATH) or os.path.getsize(mr.LOG_PATH) == 0


# ------------------------------------------------------------ config store

def test_config_save_validates_and_round_trips():
    saved = RouterConfig().save({
        "policy": "nonsense",
        "pins": {"deep": {"endpoint_id": "e1", "model": "m"},
                 "bogus-tier": {"endpoint_id": "e2"},
                 "micro": {"model": "no-endpoint"}},
        "capabilities": {"e1": {"vision": 1, "reasoning": "ultra",
                                "context_window": "8192"},
                         "junk": "not-a-dict"},
    })
    assert saved["policy"] == "local_first"  # invalid policy -> default
    assert list(saved["pins"]) == ["deep"]   # bad tier + missing endpoint dropped
    cap = saved["capabilities"]["e1"]
    assert cap == {"vision": True, "reasoning": "standard", "context_window": 8192}
    assert RouterConfig().load() == {**saved}


def test_missing_config_loads_defaults_and_is_unconfigured():
    cfg = RouterConfig().load()
    assert cfg == {"policy": "local_first", "pins": {}, "capabilities": {}}
    assert RouterConfig.is_configured(cfg) is False
