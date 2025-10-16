from __future__ import annotations

import os
import time
import asyncio
from pathlib import Path
from typing import Dict, List, Tuple, Optional

from fastapi import APIRouter, Request, HTTPException, Form
from fastapi.responses import JSONResponse, HTMLResponse, PlainTextResponse
from fastapi.templating import Jinja2Templates

from .auth import require_user, user_info
from .config import get_settings
from .drive_discovery import discover_drives
from .env_utils import (
    read_users_json,
    write_users_json,
    ensure_users_json_seed_if_legacy,
    write_env_vars,
)


from .capacity import compute_capacity

router = APIRouter(tags=["admin"])
templates = Jinja2Templates(directory="hdd_browser/app/templates")

APP_START_TS = time.time()
ALLOWED_ROLES = {"admin", "uploader", "deleter", "viewer"}

# Tunables via env (safe defaults)
ADMIN_STATS_TIME_BUDGET_SEC = float(os.environ.get("ADMIN_STATS_TIME_BUDGET_SEC", "3.0"))
ADMIN_STATS_MAX_ENTRIES_PER_ROOT = int(os.environ.get("ADMIN_STATS_MAX_ENTRIES_PER_ROOT", "50000"))
ADMIN_THUMB_SIZE_TIME_BUDGET_SEC = float(os.environ.get("ADMIN_THUMB_SIZE_TIME_BUDGET_SEC", "2.0"))
ADMIN_STATS_BYTES = os.environ.get("ADMIN_STATS_BYTES", "1").lower() in ("1", "true", "yes", "on")
# Quick reachability test for each root; skip slow/offline roots fast
ADMIN_ROOT_CHECK_TIMEOUT_SEC = float(os.environ.get("ADMIN_ROOT_CHECK_TIMEOUT_SEC", "0.5"))


def _require_admin(request: Request) -> str:
    user = require_user(request)
    info = user_info(request) or {}
    roles = set(info.get("r") or [])
    if "admin" not in roles:
        raise HTTPException(status_code=403, detail="Admin required")
    return user


@router.get("/admin", response_class=HTMLResponse)
async def admin_page(request: Request):
    t0 = time.time()
    _require_admin(request)
    print(f"[admin] GET /admin begin (t={t0:.3f})")
    resp = templates.TemplateResponse("admin.html", {"request": request})
    resp.headers["Cache-Control"] = "no-store"
    print(f"[admin] GET /admin rendered in {(time.time()-t0)*1000:.1f}ms")
    return resp


@router.get("/api/admin/ping")
async def admin_ping(request: Request):
    _require_admin(request)
    return PlainTextResponse("pong", headers={"Cache-Control": "no-store"})


# ----------------------------
# Users (persistent via .env)
# ----------------------------
def _validate_roles_csv(roles_csv: Optional[str]) -> List[str] | None:
    if roles_csv is None:
        return None
    roles = [r.strip() for r in roles_csv.split(",") if r.strip()]
    invalid = [r for r in roles if r not in ALLOWED_ROLES]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Invalid roles: {', '.join(sorted(set(invalid)))}")
    return roles

def _parse_roots_csv(roots_csv: Optional[str]) -> List[str]:
    """
    Parse a comma-separated list of roots, normalize to absolute paths,
    and ensure they exist and (optionally) are within global ALLOWED_ROOTS.
    """
    if roots_csv is None:
        return []
    s = get_settings()
    global_allowed = [p.resolve() for p in (s.allowed_roots or [])]
    items = [r.strip() for r in roots_csv.split(",") if r.strip()]
    out: List[str] = []
    for raw in items:
        p = Path(raw).expanduser().resolve()
        if not p.exists() or not p.is_dir():
            raise HTTPException(status_code=400, detail=f"Path not found or not a directory: {p}")
        # Enforce that user roots lie under global allowed_roots if global is set
        if global_allowed and not any(str(p).startswith(str(gr)) for gr in global_allowed):
            raise HTTPException(status_code=400, detail=f"Path not within global ALLOWED_ROOTS: {p}")
        sp = str(p)
        if sp not in out:
            out.append(sp)
    return out


