// =============================
// Utility / Helpers
// =============================
async function fetchJSON(url) {
  const r = await fetch(url, { credentials: "same-origin", cache: "no-store" });
  if (!r.ok) throw new Error(await r.text().catch(() => r.statusText || `HTTP ${r.status}`));
  return await r.json();
}

function formatSize(bytes) {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "–";
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(2) + " MB";
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(2) + " KB";
  return bytes + " B";
}

function escapeHtml(s) {
  return (s == null ? "" : String(s))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function absoluteHref(pathOrUrl) {
  try {
    return new URL(pathOrUrl, window.location.origin).href;
  } catch {
    return pathOrUrl;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("driveSelect")) initBrowser();
  if (document.getElementById("searchForm")) initSearch();
});

// =============================
// Thumbnail queue with deterministic order (no blob:, serial by default)
// =============================

// Override with window.THUMB_MAX_CONC to increase concurrency. Default 1 = strict serial.
const THUMB_MAX_CONC = Math.max(1, Number(window.THUMB_MAX_CONC || 1));

class ThumbQueue {
  constructor(max = 1) {
    this.max = Math.max(1, max);
    this.q = []; // FIFO tasks {imgEl, url, seq}
    this.running = 0;
    this.paused = false;
    this._resumeTimer = null;
  }
  enqueue(imgEl, url, seq = 0) {
    if (!imgEl || !url) return;
    if (imgEl.dataset.loaded === "1") return;
    if (imgEl.dataset.loading === "1") return;
    const s = Number(seq || imgEl.dataset.seq || 0);
    this.q.push({ imgEl, url, seq: s });
    this.q.sort((a, b) => a.seq - b.seq);
    this._pump();
  }
  pause() { this.paused = true; }
  resume() { this.paused = false; this._pump(); }
  clearQueue() { this.q = []; }
  _startImageLoad(imgEl, url) {
    return new Promise((resolve) => {
      const opts = { once: true };
      const done = () => {
        imgEl.removeEventListener("load", onLoad, opts);
        imgEl.removeEventListener("error", onError, opts);
        imgEl.dataset.loading = "0";
        resolve();
      };
      const onLoad = () => { imgEl.dataset.loaded = "1"; done(); };
      const onError = () => { done(); };
      imgEl.addEventListener("load", onLoad, opts);
      imgEl.addEventListener("error", onError, opts);
      imgEl.setAttribute("fetchpriority", "low");
      imgEl.decoding = "async";
      imgEl.loading = "lazy";
      imgEl.dataset.loading = "1";
      imgEl.src = url;
    });
  }
  _pump() {
    if (this.paused) return;
    while (this.running < this.max && this.q.length) {
      const task = this.q.shift();
      this.running++;
      this._startImageLoad(task.imgEl, task.url)
        .catch(() => {})
        .finally(() => { this.running--; this._pump(); });
    }
  }
}

const thumbQueue = new ThumbQueue(THUMB_MAX_CONC);
window.__thumbQueue = thumbQueue; // debug handle

// Lazy-load thumbnails with IntersectionObserver (queueing in stable order)
let thumbObserver = null;
if ("IntersectionObserver" in window) {
  thumbObserver = new IntersectionObserver(
    (entries, obs) => {
      const ready = [];
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const img = e.target;
        if (img?.dataset?.src && img.dataset.queued !== "1") {
          ready.push(img);
        }
        obs.unobserve(img);
      }
      ready.sort((a, b) => Number(a.dataset.seq || 0) - Number(b.dataset.seq || 0));
      for (const img of ready) {
        const url = img.dataset.src;
        img.dataset.queued = "1";
        thumbQueue.enqueue(img, url, Number(img.dataset.seq || 0));
      }
    },
    { rootMargin: "100px 0px" }
  );
}

// Prefetch helper for upcoming gallery images
function prefetchImage(url) {
  try {
    const img = new Image();
    img.decoding = "async";
    img.loading = "eager";
    img.src = url;
  } catch {}
}

// =============================
// Media Detection
// =============================
function isPreviewableImage(mime, name) {
  const ext = (name || "").toLowerCase().split(".").pop();
  return (
    ["jpg", "jpeg", "png", "webp", "gif", "bmp", "heic", "heif", "avif", "tiff"].includes(ext) ||
    (mime && mime.startsWith("image/"))
  );
}
function isPreviewableVideo(mime, name) {
  const ext = (name || "").toLowerCase().split(".").pop();
  return (
    ["mp4", "webm", "mov", "m4v", "avi", "mkv", "ogg"].includes(ext) ||
    (mime && mime.startsWith("video/"))
  );
}
function isMedia(mime, name) {
  return isPreviewableImage(mime, name) || isPreviewableVideo(mime, name);
}

