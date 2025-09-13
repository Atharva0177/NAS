# 📂 NAS (Network Accessed Storage)

A **self-hosted web app** to securely browse your local or mounted drives.  
Built with **FastAPI**, it provides a modern web interface with:

- 🔑 Login protection  
- 📂 File & folder browsing  
- 🖼 Thumbnails & previews (images, videos, HEIC support)  
- 🎥 Audio/video streaming with seek  
- 🔍 File search  

Think of it as a **personal NAS browser** with a clean, responsive UI.  

---

## ⚡ Quick Setup Guide (1 Minute)

### Step 1: Clone the repository
```bash
git clone https://github.com/your-repo/hdd_browser.git
cd hdd_browser
```

### Step 2: Create virtual environment & install dependencies
```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .\.venv\Scripts\Activate.ps1
pip install -r hdd_browser/requirements.txt
```

### Step 3: Set minimum environment variables
#### Linux / macOS
```bash
export AUTH_USERNAME=admin
export AUTH_PASSWORD=secret
export SESSION_SECRET=my_super_secret_key
```

#### Windows PowerShell
```powershell
setx AUTH_USERNAME admin
setx AUTH_PASSWORD secret
setx SESSION_SECRET my_super_secret_key
```

### Step 4: Run the app
```bash
uvicorn hdd_browser.app.main:app --host 0.0.0.0 --port 8080 --reload
```

### Step 5: Open in browser
```
http://localhost:8080
```

---

## ✨ Features

- 🔑 Secure login with signed cookies
- 💽 Drive discovery (auto-detects mounts, restrictable with allow-list)
- 📂 File browsing with safe path handling
- 📝 Text preview for small files
- 📥 File download with direct response
- 🎥 Video/audio streaming with HTTP Range (seek supported)
- 🖼 Thumbnails for images/videos (cached for speed)
- 📸 HEIC support via pillow-heif (auto converts to JPEG)
- 🔍 Search (recursive by name, depth & limit options)
- 🎨 Responsive UI (lightbox/gallery, clean design)

---

## 🚀 Full Installation Guide

### Requirements
- Python 3.9+
- `ffmpeg` installed (for video thumbnails)
- Optional: `pillow-heif` for HEIC image support

### Steps

#### 1. Clone and enter the repo
```bash
git clone https://github.com/Atharva0177/NAS.git
cd NAS
cd hdd_browser
```

#### 2. Create and activate virtual environment
```bash
python3 -m venv .venv
source .venv/bin/activate
```

#### 3. Install dependencies
```bash
pip install -r hdd_browser/requirements.txt
```

#### 4. Configure environment (via .env file or system variables)
Example `.env` file:
```env
APP_NAME=HDD Browser
DEBUG=True
AUTH_USERNAME=admin
AUTH_PASSWORD=secret
SESSION_SECRET=my_super_secret_key
ENABLE_UPLOAD=True
ENABLE_DELETE=False
ENABLE_THUMBNAILS=True
THUMB_CACHE_DIR=.thumb_cache
ALLOWED_ROOTS=/mnt/storage,/home
```

#### 5. Run the app
```bash
uvicorn hdd_browser.app.main:app --host 0.0.0.0 --port 8080 --reload
```

---














---

## 🔗 Tailscale Integration (Remote Access)

Perfect for accessing your NAS from anywhere securely!

### Benefits
- **Zero-config VPN**: Access from anywhere without port forwarding
- **End-to-end encryption**: All traffic encrypted between devices
- **Cross-platform**: Works on mobile, desktop, and server
- **Easy management**: Simple web interface for device control

### Setup for Tailscale

#### 1. Install Tailscale on your NAS server and get the Tailscale IP
```bash
# Get your Tailscale IP
tailscale ip -4
```

#### 2. Configure HDD Browser for Tailscale
Update your `.env` file:
```env
DEBUG=False  # Disable debug for remote access
SESSION_SECRET=your_very_long_secret_key_32chars_minimum
AUTH_USERNAME=your_strong_username
AUTH_PASSWORD=your_very_strong_password_123!
```

#### 3. Run on Tailscale interface
```bash

uvicorn hdd_browser.app.main:app --host 0.0.0.0 --port 8080
```

#### 4. Access from any device
Install Tailscale on your phone/laptop and access:
```
# Replace 100.x.x.x with your actual Tailscale IP
http://100.x.x.x:8080
```

### Optional: MagicDNS Setup
Enable MagicDNS in Tailscale admin console to access via hostname:
```
http://your-nas-hostname:8080
```

### Security for Remote Access

#### Recommended Security Settings
```env
# Strong authentication
AUTH_USERNAME=your_strong_username
AUTH_PASSWORD=your_very_strong_password_123!

# Optional: Disable risky features for remote access
ENABLE_DELETE=False  # Prevent accidental remote deletions
ENABLE_UPLOAD=True   # Keep if you need remote uploads

# Restrict access paths
ALLOWED_ROOTS=/home/media,/mnt/nas  # Limit to specific dirs
```

