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

// Lazy-load thumbnails with IntersectionObserver
let thumbObserver = null;
if ("IntersectionObserver" in window) {
  thumbObserver = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          const img = e.target;
          if (img.dataset && img.dataset.src) {
            img.src = img.dataset.src;
            img.removeAttribute("data-src");
          }
          obs.unobserve(img);
        }
      });
    },
    { rootMargin: "200px 0px" }
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

function createMediaModal({ title, type, src, downloadHref, onPrev, onNext, poster }) {
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
      <video class="media-modal-video" controls playsinline autoplay preload="metadata" style="display:${type === "video" ? "block" : "none"};"></video>
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

  function setMedia({ title, type, src, downloadHref, poster }) {
    // Stop and reset previous video
    if (vidEl) {
      try { vidEl.pause(); } catch {}
      vidEl.removeAttribute("src");
      vidEl.removeAttribute("poster");
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
  setMedia({ title, type, src, downloadHref, poster });

  function closeModal() {
    if (vidEl) {
      try { vidEl.pause(); } catch {}
      vidEl.removeAttribute("src");
      vidEl.removeAttribute("poster");
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
      _activeNav = null;
    }, 160);
  }

  closeBtn.addEventListener("click", closeModal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });

  if (prevBtn && typeof onPrev === "function") prevBtn.addEventListener("click", onPrev);
  if (nextBtn && typeof onNext === "function") nextBtn.addEventListener("click", onNext);

  if (onPrev || onNext) {
    _activeNav = { prev: onPrev || null, next: onNext || null };
  }

  _openModals.push(closeModal);
  return { close: closeModal, backdrop, setMedia, imgEl, vidEl };
}

function closeTopModal() {
  if (_openModals.length) _openModals[_openModals.length - 1]();
}
function closeAllModals() {
  while (_openModals.length) _openModals[_openModals.length - 1]();
}
window.addEventListener("keydown", (e) => {
  if (_openModals.length) {
    if (e.key === "Escape") {
      if (e.shiftKey) closeAllModals();
      else closeTopModal();
      return;
    }
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

  // Supported modes: name, -name, type, size, -size, modified, -modified
  let currentSortMode = (sortSelect && sortSelect.value) || "name";

  // Media gallery state
  let gallery = [];
  let galleryIndex = -1;
  let modalAPI = null;

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

  // Handlers
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
    // Folders first, then images, then videos, then others
    if (ent.is_dir) return 0;
    if (isPreviewableImage(ent.mime, ent.name)) return 1;
    if (isPreviewableVideo(ent.mime, ent.name)) return 2;
    return 3;
  }

  function normalizeSort(modeRaw) {
    let mode = (modeRaw || "name").toString().toLowerCase();
    let desc = false;

    if (mode.startsWith("-")) {
      desc = true;
      mode = mode.slice(1);
    }

    // Accept a few aliases if ever used
    if (mode === "name_desc") { mode = "name"; desc = true; }
    if (mode === "name_asc") { mode = "name"; desc = false; }
    if (mode === "size_desc") { mode = "size"; desc = true; }
    if (mode === "size_asc") { mode = "size"; desc = false; }
    if (mode === "modified_desc" || mode === "date_desc") { mode = "modified"; desc = true; }
    if (mode === "modified_asc" || mode === "date_asc") { mode = "modified"; desc = false; }
    if (mode === "date") { mode = "modified"; }

    if (!["name","type","size","modified"].includes(mode)) mode = "name";

    return { mode, desc };
  }

  function compareNames(a, b) {
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  }

  function sortEntries(entries) {
    const arr = entries.slice();
    const { mode, desc } = normalizeSort(currentSortMode);

    arr.sort((a, b) => {
      // Keep folders-first grouping
      const ra = entryTypeRank(a);
      const rb = entryTypeRank(b);
      if (ra !== rb) return ra - rb;

      let cmp = 0;
      switch (mode) {
        case "type":
          // Within same group, fall back to name
          cmp = compareNames(a, b);
          break;
        case "size": {
          // Only for files; folders fall back to name
          const aFile = !a.is_dir;
          const bFile = !b.is_dir;
          if (aFile && bFile) {
            const sa = Number.isFinite(a.size) ? a.size : 0;
            const sb = Number.isFinite(b.size) ? b.size : 0;
            cmp = sa === sb ? compareNames(a, b) : (sa - sb);
          } else {
            cmp = compareNames(a, b);
          }
          break;
        }
        case "modified": {
          const ma = Number.isFinite(a.modified) ? a.modified : 0; // epoch seconds
          const mb = Number.isFinite(b.modified) ? b.modified : 0;
          cmp = ma === mb ? compareNames(a, b) : (ma - mb);
          break;
        }
        case "name":
        default:
          cmp = compareNames(a, b);
      }
      return desc ? -cmp : cmp;
    });

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

  // Compute URLs for a given entry (also optimizes image/video display)
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
    galleryIndex = gallery.findIndex(e => e.name === entry.name);
    if (galleryIndex === -1 && gallery.length) galleryIndex = 0;

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
          poster: nextMedia.poster
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
      onNext: gallery.length > 1 ? () => navigate(+1) : null
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
        mediaHTML = `<img data-thumb="true" alt="${ent.name}" loading="lazy" decoding="async" />`;
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
          const thumbURL = `/api/thumb?drive_id=${encodeURIComponent(currentDrive)}&rel_path=${encodeURIComponent(path)}&size=180`;
          if (thumbObserver) {
            imgEl.dataset.src = thumbURL;
            thumbObserver.observe(imgEl);
          } else {
            imgEl.src = thumbURL;
          }
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