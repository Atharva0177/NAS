import hashlib
import subprocess
from pathlib import Path
from typing import Optional, Tuple
from PIL import Image, ImageOps
from .config import get_settings
import mimetypes
import io
import os
import threading

# Ensure registration (safe if pillow-heif missing)
try:
    from pillow_heif import register_heif_opener  # type: ignore
    register_heif_opener()
except Exception:
    pass

_lock = threading.Lock()

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tiff", ".heic", ".heif"}
VIDEO_EXTS = {".mp4", ".mkv", ".mov", ".avi", ".webm"}

def _cache_dir() -> Path:
    settings = get_settings()
    d = Path(settings.THUMB_CACHE_DIR).resolve()
    d.mkdir(parents=True, exist_ok=True)
    return d

def _hash_key(path: Path, max_dim: int, extra: str = "") -> str:
    stat = path.stat()
    h = hashlib.sha256()
    h.update(str(path).encode("utf-8"))
    h.update(str(stat.st_mtime_ns).encode())
    h.update(str(stat.st_size).encode())
    h.update(str(max_dim).encode())
    if extra:
        h.update(extra.encode())
    return h.hexdigest()

def _is_image(path: Path) -> bool:
    ext = path.suffix.lower()
    mime = mimetypes.guess_type(path.name)[0] or ""
    return ext in IMAGE_EXTS or mime.startswith("image/")

def _is_video(path: Path) -> bool:
    ext = path.suffix.lower()
    mime = mimetypes.guess_type(path.name)[0] or ""
    return ext in VIDEO_EXTS or mime.startswith("video/")

def _ffmpeg_path() -> Optional[str]:
    settings = get_settings()
    if settings.FFMPEG_PATH:
        return settings.FFMPEG_PATH
    from shutil import which
    return which("ffmpeg")

def generate_image_thumb(src: Path, max_dim: int) -> bytes:
    with Image.open(src) as im:
        # orientation correction
        try:
            im = ImageOps.exif_transpose(im)
        except Exception:
            pass
        im.thumbnail((max_dim, max_dim))
        # Convert to RGB if necessary
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        out = io.BytesIO()
        im.save(out, format="JPEG", quality=82, optimize=True)
        return out.getvalue()

def generate_video_thumb(src: Path, max_dim: int) -> Optional[bytes]:
    ffmpeg = _ffmpeg_path()
    if not ffmpeg:
        return None
    scale_filter = f"scale='if(gt(a,1),{max_dim},-1)':'if(gt(a,1),-1,{max_dim})'"
    cmd = [
        ffmpeg, "-hide_banner", "-loglevel", "error",
        "-ss", "1", "-i", str(src),
        "-vframes", "1",
        "-vf", scale_filter,
        "-q:v", "4",
        "-f", "image2pipe", "pipe:1"
    ]
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=12)
        if proc.returncode != 0 or not proc.stdout:
            return None
        return proc.stdout
    except Exception:
        return None

def get_thumbnail(path: Path, max_dim: int, allow_cache: bool = True, refresh: bool = False) -> Tuple[bytes, str, bool]:
    """
    Returns (bytes, mime, placeholder_flag).
    placeholder_flag True if we had to synthesize a gray placeholder.
    If refresh=True we ignore an existing cached file.
    """
    settings = get_settings()

    if not settings.ENABLE_THUMBNAILS:
        raise RuntimeError("Thumbnails disabled")

    if not path.exists() or not path.is_file():
        raise FileNotFoundError("File does not exist")

    img_like = _is_image(path)
    vid_like = _is_video(path)

    # Determine hash key group
    key_extra = "img" if img_like else "vid" if vid_like else "other"
    key = _hash_key(path, max_dim, key_extra)
    cache_file = _cache_dir() / f"{key}.jpg"

    # If refresh is False and cache exists, serve it
    if allow_cache and not refresh and cache_file.exists():
        return cache_file.read_bytes(), "image/jpeg", False  # We can't know placeholder flag retrospectively; treat as real

    placeholder_flag = False
    data: Optional[bytes] = None

    if img_like:
        try:
            data = generate_image_thumb(path, max_dim)
        except Exception:
            data = None
    elif vid_like:
        data = generate_video_thumb(path, max_dim)

    if not data:
        # Produce placeholder but DO NOT cache (so future decode attempt can succeed after environment fixes)
        placeholder_flag = True
        from PIL import Image as PILImage
        ph = PILImage.new("RGB", (max_dim, max_dim), color=(90, 90, 90))
        tmp = io.BytesIO()
        ph.save(tmp, format="JPEG", quality=60)
        data = tmp.getvalue()
    else:
        # Cache only genuine thumbnail
        try:
            cache_file.write_bytes(data)
        except Exception:
            pass

    return data, "image/jpeg", placeholder_flag