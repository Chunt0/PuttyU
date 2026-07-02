"""M0.2 router unit tests: resolution honors capabilities, policy, pins, and
fails LOUD when vision is required but absent (F7 / DESIGN-M0-M1 §5)."""

import pytest

from core.database import SessionLocal
from core.models import ModelEndpoint, Setting, User
from engines.model_router import (
    NoProviderError,
    NoVisionModelError,
    TaskProfile,
    resolution_table,
    resolve,
)


@pytest.fixture()
def db():
    with SessionLocal() as session:
        yield session


@pytest.fixture()
def user(db):
    row = User(username="owner", password_hash="x", is_owner=True)
    db.add(row)
    db.commit()
    return row


def add_endpoint(db, user, *, name, provider, models):
    db.add(
        ModelEndpoint(
            owner=user.id, name=name, provider=provider, base_url="", models=models
        )
    )
    db.commit()


def model(name, reasoning_class="standard", vision=False, context_window=32768):
    return {
        "name": name,
        "context_window": context_window,
        "vision": vision,
        "reasoning_class": reasoning_class,
        "structured": True,
    }


def test_fake_provider_resolves_in_test_mode(db, user):
    # No DB endpoints at all — test mode injects the FakeProvider.
    res = resolve(db, user, TaskProfile(tier="standard"))
    assert res.provider == "fake"
    assert res.model == "fake-standard"


def test_vision_absent_fails_loud(db, user):
    with pytest.raises(NoVisionModelError):
        resolve(db, user, TaskProfile(modality="vision"))
    rows = {r["tier"]: r for r in resolution_table(db, user)}
    assert rows["vision"]["available"] is False
    assert rows["vision"]["reason"] == "no_vision_model"


def test_vision_resolves_when_configured(db, user):
    add_endpoint(
        db, user, name="cloud", provider="anthropic",
        models=[model("big-eyes", "deep", vision=True)],
    )
    res = resolve(db, user, TaskProfile(modality="vision"))
    assert res.model == "big-eyes"


def test_deep_degrades_with_flag_not_silently(db, user):
    # Only the standard-class FakeProvider exists: deep degrades, flagged.
    res = resolve(db, user, TaskProfile(tier="deep"))
    assert res.model == "fake-standard"
    assert res.below_preferred is True


def test_local_first_prefers_smallest_adequate_local(db, user):
    add_endpoint(
        db, user, name="cloud", provider="anthropic",
        models=[model("huge-cloud", "deep")],
    )
    add_endpoint(
        db, user, name="box", provider="ollama",
        models=[model("tiny-local", "light"), model("mid-local", "standard")],
    )
    res = resolve(db, user, TaskProfile(tier="light"))
    assert (res.endpoint_name, res.model) == ("box", "tiny-local")


def test_quality_first_picks_strongest(db, user):
    db.add(
        Setting(
            owner=user.id,
            key="router",
            value={"policy": "quality_first"},
        )
    )
    db.commit()
    add_endpoint(
        db, user, name="cloud", provider="anthropic",
        models=[model("huge-cloud", "deep")],
    )
    res = resolve(db, user, TaskProfile(tier="light"))
    assert res.model == "huge-cloud"


def test_pin_overrides_policy(db, user):
    add_endpoint(
        db, user, name="cloud", provider="anthropic",
        models=[model("huge-cloud", "deep")],
    )
    db.add(
        Setting(
            owner=user.id,
            key="router",
            value={"pins": {"standard": "cloud/huge-cloud"}},
        )
    )
    db.commit()
    res = resolve(db, user, TaskProfile(tier="standard"))
    assert res.pinned is True
    assert res.model == "huge-cloud"


def test_local_only_privacy_excludes_cloud(db, user):
    add_endpoint(
        db, user, name="cloud", provider="anthropic",
        models=[model("huge-cloud", "deep")],
    )
    res = resolve(db, user, TaskProfile(tier="deep", privacy="local_only"))
    assert res.provider == "fake"  # the only local endpoint in tests


def test_no_provider_without_test_mode(db, user, monkeypatch):
    from core import config

    monkeypatch.setattr(
        config.get_settings(), "test_mode", False, raising=True
    )
    with pytest.raises(NoProviderError):
        resolve(db, user, TaskProfile())