// =============================
// Simple Media Modal (images/videos)
// =============================
let _mediaModalZ = 1000;
function createMediaModal({ title, type, src, downloadHref, poster, onPrev, onNext, onClose }) {
  const backdrop = document.createElement("div");
  backdrop.className = "media-modal-backdrop";
  backdrop.style.zIndex = String(_mediaModalZ++);

  const box = document.createElement("div");
  box.className = "media-modal-box";
  box.innerHTML = `
    <div class="media-modal-header">
      <span class="media-modal-title" title="${escapeHtml(title || "")}">${escapeHtml(title || "")}</span>
      <div class="media-modal-actions">
        ${onPrev ? `<button class="media-modal-btn media-modal-prev" aria-label="Previous">‹ Prev</button>` : ""}
        ${onNext ? `<button class="media-modal-btn media-modal-next" aria-label="Next">Next ›</button>` : ""}
        ${downloadHref ? `<a class="media-modal-btn media-modal-download" href="${downloadHref}" download>Download</a>` : ""}
        <button class="media-modal-btn media-modal-close" aria-label="Close">✕</button>
      </div>
    </div>
    <div class="media-modal-body">
      <img class="media-modal-img" alt="">
      <video class="media-modal-video" controls style="display:none;"></video>
    </div>
  `;

  backdrop.appendChild(box);
  document.body.appendChild(backdrop);

  const titleEl = box.querySelector(".media-modal-title");
  const imgEl = box.querySelector(".media-modal-img");
  const vidEl = box.querySelector(".media-modal-video");
  const closeBtn = box.querySelector(".media-modal-close");
  const prevBtn = box.querySelector(".media-modal-prev");
  const nextBtn = box.querySelector(".media-modal-next");
  const dlLink = box.querySelector(".media-modal-download");

  function setMedia({ title, type, src, downloadHref, poster }) {
    if (vidEl) {
      try { vidEl.pause(); } catch {}
      vidEl.removeAttribute("src");
      vidEl.removeAttribute("poster");
      vidEl.load?.();
    }
    if (titleEl) {
      titleEl.textContent = title || "";
      titleEl.setAttribute("title", title || "");
    }
    if (type === "image") {
      if (imgEl) {
        imgEl.style.display = "block";
        imgEl.alt = title || "";
        imgEl.decoding = "async";
        imgEl.src = src;
      }
      if (vidEl) vidEl.style.display = "none";
    } else {
      if (imgEl) {
        imgEl.style.display = "none";
        imgEl.src = "";
        imgEl.removeAttribute("src");
      }
      if (vidEl) {
        vidEl.style.display = "block";
        vidEl.preload = "metadata";
        vidEl.playsInline = true;
        if (poster) vidEl.poster = poster;
        vidEl.src = src;
      }
    }
    if (dlLink) {
      if (downloadHref) {
        dlLink.href = downloadHref;
        dlLink.style.display = "";
      } else {
        dlLink.style.display = "none";
        dlLink.removeAttribute("href");
      }
    }
  }

  function cleanup() {
    try {
      if (vidEl) {
        try { vidEl.pause(); } catch {}
        vidEl.removeAttribute("src");
        vidEl.load?.();
      }
    } catch {}
    backdrop.remove();
    if (typeof onClose === "function") {
      try { onClose(); } catch {}
    }
  }

  // Close button and backdrop click (clicking outside box only)
  closeBtn?.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); cleanup(); });
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) { e.preventDefault(); e.stopPropagation(); cleanup(); } });

  if (prevBtn && onPrev) prevBtn.addEventListener("click", (e) => { e.stopPropagation(); onPrev(); });
  if (nextBtn && onNext) nextBtn.addEventListener("click", (e) => { e.stopPropagation(); onNext(); });

  // ESC to close
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault(); e.stopPropagation();
      cleanup();
      window.removeEventListener("keydown", onKey, true);
    }
  };
  window.addEventListener("keydown", onKey, true);

  setMedia({ title, type, src, downloadHref, poster });
  return { setMedia, close: cleanup };
}

