import os
import sys
from pathlib import Path
from typing import Dict, List, Tuple

try:
    import psutil  # type: ignore
except Exception:  # pragma: no cover
    psutil = None  # Will raise if used without install


def _mountpoints() -> List[Tuple[str, str]]:
    """
    Return a list of (device, mountpoint) tuples.
    """
    if not psutil:
        raise RuntimeError("psutil is required for capacity reporting. pip install psutil")
    entries = []
    for p in psutil.disk_partitions(all=False):
        # device may be '' on some platforms; normalize
        device = p.device or p.mountpoint
        entries.append((device, p.mountpoint))
    return entries


def _device_for_path(path: Path) -> Tuple[str, str]:
    """
    Map a path to (device, mountpoint).
    Chooses the longest mountpoint that is a parent of path.
    """
    path = path.resolve()
    matches = []
    for device, mp in _mountpoints():
        try:
            mp_path = Path(mp).resolve()
        except Exception:
            continue
        if str(path).startswith(str(mp_path) + os.sep) or str(path) == str(mp_path):
            matches.append((len(str(mp_path)), device, mp))
    if not matches:
        # Fallback: return the path root as mountpoint
        root = Path(path.anchor or os.sep)
        return (str(root), str(root))
    _, device, mp = max(matches, key=lambda t: t[0])
    return (device, mp)


def compute_capacity(roots: List[Path]) -> Dict[str, int]:
    """
    Compute aggregate capacity across unique devices that back the provided roots.
    Returns:
      {
        "capacity_total_bytes": ...,
        "capacity_used_bytes": ...,
        "capacity_free_bytes": ...
      }
    """
    if not psutil:
        raise RuntimeError("psutil is required for capacity reporting. pip install psutil")

    # Determine unique devices from roots
    unique_devices = {}
    for r in roots:
        if not r.exists():
            continue
        dev, mp = _device_for_path(r)
        unique_devices[dev] = mp

    total = used = free = 0
    for dev, mp in unique_devices.items():
        try:
            usage = psutil.disk_usage(mp)
        except Exception:
            continue
        total += int(usage.total)
        used += int(usage.used)
        free += int(usage.free)

    return {
        "capacity_total_bytes": total,
        "capacity_used_bytes": used,
        "capacity_free_bytes": free,
    }