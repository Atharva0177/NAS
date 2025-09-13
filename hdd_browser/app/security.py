from urllib.parse import quote
from fastapi import Request
from starlette.responses import RedirectResponse, JSONResponse
from typing import Iterable

# Paths that do NOT require authentication:
PUBLIC_PATH_PREFIXES: Iterable[str] = (
    "/auth/login",
    "/auth/logout",
    "/static/",      # keep static public so login page loads styles/js
    "/favicon.ico",
)

# If you want /healthz still public, add "/healthz" above.
# If you want absolutely everything protected (even CSS), remove "/static/" (be careful—login page will break unless you inline CSS or special-case static).

def is_public_path(path: str) -> bool:
    if path == "/":
        return False  # We want root protected
    for prefix in PUBLIC_PATH_PREFIXES:
        if path.startswith(prefix):
            return True
    return False

def unauthenticated_response(request: Request):
    path = request.url.path
    # APIs: JSON 401
    if path.startswith("/api/"):
        return JSONResponse({"detail": "Not authenticated"}, status_code=401)
    # Normal pages: redirect to login with next
    return RedirectResponse(
        f"/auth/login?next={quote(path)}",
        status_code=303
    )