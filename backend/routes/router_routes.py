"""Router observability (F7): the live resolution table and an endpoint probe.
No silent degradation — below-preferred and unavailable tiers are visible."""

import os

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.auth import get_current_user
from core.crypto import SecretDecryptError, decrypt_secret
from core.database import get_session
from core.models import ModelEndpoint, User
from engines.model_router import resolution_table


class TierRow(BaseModel):
    tier: str
    available: bool
    endpoint_id: str | None
    endpoint_name: str | None
    model: str | None
    token_budget: int | None
    below_preferred: bool
    pinned: bool
    reason: str | None


class ResolutionResponse(BaseModel):
    tiers: list[TierRow]


class RouterTestRequest(BaseModel):
    endpoint_id: str


class RouterTestResponse(BaseModel):
    ok: bool
    detail: str


def _api_key_for(row: ModelEndpoint) -> str | None:
    if row.api_key_enc:
        return decrypt_secret(row.api_key_enc)
    if row.api_key_env:
        return os.environ.get(row.api_key_env)
    return None


def _probe(row: ModelEndpoint) -> RouterTestResponse:
    """Cheap reachability/auth probe per provider type."""
    base = row.base_url.rstrip("/")
    try:
        with httpx.Client(timeout=8.0) as client:
            if row.provider == "ollama":
                response = client.get(f"{base}/api/tags")
            elif row.provider == "openai_compat":
                key = _api_key_for(row)
                headers = {"Authorization": f"Bearer {key}"} if key else {}
                response = client.get(f"{base}/models", headers=headers)
            elif row.provider == "anthropic":
                key = _api_key_for(row)
                if not key:
                    return RouterTestResponse(ok=False, detail="no API key configured")
                if not (row.models or []):
                    return RouterTestResponse(ok=False, detail="no models configured")
                response = client.post(
                    f"{base or 'https://api.anthropic.com'}/v1/messages",
                    headers={
                        "x-api-key": key,
                        "anthropic-version": "2023-06-01",
                    },
                    json={
                        "model": row.models[0]["name"],
                        "max_tokens": 1,
                        "messages": [{"role": "user", "content": "ping"}],
                    },
                )
            else:  # pragma: no cover — API forbids other providers
                return RouterTestResponse(ok=False, detail="unknown provider")
        if response.status_code < 400:
            return RouterTestResponse(ok=True, detail="reachable")
        return RouterTestResponse(
            ok=False, detail=f"HTTP {response.status_code} from {row.provider}"
        )
    except SecretDecryptError as exc:
        return RouterTestResponse(ok=False, detail=str(exc))
    except httpx.HTTPError as exc:
        return RouterTestResponse(ok=False, detail=f"unreachable: {exc.__class__.__name__}")


def setup_router_routes() -> APIRouter:
    router = APIRouter(prefix="/api/router", tags=["router"])

    @router.get("/resolution", response_model=ResolutionResponse)
    def get_resolution(
        user: User = Depends(get_current_user), db: Session = Depends(get_session)
    ) -> ResolutionResponse:
        return ResolutionResponse(
            tiers=[TierRow.model_validate(r) for r in resolution_table(db, user)]
        )

    @router.post("/test", response_model=RouterTestResponse)
    def test_endpoint(
        body: RouterTestRequest,
        user: User = Depends(get_current_user),
        db: Session = Depends(get_session),
    ) -> RouterTestResponse:
        from routes.provider_routes import _get_owned

        row = _get_owned(db, user, body.endpoint_id)
        if row.provider == "fake":  # pragma: no cover
            return RouterTestResponse(ok=True, detail="fake provider")
        return _probe(row)

    return router
