from fastapi import APIRouter, Request, UploadFile, File, Form, HTTPException, Body
from fastapi.responses import StreamingResponse, FileResponse, JSONResponse
from typing import List, Optional
from pathlib import Path
import shutil
import tempfile
import zipfile
import io
import os
import time
import json

from .config import get_settings

settings = get_settings()
router = APIRouter(prefix="/api")

def _drive_root(drive_id: str) -> Path:
    root = Path(settings.DRIVES[drive_id])
    if not root.exists():
        raise HTTPException(404, "Drive not found")
    return root

def _safe_join(root: Path, rel_path: str) -> Path:
    p = (root / rel_path).resolve()
    if not str(p).startswith(str(root.resolve())):
        raise HTTPException(400, "Path traversal")
    return p

def _entry_info(p: Path):
    st = p.stat()
    is_dir = p.is_dir()
    mime = ""  # optionally detect
    return {
        "name": p.name,
        "is_dir": is_dir,
        "size": 0 if is_dir else st.st_size,
        "modified": int(st.st_mtime),
        "mime": mime,
    }

@router.get("/list")
async def list_dir(
    request: Request,
    drive_id: str,
    rel_path: str = "",
    page: int = 1,
    page_size: int = 0,  # 0 = no pagination
):
    root = _drive_root(drive_id)
    path = _safe_join(root, rel_path)
    if not path.exists() or not path.is_dir():
        raise HTTPException(404, "Directory not found")
    entries = list(path.iterdir())
    entries.sort(key=lambda p: (not p.is_dir(), p.name.lower()))
    total = len(entries)
    if page_size and page_size > 0:
        start = max((page - 1) * page_size, 0)
        end = min(start + page_size, total)
        slice_ = entries[start:end]
        data = [_entry_info(p) for p in slice_]
        return {
            "path": str(path),
            "entries": data,
            "total": total,
            "page": page,
            "page_size": page_size,
            "has_more": end < total,
        }
    else:
        data = [_entry_info(p) for p in entries]
        return { "path": str(path), "entries": data, "total": total, "page": 1, "page_size": total, "has_more": False }

@router.post("/upload")
async def upload(
    request: Request,
    drive_id: str = Form(...),
    rel_path: str = Form(""),
    file: UploadFile = File(...)
):
    # CSRF enforced by middleware
    root = _drive_root(drive_id)
    dest_dir = _safe_join(root, rel_path)
    if not dest_dir.exists():
        dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / file.filename
    # Save
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"ok": True, "name": file.filename}

@router.post("/rename")
async def rename(
    request: Request,
    drive_id: str = Body(...),
    rel_path: str = Body(""),
    old_name: str = Body(...),
    new_name: str = Body(...),
):
    root = _drive_root(drive_id)
    base = _safe_join(root, rel_path)
    src = _safe_join(base, old_name)
    dst = _safe_join(base, new_name)
    if dst.exists():
        raise HTTPException(409, "Target exists")
    src.rename(dst)
    return {"ok": True}

@router.post("/trash")
async def move_to_trash(
    request: Request,
    drive_id: str = Body(...),
    rel_path: str = Body(""),
    names: List[str] = Body(...),
):
    root = _drive_root(drive_id)
    base = _safe_join(root, rel_path)
    trash = root / ".trash"
    trash.mkdir(exist_ok=True)
    ts = int(time.time())
    moved = []
    for n in names:
        src = _safe_join(base, n)
        token_name = f"{ts}_{n}"
        dst = trash / token_name
        shutil.move(str(src), str(dst))
        moved.append({"token": token_name, "name": n})
    # Return tokens so client can undo immediately
    return {"ok": True, "moved": moved}

@router.post("/restore")
async def restore_from_trash(
    request: Request,
    drive_id: str = Body(...),
    rel_path: str = Body(""),
    moved: List[dict] = Body(...),  # [{token,name}]
):
    root = _drive_root(drive_id)
    base = _safe_join(root, rel_path)
    trash = root / ".trash"
    for item in moved:
        token = item["token"]
        name = item["name"]
        src = _safe_join(trash, token)
        dst = _safe_join(base, name)
        if not src.exists():
            continue
        # If name exists, append suffix
        final = dst
        idx = 1
        while final.exists():
            final = dst.with_name(f"{dst.stem}_{idx}{dst.suffix}")
            idx += 1
        shutil.move(str(src), str(final))
    return {"ok": True}

@router.post("/zip")
async def zip_selection(
    request: Request,
    drive_id: str = Body(...),
    rel_path: str = Body(""),
    names: List[str] = Body(...)
):
    root = _drive_root(drive_id)
    base = _safe_join(root, rel_path)
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp_path = Path(tmp.name)
    tmp.close()
    with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for n in names:
            src = _safe_join(base, n)
            if src.is_dir():
                for p in src.rglob("*"):
                    if p.is_dir():
                        continue
                    arc = Path(n) / p.relative_to(src)
                    zf.write(p, arcname=str(arc))
            else:
                zf.write(src, arcname=n)
    headers = {
        "Content-Disposition": f'attachment; filename="{(Path(rel_path).name or "selection")}.zip"'
    }
    return FileResponse(tmp_path, media_type="application/zip", headers=headers)

# Optional: endpoint to support drag-and-drop folder uploads with webkitRelativePath
@router.post("/upload-multi")
async def upload_multi(
    request: Request,
    drive_id: str = Form(...),
    rel_path: str = Form(""),
    files: List[UploadFile] = File(...),
):
    root = _drive_root(drive_id)
    base = _safe_join(root, rel_path)
    saved = []
    for f in files:
        # Try to read relativePath header supplied by client
        rel_header = request.headers.get("X-File-Relative-Path", "")
        dest_dir = base
        if rel_header:
            dest_dir = _safe_join(base, rel_header)
            dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / f.filename
        dest.parent.mkdir(parents=True, exist_ok=True)
        with dest.open("wb") as out:
            shutil.copyfileobj(f.file, out)
        saved.append(str(dest.relative_to(root)))
    return {"ok": True, "saved": saved}