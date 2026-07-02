"""Server-side settings (ADR-0004 `setting` table): router policy and future
prefs. Owner-scoped key/value JSON."""

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.auth import get_current_user
from core.database import get_session
from core.models import Setting, User, utcnow
from core.scoping import owner_scoped
from engines.model_router import DEFAULT_ROUTER_CONFIG


class SettingsResponse(BaseModel):
    values: dict[str, Any]


class SettingsUpdate(BaseModel):
    values: dict[str, Any]


def setup_settings_routes() -> APIRouter:
    router = APIRouter(prefix="/api/settings", tags=["settings"])

    @router.get("", response_model=SettingsResponse)
    def get_settings_values(
        user: User = Depends(get_current_user), db: Session = Depends(get_session)
    ) -> SettingsResponse:
        rows = db.scalars(owner_scoped(select(Setting), Setting, user)).all()
        values: dict[str, Any] = {"router": dict(DEFAULT_ROUTER_CONFIG)}
        for row in rows:
            if row.key == "router" and isinstance(row.value, dict):
                values["router"] = {**DEFAULT_ROUTER_CONFIG, **row.value}
            else:
                values[row.key] = row.value
        return SettingsResponse(values=values)

    @router.put("", response_model=SettingsResponse)
    def put_settings_values(
        body: SettingsUpdate,
        user: User = Depends(get_current_user),
        db: Session = Depends(get_session),
    ) -> SettingsResponse:
        for key, value in body.values.items():
            row = db.scalar(
                owner_scoped(select(Setting), Setting, user).where(Setting.key == key)
            )
            if row is None:
                db.add(Setting(owner=user.id, key=key, value=value))
            else:
                row.value = value
                row.updated_at = utcnow()
        db.commit()
        return get_settings_values(user=user, db=db)

    return router
