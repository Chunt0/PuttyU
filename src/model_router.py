"""
model_router.py — Feature 7 (SPEC §5.3d): feature-based model selection, v1.

The third one-door (after `owner_scoped` and the future `student_context`): call
sites declare a TaskProfile (what the task NEEDS — tier/modality/shape/latency/
privacy) and the router resolves it against whatever providers this instance has.
No call site names a model.

Config is DATA, not code (§6 Q11): data/router.json, written atomically —
    {"policy": "local_first" | "quality_first",
     "pins":         {tier: {"endpoint_id": ..., "model": ...}},
     "capabilities": {endpoint_id: {"vision": bool, "reasoning": "micro".."deep",
                                    "context_window": int?, "local": bool?}}}

Resolution order: pin → policy-ranked candidates with the required capabilities →
nearest-tier degradation when the tier has no exact match (a one-model box still
works completely). The ONLY hard failure is modality=vision with no VL-capable
candidate (never silently send an image to a text-only model). **Unconfigured
(no pins, no capabilities) is a transparent fallback to the existing
endpoint_resolver default chain — current behavior unchanged.**

Observability (F7 "routing is observable"): every resolve appends
{ts, profile, endpoint_id, model, why} to data/router_log.jsonl (rotated >5MB)
and to a bounded in-memory deque served by /api/router/log.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

TIERS = ["micro", "light", "standard", "deep"]
MODALITIES = ("text", "vision")
POLICIES = ("local_first", "quality_first")

# Default per-tier token budgets (data — the context assembler consumes these;
# a capability's context_window overrides).
TIER_BUDGETS = {"micro": 2048, "light": 4096, "standard": 8192, "deep": 16384}

CONFIG_PATH = os.path.join("data", "router.json")
LOG_PATH = os.path.join("data", "router_log.jsonl")
LOG_ROTATE_BYTES = 5 * 1024 * 1024
RECENT_MAX = 200

_recent: deque = deque(maxlen=RECENT_MAX)
_log_lock = threading.Lock()

_LOCAL_HOST_RE = re.compile(
    r"^(localhost|127\.|0\.0\.0\.0|::1|\[::1\]|10\.|192\.168\."
    r"|172\.(1[6-9]|2\d|3[01])\.|host\.docker\.internal$)"
)

_VISION_FAIL_HINT = (
    "No vision-capable model is configured. Vision is a hard requirement — the "
    "image will not be sent to a text-only model. Setup hint: add a VL model "
    "(e.g. a llava/qwen-vl model on Ollama, or Claude on an Anthropic endpoint) "
    "and mark its endpoint vision-capable in routing settings "
    "(PUT /api/router/config → capabilities.<endpoint_id>.vision = true)."
)


class RouterError(RuntimeError):
    """Raised ONLY for modality=vision with no VL candidate (message = setup hint)."""


@dataclass
class TaskProfile:
    """What a call site NEEDS — never which model it wants."""
    tier: str = "standard"          # micro | light | standard | deep
    modality: str = "text"          # text | vision
    output_shape: str = "free"      # free | structured
    latency: str = "interactive"    # interactive | background
    privacy: str = "any"            # any | local_only


@dataclass
class RoutedModel:
    """A resolved dispatch target. endpoint_url/headers are ready for llm_core."""
    endpoint_id: str
    model: str
    token_budget: int
    why: str
    endpoint_url: str = ""
    headers: dict = field(default_factory=dict)


# --------------------------------------------------------------------------- #
# Config store (data/router.json, atomic writes)                              #
# --------------------------------------------------------------------------- #
class RouterConfig:
    """Tiny manager for the router's JSON config. Lenient reads, atomic writes."""

    DEFAULTS = {"policy": "local_first", "pins": {}, "capabilities": {}}

    def __init__(self, path: str | None = None):
        self.path = path or CONFIG_PATH

    def load(self) -> dict:
        cfg = dict(self.DEFAULTS)
        try:
            with open(self.path, encoding="utf-8") as f:
                raw = json.load(f)
            if isinstance(raw, dict):
                if raw.get("policy") in POLICIES:
                    cfg["policy"] = raw["policy"]
                if isinstance(raw.get("pins"), dict):
                    cfg["pins"] = {k: v for k, v in raw["pins"].items()
                                   if k in TIERS and isinstance(v, dict)
                                   and v.get("endpoint_id")}
                if isinstance(raw.get("capabilities"), dict):
                    cfg["capabilities"] = {k: v for k, v in raw["capabilities"].items()
                                           if isinstance(v, dict)}
        except FileNotFoundError:
            pass
        except Exception as e:
            logger.warning("router config unreadable (%s); using defaults", e)
        return cfg

    def save(self, cfg: dict) -> dict:
        from core.atomic_io import atomic_write_json
        clean = {
            "policy": cfg.get("policy") if cfg.get("policy") in POLICIES else "local_first",
            "pins": {k: {"endpoint_id": str(v.get("endpoint_id", "")),
                         "model": str(v.get("model") or "")}
                     for k, v in (cfg.get("pins") or {}).items()
                     if k in TIERS and isinstance(v, dict) and v.get("endpoint_id")},
            "capabilities": {str(k): {
                "vision": bool(v.get("vision", False)),
                "reasoning": v.get("reasoning") if v.get("reasoning") in TIERS else "standard",
                **({"context_window": int(v["context_window"])}
                   if v.get("context_window") else {}),
                **({"local": bool(v["local"])} if v.get("local") is not None else {}),
            } for k, v in (cfg.get("capabilities") or {}).items() if isinstance(v, dict)},
        }
        atomic_write_json(self.path, clean, indent=2)
        return clean

    @staticmethod
    def is_configured(cfg: dict) -> bool:
        """Pins or capabilities present = the user opted in. Otherwise the router
        is dormant and the legacy default chain decides (behavior unchanged)."""
        return bool(cfg.get("pins")) or bool(cfg.get("capabilities"))


