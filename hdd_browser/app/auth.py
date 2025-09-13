from fastapi import APIRouter, Request, Form, Response, HTTPException
from fastapi.responses import RedirectResponse
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from starlette.status import HTTP_302_FOUND, HTTP_401_UNAUTHORIZED
from .config import get_settings
from typing import Optional
import time

router = APIRouter(prefix="/auth", tags=["auth"])

SESSION_COOKIE = "hdd_session"
SESSION_MAX_AGE = 3600 * 8  # 8 hours

def _serializer():
    settings = get_settings()
    return URLSafeTimedSerializer(settings.SESSION_SECRET, salt="hdd-browser-session")

def create_session(username: str) -> str:
    s = _serializer()
    return s.dumps({"u": username, "t": int(time.time())})

def verify_session(token: str) -> Optional[str]:
    s = _serializer()
    try:
        data = s.loads(token, max_age=SESSION_MAX_AGE)
        return data.get("u")
    except (BadSignature, SignatureExpired):
        return None

def current_user(request: Request) -> Optional[str]:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    return verify_session(token)

def require_user(request: Request):
    user = current_user(request)
    if not user:
        raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return user

@router.get("/login")
async def login_form(request: Request):
    if current_user(request):
        return RedirectResponse("/", status_code=HTTP_302_FOUND)
    from fastapi.templating import Jinja2Templates
    templates = Jinja2Templates(directory="hdd_browser/app/templates")
    return templates.TemplateResponse("login.html", {"request": request})

@router.post("/login")
async def login(
    request: Request,
    response: Response,
    username: str = Form(...),
    password: str = Form(...)
):
    settings = get_settings()
    if username == settings.AUTH_USERNAME and password == settings.AUTH_PASSWORD:
        token = create_session(username)
        r = RedirectResponse("/", status_code=HTTP_302_FOUND)
        r.set_cookie(SESSION_COOKIE, token, httponly=True, max_age=SESSION_MAX_AGE, secure=False)
        return r
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