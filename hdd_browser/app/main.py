"""
Main FastAPI application (protected).

All non‑public paths require authentication. A user is considered
authenticated if `request.session["user"]` is set (handled by auth router).

Public (unauthenticated) paths are defined in `security.py`:
  - /auth/login (GET/POST)
  - /auth/logout (if you allow showing logout when not logged in)
  - /static/*
  - /favicon.ico
  - (optionally /healthz if you include it there)

Anything else:
  - If path starts with /api/ and user not logged in => 401 JSON
  - Otherwise => redirect to /auth/login?next=<original_path>

Defense in depth:
  - Middleware blocks unauthorized access globally
  - Route handlers still call `require_user` for explicit protection
    (you can remove those calls if you trust the middleware completely)

Update `security.py` to adjust what is public.
"""

import io
import mimetypes
from pathlib import Path
from typing import Optional, Tuple, List

from fastapi import (
    FastAPI,
    Request,
    Query,
    UploadFile,
    File,
    Form,
    HTTPException
)
from fastapi.responses import (
    HTMLResponse,
    FileResponse,
    StreamingResponse,
    JSONResponse,
    RedirectResponse,
    Response
)
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware

from PIL import Image, ImageOps  # Image handling / HEIC conversion

from .config import get_settings
from .auth import router as auth_router, require_user, current_user
# Optional roles support (for can_upload flag). Falls back gracefully if not present.
try:
    from .auth import user_info as _user_info  # provided by the multi-user/roles edit
    _HAVE_USER_INFO = True
except Exception:
    _user_info = None
    _HAVE_USER_INFO = False

from .security import is_public_path, unauthenticated_response
from .drive_discovery import discover_drives, resolve_drive_root
from .file_ops import (
    safe_join,
    list_directory,
    preview_file,
    search,
    delete_path,
    save_upload
)
from .thumbnailer import get_thumbnail
from .heic_init import init_heic
from .admin import router as admin_router  # Admin dashboard/API

# ---------------------------------------------------------------------------
# Settings / Initialization
# ---------------------------------------------------------------------------
# Initialize once for app title and session secret; feature flags will be read per request.
_s0 = get_settings()
init_heic()

app = FastAPI(title=_s0.APP_NAME)

# Session middleware MUST come before auth_gate executes.
# Adjust cookie params as needed (secure=True if HTTPS only).
app.add_middleware(
    SessionMiddleware,
    secret_key=_s0.SESSION_SECRET,
    same_site="lax",
    https_only=False,  # Set True when serving strictly over HTTPS
    max_age=60 * 60 * 8  # 8h session (adjust as desired)
)

# Templates & Static
templates_path = Path("hdd_browser/app/templates")
static_path = Path("hdd_browser/app/static")

templates = Jinja2Templates(directory=str(templates_path))

# Dynamic settings proxy so templates always see latest values without restart
class _SettingsProxy:
    def __getattr__(self, name):
        return getattr(get_settings(), name)

templates.env.globals["settings"] = _SettingsProxy()

# Expose a helper to Jinja to check if current request user is admin
def _get_user_roles(request: Request):
    if _HAVE_USER_INFO and _user_info:
        try:
            info = _user_info(request) or {}
            roles = info.get("r") or []
            if isinstance(roles, list):
                return set(roles)
        except Exception:
            return set()
    return set()

def _tmpl_is_admin(request: Request) -> bool:
    try:
        return "admin" in _get_user_roles(request)
    except Exception:
        return False

templates.env.globals["is_admin"] = _tmpl_is_admin

app.mount("/static", StaticFiles(directory=str(static_path)), name="static")

# Routers
app.include_router(auth_router)
app.include_router(admin_router)