# --------------------------------------------------------------------------- #
# Candidates                                                                  #
# --------------------------------------------------------------------------- #
def _enabled_endpoints(owner=None) -> list:
    """Enabled ModelEndpoint rows visible to `owner` (Gate-5 rule)."""
    from core.database import SessionLocal, ModelEndpoint
    db = SessionLocal()
    try:
        q = db.query(ModelEndpoint).filter(ModelEndpoint.is_enabled == True)  # noqa: E712
        if owner:
            from src.auth_helpers import owner_filter
            q = owner_filter(q, ModelEndpoint, owner)
        rows = q.all()
        db.expunge_all()
        return rows
    except Exception as e:
        logger.debug("router: endpoint query failed: %s", e)
        return []
    finally:
        db.close()


def _endpoint_is_local(ep, cap: dict | None) -> bool:
    if cap and cap.get("local") is not None:
        return bool(cap["local"])
    host = (urlparse(getattr(ep, "base_url", "") or "").hostname or "").lower()
    return bool(_LOCAL_HOST_RE.match(host)) or host.endswith((".local", ".lan"))


def _dispatch(endpoint_id: str, model: str | None, owner=None):
    """endpoint id (+ optional model) -> (chat_url, model, headers) or None."""
    from src import endpoint_resolver
    return endpoint_resolver.resolve_endpoint_by_id(endpoint_id, model, owner=owner)


