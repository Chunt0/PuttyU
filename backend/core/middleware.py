"""HTTP middleware (SPEC §5.3). Pure ASGI (no BaseHTTPMiddleware) so streaming
responses (SSE at M0.4) are never buffered."""

from __future__ import annotations

import json

CSRF_HEADER = b"x-puttyu-csrf"
_MUTATING = {"POST", "PUT", "PATCH", "DELETE"}


class CSRFMiddleware:
    """Cookie-auth mutations must carry the `X-PuttyU-CSRF` header (ADR-0001).

    SameSite=Lax already blocks cross-site form POSTs; requiring a custom
    header adds depth — cross-origin JS can't set one without passing CORS
    preflight. The SPA sets it on every request; same-origin curl users add it
    by hand.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] == "http"
            and scope["method"] in _MUTATING
            and scope["path"].startswith("/api")
            and not any(name == CSRF_HEADER for name, _ in scope["headers"])
        ):
            body = json.dumps({"detail": "missing_csrf_header"}).encode()
            await send(
                {
                    "type": "http.response.start",
                    "status": 403,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode()),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": body})
            return
        await self.app(scope, receive, send)
