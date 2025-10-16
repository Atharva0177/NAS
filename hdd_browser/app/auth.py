from fastapi import APIRouter, Request, Form, Response, HTTPException
from fastapi.responses import RedirectResponse
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from starlette.status import HTTP_302_FOUND, HTTP_401_UNAUTHORIZED
from .config import get_settings
from typing import Optional, List, Dict, Any
from pathlib import Path
import time
import json

router = APIRouter(prefix="/auth", tags=["auth"])

SESSION_COOKIE = "hdd_session"
SESSION_MAX_AGE = 3600 * 8  # 8 hours

def _serializer():
    settings = get_settings()
    return URLSafeTimedSerializer(settings.SESSION_SECRET, salt="hdd-browser-session")

def create_session(username: str, roles: Optional[List[str]] = None, roots: Optional[List[str]] = None) -> str:
    s = _serializer()
    payload: Dict[str, Any] = {"u": username, "t": int(time.time())}
    if roles:
        payload["r"] = roles
    if roots:
        payload["ar"] = roots  # allowed roots for this user
    return s.dumps(payload)

def decode_session(token: str) -> Optional[Dict[str, Any]]:
    s = _serializer()
    try:
        return s.loads(token, max_age=SESSION_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None

def verify_session(token: str) -> Optional[str]:
    data = decode_session(token)
    if not data:
        return None
    return data.get("u")

def current_user(request: Request) -> Optional[str]:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    return verify_session(token)

def user_info(request: Request) -> Optional[Dict[str, Any]]:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    data = decode_session(token)
    if not data:
        return None
    # Normalize expected fields
    info = {
        "u": data.get("u"),
        "r": data.get("r") or [],
        "ar": data.get("ar") or [],
    }
    return info

def require_user(request: Request):
    user = current_user(request)
    if not user:
        raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return user

@router.get("/login")
async def login_form(request: Request):
    from fastapi.templating import Jinja2Templates
    templates = Jinja2Templates(directory="hdd_browser/app/templates")
    settings = get_settings()
    return templates.TemplateResponse("login.html", {"request": request, "settings": settings})

@router.post("/login")
async def login(
    request: Request,
    response: Response,
    username: str = Form(...),
    password: str = Form(...)
):
    settings = get_settings()

    # 1) Multi-user JSON mode (preferred if provided)
    users = []
    if settings.USERS_JSON.strip():
        try:
            users = json.loads(settings.USERS_JSON)
        except Exception:
            users = []

    if users:
        for u in users:
            if not isinstance(u, dict):
                continue
            if u.get("username") == username and u.get("password") == password:
                roles = u.get("roles") or ["viewer"]

                # New: per-user allowed roots from USERS_JSON; normalize to absolute strings
                roots_raw = u.get("roots") or u.get("allowed_roots") or []
                roots: List[str] = []
                if isinstance(roots_raw, list):
                    for p in roots_raw:
                        if isinstance(p, str) and p.strip():
                            try:
                                roots.append(str(Path(p).expanduser().resolve()))
                            except Exception:
                                # skip invalid/failed normalization
                                pass

                token = create_session(username, roles, roots)
                r = RedirectResponse("/", status_code=HTTP_302_FOUND)
                r.set_cookie(SESSION_COOKIE, token, httponly=True, max_age=SESSION_MAX_AGE, secure=False)
                return r
    else:
        # 2) Legacy single-user mode (fallback)
        if username == settings.AUTH_USERNAME and password == settings.AUTH_PASSWORD:
            # In legacy mode, grant admin role to keep parity with previous unrestricted behavior
            token = create_session(username, ["admin"])
            r = RedirectResponse("/", status_code=HTTP_302_FOUND)
            r.set_cookie(SESSION_COOKIE, token, httponly=True, max_age=SESSION_MAX_AGE, secure=False)
            return r

    # On failure, re-render login
    from fastapi.templating import Jinja2Templates
    templates = Jinja2Templates(directory="hdd_browser/app/templates")
    return templates.TemplateResponse(
        "login.html",
        {"request": request, "error": "Invalid credentials"},
        status_code=401
    )

@router.post("/logout")
async def logout():
    r = RedirectResponse("/auth/login", status_code=HTTP_302_FOUND)
    r.delete_cookie(SESSION_COOKIE)
    return r