# ---------------------------------------------------------------------------
# Helper: Determine per-request allowed roots (intersection of user and global)
# ---------------------------------------------------------------------------
def _user_allowed_roots(request: Request) -> List[Path]:
    """
    Compute the effective allowed roots for the current user:
      - If the session provides 'ar' (allowed roots), intersect with global ALLOWED_ROOTS.
      - If not, fall back to global ALLOWED_ROOTS.
    """
    s = get_settings()
    global_roots = [p.resolve() for p in (s.allowed_roots or [])]

    if not (_HAVE_USER_INFO and _user_info):
        return global_roots

    info = _user_info(request) or {}
    user_root_strs = info.get("ar") or []
    user_roots: List[Path] = []
    for r in user_root_strs:
        try:
            user_roots.append(Path(r).expanduser().resolve())
        except Exception:
            pass

    if not user_roots:
        return global_roots

    if not global_roots:
        return user_roots

    # Intersection: keep only user roots that are within a global root
    out: List[Path] = []
    for ur in user_roots:
        if any(str(ur).startswith(str(gr)) for gr in global_roots):
            out.append(ur)
    return out or global_roots

# ---------------------------------------------------------------------------
# Helper: Determine if current user can upload or delete (UI flags)
# ---------------------------------------------------------------------------
def _can_user_upload(request: Request) -> bool:
    s = get_settings()
    if not s.ENABLE_UPLOAD:
        return False
    roles = _get_user_roles(request)
    if roles:
        return ("admin" in roles) or ("uploader" in roles)
    # Legacy single-user mode (no roles): allow uploads for any logged-in user when globally enabled
    return True

def _can_user_delete(request: Request) -> bool:
    s = get_settings()
    if not s.ENABLE_DELETE:
        return False
    roles = _get_user_roles(request)
    if roles:
        return ("admin" in roles) or ("deleter" in roles)
    return True


# ---------------------------------------------------------------------------
# Authentication Gate (Global)
# ---------------------------------------------------------------------------
@app.middleware("http")
async def auth_gate(request: Request, call_next):
    """
    Global auth enforcement.
    - Public paths pass through unchanged
    - Authenticated users pass
    - Others get redirect (HTML) or 401 (API)
    """
    path = request.url.path

    if is_public_path(path):
        return await call_next(request)

    if current_user(request):
        return await call_next(request)

    return unauthenticated_response(request)


# ---------------------------------------------------------------------------
# Security Headers Middleware
# (Kept separate so auth logic runs first; order not critical here)
# ---------------------------------------------------------------------------
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    # You could optionally add a CSP:
    # response.headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' data: blob:;"
    return response


# ---------------------------------------------------------------------------
# Favicon (public)
# ---------------------------------------------------------------------------
@app.get("/favicon.ico")
async def favicon():
    # 1x1 transparent PNG
    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc``\x00\x00"
        b"\x00\x02\x00\x01\xe2!\xbc3\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    return Response(png_bytes, media_type="image/png")


# ---------------------------------------------------------------------------
# Page Routes (HTML) - all protected (middleware + explicit check)
# ---------------------------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    user = current_user(request)
    if not user:
        return RedirectResponse("/auth/login")
    # Pass fresh settings each render
    return templates.TemplateResponse("index.html", {"request": request, "user": user, "settings": get_settings()})

@app.get("/browse", response_class=HTMLResponse)
async def browse_page(
    request: Request,
    drive_id: Optional[str] = Query(None),
    path: Optional[str] = Query(None)
):
    user = require_user(request)
    can_upload = _can_user_upload(request)
    can_delete = _can_user_delete(request)  # pass delete permission to template
    # Pass fresh settings each render
    return templates.TemplateResponse(
        "browse.html",
        {"request": request, "user": user, "can_upload": can_upload, "can_delete": can_delete, "settings": get_settings()}
    )

@app.get("/search", response_class=HTMLResponse)
async def search_page(request: Request):
    user = require_user(request)
    # Pass fresh settings each render (in case templates reference it)
    return templates.TemplateResponse("search.html", {"request": request, "user": user, "settings": get_settings()})


# ---------------------------------------------------------------------------
# API: Drives & Listing
# ---------------------------------------------------------------------------
@app.get("/api/drives")
async def api_drives(request: Request):
    require_user(request)
    allowed = _user_allowed_roots(request)
    return discover_drives(allowed_override=allowed)

