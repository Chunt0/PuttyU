"""ORM models (ADR-0004 conventions). Tables appear as their chunk lands.

Conventions: UUID4-hex TEXT PKs (app-side), `owner` on per-user tables (scoped
only via core.scoping.owner_scoped — Gate 5), UTC timestamps, JSON columns for
open-ended attributes.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


def new_id() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    """Naive UTC — ADR-0004 timestamps are UTC; SQLite stores naive datetimes."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(Base):
    """The owner/student. Permanently single-student (SPEC §2): v1 creates one
    row; a second row would only ever be a future admin/tutor role."""

    __tablename__ = "user"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    is_owner: Mapped[bool] = mapped_column(Boolean, default=True)
    settings: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AuthSession(Base):
    """A revocable login session (M0-PLAN §5), keyed by the signed cookie's
    session id. Distinct from `session` (a chat session, M0.4)."""

    __tablename__ = "auth_session"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    owner: Mapped[str] = mapped_column(String(32), index=True)  # FK -> user.id
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
