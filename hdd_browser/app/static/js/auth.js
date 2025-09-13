/* ======================================================
   Auth Page Interactions
   ====================================================== */

document.addEventListener("DOMContentLoaded", () => {
  const form       = document.getElementById("loginForm");
  const username   = document.getElementById("username");
  const password   = document.getElementById("password");
  const pwToggle   = document.getElementById("pwToggle");
  const showPwBox  = document.getElementById("showPwBox");
  const capsBanner = document.getElementById("pwCaps");
  const submitBtn  = document.getElementById("submitBtn");
  const alertClose = document.querySelector("[data-close-alert]");

  /* Focus username if empty */
  if (username && !username.value) {
    username.focus({ preventScroll: true });
  }

  /* Dismiss alert */
  if (alertClose) {
    alertClose.addEventListener("click", () => {
      const alertEl = alertClose.closest(".alert");
      if (!alertEl) return;
      alertEl.setAttribute("closing", "");
      setTimeout(() => alertEl.remove(), 400);
    });
  }

  /* Toggle password visibility (button) */
  function setVisibility(forceState) {
    if (!password || !pwToggle) return;
    let show;
    if (typeof forceState === "boolean") {
      show = forceState;
    } else {
      show = password.type === "password";
    }
    password.type = show ? "text" : "password";
    pwToggle.setAttribute("aria-pressed", String(show));
  }

  if (pwToggle) {
    pwToggle.addEventListener("click", () => setVisibility());
  }

  /* Secondary checkbox controlling visibility */
  if (showPwBox) {
    showPwBox.addEventListener("change", () => {
      setVisibility(showPwBox.checked);
      if (pwToggle) {
        pwToggle.setAttribute("aria-pressed", String(showPwBox.checked));
      }
    });
  }

  /* Caps lock detection */
  function capsHandler(e) {
    if (!capsBanner || !password) return;
    const capsOn = e.getModifierState && e.getModifierState("CapsLock");
    capsBanner.hidden = !capsOn;
  }
  if (password && capsBanner) {
    ["keydown","keyup"].forEach(evt => password.addEventListener(evt, capsHandler));
    password.addEventListener("blur", () => { capsBanner.hidden = true; });
  }

  /* Submit: prevent double, show loader */
  if (form && submitBtn) {
    form.addEventListener("submit", (e) => {
      if (!form.checkValidity()) {
        // Let native validation handle messages.
        return;
      }
      submitBtn.classList.add("loading");
      submitBtn.disabled = true;

      // Safety fallback re-enable after 15s
      setTimeout(() => {
        if (submitBtn.disabled) {
          submitBtn.disabled = false;
          submitBtn.classList.remove("loading");
        }
      }, 15000);
    });
  }

  /* Keyboard accessibility: Enter on visible toggle */
  if (pwToggle) {
    pwToggle.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        pwToggle.click();
      }
    });
  }
});