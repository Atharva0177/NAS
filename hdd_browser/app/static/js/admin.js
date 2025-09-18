(function () {
  // Simple logger
  const LOGS = [];
  function log(...args) {
    LOGS.push([Date.now(), args.map(String).join(" ")]);
    try { console.log("[admin]", ...args); } catch {}
  }

  // Inject iOS-style toggle CSS (scoped to .feature-toggles)
  function injectIOSSwitchStyles() {
    if (document.getElementById("ios-toggle-styles")) return;
    const style = document.createElement("style");
    style.id = "ios-toggle-styles";
    style.textContent = `
/* iOS-style switches for admin feature toggles */
.feature-toggles { margin-top: 8px; }
.feature-toggles .toggle-item {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; padding: 6px 0; border-bottom: 1px dashed rgba(0,0,0,.06);
}
.feature-toggles .toggle-item:last-child { border-bottom: 0; }
.feature-toggles .toggle-label { font-size: .95rem; font-weight: 500; }

.feature-toggles .ios-toggle { width: 51px; height: 31px; position: relative; }
.feature-toggles .ios-checkbox {
  opacity: 0; width: 0; height: 0; position: absolute;
}
.feature-toggles .ios-switch {
  width: 100%; height: 100%; display: block;
  background-color: #e9e9eb; border-radius: 16px; cursor: pointer;
  transition: all 0.2s ease-out;
}
.feature-toggles .ios-slider {
  width: 27px; height: 27px; position: absolute;
  left: calc(50% - 27px/2 - 10px); top: calc(50% - 27px/2);
  border-radius: 50%; background: #FFFFFF;
  box-shadow: 0px 3px 8px rgba(0,0,0,0.15), 0px 3px 1px rgba(0,0,0,0.06);
  transition: all 0.2s ease-out; cursor: pointer;
}
.feature-toggles .ios-checkbox:checked + .ios-switch { background-color: #34C759; }
.feature-toggles .ios-checkbox:checked + .ios-switch .ios-slider {
  left: calc(50% - 27px/2 + 10px); top: calc(50% - 27px/2);
}
    `;
    document.head.appendChild(style);
  }

  // Helpers
  function fmtBytes(n) {
    if (!Number.isFinite(n)) return "–";
    const units = ["B","KB","MB","GB","TB","PB"];
    let i = 0, v = n;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2) + " " + units[i];
  }
  function fmtUptime(sec) {
    sec = sec | 0;
    const d = Math.floor(sec / 86400);
    sec -= d * 86400;
    const h = Math.floor(sec / 3600);
    sec -= h * 3600;
    const m = Math.floor(sec / 60);
    sec -= m * 60;
    const parts = [];
    if (d) parts.push(d + "d");
    if (h || parts.length) parts.push(h + "h");
    if (m || parts.length) parts.push(m + "m");
    parts.push(sec + "s");
    return parts.join(" ");
  }

  async function fetchJSON(url, timeoutMs = 15000) {
    log("fetch", url);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort("timeout"), timeoutMs);
    try {
      const r = await fetch(url, { credentials: "same-origin", cache: "no-store", signal: ctrl.signal });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        const err = new Error(`HTTP ${r.status}${text ? `: ${text}` : ""}`);
        err.status = r.status;
        err.body = text;
        throw err;
      }
      return await r.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function postForm(url, form) {
    log("post", url);
    const r = await fetch(url, { method: "POST", body: form, credentials: "same-origin", cache: "no-store" });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`${r.status} ${t}`);
    }
    return await r.json().catch(() => ({}));
  }

  function selectedRolesFrom(container) {
    return Array.from(container.querySelectorAll('input[name="role"]:checked')).map((i) => i.value);
  }

  function setFeaturesBadges(features) {
    const el = document.getElementById("featureBadges") || (() => {
      const s = document.createElement("div");
      s.id = "featureBadges";
      const stats = document.getElementById("stats");
      (stats || document.body).appendChild(s);
      return s;
    })();
    el.innerHTML = "";
    const mk = (label, on) => {
      const s = document.createElement("span");
      s.className = `badge pill ${on ? "on" : "off"}`;
      s.textContent = `${label}: ${on ? "on" : "off"}`;
      return s;
    };
    el.appendChild(mk("Uploads", !!features.uploads));
    el.appendChild(mk("Delete", !!features.delete));
    el.appendChild(mk("Thumbnails", !!features.thumbnails));
    el.appendChild(mk("HEIC", !!features.heic_conversion));
  }

  // Charts
  function chartColors() {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    return {
      grid: dark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.08)",
      text: dark ? "#eaeef5" : "#0f172a",
      palette: [
        "#8a5cf6","#ff4f8b","#00b7ff","#00ffa3",
        "#ff8a00","#e52e71","#60a5fa","#34d399",
        "#f59e0b","#fb7185","#22d3ee","#a78bfa",
      ],
    };
  }

  let rolesChart, rootsSizeChart, thumbTrendChart;
  function ensureCharts(dataUsers, dataStats) {
    if (typeof Chart === "undefined") {
      log("Chart.js not present; skipping charts.");
      return;
    }
    const colors = chartColors();

    // Roles doughnut
    const roleCounts = { admin:0, uploader:0, deleter:0, viewer:0 };
    (dataUsers.users || []).forEach(u => {
      (u.roles || []).forEach(r => { if (roleCounts[r] !== undefined) roleCounts[r]++; });
    });
    const rolesLabels = Object.keys(roleCounts);
    const rolesValues = rolesLabels.map(k => roleCounts[k]);

    if (!rolesChart) {
      rolesChart = new Chart(document.getElementById("rolesChart"), {
        type: "doughnut",
        data: {
          labels: rolesLabels,
          datasets: [{ data: rolesValues, backgroundColor: colors.palette.slice(0,4), borderWidth: 0 }]
        },
        options: {
          responsive: true,
          plugins: { legend: { position: "bottom", labels: { color: colors.text } } },
          cutout: "60%",
        }
      });
    } else {
      rolesChart.data.labels = rolesLabels;
      rolesChart.data.datasets[0].data = rolesValues;
      rolesChart.update();
    }

    // Roots by size bar
    const roots = (dataStats.roots_info || []).slice().sort((a,b)=>b.bytes - a.bytes).slice(0,7);
    const labels = roots.map(r => r.path.split(/[\\/]/).filter(Boolean).slice(-1)[0] || r.path);
    const values = roots.map(r => r.bytes);

    if (!rootsSizeChart) {
      rootsSizeChart = new Chart(document.getElementById("rootsSizeChart"), {
        type: "bar",
        data: {
          labels,
          datasets: [{
            label: "Bytes",
            data: values,
            backgroundColor: colors.palette.map(c => c + "66"),
            borderColor: colors.palette,
            borderWidth: 1.5,
          }]
        },
        options: {
          scales: {
            x: { ticks: { color: colors.text }, grid: { color: colors.grid } },
            y: {
              ticks: { color: colors.text, callback: v => fmtBytes(v) },
              grid: { color: colors.grid }
            }
          },
          plugins: { legend: { display: false } },
        }
      });
    } else {
      rootsSizeChart.data.labels = labels;
      rootsSizeChart.data.datasets[0].data = values;
      rootsSizeChart.update();
    }

    // Thumb cache trend (persist last 50 samples)
    const key = "nas:thumbTrend";
    const now = Date.now();
    const cur = Number(dataStats.thumb_cache_bytes || 0);
    let series = [];
    try { series = JSON.parse(localStorage.getItem(key) || "[]"); } catch {}
    series.push([now, cur]);
    if (series.length > 50) series = series.slice(-50);
    localStorage.setItem(key, JSON.stringify(series));

    const tLabels = series.map(p => new Date(p[0]).toLocaleTimeString());
    const tValues = series.map(p => p[1]);

    if (!thumbTrendChart) {
      thumbTrendChart = new Chart(document.getElementById("thumbTrendChart"), {
        type: "line",
        data: {
          labels: tLabels,
          datasets: [{
            label: "Thumb cache",
            data: tValues,
            borderColor: colors.palette[0],
            backgroundColor: colors.palette[0] + "2a",
            pointRadius: 0,
            tension: 0.35,
            fill: true,
          }]
        },
        options: {
          scales: {
            x: { ticks: { color: colors.text, maxRotation: 0 }, grid: { display: false } },
            y: { ticks: { color: colors.text, callback: v => fmtBytes(v) }, grid: { color: colors.grid } }
          },
          plugins: { legend: { display: false } },
        }
      });
    } else {
      thumbTrendChart.data.labels = tLabels;
      thumbTrendChart.data.datasets[0].data = tValues;
      thumbTrendChart.update();
    }
  }

  function applyStats(data) {
    const holder = document.getElementById("stats");
    if (!holder) { log("stats holder missing"); return; }

    const set = (k, v) => {
      const el = holder.querySelector(`[data-k="${k}"]`);
      if (!el) return;
      if (k.includes("bytes")) el.textContent = fmtBytes(v);
      else if (k === "uptime") el.textContent = fmtUptime(data.uptime_sec || 0);
      else el.textContent = String(v ?? "–");
    };

    set("uptime", data.uptime_sec);
    set("total_files", data.total_files);
    set("total_dirs", data.total_dirs);
    set("total_bytes", data.total_bytes);
    set("thumb_cache_bytes", data.thumb_cache_bytes);

    const ul = document.getElementById("rootsList");
    if (ul) {
      ul.innerHTML = "";
      (data.roots_info || []).forEach((ri) => {
        const li = document.createElement("li");
        li.innerHTML = `<strong>${ri.path}</strong><br/><span class="muted">${ri.files} files • ${ri.dirs} dirs • ${fmtBytes(ri.bytes)} ${ri.partial ? "(partial)" : ""}</span>`;
        ul.appendChild(li);
      });

      if (Array.isArray(data.unreachable_roots) && data.unreachable_roots.length) {
        const li = document.createElement("li");
        li.innerHTML = `<strong>Skipped roots</strong><br/><span class="muted">${
          data.unreachable_roots.map(x => `${x.path} [${x.reason}]`).join(", ")
        }</span>`;
        ul.appendChild(li);
      }
    }

    if (data.features) {
      setFeaturesBadges(data.features);
      ensureFeatureToggles(data.features);
    }
  }

  // Feature toggles UI and behavior using iOS-style switches
  function ensureFeatureToggles(features) {
    injectIOSSwitchStyles();

    const parent = document.getElementById("featureToggles") || (() => {
      const wrap = document.createElement("div");
      wrap.id = "featureToggles";
      wrap.className = "feature-toggles";
      const badges = document.getElementById("featureBadges");
      if (badges && badges.parentNode) {
        badges.parentNode.insertBefore(wrap, badges.nextSibling);
      } else {
        const stats = document.getElementById("stats");
        (stats || document.body).appendChild(wrap);
      }
      return wrap;
    })();

    // Build UI once (iOS-style markup)
    if (!parent.dataset.built) {
      parent.innerHTML = `
        <div class="toggle-item">
          <span class="toggle-label">Allow uploads</span>
          <div class="ios-toggle">
            <input type="checkbox" class="ios-checkbox" id="feat-uploads" data-key="uploads">
            <label class="ios-switch" for="feat-uploads"><span class="ios-slider"></span></label>
          </div>
        </div>
        <div class="toggle-item">
          <span class="toggle-label">Allow delete</span>
          <div class="ios-toggle">
            <input type="checkbox" class="ios-checkbox" id="feat-delete" data-key="delete">
            <label class="ios-switch" for="feat-delete"><span class="ios-slider"></span></label>
          </div>
        </div>
        <div class="toggle-item">
          <span class="toggle-label">Thumbnails</span>
          <div class="ios-toggle">
            <input type="checkbox" class="ios-checkbox" id="feat-thumbnails" data-key="thumbnails">
            <label class="ios-switch" for="feat-thumbnails"><span class="ios-slider"></span></label>
          </div>
        </div>
        <div class="toggle-item">
          <span class="toggle-label">HEIC conversion</span>
          <div class="ios-toggle">
            <input type="checkbox" class="ios-checkbox" id="feat-heic" data-key="heic_conversion">
            <label class="ios-switch" for="feat-heic"><span class="ios-slider"></span></label>
          </div>
        </div>
        <div class="muted small" id="featureStatus"></div>
      `;
      parent.dataset.built = "1";

      // Attach change listeners
      parent.querySelectorAll('.ios-checkbox[data-key]').forEach((cb) => {
        cb.addEventListener("change", async () => {
          const cont = parent;
          const status = cont.querySelector("#featureStatus");
          const cbs = Array.from(cont.querySelectorAll('.ios-checkbox[data-key]'));
          const prev = Object.fromEntries(cbs.map(el => [el.dataset.key, el.checked]));
          const payload = Object.fromEntries(cbs.map(el => [el.dataset.key, el.checked ? "1" : "0"]));

          cbs.forEach(el => el.disabled = true);
          if (status) status.textContent = "Updating features...";

          try {
            const fd = new FormData();
            fd.append("uploads", payload.uploads);
            fd.append("delete", payload.delete);
            fd.append("thumbnails", payload.thumbnails);
            fd.append("heic_conversion", payload.heic_conversion);
            const res = await postForm("/api/admin/features/update", fd);
            if (res && res.features) {
              setFeaturesBadges(res.features);
              cbs.forEach(el => {
                const k = el.dataset.key;
                if (k in res.features) el.checked = !!res.features[k];
              });
            }
            if (status) status.textContent = "Features updated.";
          } catch (err) {
            // Revert on failure
            cbs.forEach(el => { const k = el.dataset.key; el.checked = !!prev[k]; });
            if (status) status.textContent = "Update failed.";
            alert("Failed to update features: " + (err && err.message ? err.message : String(err)));
          } finally {
            cbs.forEach(el => el.disabled = false);
            loadStats().catch(() => {});
            setTimeout(() => { if (status) status.textContent = ""; }, 2000);
          }
        });
      });
    }

    // Apply current state
    parent.querySelectorAll('.ios-checkbox[data-key]').forEach((cb) => {
      const k = cb.dataset.key;
      if (k in features) cb.checked = !!features[k];
    });
  }

  // Renders the users table
  function renderUsers(users) {
    const tbody = document.querySelector("#usersTable tbody");
    const loading = document.getElementById("usersLoading");
    const errorEl = document.getElementById("usersError");

    if (loading) loading.style.display = "none";
    if (errorEl) errorEl.textContent = "";

    if (!tbody) { log("users table body missing"); return; }
    tbody.innerHTML = "";

    (users || []).forEach((u) => {
      const tr = document.createElement("tr");
      const initials = (u.username || "?").slice(0,2).toUpperCase();
      tr.innerHTML = `
        <td>
          <div class="user-row">
            <div class="avatar">${initials}</div>
            <div><strong>${u.username}</strong></div>
          </div>
        </td>
        <td>
          <div class="role-list">
            <label><input type="checkbox" name="role" value="viewer" ${u.roles.includes("viewer") ? "checked" : ""}/> viewer</label>
            <label><input type="checkbox" name="role" value="uploader" ${u.roles.includes("uploader") ? "checked" : ""}/> uploader</label>
            <label><input type="checkbox" name="role" value="deleter" ${u.roles.includes("deleter") ? "checked" : ""}/> deleter</label>
            <label><input type="checkbox" name="role" value="admin" ${u.roles.includes("admin") ? "checked" : ""}/> admin</label>
          </div>
        </td>
        <td>
          <input class="password-input" type="password" name="password" placeholder="${u.has_password ? '••••••' : 'set password'}" />
        </td>
        <td class="actions">
          <button data-action="save" class="btn-primary" type="button">Save</button>
          <button data-action="delete" class="btn-soft" type="button">Delete</button>
        </td>
      `;

      tr.querySelector('[data-action="save"]').addEventListener("click", async () => {
        const roles = selectedRolesFrom(tr);
        const pwdInput = tr.querySelector('input[name="password"]');
        const form = new FormData();
        form.append("username", u.username);
        form.append("roles", roles.join(","));
        if (pwdInput && pwdInput.value) {
          form.append("password", pwdInput.value);
        }
        try {
          await postForm("/api/admin/users/update", form);
          await loadUsers(); // refresh
        } catch (e) {
          alert("Save failed: " + e.message);
        }
      });

      tr.querySelector('[data-action="delete"]').addEventListener("click", async () => {
        if (!confirm(`Delete user "${u.username}"?`)) return;
        const form = new FormData();
        form.append("username", u.username);
        try {
          await postForm("/api/admin/users/delete", form);
          await loadUsers(); // refresh
        } catch (e) {
          alert("Delete failed: " + e.message);
        }
      });

      tbody.appendChild(tr);
    });
  }

  async function loadStats() {
    try {
      const data = await fetchJSON("/api/admin/stats");
      log("stats ok");
      applyStats(data);
      return data;
    } catch (e) {
      log("stats error", e && e.message ? e.message : String(e));
      const el = document.getElementById("statsError");
      if (el) el.textContent = "Failed to load stats: " + (e && e.message ? e.message : "Unknown error");
      throw e;
    }
  }

  async function loadUsers() {
    const loading = document.getElementById("usersLoading");
    if (loading) loading.style.display = "";
    try {
      const data = await fetchJSON("/api/admin/users");
      log("users ok");
      renderUsers(data.users || []);
      return data;
    } catch (e) {
      log("users error", e && e.message ? e.message : String(e));
      const el = document.getElementById("usersError");
      if (el) el.textContent = "Failed to load users: " + (e && e.message ? e.message : "Unknown error");
      throw e;
    } finally {
      if (loading) loading.style.display = "none";
    }
  }

  // Wire up Create User form or button
  function wireCreateUser() {
    const form = document.getElementById("createUserForm") || document.querySelector('form[data-role="create-user"]');
    const btn = document.getElementById("createUserBtn");

    async function handleCreate(e) {
      if (e) e.preventDefault();
      const scope = form || document.getElementById("createUser") || document.getElementById("userCreate") || document;

      const usernameEl = scope.querySelector('input[name="username"]');
      const passwordEl = scope.querySelector('input[name="password"]');
      const roleChecks = scope.querySelectorAll('input[name="role"]:checked');

      const username = usernameEl ? usernameEl.value.trim() : "";
      const password = passwordEl ? passwordEl.value : "";
      const roles = Array.from(roleChecks).map(i => i.value);

      if (!username) {
        alert("Please enter a username.");
        if (usernameEl) usernameEl.focus();
        return;
      }

      if (btn) btn.disabled = true;

      const fd = new FormData();
      fd.append("username", username);
      fd.append("password", password);
      fd.append("roles", roles.length ? roles.join(",") : "viewer");

      try {
        await postForm("/api/admin/users/create", fd);
        if (usernameEl) usernameEl.value = "";
        if (passwordEl) passwordEl.value = "";
        scope.querySelectorAll('input[name="role"]').forEach(i => { i.checked = false; });
        await loadUsers();
      } catch (err) {
        alert("Create failed: " + (err && err.message ? err.message : String(err)));
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    if (form) {
      form.addEventListener("submit", handleCreate);
    }
    if (btn) {
      btn.setAttribute("type", "button");
      btn.addEventListener("click", handleCreate);
    }
  }

  // Theme-aware recolor
  function watchTheme() {
    const observer = new MutationObserver(() => {
      if (typeof Chart === "undefined") return;
      const colors = chartColors();
      [rolesChart, rootsSizeChart, thumbTrendChart].forEach(ch => {
        if (!ch) return;
        if (ch.options.scales?.x?.ticks) ch.options.scales.x.ticks.color = colors.text;
        if (ch.options.scales?.y?.ticks) ch.options.scales.y.ticks.color = colors.text;
        if (ch.options.scales?.x?.grid) ch.options.scales.x.grid.color = colors.grid;
        if (ch.options.scales?.y?.grid) ch.options.scales.y.grid.color = colors.grid;
        if (ch.options.plugins?.legend?.labels) ch.options.plugins.legend.labels.color = colors.text;
        ch.update("none");
      });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }

  async function refreshAll(chartsInitDone) {
    log("refreshAll start");
    const [stats, users] = await Promise.all([loadStats(), loadUsers()]);
    if (typeof Chart !== "undefined") ensureCharts(users, stats);
    if (!chartsInitDone.started) chartsInitDone.started = true;
    log("refreshAll done");
  }

  function whenReady(fn, timeoutMs = 6000) {
    const start = Date.now();
    (function tick() {
      if (document.readyState === "complete" || document.readyState === "interactive") {
        try { fn(); } catch (e) { log("init error", e.message || e); }
        return;
      }
      if (Date.now() - start > timeoutMs) {
        log("init timeout waiting for DOM; running anyway");
        try { fn(); } catch (e) { log("init error", e.message || e); }
        return;
      }
      setTimeout(tick, 50);
    })();
  }

  async function init() {
    log("init");
    if (!document.getElementById("stats")) { log("not admin page (no #stats)"); return; }
    watchTheme();
    wireCreateUser();
    const flags = { started: false };
    try { await refreshAll(flags); } catch {}
    setInterval(() => refreshAll(flags).catch(()=>{}), 15000);
    window.__adminLogs = LOGS; // expose for debugging
  }

  whenReady(init);
})();