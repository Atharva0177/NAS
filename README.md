# 📂 NAS (Network Accessed Storage)

A self‑hosted, password‑protected web app to browse, preview, and stream files from your local or mounted drives.

Backend: FastAPI • Frontend: Jinja + Vanilla JS

Highlights
- 🔑 Login protection (signed sessions)
- 📂 Drive browsing with safe path handling
- 🖼 Thumbnails for images (and video posters)
- 🎬 Streaming with range requests (seek)
- 🔍 Search
- 🧭 Clean, responsive UI with list/grid views
- 🧩 Rich, in‑popup previews for many file types (see below)

---

## ⚡ Quick Start

1) Clone
```bash
git clone https://github.com/Atharva0177/NAS.git
cd NAS
```

2) Python env + dependencies
```bash
python3 -m venv .venv
# Windows PowerShell: .\.venv\Scripts\Activate.ps1
source .venv/bin/activate
pip install -r hdd_browser/requirements.txt
```

3) Configure minimal env vars
- Linux/macOS:
```bash
export AUTH_USERNAME=admin
export AUTH_PASSWORD=secret
export SESSION_SECRET=change_this_to_a_long_random_value
```
- Windows PowerShell:
```powershell
setx AUTH_USERNAME admin
setx AUTH_PASSWORD secret
setx SESSION_SECRET change_this_to_a_long_random_value
```

4) Run
```bash
uvicorn hdd_browser.app.main:app --host 0.0.0.0 --port 8080 --reload
```

5) Open
```
http://localhost:8080
```

---

## ✨ What’s New

- In‑popup viewers (client‑only, no server plugins):
  - DOCX → HTML via Mammoth.js
  - XLSX/XLS/CSV → tables via SheetJS (XLSX)
  - JSON/JSO/IPYNB → pretty‑printed JSON
  - XML → pretty‑printed in code modal
  - YAML/YML → parsed and re‑dumped with js‑yaml when available
  - TXT/CPP/PY → raw code modal
  - PDF → embedded inline
- Video: MKV support added in the UI. Playback depends on browser codecs.
- Robust multi‑CDN loader with optional local vendor fallback for viewer libraries.

---

## 🧩 File Preview Matrix (Popup)

- Images: jpg, jpeg, png, webp, gif, bmp, heic/heif, avif, tiff
- Videos: mp4, webm, mov, m4v, avi, mkv, ogv/ogg
  - Note: MKV playback depends on the video/audio codecs your browser supports.
- Documents:
  - PDF: embedded inline
  - DOCX: rendered to HTML (Mammoth.js)
  - XLSX/XLS/CSV: rendered as tables (SheetJS)
  - DOC/PPT/PPTX: not supported in‑browser; use Open/Download
- Text/Code:
  - json, jso, ipynb (pretty JSON), txt, cpp, py, xml (pretty), yaml/yml (pretty with js‑yaml)

Large text previews are truncated to keep the UI fast:
- Max ~1.5 MB raw text
- CSV/TXT inline rendering capped to a safe number of lines

---

## 📦 Optional: Offline / Air‑gapped Vendor Setup

The app loads client‑viewer libraries from public CDNs by default. To self‑host them:

1) Create a static vendor folder, for example:
```
hdd_browser/app/static/vendor/libs/
```

2) Download these files into that folder (names shown as expected by the loader if you customize it):
- Mammoth: `mammoth.browser.min.js`
- SheetJS: `xlsx.full.min.js`
- js‑yaml (optional, YAML pretty‑print): `js-yaml.min.js`

3) In your base template (before `app.js`), set your preferred base if you add a local loader:
```html
<script>window.PPTX_VENDOR_BASE = "/static/vendor/libs/";</script>
```

The loader will try your local files first, then CDNs (if configured that way).

---

## 🔧 Configuration

You can use environment variables or a `.env` file (auto‑loaded by the app).

