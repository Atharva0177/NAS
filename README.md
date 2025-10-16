
# NAS (Network Attached Storage) – Fast, simple web UI to browse, preview, upload, and manage files

A lightweight FastAPI-based web UI to browse local or mounted disks, preview and stream files, generate thumbnails, and optionally upload/delete content. Works natively on Windows/macOS/Linux and with Conda. Supports single-user or multi-user auth with roles. Can be accessed over your LAN or securely over [Tailscale](https://tailscale.com) (Serve/Funnel).

This guide provides a clean, step-by-step setup without Docker, including a Windows one-click launcher (.bat).

---

## 1) Requirements

- Git
- Python 3.10+ (3.11/3.12 recommended) or Conda (Miniconda/Anaconda)
- pip
- On Windows: run from an “Anaconda Prompt” if using Conda (so `conda` is on PATH)
- Optional: [Tailscale](https://tailscale.com/download) if you want access over your tailnet or via Funnel

Notes:
- Windows native runs use Windows-style paths in config (e.g., `D:/Data`).
- Linux/macOS use POSIX paths (e.g., `/mnt/data`).

---

## 2) Clone the repo

```bash
git clone https://github.com/Atharva0177/NAS.git
cd NAS
```

---

## 3) Configure environment (.env)

The app reads configuration from environment variables. It can also auto-discover a `.env` file. Recommended: create one at `hdd_browser/app/.env` (or use OS/Process env vars).

Minimal example:

```env
# hdd_browser/app/.env
APP_NAME=NAS
HOST=0.0.0.0
PORT=8000
DEBUG=false

# Auth (change immediately for security)
AUTH_USERNAME=admin
AUTH_PASSWORD=admin
SESSION_SECRET=please_change_me_long_random_32chars_min

# Feature toggles
ENABLE_UPLOAD=true
ENABLE_DELETE=false
ENABLE_THUMBNAILS=true
ENABLE_HEIC_CONVERSION=true

# Thumbnail cache directory (relative or absolute)
THUMB_CACHE_DIR=.thumb_cache

# Allowed roots (comma-separated)
# Windows (native):
ALLOWED_ROOTS=C:/,D:/,E:/Data
# Linux/macOS (native):
# ALLOWED_ROOTS=/, /mnt/storage, /home/user

# Control dotenv override behavior:
# If 1/true: values from .env can override process env vars.
# If 0/false: process env wins over .env (safer when launching via scripts).
HDD_ENV_OVERRIDE=0
```

Important:
- `SESSION_SECRET` must be ≥ 16 characters; prefer 32+ random chars.
- `ALLOWED_ROOTS` entries must exist and be directories; only those will be used.
- If you pass env vars via a .bat or shell, set `HDD_ENV_OVERRIDE=0` to prevent the repo’s `.env` from overriding them.

Optional: set `HDD_ENV_FILE=...` to force using a specific `.env` path.

---

## 4) Run natively (Python + pip)

Create a virtual environment and install dependencies:

```bash
# From repo root
python -m venv .venv

# Windows:
.\.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install --upgrade pip
pip install -r hdd_browser/requirements.txt
```

Run the server:

```bash
python -m uvicorn hdd_browser.app.main:app --host 0.0.0.0 --port 8000
```

Open your browser: http://localhost:8000

First login (default): `admin` / `admin` → change these immediately (see Users section).

---

## 5) Run with Conda (optional)

```bash
# Create and activate env
conda create -n nas python=3.11 -y
conda activate nas

# Install dependencies
pip install --upgrade pip
pip install -r hdd_browser/requirements.txt

# Run
python -m uvicorn hdd_browser.app.main:app --host 0.0.0.0 --port 8000
```

---

## 6) Windows one‑click launcher (.bat)

This launcher will:
- Start the Tailscale Windows service and tray app
- Verify Tailscale connectivity (polls for a TS IPv4)
- Start the app using your existing Conda environment
- Open your custom website (e.g., MagicDNS or Funnel URL)

Customize `ENV_NAME` (your Conda env) and `CUSTOM_URL` (your site). If you have a Tailscale auth key, set it once with `setx TAILSCALE_AUTHKEY tskey-...` and reopen your terminal.

```bat
@echo off
setlocal

REM Run from this script's directory
cd /d "%~dp0"

REM ======== Config ========
REM Pass your conda env as the first arg, else default to 'nas'
set "ENV_NAME=%~1"
if "%ENV_NAME%"=="" set "ENV_NAME=nas"

REM Your app command (adjust as needed)
set "HOST=0.0.0.0"
set "PORT=8000"
set "APP_CMD=python -m uvicorn hdd_browser.app.main:app --host %HOST% --port %PORT%"

REM Optional: set your custom website URL (e.g., https://your-hostname.ts.net:8000/)
set "CUSTOM_URL=https://ideapadgaming3.tailcac1fa.ts.net/auth/login?next=/"

REM Optional app env (only if needed by your app)
set "APP_NAME=NAS"
set "DEBUG=False"
set "ENABLE_UPLOAD=1"
set "ENABLE_DELETE=1"
set "ENABLE_THUMBNAILS=1"
set "ENABLE_HEIC_CONVERSION=1"
set "THUMB_CACHE_DIR=.thumb_cache"
set "ALLOWED_ROOTS=C:/,D:/,E:/,F:/,G:/"
set "HDD_ENV_OVERRIDE=1"

if not exist "%THUMB_CACHE_DIR%" mkdir "%THUMB_CACHE_DIR%"

echo [Tailscale] Starting service and app...
REM Start the Windows service (ignore error if already running)
net start Tailscale >nul 2>nul

REM Start the Tailscale tray UI (no IF lines that parse parentheses)
start "" "%ProgramFiles%\Tailscale\Tailscale-ipn.exe" 2>nul
REM start "" "%ProgramFiles(x86)%\Tailscale\Tailscale-ipn.exe" 2>nul

REM Pick the CLI path (fallback to PATH)
set "TS_CLI=%ProgramFiles%\Tailscale\tailscale.exe"
if not exist "%TS_CLI%" set "TS_CLI=%ProgramFiles(x86)%\Tailscale\tailscale.exe"
if not exist "%TS_CLI%" set "TS_CLI=tailscale.exe"

REM If an auth key is provided, bring the node up (no SSH flag on Windows)
if not "%TAILSCALE_AUTHKEY%"=="" "%TS_CLI%" up --authkey=%TAILSCALE_AUTHKEY% --hostname "files-hub" --accept-dns=true

REM Verify connectivity by polling for a Tailscale IPv4 (no parentheses in IF blocks)
set "TS_IP4="
set "TS_TRIES=0"
:TS_WAIT
del "%TEMP%\ts_ip4.txt" >nul 2>nul
"%TS_CLI%" ip -4 > "%TEMP%\ts_ip4.txt" 2>nul
set /p TS_IP4=<"%TEMP%\ts_ip4.txt"
if not "%TS_IP4%"=="" goto TS_OK
set /a TS_TRIES=%TS_TRIES%+1
if %TS_TRIES% GEQ 10 goto TS_SKIP
echo [Tailscale] Waiting for connection (%TS_TRIES%/10)...
ping -n 2 127.0.0.1 >nul
goto TS_WAIT
:TS_OK
echo [Tailscale] Connected: %TS_IP4%
:TS_SKIP

REM Decide which URL(s) to open
set "OPEN_URL=http://localhost:%PORT%/"
if not "%CUSTOM_URL%"=="" set "OPEN_URL=%CUSTOM_URL%"
echo.
echo Launching app with conda env: %ENV_NAME%
echo Local URL: %OPEN_URL%
REM if not "%TS_IP4%"=="" echo Tailscale URL: http://%TS_IP4%:%PORT%/
echo Allowed roots: %ALLOWED_ROOTS%
echo.

start "" "%OPEN_URL%"
REM if not "%TS_IP4%"=="" start "" "http://%TS_IP4%:%PORT%/"

REM Ensure conda is available
where conda >nul 2>nul
if errorlevel 1 (
  echo [ERROR] 'conda' not found in PATH. Open "Anaconda Prompt" or add conda to PATH.
  pause
  exit /b 1
)

REM Run the app (no global activation leakage)
conda run -n "%ENV_NAME%" %APP_CMD%

echo.
echo [INFO] Server exited.
pause
```

Usage:
1) Save as `run_nas.bat` in the repo root (same folder that contains `hdd_browser`).
2) Optional (for unattended login): in CMD, run `setx TAILSCALE_AUTHKEY tskey-...` then open a new terminal.
3) From an Anaconda Prompt or a shell with `conda` on PATH:
   - `cd NAS`
   - `run_nas.bat nas`