# --------------------------------------------------------------------------- #
# Resolution                                                                  #
# --------------------------------------------------------------------------- #
def resolve(
    profile: TaskProfile,
    *,
    owner: str | None = None,
    legacy_prefix: str = "default",
    fallback_url: str | None = None,
    fallback_model: str | None = None,
    fallback_headers: dict | None = None,
    log: bool = True,
) -> RoutedModel:
    """Resolve a TaskProfile to a dispatch target.

    `legacy_prefix` + `fallback_*` describe the call site's PRE-ROUTER behavior
    (the endpoint_resolver purpose-chain it used before adoption); they serve
    both the unconfigured case and the no-candidates degradation, so adopting
    the router can never make a working call site stop resolving.
    """
    tier = profile.tier if profile.tier in TIERS else "standard"
    cfg = RouterConfig().load()

    if not RouterConfig.is_configured(cfg):
        routed = _legacy_resolve(tier, legacy_prefix, fallback_url, fallback_model,
                                 fallback_headers, owner,
                                 why=f"unconfigured: legacy '{legacy_prefix}' chain")
        if profile.modality == "vision" and routed is None:
            raise RouterError(_VISION_FAIL_HINT)
        if routed is None:
            routed = RoutedModel("", fallback_model or "", TIER_BUDGETS[tier],
                                 "unconfigured: no endpoints; caller fallback",
                                 fallback_url or "", fallback_headers or {})
        return _finish(profile, routed, log)

    caps = cfg.get("capabilities") or {}
    policy = cfg.get("policy", "local_first")

    # 1) Pin wins (vision still requires a vision-capable pin target).
    pin = (cfg.get("pins") or {}).get(tier)
    if pin and (profile.modality != "vision"
                or (caps.get(pin["endpoint_id"]) or {}).get("vision")):
        hit = _dispatch(pin["endpoint_id"], pin.get("model") or None, owner)
        if hit:
            url, model, headers = hit
            budget = int((caps.get(pin["endpoint_id"]) or {}).get("context_window")
                         or TIER_BUDGETS[tier])
            return _finish(profile, RoutedModel(
                pin["endpoint_id"], model, budget,
                f"pinned for tier '{tier}'", url, headers), log)

    # 2) Policy-ranked candidates with required capabilities.
    tier_idx = TIERS.index(tier)
    candidates = []
    for ep in _enabled_endpoints(owner):
        cap = caps.get(ep.id) or {}
        if profile.modality == "vision" and not cap.get("vision"):
            continue
        local = _endpoint_is_local(ep, cap)
        if profile.privacy == "local_only" and not local:
            continue
        reasoning = cap.get("reasoning") if cap.get("reasoning") in TIERS else "standard"
        candidates.append((ep, cap, local, TIERS.index(reasoning)))

    if not candidates:
        if profile.modality == "vision":
            raise RouterError(_VISION_FAIL_HINT)
        routed = _legacy_resolve(tier, legacy_prefix, fallback_url, fallback_model,
                                 fallback_headers, owner,
                                 why=f"no candidates for tier '{tier}'; legacy "
                                     f"'{legacy_prefix}' chain")
        if routed is None:
            routed = RoutedModel("", fallback_model or "", TIER_BUDGETS[tier],
                                 "no candidates; caller fallback",
                                 fallback_url or "", fallback_headers or {})
        return _finish(profile, routed, log)

    # Nearest-tier first (degradation only when the exact tier is empty), then
    # the policy dial, then stronger reasoning as the tie-break.
    def rank(c):
        ep, cap, local, r_idx = c
        dist = abs(r_idx - tier_idx)
        if policy == "local_first":
            return (dist, 0 if local else 1, -r_idx)
        return (dist, -r_idx, 0 if local else 1)

    last_err = None
    for ep, cap, local, r_idx in sorted(candidates, key=rank):
        hit = _dispatch(ep.id, None, owner)
        if not hit:
            last_err = f"endpoint '{ep.id}' has no usable model"
            continue
        url, model, headers = hit
        dist = abs(r_idx - tier_idx)
        why = f"policy={policy}: tier '{tier}' -> '{ep.id}' (reasoning={TIERS[r_idx]}, " \
              f"{'local' if local else 'remote'})"
        if dist:
            why += f" [degraded: nearest tier, no {tier}-class candidate]"
        budget = int(cap.get("context_window") or TIER_BUDGETS[tier])
        return _finish(profile, RoutedModel(ep.id, model, budget, why, url, headers), log)

    if profile.modality == "vision":
        raise RouterError(_VISION_FAIL_HINT)
    routed = _legacy_resolve(tier, legacy_prefix, fallback_url, fallback_model,
                             fallback_headers, owner,
                             why=f"candidates unusable ({last_err}); legacy chain")
    if routed is None:
        routed = RoutedModel("", fallback_model or "", TIER_BUDGETS[tier],
                             f"candidates unusable ({last_err}); caller fallback",
                             fallback_url or "", fallback_headers or {})
    return _finish(profile, routed, log)


