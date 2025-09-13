// =============================
// Utility / Helpers
// =============================
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json();
}

function formatSize(bytes) {
  if (bytes >= 1e9) return (bytes/1e9).toFixed(2) + " GB";
  if (bytes >= 1e6) return (bytes/1e6).toFixed(2) + " MB";
  if (bytes >= 1e3) return (bytes/1e3).toFixed(2) + " KB";
  return bytes + " B";
}

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("driveSelect")) initBrowser();
  if (document.getElementById("searchForm")) initSearch();
});

// =============================
// Media Detection
// =============================
function isPreviewableImage(mime, name) {
  const ext = name.toLowerCase().split(".").pop();
  return ["jpg","jpeg","png","webp","gif","bmp","heic","heif"].includes(ext)
      || (mime && mime.startsWith("image/"));
}
function isPreviewableVideo(mime, name) {
  const ext = name.toLowerCase().split(".").pop();
  return (mime && mime.startsWith("video/")) ||
         ["mp4","mkv","mov","webm","avi"].includes(ext);
}
function isMedia(mime, name) {
  return isPreviewableImage(mime, name) || isPreviewableVideo(mime, name);
}

// =============================
// Independent Media Modals with Navigation
// =============================
let _mediaModalZ = 2100;
const _openModals = [];
let _activeNav = null; // { prev: fn, next: fn } when a modal with navigation is open

function createMediaModal({ title, type, src, downloadHref, onPrev, onNext }) {
  const backdrop = document.createElement("div");
  backdrop.className = "media-modal-backdrop";
  backdrop.style.zIndex = _mediaModalZ++;

  const box = document.createElement("div");
  box.className = "media-modal-box";
  box.innerHTML = `
    <div class="media-modal-header">
      <span class="media-modal-title" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
      <div class="media-modal-actions">
        ${onPrev ? `<button class="media-modal-btn media-modal-prev" aria-label="Previous">‹ Prev</button>` : ""}
        ${onNext ? `<button class="media-modal-btn media-modal-next" aria-label="Next">Next ›</button>` : ""}
        ${downloadHref ? `<a class="media-modal-btn media-modal-download" href="${downloadHref}" download>Download</a>` : ""}
        <button class="media-modal-btn media-modal-close" aria-label="Close">✕</button>
      </div>
    </div>
    <div class="media-modal-body">
      <img class="media-modal-img" alt="" style="display:${type === "image" ? "block" : "none"};" />
      <video class="media-modal-video" controls playsinline autoplay style="display:${type === "video" ? "block" : "none"};"></video>
    </div>
  `;

  backdrop.appendChild(box);
  document.body.appendChild(backdrop);
  document.body.classList.add("modal-open");

  const titleEl = box.querySelector(".media-modal-title");
  const closeBtn = box.querySelector(".media-modal-close");
  const prevBtn = box.querySelector(".media-modal-prev");
  const nextBtn = box.querySelector(".media-modal-next");
  const dlLink = box.querySelector(".media-modal-download");
  const imgEl = box.querySelector(".media-modal-img");
  const vidEl = box.querySelector(".media-modal-video");

  function setMedia({ title, type, src, downloadHref }) {
    // Stop and reset previous video
    if (vidEl) {
      try { vidEl.pause(); } catch {}
      vidEl.removeAttribute("src");
      vidEl.load?.();
    }
    // Update title
    if (titleEl) {
      titleEl.textContent = title || "";
      titleEl.setAttribute("title", title || "");
    }
    // Toggle elements and set src
    if (type === "image") {
      if (imgEl) {
        imgEl.style.display = "block";
        imgEl.alt = title || "";
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
        vidEl.src = src;
        // autoplay is set; some browsers may block if not user-initiated
      }
    }
    // Update download href
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

  // Initial media
  setMedia({ title, type, src, downloadHref });

  function closeModal() {
    // Clean up video
    if (vidEl) {
      try { vidEl.pause(); } catch {}
      vidEl.removeAttribute("src");
      vidEl.load?.();
    }
    backdrop.classList.add("closing");
    setTimeout(() => {
      backdrop.remove();
      const idx = _openModals.indexOf(closeModal);
      if (idx >= 0) _openModals.splice(idx, 1);
      if (_openModals.length === 0) {
        document.body.classList.remove("modal-open");
      }
      // Clear active nav if this was the last modal
      _activeNav = null;
    }, 160);
  }

  closeBtn.addEventListener("click", closeModal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });

  if (prevBtn && typeof onPrev === "function") {
    prevBtn.addEventListener("click", onPrev);
  }
  if (nextBtn && typeof onNext === "function") {
    nextBtn.addEventListener("click", onNext);
  }

  // Register active nav handlers if provided
  if (onPrev || onNext) {
    _activeNav = {
      prev: onPrev || null,
      next: onNext || null
    };
  }

  _openModals.push(closeModal);
  return { close: closeModal, backdrop, setMedia, imgEl, vidEl };
}