// =============================
// Text / Code Modal (json/jso, py, ipynb, csv, txt, cpp)
// =============================
function createTextModal({ title, text, downloadHref, truncated }) {
  const backdrop = document.createElement("div");
  backdrop.className = "media-modal-backdrop";
  backdrop.style.zIndex = String(++_mediaModalZ);

  const box = document.createElement("div");
  box.className = "media-modal-box";
  box.innerHTML = `
    <div class="media-modal-header">
      <span class="media-modal-title" title="${escapeHtml(title || "")}">${escapeHtml(title || "")}</span>
      <div class="media-modal-actions">
        ${downloadHref ? `<a class="media-modal-btn media-modal-download" href="${downloadHref}" download>Download</a>` : ""}
        <button class="media-modal-btn media-modal-copy" aria-label="Copy">Copy</button>
        <button class="media-modal-btn media-modal-close" aria-label="Close">✕</button>
      </div>
    </div>
    <div class="media-modal-body" style="display:block;">
      ${truncated ? `<div class="muted small" style="margin-bottom:6px;">Note: Preview truncated</div>` : ""}
      <pre class="modal-code" style="max-height:70vh;overflow:auto;white-space:pre;line-height:1.4;background:rgba(0,0,0,.06);padding:12px;border-radius:8px;"><code></code></pre>
    </div>
  `;

  const codeEl = box.querySelector("code");
  codeEl.textContent = text || "";

  backdrop.appendChild(box);
  document.body.appendChild(backdrop);

  const closeBtn = box.querySelector(".media-modal-close");
  const copyBtn = box.querySelector(".media-modal-copy");

  function cleanup() { backdrop.remove(); }

  closeBtn?.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); cleanup(); });
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) { e.preventDefault(); e.stopPropagation(); cleanup(); } });
  copyBtn?.addEventListener("click", async (e) => {
    e.preventDefault(); e.stopPropagation();
    try {
      await navigator.clipboard.writeText(codeEl.textContent || "");
      copyBtn.textContent = "Copied";
      setTimeout(() => (copyBtn.textContent = "Copy"), 1200);
    } catch {
      copyBtn.textContent = "Failed";
      setTimeout(() => (copyBtn.textContent = "Copy"), 1200);
    }
  });

  return { close: cleanup };
}

function shouldOpenTextModal(name, mime) {
  const ext = (name || "").toLowerCase().split(".").pop();
  // Modalize these as text/code
  const modalExts = new Set(["jso", "json", "py", "ipynb", "csv", "txt", "cpp"]);
  if (modalExts.has(ext)) return true;
  if (mime && (mime.startsWith("text/") || mime.includes("json"))) return true;
  return false;
}

// Fallback: fetch file text when /api/preview has no text (e.g., ipynb/csv)
async function fetchTextPreview(downloadHref, ext) {
  const MAX_BYTES = 1_500_000; // ~1.5MB
  const MAX_LINES = 2000;      // cap lines for CSV/TXT
  try {
    const r = await fetch(downloadHref, { credentials: "same-origin" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const blob = await r.blob();
    let truncated = false;
    let text;
    if (blob.size > MAX_BYTES) {
      text = await blob.slice(0, MAX_BYTES).text();
      truncated = true;
    } else {
      text = await blob.text();
    }
    const lowerExt = (ext || "").toLowerCase();
    if (["ipynb", "json", "jso"].includes(lowerExt)) {
      try { text = JSON.stringify(JSON.parse(text), null, 2); } catch {}
    } else if (["csv", "txt"].includes(lowerExt)) {
      const lines = text.split(/\r?\n/);
      if (lines.length > MAX_LINES) {
        text = lines.slice(0, MAX_LINES).join("\n");
        truncated = true;
      }
    }
    return { text, truncated };
  } catch {
    return null;
  }
}

// =============================
// Document Modal (PDF embed; Office via Office Online Viewer)
// =============================
function createDocModal({ title, pdfObjectUrl, officeEmbedUrl, downloadHref, mime, note }) {
  const backdrop = document.createElement("div");
  backdrop.className = "media-modal-backdrop";
  backdrop.style.zIndex = String(++_mediaModalZ);

  const box = document.createElement("div");
  box.className = "media-modal-box";
  const bodyInner = (() => {
    if (pdfObjectUrl) {
      return `<iframe class="doc-frame" title="Document" style="width:100%;height:70vh;border:0;background:#fff;" src="${pdfObjectUrl}"></iframe>`;
    }
    if (officeEmbedUrl) {
      return `<iframe class="doc-frame" title="Document" style="width:100%;height:70vh;border:0;background:#fff;" src="${officeEmbedUrl}"></iframe>
              <div class="muted small" style="margin-top:6px;">If the viewer doesn't load, the file may not be publicly reachable by Office Online. Use Open or Download.</div>`;
    }
    return `
      <div class="muted" style="margin:8px 0 12px;">
        ${escapeHtml(note || "Preview not supported in-browser. Use Open or Download.")}
      </div>`;
  })();

  box.innerHTML = `
    <div class="media-modal-header">
      <span class="media-modal-title" title="${escapeHtml(title || "")}">${escapeHtml(title || "")}</span>
      <div class="media-modal-actions">
        ${downloadHref ? `<a class="media-modal-btn media-modal-download" href="${downloadHref}" target="_blank">Open</a>` : ""}
        ${downloadHref ? `<a class="media-modal-btn" href="${downloadHref}" download>Download</a>` : ""}
        <button class="media-modal-btn media-modal-close" aria-label="Close">✕</button>
      </div>
    </div>
    <div class="media-modal-body" style="display:block;">
      ${bodyInner}
    </div>
  `;

  backdrop.appendChild(box);
  document.body.appendChild(backdrop);

  const closeBtn = box.querySelector(".media-modal-close");
  function cleanup() {
    try { if (pdfObjectUrl && pdfObjectUrl.startsWith("blob:")) URL.revokeObjectURL(pdfObjectUrl); } catch {}
    backdrop.remove();
  }
  closeBtn?.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); cleanup(); });
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) { e.preventDefault(); e.stopPropagation(); cleanup(); } });

  // ESC to close
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault(); e.stopPropagation();
      cleanup();
      window.removeEventListener("keydown", onKey, true);
    }
  };
  window.addEventListener("keydown", onKey, true);

  return { close: cleanup };
}

