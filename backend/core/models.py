"""ORM models (ADR-0004 conventions). Tables appear as their chunk lands.

Conventions: UUID4-hex TEXT PKs (app-side), `owner` on per-user tables (scoped
only via core.scoping.owner_scoped — Gate 5), UTC timestamps, JSON columns for
open-ended attributes.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, String, Text, UniqueConstraint
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


class Setting(Base):
    """Server-side prefs (router policy, etc. — ADR-0004). owner is nullable
    for future global rows; v1 writes owner-scoped rows only."""

    __tablename__ = "setting"
    __table_args__ = (UniqueConstraint("owner", "key"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    owner: Mapped[str | None] = mapped_column(String(32), index=True)
    key: Mapped[str] = mapped_column(String(64))
    value: Mapped[Any] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ModelEndpoint(Base):
    """A configured LLM provider + its models with capability tags (ADR-0004).
    API keys live Fernet-encrypted in api_key_enc, or by env-var name in
    api_key_env — never in plaintext, never returned to the client."""

    __tablename__ = "model_endpoint"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    owner: Mapped[str] = mapped_column(String(32), index=True)
    name: Mapped[str] = mapped_column(String(64))
    provider: Mapped[str] = mapped_column(String(32))  # anthropic|openai_compat|ollama
    base_url: Mapped[str] = mapped_column(Text, default="")
    api_key_enc: Mapped[str | None] = mapped_column(Text)
    api_key_env: Mapped[str | None] = mapped_column(String(64))
    # [{name, context_window, vision, reasoning_class, structured, cost_in, cost_out}]
    models: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