### Systemd Service (Always-On NAS)
Create `/etc/systemd/system/hdd-browser.service`:
```ini
[Unit]
Description=HDD Browser NAS
After=network.target tailscaled.service

[Service]
Type=simple
User=your_user
WorkingDirectory=/path/to/hdd_browser
Environment=PATH=/path/to/hdd_browser/.venv/bin
ExecStart=/path/to/hdd_browser/.venv/bin/uvicorn hdd_browser.app.main:app --host 100.x.x.x --port 8080
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
sudo systemctl enable hdd-browser
sudo systemctl start hdd-browser
sudo systemctl status hdd-browser  # Check status
```

---




















## ⚙️ Configuration

Settings can come from:
- Environment variables
- `.env` file (auto-discovered by `config.py`)

### Key Variables

| Variable | Purpose |
|----------|---------|
| `APP_NAME` | App display name |
| `HOST`, `PORT` | Where the server listens |
| `DEBUG` | Enable/disable debug mode |
| `AUTH_USERNAME`, `AUTH_PASSWORD` | Login credentials |
| `SESSION_SECRET` | 16+ char secret for cookies |
| `ENABLE_UPLOAD`, `ENABLE_DELETE` | Enable/disable file ops |
| `ENABLE_THUMBNAILS` | Turn thumbnails on/off |
| `THUMB_MAX_DIM` | Thumbnail size (pixels) |
| `THUMB_CACHE_DIR` | Where cached thumbs live |
| `FFMPEG_PATH` | Path to ffmpeg binary |
| `ENABLE_HEIC_CONVERSION` | Enable HEIC→JPEG |
| `ALLOWED_ROOTS` | Comma-separated root dirs |

---

## 🔒 Security & Auth

- Only public paths (`/auth/login`, `/static/*`, etc.) are unauthenticated.
- Everything else requires login.
- Sessions are signed with `itsdangerous`.
- File access uses safe path joining to block path traversal.

---

## 💽 Drive Discovery & Browsing

- Auto-detects drives and mount points.
- Restricted by `ALLOWED_ROOTS` if set.
- Directory listings are sanitized.

---

## 📺 Previews & Streaming

- **Text files**: show preview snippets in browser.
- **File downloads**: served via `FileResponse`.
- **Video/audio**: HTTP Range supported → fast seeking.

---

## 🖼 Thumbnails & Images

- Generated via Pillow (`.jpg`, `.png`, etc.)
- Fixes orientation via EXIF
- **HEIC support** → converted to JPEG if `pillow-heif` installed
- **Videos** → thumbnails created with `ffmpeg`
- All thumbnails cached to `.thumb_cache`

---

## 🖥 User Interface

Built with Jinja templates + vanilla JS.

### Pages
- `/` → Home
- `/browse` → File browser
- `/search` → Search
- `/login` → Auth page

### Static assets
- CSS → `static/css/`
- JS → `static/js/`

---

## 📡 HTTP API (Authenticated)

### Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/drives` | List drives |
| `GET /api/list?drive_id&rel_path` | List folder contents |
| `GET /api/preview?...` | Preview text/metadata |
| `GET /api/download?...` | Download file |
| `GET /api/stream?...` | Stream audio/video |
| `GET /api/search?...` | Search files |
| `POST /api/upload` | Upload file (if enabled) |
| `POST /api/delete` | Delete file (if enabled) |
| `GET /api/thumb?...` | Get thumbnail |
| `GET /api/render_image?...` | Render/convert image |

### Auth
- `GET/POST /auth/login`
- `POST /auth/logout`



## 🛠 Troubleshooting

### Login loop (401 error)
- Check `SESSION_SECRET` length (must be 16+ chars)
- Ensure cookies are enabled in your browser
- Verify public path list in `security.py`

### No thumbnails
- Set `ENABLE_THUMBNAILS=True`
- Install `ffmpeg`
- Check `.thumb_cache` directory

### HEIC images not loading
- Install `pillow-heif`
- Confirm `init_heic()` runs in `heic_init.py`

### Permission denied
- Verify OS file permissions
- Restrict with `ALLOWED_ROOTS`

---

## 📂 Project Structure

```
hdd_browser/
├──hdd_browser/
  ├── app/
  │   ├── main.py           # App entrypoint
  │   ├── config.py         # Config handling
  │   ├── auth.py           # Auth & sessions
  │   ├── security.py       # Public/private path rules
  │   ├── drive_discovery.py# Drive detection
  │   ├── file_ops.py       # File operations
  │   ├── thumbnailer.py    # Thumbnails
  │   ├── heic_init.py      # HEIC support
  │   ├── templates/        # UI templates
  │   └── static/           # CSS & JS
  ├── requirements.txt

```

---

## 💡 Tips & Tricks

- Mount network shares → then browse them via this app.
- Use `ALLOWED_ROOTS` to limit to a specific folder (e.g., `/home/media`).
- Run as a systemd service for 24/7 uptime.

---

