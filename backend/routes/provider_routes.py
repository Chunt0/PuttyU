"""Provider (model_endpoint) CRUD (F7, ADR-0004). Keys are Fernet-encrypted at
rest and NEVER returned — responses carry has_api_key only (THREAT_MODEL S3)."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.auth import get_current_user
from core.crypto import encrypt_secret
from core.database import get_session
from core.models import ModelEndpoint, User, utcnow
from core.scoping import owner_scoped


class ModelSpec(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    context_window: int = Field(ge=1024, default=8192)
    vision: bool = False
    reasoning_class: Literal["micro", "light", "standard", "deep"] = "standard"
    structured: bool = True
    cost_in: float | None = None
    cost_out: float | None = None


class EndpointCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    provider: Literal["anthropic", "openai_compat", "ollama"]
    base_url: str = ""
    api_key: str | None = None
    api_key_env: str | None = None
    models: list[ModelSpec] = Field(min_length=1)
    enabled: bool = True


class EndpointUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    base_url: str | None = None
    api_key: str | None = None  # set = re-encrypt; "" clears
    api_key_env: str | None = None
    models: list[ModelSpec] | None = None
    enabled: bool | None = None


class EndpointOut(BaseModel):
    id: str
    name: str
    provider: str
    base_url: str
    has_api_key: bool
    api_key_env: str | None
    models: list[ModelSpec]
    enabled: bool


class OkResponse(BaseModel):
    ok: bool = True


def _out(row: ModelEndpoint) -> EndpointOut:
    return EndpointOut(
        id=row.id,
        name=row.name,
        provider=row.provider,
        base_url=row.base_url,
        has_api_key=bool(row.api_key_enc),
        api_key_env=row.api_key_env,
        models=[ModelSpec.model_validate(m) for m in (row.models or [])],
        enabled=row.enabled,
    )


def _get_owned(db: Session, user: User, endpoint_id: str) -> ModelEndpoint:
    row = db.scalar(
        owner_scoped(select(ModelEndpoint), ModelEndpoint, user).where(
            ModelEndpoint.id == endpoint_id
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="endpoint_not_found")
    return row


def setup_provider_routes() -> APIRouter:
    router = APIRouter(prefix="/api/model-endpoints", tags=["providers"])

    @router.get("", response_model=list[EndpointOut])
    def list_endpoints(
        user: User = Depends(get_current_user), db: Session = Depends(get_session)
    ) -> list[EndpointOut]:
        rows = db.scalars(
            owner_scoped(select(ModelEndpoint), ModelEndpoint, user)
        ).all()
        return [_out(row) for row in rows]

    @router.post("", response_model=EndpointOut)
    def create_endpoint(
        body: EndpointCreate,
        user: User = Depends(get_current_user),
        db: Session = Depends(get_session),
    ) -> EndpointOut:
        row = ModelEndpoint(
            owner=user.id,
            name=body.name,
            provider=body.provider,
            base_url=body.base_url,
            api_key_enc=encrypt_secret(body.api_key) if body.api_key else None,
            api_key_env=body.api_key_env,
            models=[m.model_dump() for m in body.models],
            enabled=body.enabled,
        )
        db.add(row)
        db.commit()
        return _out(row)

    @router.put("/{endpoint_id}", response_model=EndpointOut)
    def update_endpoint(
        endpoint_id: str,
        body: EndpointUpdate,
        user: User = Depends(get_current_user),
        db: Session = Depends(get_session),
    ) -> EndpointOut:
        row = _get_owned(db, user, endpoint_id)
        if body.name is not None:
            row.name = body.name
        if body.base_url is not None:
            row.base_url = body.base_url
        if body.api_key is not None:
            row.api_key_enc = encrypt_secret(body.api_key) if body.api_key else None
        if body.api_key_env is not None:
            row.api_key_env = body.api_key_env or None
        if body.models is not None:
            row.models = [m.model_dump() for m in body.models]
        if body.enabled is not None:
            row.enabled = body.enabled
        row.updated_at = utcnow()
        db.commit()
        return _out(row)

    @router.delete("/{endpoint_id}", response_model=OkResponse)
    def delete_endpoint(
        endpoint_id: str,
        user: User = Depends(get_current_user),
        db: Session = Depends(get_session),
    ) -> OkResponse:
        db.delete(_get_owned(db, user, endpoint_id))
        db.commit()
        return OkResponse()

    return router