Common variables:
- `APP_NAME` – UI title
- `HOST`, `PORT` – server bind
- `DEBUG` – True/False
- `AUTH_USERNAME`, `AUTH_PASSWORD` – login credentials
- `SESSION_SECRET` – 16+ char secret for signed cookies
- `ENABLE_UPLOAD` – True/False
- `ENABLE_DELETE` – True/False
- `ENABLE_THUMBNAILS` – True/False
- `THUMB_CACHE_DIR` – path to thumbnail cache
- `FFMPEG_PATH` – override ffmpeg path (video thumbs/posters)
- `ENABLE_HEIC_CONVERSION` – True/False
- `ALLOWED_ROOTS` – comma‑separated allowed root directories (limits browsing scope)

Frontend toggles (set via page scripts or template globals):
- `THUMB_MAX_CONC` – control thumbnail load concurrency (default 1 for strict serial)

Example `.env`:
```env
APP_NAME=NAS
DEBUG=True
AUTH_USERNAME=admin
AUTH_PASSWORD=secret
SESSION_SECRET=change_me_long_random
ENABLE_UPLOAD=True
ENABLE_DELETE=False
ENABLE_THUMBNAILS=True
THUMB_CACHE_DIR=.thumb_cache
ALLOWED_ROOTS=/mnt/storage,/home
```

---

## 🖥 Running in Production

Uvicorn example:
```bash
uvicorn hdd_browser.app.main:app --host 0.0.0.0 --port 8080
```

Systemd unit (example):
```ini
[Unit]
Description=NAS (FastAPI)
After=network.target

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/path/to/NAS
Environment=PATH=/path/to/NAS/.venv/bin
ExecStart=/path/to/NAS/.venv/bin/uvicorn hdd_browser.app.main:app --host 0.0.0.0 --port 8080
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

---

## 🌐 Remote Access (Tailscale optional)

Tailscale makes secure remote access trivial.

- Install Tailscale on your NAS and device(s)
- Use the Tailscale IP or MagicDNS hostname to access the service
- Recommended for remote use:
  - Strong `AUTH_*` and `SESSION_SECRET`
  - Consider `ENABLE_DELETE=False`

---

## 🔒 Security

- Only public paths (`/auth/login`, `/static/*`) are open; everything else requires a valid session.
- Session cookies are signed (`itsdangerous`); provide a long `SESSION_SECRET`.
- Path traversal is blocked via safe path joining.

---

## 📡 API (Authenticated)

Key endpoints:
- `GET /api/drives` – list drives
- `GET /api/list?drive_id&rel_path` – list directory contents
- `GET /api/preview?drive_id&rel_path` – light preview/metadata
- `GET /api/download?drive_id&rel_path` – download a file
- `GET /api/stream?drive_id&rel_path` – range‑enabled streaming (audio/video)
- `GET /api/search?drive_id&q` – recursive search
- `POST /api/upload` – upload file(s) (if enabled)
- `POST /api/delete` – delete file/folder (if enabled; folder can be recursive)
- `GET /api/thumb?drive_id&rel_path&size=...` – thumbnail
- `GET /api/render_image?drive_id&rel_path&max_dim=...` – server‑sized image

---

## 🧠 Tips

- Use `ALLOWED_ROOTS` to confine browsing to specific folders.
- For HEIC images, ensure `pillow-heif` is installed (already in requirements).
- Video thumbnails/posters need `ffmpeg` available in PATH (or set `FFMPEG_PATH`).
- If you’re air‑gapped, self‑host the viewer libraries and set a local vendor base.

---

## 🧱 Project Structure (simplified)

```
NAS/
├─ hdd_browser/
│  ├─ app/
│  │  ├─ main.py               # FastAPI app entry
│  │  ├─ auth.py               # login/session
│  │  ├─ config.py             # env & settings
│  │  ├─ security.py           # public/private path rules
│  │  ├─ drive_discovery.py    # drive/mount detection
│  │  ├─ file_ops.py           # core file operations
│  │  ├─ thumbnailer.py        # thumbs/posters
│  │  ├─ heic_init.py          # HEIC support
│  │  ├─ templates/            # Jinja2 templates
│  │  └─ static/
│  │     ├─ css/
│  │     └─ js/app.js          # frontend (viewers & UI)
│  └─ requirements.txt
└─ README.md
```

---

## ⚠️ Known Limitations

- PowerPoint formats (PPT/PPTX) are not supported in‑browser; use Open/Download.
- MKV playback depends on your browser’s codec support.
- Very large text/CSV files are truncated in preview for performance.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
