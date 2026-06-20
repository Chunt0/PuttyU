"""Health/liveness route. The first ride on the typed OpenAPI seam (Gate 1)."""

from fastapi import APIRouter
from pydantic import BaseModel

from core.config import APP_VERSION


class HealthResponse(BaseModel):
    status: str
    version: str


def setup_health_routes() -> APIRouter:
    router = APIRouter(prefix="/api", tags=["system"])

    @router.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(status="ok", version=APP_VERSION)

    return router