4) Visit your custom URL (the script opens it after the app is ready).

If you’re not using Tailscale yet, set `CUSTOM_URL=http://localhost:8000/`.

---

## 7) Authentication and users

By default, single-user auth uses `AUTH_USERNAME` and `AUTH_PASSWORD`.

Multi-user mode: provide `USERS_JSON` as a JSON string. Roles control capabilities:
- `admin` – full access including admin panel
- `uploader` – can upload files (if `ENABLE_UPLOAD=true`)
- `deleter` – can delete files (if `ENABLE_DELETE=true`)
- `viewer` – read-only browsing

Example `USERS_JSON`:
```env
USERS_JSON=[
  {"username":"admin","password":"admin_pw_change_me","roles":["admin"]},
  {"username":"bob","password":"bob_pw","roles":["viewer"]},
  {"username":"carol","password":"carol_pw","roles":["uploader","deleter"]}
]
```

Admin panel: `http://localhost:8000/admin` (requires `admin` role). Shows roots reachability, quick stats, user listing, environment info.

---

## 8) Features and API

- Drives list: `GET /api/drives` (authenticated; derived from system partitions filtered by `ALLOWED_ROOTS`)
- List directory: `GET /api/list?drive_id=&rel_path=`
- Preview file: `GET /api/preview?drive_id=&rel_path=`
- Download: `GET /api/download?drive_id=&rel_path=`
- Stream (range): `GET /api/stream?drive_id=&rel_path=`
- Thumbnails: `GET /api/thumb?drive_id=&rel_path=&size=`
- Render/resize image, HEIC→JPEG: `GET /api/render_image?drive_id=&rel_path=&max_dim=`
- Search: `GET /api/search?drive_id=&query=&depth=&limit=`
- Health: `GET /healthz` → `{ "status": "ok" }`

