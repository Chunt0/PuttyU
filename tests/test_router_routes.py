"""Phase-2 T2a — /api/router/* routes (SPEC F7 observability + the policy dial)."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import src.model_router as mr
import routes.router_routes as rroutes
from src.request_models import (
    RouterCapability,
    RouterConfigUpdateRequest,
    RouterPin,
)

_ROUTER = rroutes.setup_router_routes()


def _endpoint(method, suffix):
    for r in _ROUTER.routes:
        if getattr(r, "path", "").endswith(suffix) and method in getattr(r, "methods", set()):
            return r.endpoint
    raise RuntimeError(f"{method} *{suffix} not found")


get_config = _endpoint("GET", "/config")
put_config = _endpoint("PUT", "/config")
get_resolution = _endpoint("GET", "/resolution")
get_log = _endpoint("GET", "/log")


def _req(user="ada"):
    return SimpleNamespace(state=SimpleNamespace(current_user=user))


@pytest.fixture(autouse=True)
def _isolated_router(tmp_path, monkeypatch):
    monkeypatch.setattr(mr, "CONFIG_PATH", str(tmp_path / "router.json"))
    monkeypatch.setattr(mr, "LOG_PATH", str(tmp_path / "router_log.jsonl"))
    mr._recent.clear()
    yield


def test_config_roundtrip_and_configured_flag():
    out = get_config(_req())
    assert out["configured"] is False and out["policy"] == "local_first"

    saved = put_config(_req(), RouterConfigUpdateRequest(
        policy="quality_first",
        pins={"deep": RouterPin(endpoint_id="claude-ep", model="claude-x")},
        capabilities={"claude-ep": RouterCapability(vision=True, reasoning="deep",
                                                    context_window=200000)},
    ))
    assert saved["configured"] is True and saved["policy"] == "quality_first"
    assert saved["pins"]["deep"]["endpoint_id"] == "claude-ep"
    assert saved["capabilities"]["claude-ep"]["context_window"] == 200000

    again = get_config(_req())
    assert again["pins"]["deep"]["model"] == "claude-x"

    # partial update: policy only — pins/capabilities preserved
    partial = put_config(_req(), RouterConfigUpdateRequest(policy="local_first"))
    assert partial["policy"] == "local_first"
    assert partial["pins"]["deep"]["endpoint_id"] == "claude-ep"


def test_put_config_rejects_unknown_policy():
    with pytest.raises(HTTPException) as e:
        put_config(_req(), RouterConfigUpdateRequest(policy="fastest"))
    assert e.value.status_code == 400


def test_resolution_table_endpoint(monkeypatch):
    monkeypatch.setattr(rroutes, "resolution_table",
                        lambda owner=None: [{"tier": "micro", "modality": "text",
                                             "endpoint_id": "e1", "model": "m",
                                             "token_budget": 2048, "why": "w"}])
    out = get_resolution(_req())
    assert out["rows"][0]["endpoint_id"] == "e1"
    assert out["configured"] is False


def test_log_endpoint_returns_recent_first(monkeypatch):
    from src import endpoint_resolver
    monkeypatch.setattr(endpoint_resolver, "resolve_endpoint",
                        lambda *a, **k: ("http://legacy/chat", "m", {}))
    mr.resolve(mr.TaskProfile(tier="micro"))
    mr.resolve(mr.TaskProfile(tier="deep"))
    out = get_log(_req(), limit=10)
    assert [e["profile"]["tier"] for e in out["entries"]] == ["deep", "micro"]
