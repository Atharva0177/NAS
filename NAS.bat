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