@app.get("/api/list")
async def api_list(
    request: Request,
    drive_id: str = Query(...),
    rel_path: str = Query("", description="Relative path inside drive")
):
    require_user(request)
    allowed = _user_allowed_roots(request)
    root = resolve_drive_root(drive_id, allowed_override=allowed)
    target = safe_join(root, rel_path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="Not found")
    if not target.is_dir():
        raise HTTPException(status_code=400, detail="Not a directory")
    return {
        "drive_id": drive_id,
        "root": str(root),
        "path": str(target),
        "entries": list_directory(target)
    }


# ---------------------------------------------------------------------------
# API: File Preview / Download
# ---------------------------------------------------------------------------
@app.get("/api/preview")
async def api_preview(
    request: Request,
    drive_id: str,
    rel_path: str
):
    require_user(request)
    allowed = _user_allowed_roots(request)
    root = resolve_drive_root(drive_id, allowed_override=allowed)
    target = safe_join(root, rel_path)
    if not target.is_file():
        raise HTTPException(status_code=400, detail="Not a file")
    s = get_settings()
    return preview_file(target, s.MAX_TEXT_PREVIEW_BYTES)

@app.get("/api/download")
async def api_download(
    request: Request,
    drive_id: str,
    rel_path: str
):
    require_user(request)
    allowed = _user_allowed_roots(request)
    root = resolve_drive_root(drive_id, allowed_override=allowed)
    target = safe_join(root, rel_path)
    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(str(target), filename=target.name)

# NEW: Inline view endpoint for embedding in <iframe> (e.g., PDFs)
@app.get("/api/view")
async def api_view(
    request: Request,
    drive_id: str,
    rel_path: str
):
    require_user(request)
    allowed = _user_allowed_roots(request)
    root = resolve_drive_root(drive_id, allowed_override=allowed)
    target = safe_join(root, rel_path)
    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    mime = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    headers = {
        # Inline so browsers can display (PDF/image/text) inside iframe
        "Content-Disposition": f'inline; filename="{target.name}"'
    }
    return FileResponse(str(target), media_type=mime, headers=headers)


# ---------------------------------------------------------------------------
# Video / Large File Streaming with Range
# ---------------------------------------------------------------------------
def parse_range(range_header: str, file_size: int) -> Optional[Tuple[int, int]]:
    """
    Parse a single HTTP Range header (bytes=) into (start, end) inclusive.
    Supports:
      bytes=start-end
      bytes=start-
      bytes=-suffix
    Returns None if invalid or multi-range.
    """
    if not range_header or not range_header.startswith("bytes="):
        return None
    spec = range_header[len("bytes="):].strip()
    if "," in spec:
        return None  # multi-range not implemented
    if spec.startswith("-"):
        # suffix range
        try:
            length = int(spec[1:])
            if length <= 0:
                return None
            if length > file_size:
                length = file_size
            return file_size - length, file_size - 1
        except ValueError:
            return None
    parts = spec.split("-")
    if len(parts) != 2:
        return None
    try:
        start = int(parts[0]) if parts[0] else 0
        end = int(parts[1]) if parts[1] else file_size - 1
        if start > end or start >= file_size:
            return None
        if end >= file_size:
            end = file_size - 1
        return start, end
    except ValueError:
        return None