function shouldOpenDocModal(name, mime) {
  const ext = (name || "").toLowerCase().split(".").pop();
  // Docs we show in a doc modal: PDF, Office formats
  const docExts = new Set(["pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx"]);
  if (docExts.has(ext)) return true;
  if (mime && (mime === "application/pdf" || mime.startsWith("application/vnd.openxmlformats"))) return true;
  return false;
}

// =============================
// Browser Page
// =============================
async function initBrowser() {
  const driveSelect = document.getElementById("driveSelect");
  const entriesDiv = document.getElementById("entries");
  const currentPathSpan = document.getElementById("currentPath");
  const upBtn = document.getElementById("upBtn");
  const toggleViewBtn = document.getElementById("toggleViewBtn");
  const previewDiv = document.getElementById("preview");
  const sortSelect = document.getElementById("sortSelect");

  // Global flags provided by template (fallbacks in case undefined)
  const enableUpload = typeof window.enableUpload !== "undefined" ? window.enableUpload : true;
  const enableDelete = typeof window.enableDelete !== "undefined" ? window.enableDelete : false;
  const enableThumbs = typeof window.enableThumbs !== "undefined" ? window.enableThumbs : true;

  // Query params
  const params = new URLSearchParams(window.location.search);
  let currentDrive = params.get("drive_id") || "";
  let relPath = ""; // current relative directory path
  let currentEntries = [];
  let viewMode = "list";

  // Supported modes: name, -name, type, size, -size, modified, -modified
  let currentSortMode = (sortSelect && sortSelect.value) || "name";

  // Media gallery state
  let gallery = [];
  let galleryIndex = -1;
  let modalAPI = null;

  // Deterministic sequence assignment for grid images
  let seqCounter = 1;

  function exposeGlobals() {
    window.__currentDrive = currentDrive;
    window.__relPath = relPath || "";
    window.loadDir = loadDir;
  }

  function syncUploadHidden() {
    const d = document.getElementById("uploadDrive");
    const p = document.getElementById("uploadRelPath");
    if (d) d.value = currentDrive || "";
    if (p) p.value = relPath || "";
  }

  // Load drives
  try {
    const drives = await fetchJSON("/api/drives");
    const opts = Array.isArray(drives)
      ? drives.map((d) =>
          typeof d === "string"
            ? { id: d, label: d }
            : { id: d.id || d.drive_id || d.name || d.path || "", label: d.label || d.name || d.path || d.id || "" }
        )
      : [];
    driveSelect.innerHTML = "";
    for (const d of opts) {
      if (!d.id) continue;
      const opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = d.label || d.id;
      driveSelect.appendChild(opt);
    }
    if (!currentDrive && driveSelect.options.length) {
      currentDrive = driveSelect.options[0].value;
    }
    if (currentDrive) driveSelect.value = currentDrive;
  } catch (e) {
    console.error("Failed to load drives:", e);
  }

  // Handlers
  driveSelect.addEventListener("change", () => {
    currentDrive = driveSelect.value;
    relPath = "";
    exposeGlobals();
    syncUploadHidden();
    thumbQueue.clearQueue(); // drop pending thumbs
    loadDir();
  });

  upBtn.addEventListener("click", () => {
    if (!relPath) return;
    const parts = relPath.split("/").filter(Boolean);
    parts.pop();
    relPath = parts.join("/");
    exposeGlobals();
    syncUploadHidden();
    thumbQueue.clearQueue();
    loadDir();
  });

  toggleViewBtn.addEventListener("click", () => {
    viewMode = viewMode === "list" ? "grid" : "list";
    toggleViewBtn.textContent = viewMode === "list" ? "Grid View" : "List View";
    renderEntries(currentEntries);
  });

  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      currentSortMode = sortSelect.value || "name";
      renderEntries(currentEntries);
    });
  }

  (function wireUpload() {
    const uploadSection = document.getElementById("uploadSection");
    if (uploadSection && enableUpload) uploadSection.style.display = "block";

    const uploadBtn = document.getElementById("uploadBtn");
    const fileInput = document.getElementById("fileInput");
    const folderInput = document.getElementById("folderInput");
    const resultEl = document.getElementById("uploadResult");

    function setStatus(msg) { if (resultEl) resultEl.textContent = msg || ""; }

    function ensureContext() {
      if (!currentDrive) { alert("Select a drive before uploading."); return false; }
      return true;
    }

    uploadBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      if (!ensureContext()) return;
      if (e.altKey) folderInput?.click(); else fileInput?.click();
    });
    uploadBtn?.addEventListener("contextmenu", (e) => { e.preventDefault(); if (!ensureContext()) return; folderInput?.click(); });

    let lpTimer = null;
    function clearLP() { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } }
    uploadBtn?.addEventListener("pointerdown", () => { if (!ensureContext()) return; clearLP(); lpTimer = setTimeout(() => folderInput?.click(), 550); });
    uploadBtn?.addEventListener("pointerup", clearLP);
    uploadBtn?.addEventListener("pointerleave", clearLP);

    async function uploadFiles(list) {
      if (!ensureContext() || !list || !list.length) return;
      const total = list.length;
      let done = 0, ok = 0, failed = 0;
      const CONC = 3;
      let idx = 0;

      function nextJob() {
        if (idx >= total) return null;
        const f = list[idx++];
        const relFull = (f.webkitRelativePath && f.webkitRelativePath.length > 0) ? f.webkitRelativePath : f.name;
        const subDir = relFull.includes("/") ? relFull.split("/").slice(0, -1).join("/") : "";
        const targetRelDir = [relPath || "", subDir].filter(Boolean).join("/");
        return async () => {
          const form = new FormData();
          form.append("drive_id", currentDrive);
          form.append("rel_path", targetRelDir);
          form.append("file", f, f.name);
          try {
            const r = await fetch("/api/upload", { method: "POST", body: form, credentials: "same-origin" });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            ok++;
          } catch { failed++; } finally {
            done++; setStatus(`Uploading ${done}/${total}… (ok: ${ok}, failed: ${failed})`);
          }
        };
      }

      setStatus(`Uploading 0/${total}…`);
      const workers = Array.from({ length: Math.min(CONC, total) }, async () => {
        while (true) { const job = nextJob(); if (!job) break; await job(); }
      });
      await Promise.all(workers);
      setStatus(`Uploaded ${ok}/${total}${failed ? ` (failed: ${failed})` : ""}.`);
      await loadDir();
    }

    fileInput?.addEventListener("change", async () => { await uploadFiles(fileInput.files); if (fileInput) fileInput.value = ""; });
    folderInput?.addEventListener("change", async () => { await uploadFiles(folderInput.files); if (folderInput) folderInput.value = ""; });
  })();

  function entryTypeRank(ent) {
    if (ent.is_dir) return 0;
    if (isPreviewableImage(ent.mime, ent.name)) return 1;
    if (isPreviewableVideo(ent.mime, ent.name)) return 2;
    return 3;
  }

  function sortEntries(entries) {
    const mode = (typeof currentSortMode === "string" && currentSortMode) || "name";
    const asc = !mode.startsWith("-");
    const key = asc ? mode : mode.slice(1);
    const arr = entries.slice();
    arr.sort((a, b) => {
      if (key === "type") { const rA = entryTypeRank(a), rB = entryTypeRank(b); return asc ? rA - rB : rB - rA; }
      if (key === "size") { const sA = a.is_dir ? -1 : a.size || 0, sB = b.is_dir ? -1 : b.size || 0; return asc ? sA - sB : sB - sA; }
      if (key === "modified") { const mA = a.modified || 0, mB = b.modified || 0; return asc ? mA - mB : mB - mA; }
      const nA = (a.name || "").toLowerCase(), nB = (b.name || "").toLowerCase();
      if (nA < nB) return asc ? -1 : 1;
      if (nA > nB) return asc ? 1 : -1;
      return 0;
    });
    return arr;
  }

  async function loadDir() {
    previewDiv.innerHTML = "";
    if (!currentDrive) { entriesDiv.innerHTML = "<p>Select a drive</p>"; return; }
    seqCounter = 1;
    const url = `/api/list?drive_id=${encodeURIComponent(currentDrive)}&rel_path=${encodeURIComponent(relPath)}`;
    try {
      const data = await fetchJSON(url);
      currentPathSpan.textContent = data.path || "";
      currentEntries = Array.isArray(data.entries) ? data.entries : [];
      gallery = []; galleryIndex = -1; modalAPI = null;
      renderEntries(currentEntries);
      exposeGlobals();
      syncUploadHidden();
      if (enableUpload) { const us = document.getElementById("uploadSection"); if (us) us.style.display = "block"; }
    } catch (e) {
      entriesDiv.innerHTML = `<p>Error: ${escapeHtml(e.message)}</p>`;
    }
  }

  function renderEntries(entries) {
    const sorted = sortEntries(entries);
    if (viewMode === "grid") renderGrid(sorted); else renderTable(sorted);
    if (enableUpload) { const us = document.getElementById("uploadSection"); if (us) us.style.display = "block"; }
  }

  function buildGallery() { gallery = currentEntries.filter((e) => !e.is_dir && isMedia(e.mime, e.name)); }

  function deprioritizeThumbsFor(ms = 3000) {
    thumbQueue.pause();
    if (thumbQueue._resumeTimer) clearTimeout(thumbQueue._resumeTimer);
    thumbQueue._resumeTimer = setTimeout(() => thumbQueue.resume(), ms);
  }

  function mediaSourceFor(entry) {
    const path = relPath ? `${relPath}/${entry.name}` : entry.name;
    const encodedRel = encodeURIComponent(path);
    const encodedDrive = encodeURIComponent(currentDrive);

    const downloadHref = `/api/download?drive_id=${encodedDrive}&rel_path=${encodedRel}`;

    if (isPreviewableImage(entry.mime, entry.name)) {
      const maxDim = Math.min(Math.round((window.innerWidth || 1200) * 1.2), 1600);
      const src = `/api/render_image?drive_id=${encodedDrive}&rel_path=${encodedRel}&max_dim=${maxDim}`;
      return { type: "image", src, downloadHref };
    }

    if (isPreviewableVideo(entry.mime, entry.name)) {
      const src = `/api/stream?drive_id=${encodedDrive}&rel_path=${encodedRel}`;
      const poster = `/api/thumb?drive_id=${encodedDrive}&rel_path=${encodedRel}&size=480`;
      return { type: "video", src, downloadHref, poster };
    }

    return { type: "other", src: downloadHref, downloadHref };
  }

  function openMediaPopup(entry) {
    buildGallery();
    galleryIndex = gallery.findIndex((e) => e.name === entry.name);
    if (galleryIndex === -1 && gallery.length) galleryIndex = 0;

    deprioritizeThumbsFor(3000);

    const current = gallery.length ? gallery[galleryIndex] : entry;
    const currentMedia = mediaSourceFor(current);

    function navigate(delta) {
      if (!gallery.length) return;
      galleryIndex = (galleryIndex + delta + gallery.length) % gallery.length;
      const ent = gallery[galleryIndex];
      const nextMedia = mediaSourceFor(ent);
      if (modalAPI?.setMedia) {
        modalAPI.setMedia({
          title: ent.name,
          type: nextMedia.type,
          src: nextMedia.src,
          downloadHref: nextMedia.downloadHref,
          poster: nextMedia.poster,
        });
      }
      const preIdx = (galleryIndex + 1) % gallery.length;
      const upcoming = gallery[preIdx];
      if (upcoming && isPreviewableImage(upcoming.mime, upcoming.name)) {
        const preview = mediaSourceFor(upcoming);
        if (preview && preview.src) prefetchImage(preview.src);
      }
    }

    const api = createMediaModal({
      title: current.name,
      type: currentMedia.type,
      src: currentMedia.src,
      downloadHref: currentMedia.downloadHref,
      poster: currentMedia.poster,
      onPrev: gallery.length > 1 ? () => navigate(-1) : null,
      onNext: gallery.length > 1 ? () => navigate(+1) : null,
      onClose: () => { thumbQueue.resume(); }
    });
    modalAPI = api;

    if (gallery.length > 1) {
      const nextIndex = (galleryIndex + 1) % gallery.length;
      const upcoming = gallery[nextIndex];
      if (upcoming && isPreviewableImage(upcoming.mime, upcoming.name)) {
        const preview = mediaSourceFor(upcoming);
        if (preview && preview.src) prefetchImage(preview.src);
      }
    }
  }

  // Non-media preview routing (text/code modal, or doc modal)
  function openNonMediaPreview(name) {
    const path = relPath ? `${relPath}/${name}` : name;
    const url = `/api/preview?drive_id=${encodeURIComponent(currentDrive)}&rel_path=${encodeURIComponent(path)}`;
    const encodedDrive = encodeURIComponent(currentDrive);
    const encodedRel = encodeURIComponent(path);
    const downloadHref = `/api/download?drive_id=${encodedDrive}&rel_path=${encodedRel}`;

    fetchJSON(url)
      .then(async (data) => {
        const title = data?.name || name;
        const mime = data?.mime || "";
        const ext = (title || "").toLowerCase().split(".").pop();

        if (shouldOpenTextModal(title, mime)) {
          let text = data?.text || "";
          let truncated = !!data?.truncated;
          if (!text) {
            const t = await fetchTextPreview(downloadHref, ext);
            if (t) { text = t.text; truncated = truncated || t.truncated; }
          } else {
            if (["json", "jso", "ipynb"].includes(ext)) {
              try { text = JSON.stringify(JSON.parse(text), null, 2); } catch {}
            } else if (ext === "csv") {
              const lines = text.split(/\r?\n/);
              if (lines.length > 2000) { text = lines.slice(0, 2000).join("\n"); truncated = true; }
            }
          }
          createTextModal({ title, text, downloadHref, truncated });
          return;
        }

        if (shouldOpenDocModal(title, mime)) {
          const abs = absoluteHref(downloadHref);
          const isPdf = mime === "application/pdf" || ext === "pdf";
          if (isPdf) {
            // Embed PDF via blob for best compatibility
            let pdfUrl = "";
            try {
              const r = await fetch(downloadHref, { credentials: "same-origin" });
              if (!r.ok) throw new Error(`HTTP ${r.status}`);
              const blob = await r.blob();
              pdfUrl = URL.createObjectURL(blob);
            } catch {}
            createDocModal({ title, pdfObjectUrl: pdfUrl, officeEmbedUrl: "", downloadHref, mime: "application/pdf" });
          } else {
            // Office viewer embed (file must be publicly reachable by officeapps.live.com)
            const officeUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(abs)}`;
            createDocModal({
              title,
              pdfObjectUrl: "",
              officeEmbedUrl: officeUrl,
              downloadHref,
              mime,
              note: "Preview not supported in-browser. Use Open or Download."
            });
          }
          return;
        }

        // Fallback to bottom inline preview
        renderInlinePreview(data);
      })
      .catch((e) => {
        const previewDiv = document.getElementById("preview");
        if (previewDiv) previewDiv.innerHTML = `<p>Preview error: ${escapeHtml(e.message)}</p>`;
      });
  }

  function renderInlinePreview(data) {
    const previewDiv = document.getElementById("preview");
    if (!previewDiv) return;
    if (!data.mime && !data.name) {
      previewDiv.innerHTML = "<p>No preview.</p>";
      return;
    }
    const lowerName = data.name.toLowerCase();
    if (
      (data.mime && (data.mime.startsWith("text/") || data.mime === "application/json")) ||
      (!data.mime && lowerName.match(/\.(txt|json|log|md|csv)$/))
    ) {
      let body = data.text || "";
      if (lowerName.endsWith(".json") || lowerName.endsWith(".ipynb") || lowerName.endsWith(".jso")) {
        try { body = JSON.stringify(JSON.parse(body), null, 2); } catch {}
      }
      if (lowerName.endsWith(".csv")) {
        const lines = body.split(/\r?\n/);
        if (lines.length > 2000) body = lines.slice(0, 2000).join("\n") + "\n[TRUNCATED]";
      }
      previewDiv.innerHTML = `<h3>Preview: ${escapeHtml(
        data.name
      )}</h3><pre class="preview">${escapeHtml(body)}${data.truncated ? "\n[TRUNCATED]" : ""}</pre>`;
    } else {
      previewDiv.innerHTML = `<p>No inline preview for ${escapeHtml(data.name)} (${escapeHtml(
        data.mime || "unknown type"
      )})</p>`;
    }
  }

  function renderTable(entries) {
    if (!entries.length) { entriesDiv.innerHTML = "<p>(Empty)</p>"; return; }
    const table = document.createElement("table");
    table.innerHTML = `
      <thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Modified</th><th>Actions</th></tr></thead>
      <tbody></tbody>`;
    const tbody = table.querySelector("tbody");
    entries.forEach((ent) => {
      const icon = ent.is_dir ? "📁" : isPreviewableImage(ent.mime, ent.name) ? "🖼️" : isPreviewableVideo(ent.mime, ent.name) ? "🎬" : "📄";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${icon} <a href="#" data-name="${escapeHtml(ent.name)}">${escapeHtml(ent.name)}</a></td>
        <td>${ent.is_dir ? "DIR" : escapeHtml(ent.mime || "")}</td>
        <td>${ent.is_dir ? "" : formatSize(ent.size)}</td>
        <td>${new Date(ent.modified * 1000).toLocaleString()}</td>
        <td>
          ${
            !ent.is_dir
              ? `<button data-action="preview" data-name="${escapeHtml(ent.name)}">Preview</button>
            <a href="/api/download?drive_id=${encodeURIComponent(currentDrive)}&rel_path=${encodeURIComponent(
                  relPath ? relPath + "/" + ent.name : ent.name
                )}" target="_blank">Open</a>`
              : ""
          }
          ${enableDelete ? `<button data-action="delete" data-name="${escapeHtml(ent.name)}">Delete</button>` : ""}
        </td>
      `;
      const link = tr.querySelector("a");
      link.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        if (ent.is_dir) {
          relPath = relPath ? `${relPath}/${ent.name}` : ent.name;
          exposeGlobals(); syncUploadHidden(); thumbQueue.clearQueue(); loadDir();
        } else {
          if (isMedia(ent.mime, ent.name)) openMediaPopup(ent); else openNonMediaPreview(ent.name);
        }
      });
      tr.querySelectorAll("button[data-action]").forEach((btn) => {
        btn.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); handleAction(btn.dataset.action, ent.name, ent.is_dir); });
      });
      tbody.appendChild(tr);
    });
    entriesDiv.innerHTML = "";
    entriesDiv.appendChild(table);
    if (enableUpload) { const us = document.getElementById("uploadSection"); if (us) us.style.display = "block"; }
  }

  function renderGrid(entries) {
    entriesDiv.innerHTML = "";
    entriesDiv.classList.remove("list-mode", "grid-mode");
    entriesDiv.classList.add("grid-mode");
    if (!entries.length) { entriesDiv.innerHTML = "<p>(Empty)</p>"; return; }
    const frag = document.createDocumentFragment();
    entries.forEach((ent) => {
      const card = document.createElement("div");
      card.className = "thumb-card";
      const path = relPath ? `${relPath}/${ent.name}` : ent.name;
      let mediaHTML = "";
      if (ent.is_dir) {
        mediaHTML = `<div class="thumb-glyph folder-glyph">📁</div>`;
      } else if (enableThumbs && isPreviewableImage(ent.mime, ent.name)) {
        mediaHTML = `<img data-thumb="true" fetchpriority="low" alt="${escapeHtml(ent.name)}" loading="lazy" decoding="async" />`;
      } else if (enableThumbs && isPreviewableVideo(ent.mime, ent.name)) {
        mediaHTML = `<div class="thumb-glyph video-glyph">🎬</div>`;
      } else {
        mediaHTML = `<div class="thumb-glyph file-glyph">📄</div>`;
      }
      card.innerHTML = `
        ${mediaHTML}
        <div class="thumb-name" title="${escapeHtml(ent.name)}">${escapeHtml(ent.name)}</div>
        <div class="thumb-meta">${ent.is_dir ? "DIR" : formatSize(ent.size)}</div>
      `;
      card.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        if (ent.is_dir) {
          relPath = relPath ? `${relPath}/${ent.name}` : ent.name;
          exposeGlobals(); syncUploadHidden(); thumbQueue.clearQueue(); loadDir();
        } else {
          if (isMedia(ent.mime, ent.name)) openMediaPopup(ent); else openNonMediaPreview(ent.name);
        }
      });
      frag.appendChild(card);

      if (enableThumbs && !ent.is_dir && isPreviewableImage(ent.mime, ent.name)) {
        const imgEl = card.querySelector("img[data-thumb]");
        if (imgEl) {
          imgEl.dataset.seq = String(seqCounter++);
          const thumbURL = `/api/thumb?drive_id=${encodeURIComponent(currentDrive)}&rel_path=${encodeURIComponent(path)}&size=180`;
          if (thumbObserver) { imgEl.dataset.src = thumbURL; thumbObserver.observe(imgEl); }
          else { thumbQueue.enqueue(imgEl, thumbURL, Number(imgEl.dataset.seq || 0)); }
        }
      }
    });
    entriesDiv.appendChild(frag);
    if (enableUpload) { const us = document.getElementById("uploadSection"); if (us) us.style.display = "block"; }
  }

  async function handleAction(action, name, isDir) {
    if (action === "preview" && !isDir) {
      const entry = currentEntries.find((e) => e.name === name);
      if (entry && isMedia(entry.mime, entry.name)) { openMediaPopup(entry); return; }
      openNonMediaPreview(name); return;
    }

    if (action === "delete") {
      const targetRel = relPath ? `${relPath}/${name}` : name;
      const form = new FormData();
      form.append("drive_id", currentDrive);
      form.append("rel_path", targetRel);
      if (isDir) {
        if (!confirm(`Delete the folder "${name}" and all of its contents? This cannot be undone.`)) return;
        form.append("recursive", "1");
      } else {
        if (!confirm(`Delete ${name}?`)) return;
      }
      const r = await fetch("/api/delete", { method: "POST", body: form, credentials: "same-origin" });
      if (r.ok) loadDir();
      else { const msg = await r.text().catch(() => ""); alert(`Delete failed: ${r.status} ${msg}`); }
    }
  }

  // Initial load
  exposeGlobals();
  syncUploadHidden();
  loadDir();
}

// =============================
// Search Page (minimal)
// =============================
function initSearch() {
  const form = document.getElementById("searchForm");
  const results = document.getElementById("searchResults");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = form.querySelector("input[name='q']")?.value || "";
    const drive = form.querySelector("select[name='drive_id']")?.value || "";
    results.innerHTML = "Searching...";
    try {
      const data = await fetchJSON(`/api/search?drive_id=${encodeURIComponent(drive)}&q=${encodeURIComponent(q)}`);
      const items = Array.isArray(data?.results) ? data.results : [];
      if (!items.length) { results.innerHTML = "<p>No results</p>"; return; }
      const ul = document.createElement("ul");
      items.forEach((it) => {
        const li = document.createElement("li");
        li.textContent = `${it.path} (${formatSize(it.size || 0)})`;
        ul.appendChild(li);
      });
      results.innerHTML = "";
      results.appendChild(ul);
    } catch (err) {
      results.innerHTML = `<p>Error: ${escapeHtml(err.message)}</p>`;
    }
  });
}