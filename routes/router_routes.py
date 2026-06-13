# routes/router_routes.py
"""Model-router settings + observability routes (Phase-2 T2a — SPEC F7).

Born small and typed (Gates 6b/6c). The config is data (data/router.json):
GET/PUT mirror it, /resolution shows the LIVE tier→model table (incl.
degradation notes — no silent degradation), /log shows recent resolutions.
"""

import logging

from fastapi import APIRouter, HTTPException, Query, Request

from src.auth_helpers import require_user
from src.model_router import (
    POLICIES,
    RouterConfig,
    recent_resolutions,
    resolution_table,
)
from src.request_models import (
    RouterConfigResponse,
    RouterConfigUpdateRequest,
    RouterLogResponse,
    RouterResolutionResponse,
)

logger = logging.getLogger(__name__)


def setup_router_routes() -> APIRouter:
    router = APIRouter(prefix="/api/router", tags=["router"])

    @router.get("/config", response_model=RouterConfigResponse)
    def get_config(request: Request):
        require_user(request)
        cfg = RouterConfig().load()
        return {**cfg, "configured": RouterConfig.is_configured(cfg)}

    @router.put("/config", response_model=RouterConfigResponse)
    def put_config(request: Request, body: RouterConfigUpdateRequest):
        """Update the policy dial / per-tier pins / capability table. Omitted
        fields keep their current value; saved atomically (core/atomic_io)."""
        require_user(request)
        if body.policy is not None and body.policy not in POLICIES:
            raise HTTPException(400, f"policy must be one of {', '.join(POLICIES)}")
        store = RouterConfig()
        cfg = store.load()
        if body.policy is not None:
            cfg["policy"] = body.policy
        if body.pins is not None:
            cfg["pins"] = {k: v.model_dump() for k, v in body.pins.items()}
        if body.capabilities is not None:
            cfg["capabilities"] = {
                k: v.model_dump(exclude_none=True) for k, v in body.capabilities.items()
            }
        saved = store.save(cfg)
        return {**saved, "configured": RouterConfig.is_configured(saved)}

    @router.get("/resolution", response_model=RouterResolutionResponse)
    def get_resolution(request: Request):
        """The live tier→endpoint/model table, including nearest-tier and
        legacy-chain degradation notes and the vision row (setup hint on error)."""
        user = require_user(request)
        cfg = RouterConfig().load()
        return {
            "policy": cfg.get("policy", "local_first"),
            "configured": RouterConfig.is_configured(cfg),
            "rows": resolution_table(owner=user or None),
        }

    @router.get("/log", response_model=RouterLogResponse)
    def get_log(request: Request, limit: int = Query(50, ge=1, le=200)):
        require_user(request)
        return {"entries": recent_resolutions(limit)}

    return router
