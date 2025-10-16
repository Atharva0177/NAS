import platform
import psutil
from pathlib import Path
from typing import List, Dict, Optional
from .config import get_settings

def _within_any(p: Path, roots: List[Path]) -> bool:
    pr = p.resolve()
    for ar in roots:
        try:
            if str(pr).startswith(str(ar.resolve())):
                return True
        except Exception:
            continue
    return False

def discover_drives(allowed_override: Optional[List[Path]] = None) -> List[Dict]:
    """
    Returns a list of candidate drives / mount points.
    Filters to only those that intersect with allowed roots if configured.
    If allowed_override is provided, use that instead of global settings.
    """
    settings = get_settings()
    base_allowed = allowed_override if allowed_override is not None else settings.allowed_roots
    allowed_resolved = [p.resolve() for p in (base_allowed or [])]

    drives: List[Dict] = []
    system = platform.system().lower()

    # IMPORTANT: include bind mounts by using all=True
    partitions = psutil.disk_partitions(all=True)
    for part in partitions:
        mount = Path(part.mountpoint).resolve()

        # Filter by allowed roots if any
        if allowed_resolved:
            if not _within_any(mount, allowed_resolved):
                continue

        try:
            usage = psutil.disk_usage(str(mount))
            drives.append({
                "id": str(mount),
                "mount_point": str(mount),
                "fstype": part.fstype,
                "total": usage.total,
                "used": usage.used,
                "free": usage.free,
                "percent": usage.percent,
            })
        except PermissionError:
            continue

    # Fallback: if allowed roots are set but no partitions matched,
    # expose the allowed roots themselves as drives (common for bind mounts).
    if allowed_resolved and not drives:
        for ar in allowed_resolved:
            try:
                usage = psutil.disk_usage(str(ar))
                drives.append({
                    "id": str(ar),
                    "mount_point": str(ar),
                    "fstype": "bind",
                    "total": usage.total,
                    "used": usage.used,
                    "free": usage.free,
                    "percent": usage.percent,
                })
            except PermissionError:
                continue

    return drives

def resolve_drive_root(drive_id: str, allowed_override: Optional[List[Path]] = None) -> Path:
    """
    Validate the drive_id (mount point) is in discovered set and within allowed roots.
    Optionally enforce a per-request allowed_override (e.g., per-user roots).
    """
    drives = discover_drives(allowed_override=allowed_override)
    for d in drives:
        if d["id"] == drive_id:
            return Path(drive_id).resolve()
    raise ValueError("Drive not allowed or not found")