@app.get("/api/stream")
async def api_stream(
    request: Request,
    drive_id: str,
    rel_path: str
):
    require_user(request)
    allowed = _user_allowed_roots(request)
    root = resolve_drive_root(drive_id, allowed_override=allowed)
    target = safe_join(root, rel_path)
    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    mime = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    file_size = target.stat().st_size
    range_header = request.headers.get("range")
    range_tuple = parse_range(range_header, file_size) if range_header else None

    CHUNK = 64 * 1024

    async def async_range_stream(start: int, end: int):
        bytes_left = end - start + 1
        try:
            with open(target, "rb") as f:
                f.seek(start)
                while bytes_left > 0:
                    if await request.is_disconnected():
                        break
                    to_read = min(CHUNK, bytes_left)
                    data = f.read(to_read)
                    if not data:
                        break
                    bytes_left -= len(data)
                    yield data
        except (ConnectionResetError, BrokenPipeError):
            return

    async def async_full_stream():
        try:
            with open(target, "rb") as f:
                while True:
                    if await request.is_disconnected():
                        break
                    data = f.read(CHUNK)
                    if not data:
                        break
                    yield data
        except (ConnectionResetError, BrokenPipeError):
            return

    if range_tuple:
        start, end = range_tuple
        content_length = end - start + 1
        headers = {
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(content_length),
        }
        return StreamingResponse(
            async_range_stream(start, end),
            status_code=206,
            media_type=mime,
            headers=headers
        )

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(file_size),
    }
    return StreamingResponse(async_full_stream(), status_code=200, media_type=mime, headers=headers)


# ---------------------------------------------------------------------------
# API: Search
# ---------------------------------------------------------------------------
@app.get("/api/search")
async def api_search(
    request: Request,
    drive_id: str,
    query: str,
    depth: int = Query(None),
    limit: int = Query(None)
):
    require_user(request)
    s = get_settings()
    allowed = _user_allowed_roots(request)
    root = resolve_drive_root(drive_id, allowed_override=allowed)
    depth = depth or s.SEARCH_DEFAULT_DEPTH
    limit = min(limit or s.MAX_SEARCH_RESULTS, s.MAX_SEARCH_RESULTS)
    return {
        "drive_id": drive_id,
        "query": query,
        "results": search(root, query, limit, depth)
    }


# ---------------------------------------------------------------------------
# API: Delete / Upload
# ---------------------------------------------------------------------------
@app.post("/api/delete")
async def api_delete(
    request: Request,
    drive_id: str = Form(...),
    rel_path: str = Form(...),
    recursive: int = Form(0)  # 0/1 from client; treat non-zero as True
):
    require_user(request)
    s = get_settings()
    if not s.ENABLE_DELETE:
        raise HTTPException(status_code=403, detail="Delete disabled")

    # Enforce roles (admin or deleter) when roles are present
    roles = _get_user_roles(request)
    if roles and not (("admin" in roles) or ("deleter" in roles)):
        raise HTTPException(status_code=403, detail="Not authorized to delete")

    allowed = _user_allowed_roots(request)
    root = resolve_drive_root(drive_id, allowed_override=allowed)
    target = safe_join(root, rel_path)
    # For safety, never allow deleting the drive root itself
    if target == root:
        raise HTTPException(status_code=400, detail="Cannot delete drive root")

    if not target.exists():
        raise HTTPException(status_code=404, detail="Not found")

    # delete_path now supports recursive deletion
    delete_path(target, recursive=bool(recursive))
    return {"status": "ok"}

@app.post("/api/upload")
async def api_upload(
    request: Request,
    drive_id: str = Form(...),
    rel_path: str = Form(...),
    file: UploadFile = File(...)
):
    require_user(request)
    s = get_settings()
    if not s.ENABLE_UPLOAD:
        raise HTTPException(status_code=403, detail="Upload disabled")
    allowed = _user_allowed_roots(request)
    root = resolve_drive_root(drive_id, allowed_override=allowed)
    target_dir = safe_join(root, rel_path or "")
    # If the path exists but is not a directory, reject
    if target_dir.exists() and not target_dir.is_dir():
        raise HTTPException(status_code=400, detail="Target path not dir")
    # Ensure nested directories are created for folder uploads
    target_dir.mkdir(parents=True, exist_ok=True)
    data = await file.read()
    saved = save_upload(target_dir, file.filename, data)
    return {"status": "ok", "path": str(saved)}


