import mimetypes
import os
from pathlib import Path
from typing import List, Dict, Optional, Generator, Tuple
from fastapi import HTTPException
from .config import get_settings

def safe_join(root: Path, relative: str) -> Path:
    candidate = (root / relative).resolve()
    if not str(candidate).startswith(str(root)):
        raise HTTPException(status_code=400, detail="Path traversal detected")
    return candidate

def list_directory(path: Path) -> List[Dict]:
    try:
        entries = []
        for entry in sorted(path.iterdir(), key=lambda p: (p.is_file(), p.name.lower())):
            try:
                stat = entry.stat()
                entries.append({
                    "name": entry.name,
                    "is_dir": entry.is_dir(),
                    "size": stat.st_size,
                    "modified": stat.st_mtime,
                    "mime": mimetypes.guess_type(entry.name)[0] if entry.is_file() else None
                })
            except PermissionError:
                continue
        return entries
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Directory not found")

def preview_file(path: Path, max_bytes: int) -> Dict:
    if not path.is_file():
        raise HTTPException(status_code=400, detail="Not a file")
    size = path.stat().st_size
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    text_like = mime.startswith("text/") or mime in {"application/json", "application/xml"}
    data = None
    truncated = False
    if text_like and size <= max_bytes:
        try:
            data = path.read_text(errors="replace")
        except UnicodeDecodeError:
            data = path.read_bytes()[:max_bytes].decode(errors="replace")
    elif text_like:
        with path.open("rb") as f:
            snippet = f.read(max_bytes)
            try:
                data = snippet.decode()
            except UnicodeDecodeError:
                data = snippet.decode(errors="replace")
        truncated = True
    return {
        "name": path.name,
        "size": size,
        "mime": mime,
        "text": data,
        "truncated": truncated
    }

def search(root: Path, query: str, max_results: int, max_depth: int) -> List[Dict]:
    results = []
    q = query.lower()
    root_str = str(root)
    for current_root, dirs, files in os.walk(root):
        rel_depth = Path(current_root).relative_to(root).parts
        if len(rel_depth) > max_depth:
            # Prune deeper directories
            dirs[:] = []
            continue
        # Search in directories
        for d in dirs:
            if q in d.lower():
                p = Path(current_root) / d
                results.append({
                    "path": str(p),
                    "name": d,
                    "is_dir": True
                })
                if len(results) >= max_results:
                    return results
        # Search in files
        for f in files:
            if q in f.lower():
                p = Path(current_root) / f
                results.append({
                    "path": str(p),
                    "name": f,
                    "is_dir": False
                })
                if len(results) >= max_results:
                    return results
    return results

def _delete_path_recursive(path: Path):
    # Do not follow symlinks; delete the link itself
    if path.is_symlink():
        path.unlink(missing_ok=True)
        return
    if path.is_file():
        path.unlink(missing_ok=True)
        return
    if path.is_dir():
        for child in path.iterdir():
            _delete_path_recursive(child)
        path.rmdir()
        return
    # If it’s neither file nor dir (e.g., broken symlink), try unlink
    try:
        path.unlink(missing_ok=True)
    except FileNotFoundError:
        pass

def delete_path(path: Path, recursive: bool = False):
    if not path.exists():
        raise HTTPException(status_code=404, detail="Not found")
    if recursive:
        _delete_path_recursive(path)
        return
    if path.is_dir():
        # Only allow deleting empty dir when not recursive
        if any(path.iterdir()):
            raise HTTPException(status_code=400, detail="Dir not empty")
        path.rmdir()
    else:
        path.unlink()

def save_upload(dest_dir: Path, filename: str, data: bytes) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    target = (dest_dir / filename).resolve()
    if not str(target).startswith(str(dest_dir.resolve())):
        raise HTTPException(status_code=400, detail="Invalid upload path")
    if target.exists():
        raise HTTPException(status_code=409, detail="File exists")
    with open(target, "wb") as f:
        f.write(data)
    return target