@router.get("/api/admin/users")
async def admin_users_list(request: Request):
    _require_admin(request)
    # Seed USERS_JSON from legacy AUTH_* if empty (first-time setups)
    ensure_users_json_seed_if_legacy()
    users = read_users_json()
    redacted = [{
        "username": u["username"],
        "roles": u.get("roles") or [],
        "has_password": bool(u.get("password")),
        "roots": u.get("roots") or []
    } for u in users]
    print(f"[admin] users: returned {len(redacted)} users")
    return JSONResponse({"users": redacted}, headers={"Cache-Control": "no-store"})


@router.post("/api/admin/users/create")
async def admin_users_create(
    request: Request,
    username: str = Form(...),
    password: str = Form(""),
    roles: str = Form("viewer"),
    allowed_roots: str = Form(""),
):
    _require_admin(request)
    username = (username or "").strip()
    if not username:
        raise HTTPException(status_code=400, detail="Username required")

    users = read_users_json()
    if any(u.get("username") == username for u in users):
        raise HTTPException(status_code=409, detail="User already exists")

    roles_list = _validate_roles_csv(roles) or ["viewer"]
    roots_list = _parse_roots_csv(allowed_roots)
    users.append({"username": username, "password": password or "", "roles": roles_list, "roots": roots_list})
    write_users_json(users)
    return JSONResponse({"status": "ok"}, headers={"Cache-Control": "no-store"})


@router.post("/api/admin/users/update")
async def admin_users_update(
    request: Request,
    username: str = Form(...),
    password: str | None = Form(None),
    roles: str | None = Form(None),
    allowed_roots: str | None = Form(None),
):
    _require_admin(request)
    username = (username or "").strip()
    if not username:
        raise HTTPException(status_code=400, detail="Username required")

    users = read_users_json()
    idx = next((i for i, u in enumerate(users) if u.get("username") == username), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="User not found")

    # Apply updates
    if roles is not None:
        users[idx]["roles"] = _validate_roles_csv(roles) or []
    if password is not None:
        users[idx]["password"] = password or ""
    if allowed_roots is not None:
        users[idx]["roots"] = _parse_roots_csv(allowed_roots)

    write_users_json(users)
    return JSONResponse({"status": "ok"}, headers={"Cache-Control": "no-store"})


@router.post("/api/admin/users/delete")
async def admin_users_delete(
    request: Request,
    username: str = Form(...),
):
    _require_admin(request)
    username = (username or "").strip()
    if not username:
        raise HTTPException(status_code=400, detail="Username required")

    users = read_users_json()
    new_users = [u for u in users if u.get("username") != username]
    if len(new_users) == len(users):
        raise HTTPException(status_code=404, detail="User not found")

    write_users_json(new_users)
    return JSONResponse({"status": "ok"}, headers={"Cache-Control": "no-store"})


# ----------------------------
# Feature toggles (persistent via .env)
# ----------------------------
def _truthy(v: Optional[str]) -> Optional[bool]:
    if v is None:
        return None
    s = str(v).strip().lower()
    if s in ("1", "true", "yes", "on"):
        return True
    if s in ("0", "false", "no", "off"):
        return False
    return None


def _bool_env(b: bool) -> str:
    return "1" if b else "0"


def _current_features() -> Dict[str, bool]:
    s = get_settings()
    return {
        "uploads": bool(s.ENABLE_UPLOAD),
        "delete": bool(s.ENABLE_DELETE),
        "thumbnails": bool(s.ENABLE_THUMBNAILS),
        "heic_conversion": bool(s.ENABLE_HEIC_CONVERSION),
    }


@router.get("/api/admin/features")
async def admin_features_get(request: Request):
    _require_admin(request)
    return JSONResponse({"features": _current_features()}, headers={"Cache-Control": "no-store"})