Note: All except `/healthz` require authentication.

---

## 9) Optional: Publish over Tailscale (Serve/Funnel)

If you want your `.ts.net` URL to reach this app:

1) Ensure Tailscale is connected on the machine (`tailscale up` → `tailscale status`).
2) Serve your local app over HTTPS on 443 via Tailscale proxy:
   ```bash
   tailscale serve --bg  http://127.0.0.1:8000
   ```
3) Enable Funnel (public internet via `*.ts.net`):
   ```bash
   tailscale funnel --bg 8000 
   ```
4) Verify:
   ```bash
   tailscale serve status
   ```
Then open your Funnel URL (e.g., `https://your-hostname.ts.net/`). If permission is required, enable Funnel for the tailnet and/or tags in the Admin Console.

Tip (Windows): You can add these `tailscale serve/funnel` commands to your `.bat` after the “Connected” check if you want automation.

---

## 10) Troubleshooting

- Port already in use (Windows error 10048 / “address already in use”):
  - Free the port:
    ```bat
    netstat -ano | findstr :8000
    taskkill /PID <pid> /F
    ```
  - Or change the app port consistently (in `.env` or `.bat` and in your reverse proxy/Tailscale serve mapping).

- `/api/drives` returns `[]`:
  - Ensure you’re logged in (endpoint is authenticated).
  - Confirm `ALLOWED_ROOTS` directories exist and are readable.
  - On Windows native: use Windows-style paths (e.g., `D:/`).

- Credentials don’t change:
  - If the repo’s `.env` overrides your runtime variables, set `HDD_ENV_OVERRIDE=0` in `.env` or via your launcher so process env wins.

- Permission denied on system folders:
  - Normal for protected paths (Windows). Browse into user folders instead.

- Thumbnails slow/missing:
  - Ensure `ENABLE_THUMBNAILS=true` and `THUMB_CACHE_DIR` is writable.

- HEIC conversion:
  - Requires Pillow with HEIF support; if not available, conversion is skipped/fails. Disable via `ENABLE_HEIC_CONVERSION=false` or install `pillow-heif`.

---

## 11) Security checklist

- Change default `AUTH_USERNAME`/`AUTH_PASSWORD` immediately.
- Use a strong `SESSION_SECRET` (32+ random characters).
- Limit `ALLOWED_ROOTS` to only what you want exposed.
- Prefer read-only access for sensitive data; grant write only where necessary.
- Put the app behind HTTPS (reverse proxy, Tailscale Serve, or TLS terminator).
- For public exposure, prefer Tailscale Funnel or a carefully configured reverse proxy with authentication.

---

## 12) Development

Run with auto-reload (dev only):

```bash
# In your shell or .env
export DEBUG=1  # Windows PowerShell: $env:DEBUG='1'
python -m uvicorn hdd_browser.app.main:app --host 127.0.0.1 --port 8000 --reload
```

Entrypoint:
- ASGI app: `hdd_browser.app.main:app`
- `python -m hdd_browser.app.main` uses the `run()` helper in `main.py`

---
