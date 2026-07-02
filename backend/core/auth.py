"""Authentication (ADR-0001): bcrypt passwords, signed-cookie sessions backed
by the revocable `auth_session` table, and rate-limited login."""

from __future__ import annotations

import hashlib
import hmac
import time
from datetime import timedelta

import bcrypt
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .config import get_settings
from .database import get_session
from .models import AuthSession, User, utcnow

COOKIE_NAME = "puttyu_session"
SESSION_TTL = timedelta(days=30)

# Equalizes login timing when the username doesn't exist (ADR-0001:
# constant-time behavior, generic errors).
_DUMMY_HASH = bcrypt.hashpw(b"puttyu-dummy-password", bcrypt.gensalt())

# --- passwords ---------------------------------------------------------------


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def burn_password_check() -> None:
    """Spend the same time as a real check when the user doesn't exist."""
    bcrypt.checkpw(b"puttyu-dummy-password", _DUMMY_HASH)


# --- signed cookie <-> auth_session ------------------------------------------


def _sign(value: str) -> str:
    secret = get_settings().secret_key.encode()
    return hmac.new(secret, value.encode(), hashlib.sha256).hexdigest()


def cookie_value(session_id: str) -> str:
    return f"{session_id}.{_sign(session_id)}"


def parse_cookie(raw: str) -> str | None:
    """Return the session id iff the signature verifies."""
    session_id, _, signature = raw.partition(".")
    if session_id and signature and hmac.compare_digest(signature, _sign(session_id)):
        return session_id
    return None


def create_auth_session(db: Session, user: User) -> str:
    """Create a revocable session row; returns the signed cookie value."""
    session = AuthSession(owner=user.id, expires_at=utcnow() + SESSION_TTL)
    db.add(session)
    db.commit()
    return cookie_value(session.id)


def revoke_auth_session(db: Session, session_id: str) -> None:
    row = db.get(AuthSession, session_id)
    if row is not None:
        db.delete(row)
        db.commit()


def resolve_session_user(request: Request, db: Session) -> User | None:
    """The non-raising resolver: cookie -> live auth_session -> user."""
    raw = request.cookies.get(COOKIE_NAME)
    if not raw:
        return None
    session_id = parse_cookie(raw)
    if session_id is None:
        return None
    session = db.get(AuthSession, session_id)
    if session is None or session.expires_at <= utcnow():
        return None
    return db.get(User, session.owner)


def get_current_user(
    request: Request, db: Session = Depends(get_session)
) -> User:
    """FastAPI dependency: the authenticated owner, or 401."""
    user = resolve_session_user(request, db)
    if user is None:
        raise HTTPException(status_code=401, detail="unauthenticated")
    return user


# --- login rate limiting (ADR-0001) ------------------------------------------

_RATE_WINDOW_S = 60.0
_RATE_MAX_FAILURES = 5
_failed_logins: dict[str, list[float]] = {}


def rate_limit_check(username: str) -> None:
    """429 if this username has too many recent failures."""
    now = time.monotonic()
    recent = [t for t in _failed_logins.get(username, []) if now - t < _RATE_WINDOW_S]
    _failed_logins[username] = recent
    if len(recent) >= _RATE_MAX_FAILURES:
        raise HTTPException(status_code=429, detail="too_many_attempts")


def rate_limit_note_failure(username: str) -> None:
    _failed_logins.setdefault(username, []).append(time.monotonic())


def rate_limit_clear(username: str) -> None:
    _failed_logins.pop(username, None)
