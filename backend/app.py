"""PuttyU backend — slim FastAPI orchestrator (SPEC §5.3).

Middleware → routers → lifespan. No business logic here.
Run from `backend/`:  uv run uvicorn app:app --reload
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import APP_VERSION, get_settings
from core.database import init_db
from routes.health_routes import setup_health_routes


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


def create_app() -> FastAPI:
    get_settings()  # validate env early
    app = FastAPI(title="PuttyU", version=APP_VERSION, lifespan=lifespan)

    # Dev: the Vite dev server is a separate origin. In prod the SPA is served
    # same-origin by FastAPI (M0-PLAN §1), so this is dev-only convenience.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(setup_health_routes())
    return app


app = create_app()
