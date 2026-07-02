"""Auth routes (ADR-0001, DESIGN-M0-M1 §4): first-run setup, login, logout, me.

Flow: SPA loads -> GET /api/auth/me. 409 needs_setup -> setup screen;
401 -> login; 200 -> in.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.auth import (
    COOKIE_NAME,
    SESSION_TTL,
    burn_password_check,
    create_auth_session,
    hash_password,
    parse_cookie,
    rate_limit_check,
    rate_limit_clear,
    rate_limit_note_failure,
    resolve_session_user,
    revoke_auth_session,
    verify_password,
)
from core.database import get_session
from core.models import User


class Credentials(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=8, max_length=128)


class MeResponse(BaseModel):
    id: str
    username: str


class OkResponse(BaseModel):
    ok: bool = True


def _user_count(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(User)) or 0


def _set_session_cookie(response: Response, value: str) -> None:
    # secure=False: v1 runs on localhost/LAN over http; HTTPS is the operator's
    # job off-localhost (ADR-0001 / THREAT_MODEL S4).
    response.set_cookie(
        COOKIE_NAME,
        value,
        max_age=int(SESSION_TTL.total_seconds()),
        httponly=True,
        samesite="lax",
        path="/",
    )


def setup_auth_routes() -> APIRouter:
    router = APIRouter(prefix="/api/auth", tags=["auth"])

    @router.get("/me", response_model=MeResponse)
    def me(request: Request, db: Session = Depends(get_session)) -> MeResponse:
        if _user_count(db) == 0:
            raise HTTPException(status_code=409, detail="needs_setup")
        user = resolve_session_user(request, db)
        if user is None:
            raise HTTPException(status_code=401, detail="unauthenticated")
        return MeResponse(id=user.id, username=user.username)

    @router.post("/setup", response_model=OkResponse)
    def setup(body: Credentials, db: Session = Depends(get_session)) -> OkResponse:
        if _user_count(db) > 0:
            raise HTTPException(status_code=409, detail="already_setup")
        db.add(
            User(
                username=body.username,
                password_hash=hash_password(body.password),
                is_owner=True,
            )
        )
        db.commit()
        return OkResponse()

    @router.post("/login", response_model=MeResponse)
    def login(
        body: Credentials, response: Response, db: Session = Depends(get_session)
    ) -> MeResponse:
        rate_limit_check(body.username)
        user = db.scalar(select(User).where(User.username == body.username))
        if user is None:
            burn_password_check()  # equalize timing for unknown usernames
            rate_limit_note_failure(body.username)
            raise HTTPException(status_code=401, detail="invalid_credentials")
        if not verify_password(body.password, user.password_hash):
            rate_limit_note_failure(body.username)
            raise HTTPException(status_code=401, detail="invalid_credentials")
        rate_limit_clear(body.username)
        _set_session_cookie(response, create_auth_session(db, user))
        return MeResponse(id=user.id, username=user.username)

    @router.post("/logout", response_model=OkResponse)
    def logout(
        request: Request, response: Response, db: Session = Depends(get_session)
    ) -> OkResponse:
        raw = request.cookies.get(COOKIE_NAME)
        if raw:
            session_id = parse_cookie(raw)
            if session_id:
                revoke_auth_session(db, session_id)
        response.delete_cookie(COOKIE_NAME, path="/")
        return OkResponse()

    return router