function closeTopModal() {
  if (_openModals.length) {
    _openModals[_openModals.length - 1]();
  }
}
function closeAllModals() {
  while (_openModals.length) {
    _openModals[_openModals.length - 1]();
  }
}
window.addEventListener("keydown", (e) => {
  if (_openModals.length) {
    if (e.key === "Escape") {
      if (e.shiftKey) {
        closeAllModals();
      } else {
        closeTopModal();
      }
      return;
    }
    // Arrow navigation for media modal
    if (e.key === "ArrowLeft" && _activeNav?.prev) {
      e.preventDefault();
      _activeNav.prev();
    } else if (e.key === "ArrowRight" && _activeNav?.next) {
      e.preventDefault();
      _activeNav.next();
    }
  }
});

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[c]));
}

// =============================
// Main Browser Initialization
// =============================
async function initBrowser() {
  const driveSelect = document.getElementById("driveSelect");
  const entriesDiv = document.getElementById("entries");
  const currentPathSpan = document.getElementById("currentPath");
  const upBtn = document.getElementById("upBtn");
  const toggleViewBtn = document.getElementById("toggleViewBtn");
  const previewDiv = document.getElementById("preview");
  const sortSelect = document.getElementById("sortSelect");

  const params = new URLSearchParams(window.location.search);
  let currentDrive = params.get("drive_id");
  let relPath = "";
  let currentEntries = [];
  let viewMode = "list";

  let currentSortMode = (sortSelect && sortSelect.value) || "name";

  // Media gallery state for navigation
  let gallery = [];       // array of media entries in current dir
  let galleryIndex = -1;  // index into gallery for current entry
  let modalAPI = null;    // { setMedia, close, ... }

  // Load drives
  try {
    const drives = await fetchJSON("/api/drives");
    driveSelect.innerHTML = "";
    drives.forEach(d => {
      const opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = d.id;
      if (d.id === currentDrive) opt.selected = true;
      driveSelect.appendChild(opt);
    });
    if (!currentDrive && drives.length) currentDrive = drives[0].id;
  } catch {
    entriesDiv.innerHTML = "<p>Error loading drives</p>";
    return;
  }

  // Event handlers
  driveSelect.addEventListener("change", () => {
    currentDrive = driveSelect.value;
    relPath = "";
    loadDir();
  });

  upBtn.addEventListener("click", () => {
    if (!relPath) return;
    const parts = relPath.split("/").filter(Boolean);
    parts.pop();
    relPath = parts.join("/");
    loadDir();
  });

  if (toggleViewBtn) {
    toggleViewBtn.addEventListener("click", () => {
      viewMode = viewMode === "list" ? "grid" : "list";
      toggleViewBtn.textContent = viewMode === "list" ? "Grid View" : "List View";
      entriesDiv.classList.remove("list-mode","grid-mode");
      entriesDiv.classList.add(viewMode + "-mode");
      renderEntries(currentEntries);
    });
  }

  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      currentSortMode = sortSelect.value;
      renderEntries(currentEntries);
    });
  }

  async function loadDir() {
    previewDiv.innerHTML = "";
    const url = `/api/list?drive_id=${encodeURIComponent(currentDrive)}&rel_path=${encodeURIComponent(relPath)}`;
    try {
      const data = await fetchJSON(url);
      currentPathSpan.textContent = data.path;
      currentEntries = data.entries;
      // reset gallery on dir change
      gallery = [];
      galleryIndex = -1;
      modalAPI = null;
      renderEntries(currentEntries);
    } catch (e) {
      entriesDiv.innerHTML = `<p>Error: ${e.message}</p>`;
    }
  }

  // Sorting helpers
  function entryTypeRank(ent) {
    if (ent.is_dir) return 0;                                // Folders
    if (isPreviewableImage(ent.mime, ent.name)) return 1;    // Images
    if (isPreviewableVideo(ent.mime, ent.name)) return 2;    // Videos
    return 3;                                                // Others
  }

  function sortEntries(entries) {
    const arr = entries.slice();
    if (currentSortMode === "type") {
      arr.sort((a,b) => {
        const ra = entryTypeRank(a);
        const rb = entryTypeRank(b);
        if (ra !== rb) return ra - rb;
        return a.name.localeCompare(b.name, undefined, {sensitivity:"base"});
      });
    } else {
      arr.sort((a,b) => a.name.localeCompare(b.name, undefined, {sensitivity:"base"}));
    }
    return arr;
  }

  function renderEntries(entries) {
    const sorted = sortEntries(entries);
    if (viewMode === "grid" && enableThumbs) {
      renderGrid(sorted);
    } else {
      renderTable(sorted);
    }
  }

  // Build gallery of media files in current directory
  function buildGallery() {
    gallery = currentEntries.filter(e => !e.is_dir && isMedia(e.mime, e.name));
  }

  // Helper to compute URLs for a given entry
  function mediaSourceFor(entry) {
    const path = relPath ? `${relPath}/${entry.name}` : entry.name;
    if (isPreviewableImage(entry.mime, entry.name)) {
      const isHeic = entry.name.toLowerCase().endsWith(".heic") || entry.name.toLowerCase().endsWith(".heif");
      const src = isHeic
        ? `/api/render_image?drive_id=${encodeURIComponent(currentDrive)}&rel_path=${encodeURIComponent(path)}&max_dim=1800`
        : `/api/download?drive_id=${encodeURIComponent(currentDrive)}&rel_path=${encodeURIComponent(path)}`;
      const downloadHref = `/api/download?drive_id=${encodeURIComponent(currentDrive)}&rel_path=${encodeURIComponent(path)}`;
      return { type: "image", src, downloadHref };
    } else {
      const src = `/api/stream?drive_id=${encodeURIComponent(currentDrive)}&rel_path=${encodeURIComponent(path)}`;
      const downloadHref = `/api/download?drive_id=${encodeURIComponent(currentDrive)}&rel_path=${encodeURIComponent(path)}`;
      return { type: "video", src, downloadHref };
    }
  }

  function openMediaPopup(entry) {
    buildGallery();
    galleryIndex = gallery.findIndex(e => e.name === entry.name);
    if (galleryIndex === -1 && gallery.length) {
      galleryIndex = 0;
    }

    const current = gallery.length ? gallery[galleryIndex] : entry;
    const { type, src, downloadHref } = mediaSourceFor(current);

    function navigate(delta) {
      if (!gallery.length) return;
      galleryIndex = (galleryIndex + delta + gallery.length) % gallery.length; // wrap-around
      const ent = gallery[galleryIndex];
      const { type, src, downloadHref } = mediaSourceFor(ent);
      if (modalAPI?.setMedia) {
        modalAPI.setMedia({
          title: ent.name,
          type,
          src,
          downloadHref
        });
      }
    }

    const api = createMediaModal({
      title: current.name,
      type,
      src,
      downloadHref,
      onPrev: gallery.length > 1 ? () => navigate(-1) : null,
      onNext: gallery.length > 1 ? () => navigate(+1) : null
    });
    modalAPI = api;
  }

  function openNonMediaPreview(name) {
    const path = relPath ? `${relPath}/${name}` : name;
    const url = `/api/preview?drive_id=${encodeURIComponent(currentDrive)}&rel_path=${encodeURIComponent(path)}`;
    fetchJSON(url)
      .then((data) => renderInlinePreview(data))
      .catch((e) => { previewDiv.innerHTML = `<p>Preview error: ${e.message}</p>`; });
  }

  function renderTable(entries) {
    if (!entries.length) {
      entriesDiv.innerHTML = "<p>(Empty)</p>";
      return;
    }
    const table = document.createElement("table");
    table.innerHTML = `
      <thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Modified</th><th>Actions</th></tr></thead>
      <tbody></tbody>`;
    const tbody = table.querySelector("tbody");
    entries.forEach((ent) => {
      const icon = ent.is_dir ? "📁" :
        (isPreviewableImage(ent.mime, ent.name) ? "🖼️" :
          isPreviewableVideo(ent.mime, ent.name) ? "🎬" : "📄");
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${icon} <a href="#" data-name="${ent.name}">${ent.name}</a></td>
        <td>${ent.is_dir ? "DIR" : (ent.mime || "")}</td>
        <td>${ent.is_dir ? "" : formatSize(ent.size)}</td>
        <td>${new Date(ent.modified*1000).toLocaleString()}</td>
        <td>
          ${!ent.is_dir ? `<button data-action="preview" data-name="${ent.name}">Preview</button>
            <a href="/api/download?drive_id=${encodeURIComponent(currentDrive)}&rel_path=${encodeURIComponent(relPath ? relPath + '/' + ent.name : ent.name)}" target="_blank">Download</a>` : ""}
          ${enableDelete ? `<button data-action="delete" data-name="${ent.name}">Delete</button>` : ""}
        </td>
      `;
      const link = tr.querySelector("a");
      link.addEventListener("click", e => {
        e.preventDefault();
        if (ent.is_dir) {
          relPath = relPath ? `${relPath}/${ent.name}` : ent.name;
          loadDir();
        } else {
          if (isMedia(ent.mime, ent.name)) {
            openMediaPopup(ent);
          } else {
            openNonMediaPreview(ent.name);
          }
        }
      });
      tr.querySelectorAll("button[data-action]").forEach(btn => {
        btn.addEventListener("click", () => handleAction(
          btn.dataset.action,
          ent.name,
          ent.is_dir
        ));
      });
      tbody.appendChild(tr);
    });
    entriesDiv.innerHTML = "";
    entriesDiv.appendChild(table);
    if (enableUpload) {
      const us = document.getElementById("uploadSection");
      if (us) us.style.display = "block";
    }
  }

  function renderGrid(entries) {
    entriesDiv.innerHTML = "";
    entriesDiv.classList.remove("list-mode","grid-mode");
    entriesDiv.classList.add("grid-mode");
    if (!entries.length) {
      entriesDiv.innerHTML = "<p>(Empty)</p>";
      return;
    }
    const frag = document.createDocumentFragment();
    entries.forEach(ent => {
      const card = document.createElement("div");
      card.className = "thumb-card";
      const path = relPath ? `${relPath}/${ent.name}` : ent.name;
      let mediaHTML = "";
      if (ent.is_dir) {
        mediaHTML = `<div class="thumb-glyph folder-glyph">📁</div>`;
      } else if (enableThumbs && isPreviewableImage(ent.mime, ent.name)) {
        mediaHTML = `<img data-thumb="true" alt="${ent.name}" />`;
      } else if (enableThumbs && isPreviewableVideo(ent.mime, ent.name)) {
        mediaHTML = `<div class="thumb-glyph video-glyph">🎬</div>`;
      } else {
        mediaHTML = `<div class="thumb-glyph file-glyph">📄</div>`;
      }
      card.innerHTML = `
        ${mediaHTML}
        <div class="thumb-name" title="${ent.name}">${ent.name}</div>
        <div class="thumb-meta">${ent.is_dir ? "DIR" : formatSize(ent.size)}</div>
      `;
      card.addEventListener("click", () => {
        if (ent.is_dir) {
          relPath = relPath ? `${relPath}/${ent.name}` : ent.name;
          loadDir();
        } else {
          if (isMedia(ent.mime, ent.name)) {
            openMediaPopup(ent);
          } else {
            openNonMediaPreview(ent.name);
          }
        }
      });
      frag.appendChild(card);

      if (enableThumbs && !ent.is_dir && isPreviewableImage(ent.mime, ent.name)) {
        const imgEl = card.querySelector("img[data-thumb]");
        if (imgEl) {
          const thumbURL = `/api/thumb?drive_id=${encodeURIComponent(currentDrive)}&rel_path=${encodeURIComponent(path)}&size=220`;
          imgEl.src = thumbURL;
        }
      }
    });
    entriesDiv.appendChild(frag);
    if (enableUpload) {
      const us = document.getElementById("uploadSection");
      if (us) us.style.display = "block";
    }
  }

  async function handleAction(action, name, isDir) {
    if (action === "preview" && !isDir) {
      const entry = currentEntries.find(e => e.name === name);
      if (entry && isMedia(entry.mime, entry.name)) {
        openMediaPopup(entry);
        return;
      }
      openNonMediaPreview(name);
    } else if (action === "delete") {
      if (!confirm(`Delete ${name}?`)) return;
      const form = new FormData();
      form.append("drive_id", currentDrive);
      form.append("rel_path", relPath ? `${relPath}/${name}` : name);
      const r = await fetch("/api/delete", { method:"POST", body: form });
      if (r.ok) {
        loadDir();
      } else {
        alert("Delete failed");
      }
    }
  }

  function renderInlinePreview(data) {
    if (!data.mime && !data.name) {
      previewDiv.innerHTML = "<p>No preview.</p>";
      return;
    }
    const lowerName = data.name.toLowerCase();
    if ((data.mime && (data.mime.startsWith("text/") || data.mime === "application/json")) ||
        (!data.mime && lowerName.match(/\.(txt|json|log|md|csv)$/))) {
      previewDiv.innerHTML = `<h3>Preview: ${data.name}</h3><pre class="preview">${escapeHtml(data.text || "")}${data.truncated? "\n[TRUNCATED]" : ""}</pre>`;
    } else {
      previewDiv.innerHTML = `<p>No inline preview for ${data.name} (${data.mime || "unknown type"})</p>`;
    }
  }

  // Upload
  const uploadForm = document.getElementById("uploadForm");
  if (uploadForm) {
    uploadForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(uploadForm);
      fd.append("drive_id", currentDrive);
      fd.append("rel_path", relPath);
      const r = await fetch("/api/upload", { method:"POST", body: fd });
      const out = document.getElementById("uploadResult");
      if (r.ok) {
        out.textContent = "Upload complete.";
        loadDir();
      } else {
        out.textContent = "Upload failed.";
      }
    });
  }

  loadDir();
}

// =============================
// Search Page Init (if used)
// =============================
async function initSearch() {
  const driveSelect = document.getElementById("searchDrive");
  try {
    const drives = await fetchJSON("/api/drives");
    drives.forEach(d => {
      const opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = d.id;
      driveSelect.appendChild(opt);
    });
  } catch {}
  const form = document.getElementById("searchForm");
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const q = fd.get("query");
    const depth = fd.get("depth");
    const limit = fd.get("limit");
    const url = `/api/search?drive_id=${encodeURIComponent(driveSelect.value)}&query=${encodeURIComponent(q)}&depth=${depth}&limit=${limit}`;
    const resultsDiv = document.getElementById("searchResults");
    resultsDiv.textContent = "Searching...";
    try {
      const data = await fetchJSON(url);
      if (!data.results.length) {
        resultsDiv.textContent = "No matches.";
        return;
      }
      const ul = document.createElement("ul");
      data.results.forEach(r => {
        const li = document.createElement("li");
        li.innerHTML = `${r.is_dir ? "📁" : "📄"} ${r.path}`;
        ul.appendChild(li);
      });
      resultsDiv.innerHTML = "";
      resultsDiv.appendChild(ul);
    } catch (e2) {
      resultsDiv.textContent = "Search error.";
    }
  });
}