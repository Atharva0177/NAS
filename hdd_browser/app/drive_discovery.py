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

    drives = []
    system = platform.system().lower()

    partitions = psutil.disk_partitions(all=False)
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
                "percent": usage.percent
            })
        except PermissionError:
            continue

    # If no allowed roots specified and list ended empty, fall back
    if not allowed_resolved and not drives:
        # Possibly user has no partitions accessible
        pass
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