# ---------------------------------------------------------------------------
# API: Thumbnails (with client cache hints)
# ---------------------------------------------------------------------------
@app.get("/api/thumb")
async def api_thumb(
    request: Request,
    drive_id: str,
    rel_path: str,
    size: int = 0,
    refresh: int = 0
):
    require_user(request)
    allowed = _user_allowed_roots(request)
    root = resolve_drive_root(drive_id, allowed_override=allowed)
    target = safe_join(root, rel_path)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    s = get_settings()
    max_dim = size if (size and 16 < size <= 2048) else s.THUMB_MAX_DIM
    try:
        data, mime, placeholder = get_thumbnail(
            target,
            max_dim=max_dim,
            allow_cache=True,
            refresh=bool(refresh)
        )
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        if s.DEBUG:
            raise HTTPException(status_code=500, detail=f"Thumbnail error: {e}")
        raise HTTPException(status_code=500, detail="Thumbnail error")
    headers = {}
    if placeholder:
        headers["X-Thumb-Placeholder"] = "1"
    # Encourage browser caching for faster subsequent loads
    headers["Cache-Control"] = "public, max-age=604800, immutable"
    return Response(content=data, media_type=mime, headers=headers)


# ---------------------------------------------------------------------------
# API: Render Image (HEIC -> JPEG / Optional Resize)
# ---------------------------------------------------------------------------
@app.get("/api/render_image")
async def api_render_image(
    request: Request,
    drive_id: str = Query(...),
    rel_path: str = Query(...),
    max_dim: int = Query(0, description="Resize largest dimension (0 = original size if non-HEIC)")
):
    require_user(request)
    allowed = _user_allowed_roots(request)
    root = resolve_drive_root(drive_id, allowed_override=allowed)
    target = safe_join(root, rel_path)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="Not found")

    suffix = target.suffix.lower()
    heic_like = suffix in {".heic", ".heif"}

    try:
        from pillow_heif import register_heif_opener  # type: ignore
        register_heif_opener()
    except Exception:
        if heic_like:
            raise HTTPException(status_code=500, detail="HEIC support not available (install pillow-heif).")

    try:
        with Image.open(target) as im:
            s = get_settings()
            if heic_like and not getattr(s, "ENABLE_HEIC_CONVERSION", True):
                raise HTTPException(status_code=400, detail="HEIC conversion disabled")

            # Respect orientation
            try:
                im = ImageOps.exif_transpose(im)
            except Exception:
                pass

            if max_dim and max_dim > 0:
                im.thumbnail((max_dim, max_dim))

            out = io.BytesIO()
            if heic_like:
                if im.mode not in ("RGB", "L"):
                    im = im.convert("RGB")
                im.save(out, format="JPEG", quality=86, optimize=True)
                return Response(content=out.getvalue(), media_type="image/jpeg")
            else:
                if max_dim and max_dim > 0:
                    # Force re-encode for resized variants
                    if im.mode == "RGBA":
                        im.save(out, format="PNG", optimize=True)
                        return Response(content=out.getvalue(), media_type="image/png")
                    if im.mode not in ("RGB", "L"):
                        im = im.convert("RGB")
                    im.save(out, format="JPEG", quality=88, optimize=True)
                    return Response(content=out.getvalue(), media_type="image/jpeg")

                mime = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
                return FileResponse(str(target), filename=target.name, media_type=mime)

    except HTTPException:
        raise
    except Exception as e:
        s = get_settings()
        if s.DEBUG:
            raise HTTPException(status_code=500, detail=f"Render error: {e}")
        raise HTTPException(status_code=500, detail="Render error")


# ---------------------------------------------------------------------------
# Health (decide if public or protected by editing is_public_path in security.py)
# ---------------------------------------------------------------------------
@app.get("/healthz")
async def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------
def run():
    import uvicorn
    s = get_settings()
    uvicorn.run(
        "hdd_browser.app.main:app",
        host=s.HOST,
        port=s.PORT,
        reload=getattr(s, "DEBUG", False)
    )


if __name__ == "__main__":
    run()