def _legacy_resolve(tier, prefix, fb_url, fb_model, fb_headers, owner, why) -> RoutedModel | None:
    """The pre-router behavior: endpoint_resolver's settings purpose-chain."""
    from src import endpoint_resolver
    url, model, headers = endpoint_resolver.resolve_endpoint(
        prefix, fallback_url=fb_url, fallback_model=fb_model,
        fallback_headers=fb_headers, owner=owner,
    )
    if not url and not model:
        return None
    return RoutedModel("", model or "", TIER_BUDGETS[tier], why, url or "", headers or {})


# --------------------------------------------------------------------------- #
# Observability                                                               #
# --------------------------------------------------------------------------- #
def _finish(profile: TaskProfile, routed: RoutedModel, log: bool) -> RoutedModel:
    if log:
        entry = {"ts": time.time(), "profile": asdict(profile),
                 "endpoint_id": routed.endpoint_id, "model": routed.model,
                 "why": routed.why}
        _recent.append(entry)
        try:
            _append_log(entry)
        except Exception as e:  # observability must never break resolution
            logger.debug("router log write failed: %s", e)
    return routed


def _append_log(entry: dict) -> None:
    with _log_lock:
        os.makedirs(os.path.dirname(LOG_PATH) or ".", exist_ok=True)
        try:
            if os.path.getsize(LOG_PATH) > LOG_ROTATE_BYTES:
                os.replace(LOG_PATH, LOG_PATH + ".1")  # keep one generation
        except OSError:
            pass
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")


def recent_resolutions(limit: int = 50) -> list[dict]:
    """Most-recent-first log entries for /api/router/log. Falls back to the
    jsonl tail after a restart (the deque is process-local)."""
    limit = max(1, min(int(limit or 50), RECENT_MAX))
    entries = list(_recent)[-limit:]
    if not entries:
        try:
            with open(LOG_PATH, encoding="utf-8") as f:
                tail = f.readlines()[-limit:]
            entries = [json.loads(line) for line in tail if line.strip()]
        except (OSError, json.JSONDecodeError):
            entries = []
    return list(reversed(entries))


def resolution_table(owner: str | None = None) -> list[dict]:
    """The live tier→model table (F7 'routing is observable'), incl. a vision
    row. Probes do NOT write the log."""
    rows = []
    for tier in TIERS:
        row = {"tier": tier, "modality": "text"}
        try:
            r = resolve(TaskProfile(tier=tier), owner=owner, log=False)
            row.update({"endpoint_id": r.endpoint_id, "model": r.model,
                        "token_budget": r.token_budget, "why": r.why,
                        "degraded": "degraded" in r.why or "legacy" in r.why})
        except RouterError as e:
            row.update({"error": str(e)})
        rows.append(row)
    vrow = {"tier": "standard", "modality": "vision"}
    try:
        r = resolve(TaskProfile(tier="standard", modality="vision"), owner=owner, log=False)
        vrow.update({"endpoint_id": r.endpoint_id, "model": r.model,
                     "token_budget": r.token_budget, "why": r.why,
                     "degraded": "degraded" in r.why or "legacy" in r.why})
    except RouterError as e:
        vrow.update({"error": str(e)})
    rows.append(vrow)
    return rows


__all__ = [
    "TaskProfile", "RoutedModel", "RouterError", "RouterConfig",
    "resolve", "recent_resolutions", "resolution_table",
    "TIERS", "TIER_BUDGETS", "POLICIES",
]
