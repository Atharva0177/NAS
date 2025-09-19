import os
from pathlib import Path
from typing import Dict, List, Tuple, Optional

try:
    import psutil  # type: ignore
except Exception:  # pragma: no cover
    psutil = None  # Will raise if used without install


def _mountpoints() -> List[Tuple[str, str]]:
    """
    Return a list of (device, mountpoint) tuples.

    Use all=True to include network-mapped and removable volumes (important on Windows).
    """
    if not psutil:
        raise RuntimeError("psutil is required for capacity reporting. pip install psutil")
    entries: List[Tuple[str, str]] = []
    try:
        parts = psutil.disk_partitions(all=True)
    except Exception:
        parts = []
    for p in parts:
        device = p.device or p.mountpoint
        entries.append((device, p.mountpoint))
    return entries


def _longest_mount_for_path_str(path_str: str) -> Optional[Tuple[str, str]]:
    """
    Find the longest mountpoint that is a parent of path_str without touching the filesystem.
    Returns (device, mountpoint) or None if no mountpoint matches.
    """
    def norm(p: str) -> str:
        return os.path.normcase(os.path.abspath(p.rstrip(os.sep) or os.sep))

    target = norm(path_str)
    best: Optional[Tuple[int, str, str]] = None
    for device, mp in _mountpoints():
        try:
            mp_norm = norm(mp)
        except Exception:
            continue
        if target == mp_norm or target.startswith(mp_norm + os.sep):
            cand = (len(mp_norm), device, mp)
            if best is None or cand[0] > best[0]:
                best = cand
    if not best:
        return None
    _, device, mp = best
    return device, mp


def compute_capacity(roots: List[Path]) -> Dict[str, object]:
    """
    Compute aggregate capacity across unique devices backing the provided roots.
    Returns totals and per-root device breakdown.

    Returns:
      {
        "capacity_total_bytes": int,
        "capacity_used_bytes": int,
        "capacity_free_bytes": int,
        "capacity_per_root": [
          {
            "device": str,
            "mountpoint": str,
            "total_bytes": int,
            "used_bytes": int,
            "free_bytes": int
          }, ...
        ]
      }
    """
    if not psutil:
        raise RuntimeError("psutil is required for capacity reporting. pip install psutil")

    # Map roots -> unique device mountpoints
    unique_devices: Dict[str, str] = {}
    for r in roots:
        try:
            device_mount = _longest_mount_for_path_str(str(r.expanduser()))
        except Exception:
            device_mount = None
        if not device_mount:
            # No current mountpoint match (offline/unmounted) — skip
            continue
        dev, mp = device_mount
        unique_devices[dev] = mp

    total = used = free = 0
    per_root: List[Dict[str, int | str]] = []

    for dev, mp in unique_devices.items():
        try:
            usage = psutil.disk_usage(mp)
        except Exception:
            # Skip devices we cannot stat (e.g., no media)
            continue
        entry = {
            "device": str(dev),
            "mountpoint": str(mp),
            "total_bytes": int(usage.total),
            "used_bytes": int(usage.used),
            "free_bytes": int(usage.free),
        }
        per_root.append(entry)
        total += entry["total_bytes"]  # type: ignore[arg-type]
        used += entry["used_bytes"]    # type: ignore[arg-type]
        free += entry["free_bytes"]    # type: ignore[arg-type]

    # Sort for convenience (largest used first)
    per_root.sort(key=lambda e: int(e["used_bytes"]), reverse=True)

    return {
        "capacity_total_bytes": total,
        "capacity_used_bytes": used,
        "capacity_free_bytes": free,
        "capacity_per_root": per_root,
    }