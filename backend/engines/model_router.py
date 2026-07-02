"""The model-selection one-door (SPEC §5.5 #3, F7; DESIGN-M0-M1 §5; Gate 6g).

Call sites declare a TaskProfile — a *need*, never a model name. resolve()
maps it onto the configured `model_endpoint` rows: pins first, then hard
capability filters (vision/structured/privacy), then policy ranking, then a
flagged degrade — never a silent one. Vision with no vision model fails LOUD.

The router config (policy, pins, tier_table, reserve) is data in the `setting`
table under key "router" — re-tunable without a deploy.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.config import get_settings
from core.models import ModelEndpoint, Setting, User
from core.scoping import owner_scoped

Tier = Literal["micro", "light", "standard", "deep"]
TIERS: tuple[Tier, ...] = ("micro", "light", "standard", "deep")
_RANK = {"micro": 0, "light": 1, "standard": 2, "deep": 3}
_LOCAL_PROVIDERS = {"ollama", "fake"}

DEFAULT_ROUTER_CONFIG: dict[str, Any] = {
    "policy": "local_first",  # local_first | quality_first (F7: student policy)
    "pins": {},  # tier -> "endpoint_name/model_name"
    "tier_table": {},  # reserved for explicit preference lists (data, not code)
    "reserve_tokens": 1024,  # subtracted from context_window for the budget
}


@dataclass(frozen=True)
class TaskProfile:
    tier: Tier = "standard"
    modality: Literal["text", "vision"] = "text"
    output_shape: Literal["text", "structured"] = "text"
    latency: Literal["interactive", "background"] = "interactive"
    privacy: Literal["default", "local_only"] = "default"


@dataclass(frozen=True)
class Resolution:
    endpoint_id: str
    endpoint_name: str
    provider: str
    model: str
    token_budget: int
    below_preferred: bool
    pinned: bool


class RouterError(Exception):
    code = "router_error"


class NoProviderError(RouterError):
    code = "no_provider"


class NoVisionModelError(RouterError):
    code = "no_vision_model"


# (endpoint-dict, model-dict) pairs are the resolution currency.
Candidate = tuple[dict[str, Any], dict[str, Any]]


def _fake_endpoint() -> dict[str, Any]:
    """The deterministic FakeProvider, present only in test mode (M0-PLAN §4).
    Text-only on purpose: vision-absent paths must stay testable."""
    return {
        "id": "fake",
        "name": "FakeProvider",
        "provider": "fake",
        "models": [
            {
                "name": "fake-standard",
                "context_window": 32768,
                "vision": False,
                "reasoning_class": "standard",
                "structured": True,
            }
        ],
    }


def router_config(db: Session, user: User) -> dict[str, Any]:
    row = db.scalar(
        owner_scoped(select(Setting), Setting, user).where(Setting.key == "router")
    )
    config = dict(DEFAULT_ROUTER_CONFIG)
    if row is not None and isinstance(row.value, dict):
        config.update(row.value)
    return config


def _candidates(db: Session, user: User) -> list[Candidate]:
    endpoints: list[dict[str, Any]] = [
        {
            "id": row.id,
            "name": row.name,
            "provider": row.provider,
            "models": row.models or [],
        }
        for row in db.scalars(
            owner_scoped(select(ModelEndpoint), ModelEndpoint, user).where(
                ModelEndpoint.enabled
            )
        )
    ]
    if get_settings().test_mode:
        endpoints.append(_fake_endpoint())
    return [(e, m) for e in endpoints for m in e["models"]]


def _rank(candidate: Candidate) -> int:
    return _RANK.get(candidate[1].get("reasoning_class", "standard"), 2)


def _pick(pool: list[Candidate], policy: str, degraded: bool) -> Candidate:
    if degraded:
        # Nothing meets the tier: best effort = strongest available.
        return max(pool, key=_rank)
    if policy == "quality_first":
        return max(pool, key=_rank)
    # local_first: prefer local endpoints; take the *smallest* adequate model
    # (the pool is already filtered to >= the tier minimum).
    local = [c for c in pool if c[0]["provider"] in _LOCAL_PROVIDERS]
    return min(local or pool, key=_rank)


def _resolution(candidate: Candidate, config: dict[str, Any], *, below: bool, pinned: bool) -> Resolution:
    endpoint, model = candidate
    reserve = int(config.get("reserve_tokens", 1024))
    return Resolution(
        endpoint_id=endpoint["id"],
        endpoint_name=endpoint["name"],
        provider=endpoint["provider"],
        model=model["name"],
        token_budget=max(0, int(model.get("context_window", 8192)) - reserve),
        below_preferred=below,
        pinned=pinned,
    )


def resolve(db: Session, user: User, profile: TaskProfile) -> Resolution:
    config = router_config(db, user)
    candidates = _candidates(db, user)
    if not candidates:
        raise NoProviderError("no enabled model endpoint is configured")

    if profile.modality == "vision":
        candidates = [c for c in candidates if c[1].get("vision")]
        if not candidates:
            # The hard requirement (F7): never silently text-only.
            raise NoVisionModelError(
                "vision required but no vision-capable model is configured"
            )
    if profile.privacy == "local_only":
        candidates = [c for c in candidates if c[0]["provider"] in _LOCAL_PROVIDERS]
        if not candidates:
            raise NoProviderError("local_only requested but no local endpoint exists")
    if profile.output_shape == "structured":
        candidates = [c for c in candidates if c[1].get("structured", True)]
        if not candidates:
            raise NoProviderError("no configured model supports structured output")

    need = _RANK[profile.tier]

    pin = config.get("pins", {}).get(profile.tier)
    if pin:
        for candidate in candidates:
            if f"{candidate[0]['name']}/{candidate[1]['name']}" == pin:
                return _resolution(
                    candidate, config, below=_rank(candidate) < need, pinned=True
                )
        # Pinned model unavailable -> fall through to auto-resolution.

    meeting = [c for c in candidates if _rank(c) >= need]
    pool, degraded = (meeting, False) if meeting else (candidates, True)
    chosen = _pick(pool, str(config.get("policy", "local_first")), degraded)
    return _resolution(chosen, config, below=degraded, pinned=False)


def resolution_table(db: Session, user: User) -> list[dict[str, Any]]:
    """The live tier->model table for /api/router/resolution (F7 observability).
    Includes the vision pseudo-row: same tiers, modality=vision."""
    rows: list[dict[str, Any]] = []
    probes: list[tuple[str, TaskProfile]] = [
        *((tier, TaskProfile(tier=tier)) for tier in TIERS),
        ("vision", TaskProfile(tier="standard", modality="vision")),
    ]
    for label, profile in probes:
        try:
            res = resolve(db, user, profile)
            rows.append(
                {
                    "tier": label,
                    "available": True,
                    "endpoint_id": res.endpoint_id,
                    "endpoint_name": res.endpoint_name,
                    "model": res.model,
                    "token_budget": res.token_budget,
                    "below_preferred": res.below_preferred,
                    "pinned": res.pinned,
                    "reason": None,
                }
            )
        except RouterError as exc:
            rows.append(
                {
                    "tier": label,
                    "available": False,
                    "endpoint_id": None,
                    "endpoint_name": None,
                    "model": None,
                    "token_budget": None,
                    "below_preferred": False,
                    "pinned": False,
                    "reason": exc.code,
                }
            )
    return rows
