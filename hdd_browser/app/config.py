import os
from pathlib import Path
from functools import lru_cache
from typing import List, Dict, Any, Optional

# Version detection
try:
    import pydantic
    from packaging import version as _pkg_version
    PYDANTIC_VERSION = _pkg_version.parse(pydantic.__version__)
except Exception:  # pragma: no cover
    raise RuntimeError("Pydantic is required.")

IS_V2 = PYDANTIC_VERSION.major >= 2

# Import correct BaseSettings / decorators
if IS_V2:
    from pydantic_settings import BaseSettings, SettingsConfigDict
    from pydantic import field_validator
else:
    from pydantic import BaseSettings, validator  # type: ignore

# Optional python-dotenv
try:
    from dotenv import load_dotenv
    HAVE_DOTENV = True
except ImportError:
    HAVE_DOTENV = False


# ---------------------------------------------------------------------------
# Environment file discovery
# ---------------------------------------------------------------------------
def _find_env_file() -> Optional[Path]:
    """
    Priority:
      1. HDD_ENV_FILE (explicit path)
      2. CWD/.env
      3. Walk upward from this file's directory (limit depth)
    """
    explicit = os.environ.get("HDD_ENV_FILE")
    if explicit:
        p = Path(explicit).expanduser().resolve()
        if p.is_file():
            return p

    cwd_candidate = Path.cwd() / ".env"
    if cwd_candidate.is_file():
        return cwd_candidate.resolve()

    here = Path(__file__).resolve().parent
    for depth, parent in enumerate([here, *here.parents]):
        candidate = parent / ".env"
        if candidate.is_file():
            return candidate.resolve()
        if depth > 5:
            break
    return None


_ENV_FILE_PATH = _find_env_file()


def _log_once(tag: str, msg: str):
    key = f"__LOGGED_{tag}"
    if key not in globals():
        print(msg)
        globals()[key] = True


if _ENV_FILE_PATH:
    _log_once("ENV_FILE", f"[config] Using .env file: {_ENV_FILE_PATH}")
else:
    _log_once("ENV_FILE_MISSING", "[config] WARNING: No .env file found (falling back to OS env + defaults).")

# Dotenv load BEFORE Settings instantiation
DOTENV_OVERRIDE = os.environ.get("HDD_ENV_OVERRIDE", "0").lower() in ("1", "true", "yes", "on")

if _ENV_FILE_PATH and HAVE_DOTENV:
    load_dotenv(dotenv_path=_ENV_FILE_PATH, override=DOTENV_OVERRIDE)
    _log_once("DOTENV_LOAD", f"[config] dotenv loaded ({'override' if DOTENV_OVERRIDE else 'no override'}) from: {_ENV_FILE_PATH}")
elif _ENV_FILE_PATH and not HAVE_DOTENV:
    _log_once("DOTENV_MISSING", "[config] Note: python-dotenv not installed; relying on Pydantic env_file support.")


# ---------------------------------------------------------------------------
# Settings model
# ---------------------------------------------------------------------------
class Settings(BaseSettings):
    # Core
    APP_NAME: str = "HDD Browser"
    HOST: str = "127.0.0.1"
    PORT: int = 8080
    DEBUG: bool = False

    # Auth
    AUTH_USERNAME: str = "admin"
    AUTH_PASSWORD: str = "admin"
    SESSION_SECRET: str = "please_change_me_very_long_random"

    # Features / permissions
    ENABLE_UPLOAD: bool = False
    ENABLE_DELETE: bool = False
    ENABLE_THUMBNAILS: bool = True
    ENABLE_HEIC_CONVERSION: bool = True

    # Paths / search
    ALLOWED_ROOTS: str = ""
    MAX_TEXT_PREVIEW_BYTES: int = 1_000_000
    MAX_SEARCH_RESULTS: int = 500
    SEARCH_DEFAULT_DEPTH: int = 6

    # Thumbnails
    THUMB_MAX_DIM: int = 256
    THUMB_CACHE_DIR: str = ".thumb_cache"
    FFMPEG_PATH: str = ""

    # Pydantic v2 config
    if IS_V2:
        model_config = SettingsConfigDict(
            env_file=str(_ENV_FILE_PATH) if _ENV_FILE_PATH else None,
            env_file_encoding="utf-8",
            case_sensitive=True,
            extra="ignore",
        )

    # Allowed roots convenience
    @property
    def allowed_roots(self) -> List[Path]:
        roots: List[Path] = []
        if self.ALLOWED_ROOTS.strip():
            for raw in self.ALLOWED_ROOTS.split(","):
                p = Path(raw).expanduser().resolve()
                if p.exists() and p.is_dir():
                    roots.append(p)
        return roots

    # Validation (session secret)
    @staticmethod
    def _validate_secret(v: str) -> str:
        if not v or len(v) < 16:
            raise ValueError("SESSION_SECRET must be at least 16 characters")
        return v

    if IS_V2:
        @field_validator("SESSION_SECRET")
        def _v2_secret(cls, v):
            return cls._validate_secret(v)
    else:
        @validator("SESSION_SECRET")
        def _v1_secret(cls, v):
            return cls._validate_secret(v)

    # Debug info
    def debug_dump(self) -> Dict[str, Any]:
        return {
            "HOST": self.HOST,
            "PORT": self.PORT,
            "DEBUG": self.DEBUG,
            "AUTH_USERNAME": self.AUTH_USERNAME,
            "AUTH_PASSWORD_LENGTH": len(self.AUTH_PASSWORD) if self.AUTH_PASSWORD else 0,
            "ENABLE_UPLOAD": self.ENABLE_UPLOAD,
            "ENABLE_DELETE": self.ENABLE_DELETE,
            "ENABLE_THUMBNAILS": self.ENABLE_THUMBNAILS,
            "ENABLE_HEIC_CONVERSION": self.ENABLE_HEIC_CONVERSION,
            "ALLOWED_ROOTS": self.ALLOWED_ROOTS,
            "THUMB_MAX_DIM": self.THUMB_MAX_DIM,
            "THUMB_CACHE_DIR": self.THUMB_CACHE_DIR,
            "ENV_FILE_USED": str(_ENV_FILE_PATH) if _ENV_FILE_PATH else None,
            "DOTENV_OVERRIDE": DOTENV_OVERRIDE,
            "PYDANTIC_VERSION": str(PYDANTIC_VERSION),
        }

    def verify(self) -> None:
        issues = []
        if self.AUTH_USERNAME == "admin" and os.environ.get("AUTH_USERNAME") is None:
            issues.append("AUTH_USERNAME still default")
        if self.AUTH_PASSWORD == "admin" and os.environ.get("AUTH_PASSWORD") is None:
            issues.append("AUTH_PASSWORD still default")
        if self.SESSION_SECRET.startswith("please_change_me"):
            issues.append("SESSION_SECRET weak/default")
        if issues:
            _log_once("VERIFY_WARN", "[config] WARN: " + "; ".join(issues))


# Pydantic v1 env_file config block
if not IS_V2:
    class _V1Config:  # type: ignore
        env_file = str(_ENV_FILE_PATH) if _ENV_FILE_PATH else None
        env_file_encoding = "utf-8"
        case_sensitive = True
    Settings.Config = _V1Config  # type: ignore


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.verify()
    return s