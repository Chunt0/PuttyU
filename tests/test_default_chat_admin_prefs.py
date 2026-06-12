"""Regression: GET /api/default-chat must honor an ADMIN's per-user default.

Bug (found in a live click-through, 2026-06-05): the Providers screen writes the default
endpoint/model to PER-USER prefs (`/api/prefs/default_*` → user_prefs.json), but
get_default_chat resolved admins from the GLOBAL settings.json — so an admin's UI selection
was silently ignored (and a stray non-/v1 endpoint got picked, 302-ing chat). Since v1 is
single-user and that user is an admin, this broke the core flow. The fix makes default-chat
honor per-user prefs for everyone, with settings.json as a fallback only when unset.

Reuses the fakes/harness from test_review_regressions to exercise the real route function.
"""
from types import SimpleNamespace

import test_review_regressions as trr


def _admin_request(user="admin"):
    return SimpleNamespace(
        state=SimpleNamespace(current_user=user),
        app=SimpleNamespace(state=SimpleNamespace(
            auth_manager=SimpleNamespace(is_admin=lambda u: True)
        )),
    )


def _wire(monkeypatch, ep, settings, user_prefs):
    trr._install_model_route_import_stubs(monkeypatch)
    import routes.model_routes as model_routes
    import routes.prefs_routes as prefs_routes
    monkeypatch.setattr(model_routes, "ModelEndpoint", trr._FakeModelEndpoint)
    monkeypatch.setattr(model_routes, "SessionLocal", lambda: trr._FakeDb([ep]))
    monkeypatch.setattr(model_routes, "_load_settings", lambda: settings)
    monkeypatch.setattr(model_routes, "owner_filter", lambda q, m, u, **kw: q)
    monkeypatch.setattr(model_routes, "_normalize_base", lambda b: b.rstrip("/"))
    monkeypatch.setattr(model_routes, "build_chat_url", lambda b: f"{b}/chat/completions")
    monkeypatch.setattr(prefs_routes, "_load_for_user", lambda user: user_prefs)


def test_admin_default_chat_prefers_per_user_pick_over_global(monkeypatch):
    """Admin with a per-user default uses it — NOT the (different) global settings default."""
    ep = SimpleNamespace(
        id="ep1", base_url="http://localhost:11434/v1", is_enabled=True, owner=None,
        cached_models='["visible-model", "other-model"]', hidden_models='[]',
    )
    _wire(
        monkeypatch, ep,
        settings={"default_endpoint_id": "ep1", "default_model": "other-model"},
        user_prefs={"default_endpoint_id": "ep1", "default_model": "visible-model"},
    )
    result = trr._default_chat_endpoint()(_admin_request())
    assert result["endpoint_id"] == "ep1"
    assert result["model"] == "visible-model"  # per-user pick, not the global "other-model"


def test_admin_default_chat_falls_back_to_global_when_no_per_user(monkeypatch):
    """Admin with NO per-user pick still resolves via global settings.json (unchanged)."""
    ep = SimpleNamespace(
        id="ep1", base_url="http://localhost:11434/v1", is_enabled=True, owner=None,
        cached_models='["global-model"]', hidden_models='[]',
    )
    _wire(
        monkeypatch, ep,
        settings={"default_endpoint_id": "ep1", "default_model": "global-model"},
        user_prefs={},
    )
    result = trr._default_chat_endpoint()(_admin_request())
    assert result["endpoint_id"] == "ep1"
    assert result["model"] == "global-model"
