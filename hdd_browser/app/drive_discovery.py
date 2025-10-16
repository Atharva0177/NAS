import platform
import psutil
from pathlib import Path
from typing import List, Dict
from .config import get_settings

def discover_drives() -> List[Dict]:
    """
    Returns a list of candidate drives / mount points.
    Filters to only those that intersect with allowed_roots if configured.
    """
    settings = get_settings()
    allowed = settings.allowed_roots
    allowed_resolved = [p.resolve() for p in allowed]

    drives: List[Dict] = []
    system = platform.system().lower()

    # IMPORTANT: include bind mounts by using all=True
    partitions = psutil.disk_partitions(all=True)
    for part in partitions:
        mount = Path(part.mountpoint).resolve()

        # Filter by allowed roots if any
        if allowed_resolved:
            if not any(str(mount).startswith(str(ar)) for ar in allowed_resolved):
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

def resolve_drive_root(drive_id: str) -> Path:
    """
    Validate the drive_id (mount point) is in discovered set and within allowed roots.
    """
    drives = discover_drives()
    for d in drives:
        if d["id"] == drive_id:
            return Path(drive_id).resolve()
    raise ValueError("Drive not allowed or not found")