@router.post("/api/admin/features/update")
async def admin_features_update(
    request: Request,
    uploads: Optional[str] = Form(None),
    delete: Optional[str] = Form(None),
    thumbnails: Optional[str] = Form(None),
    heic_conversion: Optional[str] = Form(None),
):
    _require_admin(request)

    # Parse optional booleans
    upd: Dict[str, str] = {}
    cur = _current_features()

    v = _truthy(uploads)
    if v is not None:
        upd["ENABLE_UPLOAD"] = _bool_env(v)
    else:
        upd["ENABLE_UPLOAD"] = _bool_env(cur["uploads"])

    v = _truthy(delete)
    if v is not None:
        upd["ENABLE_DELETE"] = _bool_env(v)
    else:
        upd["ENABLE_DELETE"] = _bool_env(cur["delete"])

    v = _truthy(thumbnails)
    if v is not None:
        upd["ENABLE_THUMBNAILS"] = _bool_env(v)
    else:
        upd["ENABLE_THUMBNAILS"] = _bool_env(cur["thumbnails"])

    v = _truthy(heic_conversion)
    if v is not None:
        upd["ENABLE_HEIC_CONVERSION"] = _bool_env(v)
    else:
        upd["ENABLE_HEIC_CONVERSION"] = _bool_env(cur["heic_conversion"])

    # Persist to .env and process env
    write_env_vars(upd)
    for k, v in upd.items():
        os.environ[k] = v

    # Refresh settings
    try:
        get_settings.cache_clear()  # type: ignore[attr-defined]
    except Exception:
        pass
    _ = get_settings()

    return JSONResponse({"status": "ok", "features": _current_features()}, headers={"Cache-Control": "no-store"})


# ----------------------------
# Stats (time-boxed, parallel)
# ----------------------------
def _dir_size_budgeted(p: Path, time_budget_sec: float) -> Tuple[int, bool]:
    total = 0
    t0 = time.time()
    partial = False
    try:
        for root, dirs, files in os.walk(p, followlinks=False):
            for f in files:
                try:
                    total += (Path(root) / f).stat().st_size
                except Exception:
                    pass
                if (time.time() - t0) > time_budget_sec:
                    partial = True
                    return total, partial
    except Exception:
        pass
    return total, partial


def _scan_root_quick(r: Path, time_budget_sec: float, max_entries: int, include_bytes: bool) -> Dict:
    files = 0
    dirs = 0
    bytes_ = 0
    count = 0
    t0 = time.time()
    partial = False

    try:
        for cur_root, dnames, fnames in os.walk(r, followlinks=False):
            dirs += len(dnames)
            files += len(fnames)

            if include_bytes:
                for f in fnames:
                    try:
                        bytes_ += (Path(cur_root) / f).stat().st_size
                    except Exception:
                        pass
                    count += 1
                    if count >= max_entries or (time.time() - t0) > time_budget_sec:
                        partial = True
                        break
            else:
                count += len(dnames) + len(fnames)
                if count >= max_entries or (time.time() - t0) > time_budget_sec:
                    partial = True

            if partial:
                break

            if (time.time() - t0) > time_budget_sec:
                partial = True
                break
    except Exception:
        pass

    return {"path": str(r), "files": files, "dirs": dirs, "bytes": bytes_, "partial": partial, "elapsed_ms": int((time.time() - t0) * 1000)}


async def _is_dir_quick(p: Path, timeout_sec: float) -> Tuple[bool, str]:
    def check() -> bool:
        try:
            return p.exists() and p.is_dir()
        except Exception:
            return False
    try:
        ok = await asyncio.wait_for(asyncio.to_thread(check), timeout=timeout_sec)
        return ok, ("" if ok else "not_dir")
    except asyncio.TimeoutError:
        return False, "timeout"


