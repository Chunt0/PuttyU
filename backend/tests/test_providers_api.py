"""M0.2 API tests: provider CRUD (keys never returned), settings, resolution."""

from fastapi.testclient import TestClient

from app import app

CSRF = {"X-PuttyU-CSRF": "1"}
OWNER = {"username": "owner", "password": "correct-horse-battery"}

ENDPOINT = {
    "name": "box",
    "provider": "ollama",
    "base_url": "http://127.0.0.1:11434",
    "api_key": "super-secret-key",
    "models": [
        {
            "name": "local-small",
            "context_window": 32768,
            "vision": False,
            "reasoning_class": "light",
        }
    ],
}


def logged_in_client() -> TestClient:
    c = TestClient(app, headers=CSRF)
    c.__enter__()
    assert c.post("/api/auth/setup", json=OWNER).status_code == 200
    assert c.post("/api/auth/login", json=OWNER).status_code == 200
    return c


def test_endpoints_require_auth():
    with TestClient(app, headers=CSRF) as c:
        assert c.get("/api/model-endpoints").status_code in (401, 409)
        assert c.get("/api/router/resolution").status_code in (401, 409)


def test_endpoint_crud_never_returns_the_key():
    c = logged_in_client()
    try:
        created = c.post("/api/model-endpoints", json=ENDPOINT)
        assert created.status_code == 200
        body = created.json()
        assert body["has_api_key"] is True
        assert "super-secret-key" not in created.text

        listed = c.get("/api/model-endpoints")
        assert listed.status_code == 200
        assert "super-secret-key" not in listed.text
        assert len(listed.json()) == 1

        updated = c.put(
            f"/api/model-endpoints/{body['id']}", json={"enabled": False}
        )
        assert updated.status_code == 200
        assert updated.json()["enabled"] is False

        deleted = c.delete(f"/api/model-endpoints/{body['id']}")
        assert deleted.status_code == 200
        assert c.get("/api/model-endpoints").json() == []
    finally:
        c.__exit__(None, None, None)


def test_resolution_table_renders_with_fake_provider():
    c = logged_in_client()
    try:
        r = c.get("/api/router/resolution")
        assert r.status_code == 200
        tiers = {row["tier"]: row for row in r.json()["tiers"]}
        assert set(tiers) == {"micro", "light", "standard", "deep", "vision"}
        assert tiers["standard"]["available"] is True
        assert tiers["standard"]["model"] == "fake-standard"
        # Test-mode fake is text-only: the vision row is loudly unavailable.
        assert tiers["vision"]["available"] is False
        assert tiers["vision"]["reason"] == "no_vision_model"
        # Deep degrades to the standard fake, flagged.
        assert tiers["deep"]["below_preferred"] is True
    finally:
        c.__exit__(None, None, None)


def test_settings_roundtrip_and_router_default():
    c = logged_in_client()
    try:
        r = c.get("/api/settings")
        assert r.status_code == 200
        assert r.json()["values"]["router"]["policy"] == "local_first"

        r = c.put(
            "/api/settings",
            json={"values": {"router": {"policy": "quality_first"}}},
        )
        assert r.status_code == 200
        assert r.json()["values"]["router"]["policy"] == "quality_first"
        # Defaults still merged in for unset keys.
        assert "reserve_tokens" in r.json()["values"]["router"]
    finally:
        c.__exit__(None, None, None)
