from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Dict, List, Optional

from .config import get_settings
try:
    from .config import _ENV_FILE_PATH as _CONF_ENV_PATH  # type: ignore
except Exception:
    _CONF_ENV_PATH = None  # type: ignore

# Optional python-dotenv for robust reads/writes
try:
    from dotenv import set_key as dotenv_set_key, get_key as dotenv_get_key
    _HAVE_DOTENV = True
except Exception:
    _HAVE_DOTENV = False


def env_path() -> Path:
    """
    Resolve the .env path. Prefer the one detected by config; otherwise fallback to CWD/.env.
    Ensure the file exists.
    """
    if _CONF_ENV_PATH:
        p = Path(_CONF_ENV_PATH)
    else:
        p = Path(".env").resolve()
    p.parent.mkdir(parents=True, exist_ok=True)
    if not p.exists():
        p.touch()
    return p.resolve()


def _quote_value(v: str) -> str:
    """
    Quote the value for .env. We use single quotes and escape internal single quotes.
    """
    v = v.replace("'", "\\'")
    return f"'{v}'"


def read_env_file_var_only(key: str) -> Optional[str]:
    """
    Read a key strictly from the .env file (ignore process environment).
    This is used where we want the freshest on-disk state (e.g. admin panel).
    """
    p = env_path()
    if _HAVE_DOTENV:
        try:
            val = dotenv_get_key(str(p), key)
            if val is not None:
                return val
        except Exception:
            pass
    # Manual parse
    try:
        for line in p.read_text(encoding="utf-8").splitlines():
            s = line.strip()
            if not s or s.startswith("#") or "=" not in s:
                continue
            k, raw = s.split("=", 1)
            if k.strip() == key:
                return raw.strip().strip('"').strip("'")
    except Exception:
        return None
    return None


def read_env_var(key: str) -> Optional[str]:
    """
    General utility: prefer process environment if present, else read from .env.
    Not used by admin panel for USERS_JSON listing because we want on-disk state.
    """
    if key in os.environ:
        return os.environ.get(key)
    return read_env_file_var_only(key)


def write_env_vars(updates: Dict[str, str]) -> Path:
    """
    Write/update keys in .env while preserving other lines.
    Uses python-dotenv when available; otherwise falls back to manual update.
    """
    p = env_path()
    if _HAVE_DOTENV:
        for k, v in updates.items():
            dotenv_set_key(str(p), k, v)
        return p

    try:
        lines = p.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        lines = []

    existing = set()
    out: List[str] = []
    for line in lines:
        if "=" in line and (not line.strip().startswith("#")):
            k, _ = line.split("=", 1)
            k = k.strip()
            if k in updates:
                existing.add(k)
                out_lines = f"{k}={_quote_value(updates[k])}"
                out.append(out_lines)
            else:
                out.append(line)
        else:
            out.append(line)

    for k, v in updates.items():
        if k not in existing:
            out.append(f"{k}={_quote_value(v)}")

    p.write_text("\n".join(out) + "\n", encoding="utf-8")
    return p


def _parse_users_json(raw: str) -> List[Dict]:
    try:
        data = json.loads(raw)
    except Exception:
        return []
    if not isinstance(data, list):
        return []
    out: List[Dict] = []
    for u in data:
        if not isinstance(u, dict):
            continue
        uname = str(u.get("username") or "").strip()
        if not uname:
            continue
        pwd = str(u.get("password") or "")
        roles = u.get("roles") or []
        if not isinstance(roles, list):
            roles = []

        # NEW: parse per-user allowed roots if provided
        roots_in = u.get("roots") or u.get("allowed_roots") or []
        roots: List[str] = []
        if isinstance(roots_in, list):
            for r in roots_in:
                if isinstance(r, str) and r.strip():
                    try:
                        roots.append(str(Path(r).expanduser().resolve()))
                    except Exception:
                        pass

        out.append({"username": uname, "password": pwd, "roles": roles, "roots": roots})
    return out


def read_users_json() -> List[Dict]:
    """
    Admin-panel view of users:
    1) Always prefer the value currently in the .env file (fresh on-disk state).
    2) If missing from .env, fall back to process environment.
    3) Finally, fall back to current Settings value.
    """
    # 1) Prefer on-disk .env value
    file_raw = read_env_file_var_only("USERS_JSON")
    if file_raw and file_raw.strip():
        users = _parse_users_json(file_raw)
        if users:
            return users

    # 2) Fall back to process env
    env_raw = os.environ.get("USERS_JSON", "")
    if env_raw.strip():
        users = _parse_users_json(env_raw)
        if users:
            return users

    # 3) Fall back to Settings
    s = get_settings()
    raw = (s.USERS_JSON or "").strip()
    if not raw:
        return []
    return _parse_users_json(raw)


def write_users_json(users: List[Dict]) -> None:
    """
    Persist USERS_JSON to .env, sync process env, and refresh Settings cache.
    """
    payload = json.dumps(users, separators=(",", ":"), ensure_ascii=False)
    write_env_vars({"USERS_JSON": payload})

    # Keep process env in sync so any code reading os.environ sees the update
    os.environ["USERS_JSON"] = payload

    # Invalidate and reload Settings so new values are picked up in-process
    try:
        get_settings.cache_clear()  # type: ignore[attr-defined]
    except Exception:
        pass
    _ = get_settings()


def ensure_users_json_seed_if_legacy() -> Optional[List[Dict]]:
    """
    If USERS_JSON is empty but legacy AUTH_USERNAME/PASSWORD are set,
    seed USERS_JSON with that admin user.
    """
    users = read_users_json()
    if users:
        return None
    s = get_settings()
    if s.AUTH_USERNAME and s.AUTH_PASSWORD:
        seeded = [{"username": s.AUTH_USERNAME, "password": s.AUTH_PASSWORD, "roles": ["admin"]}]
        write_users_json(seeded)
        return seeded
    return None