@router.get("/api/admin/stats")
async def admin_stats(request: Request):
    _require_admin(request)
    s = get_settings()
    print(
        f"[admin] stats: start bytes={ADMIN_STATS_BYTES} budget={ADMIN_STATS_TIME_BUDGET_SEC}s "
        f"entries={ADMIN_STATS_MAX_ENTRIES_PER_ROOT} rootCheck={ADMIN_ROOT_CHECK_TIMEOUT_SEC}s"
    )

    raw = s.ALLOWED_ROOTS or ""
    raw_list = [r.strip() for r in raw.split(",") if r.strip()]

    # Deduplicate
    dedup: List[str] = []
    seen = set()
    for r in raw_list:
        if r not in seen:
            dedup.append(r)
            seen.add(r)

    # Reachability checks
    reachable: List[Path] = []
    unreachable: List[Dict[str, str]] = []
    for rs in dedup:
        p = Path(rs).expanduser()
        ok, reason = await _is_dir_quick(p, ADMIN_ROOT_CHECK_TIMEOUT_SEC)
        if ok:
            reachable.append(p)
        else:
            unreachable.append({"path": str(p), "reason": reason})

    # Quick per-root scans (partial)
    roots_info: List[Dict] = []
    total_files = 0
    total_dirs = 0
    total_bytes = 0
    any_partial = False
    for p in reachable:
        res = _scan_root_quick(p, ADMIN_STATS_TIME_BUDGET_SEC, ADMIN_STATS_MAX_ENTRIES_PER_ROOT, ADMIN_STATS_BYTES)
        roots_info.append(res)
        total_files += res["files"]
        total_dirs += res["dirs"]
        total_bytes += res["bytes"] if ADMIN_STATS_BYTES else 0
        any_partial = any_partial or res.get("partial", False)
        print(f"[admin] stats: scanned {p} -> files={res['files']} dirs={res['dirs']} bytes={res['bytes']} partial={res['partial']} in {res['elapsed_ms']}ms")

    drives = discover_drives()

    # True device capacity (this is what the chart should use)
    try:
        dedup_paths = [Path(r).expanduser() for r in dedup]
        caps = compute_capacity(dedup_paths)
        capacity_total_bytes = caps.get("capacity_total_bytes")
        capacity_used_bytes = caps.get("capacity_used_bytes")
        capacity_free_bytes = caps.get("capacity_free_bytes")
        capacity_per_root = caps.get("capacity_per_root") or []
    except Exception as e:
        print(f"[admin] capacity compute failed: {e}")
        capacity_total_bytes = capacity_used_bytes = capacity_free_bytes = None
        capacity_per_root = []

    # Thumb cache size (time-boxed)
    thumb_dir = Path(s.THUMB_CACHE_DIR)
    thumb_bytes = 0
    thumb_partial = False
    if thumb_dir.exists():
        thumb_bytes, thumb_partial = _dir_size_budgeted(thumb_dir, ADMIN_THUMB_SIZE_TIME_BUDGET_SEC)

    uptime_sec = int(time.time() - APP_START_TS)
    partial = any_partial or thumb_partial or bool(unreachable)

    print(f"[admin] stats: done roots={len(reachable)}/{len(dedup)} partial={partial}")

    return JSONResponse(
        {
            "drives": drives,
            "roots_raw": dedup,
            "roots": [str(p) for p in reachable],
            "unreachable_roots": unreachable,
            "roots_info": roots_info,                 # quick scan (may be partial)
            "total_files": total_files,
            "total_dirs": total_dirs,
            "total_bytes": total_bytes,               # legacy
            "capacity_total_bytes": capacity_total_bytes,
            "capacity_used_bytes": capacity_used_bytes,
            "capacity_free_bytes": capacity_free_bytes,
            "capacity_per_root": capacity_per_root,   # add this line
            "thumb_cache_bytes": thumb_bytes,
            "uptime_sec": uptime_sec,
            "features": _current_features(),
            "partial": partial,
        },
        headers={"Cache-Control": "no-store"},
    )