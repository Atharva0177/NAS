// Non-invasive UI micro-interactions and motion.
// Safe to include alongside existing app.js. No overrides, no globals clobbered.

(function () {
  const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Intersection-based reveal for .fade-in, .slide-up, .scale-in
  function setupReveal() {
    if (prefersReduced || !('IntersectionObserver' in window)) {
      // If motion is reduced or IO not available, show everything immediately
      document.querySelectorAll('.fade-in, .slide-up, .scale-in').forEach(el => el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });

    document.querySelectorAll('.fade-in, .slide-up, .scale-in').forEach(el => io.observe(el));
  }

  // Subtle ripple for buttons (btn-primary, btn-soft, btn-outline)
  function setupRipples() {
    if (prefersReduced) return;
    const sel = '.btn-primary, .btn-soft, .btn-outline, .btn-ghost';
    document.addEventListener('click', (ev) => {
      const target = ev.target.closest(sel);
      if (!target) return;

      const rect = target.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const ripple = document.createElement('span');
      ripple.style.position = 'absolute';
      ripple.style.pointerEvents = 'none';
      ripple.style.left = `${ev.clientX - rect.left - size / 2}px`;
      ripple.style.top = `${ev.clientY - rect.top - size / 2}px`;
      ripple.style.width = `${size}px`;
      ripple.style.height = `${size}px`;
      ripple.style.borderRadius = '50%';
      ripple.style.background = 'radial-gradient(circle, rgba(255,255,255,.35), rgba(255,255,255,0) 60%)';
      ripple.style.transform = 'scale(0)';
      ripple.style.opacity = '0.75';
      ripple.style.transition = 'transform 450ms cubic-bezier(.2,.8,.2,1), opacity 600ms ease';
      target.style.position = target.style.position || 'relative';
      target.appendChild(ripple);
      requestAnimationFrame(() => {
        ripple.style.transform = 'scale(1.8)';
        ripple.style.opacity = '0';
      });
      setTimeout(() => ripple.remove(), 650);
    }, { passive: true });
  }

  // Theme toggle persistence (no override, just resilience if base.html logic changes)
  function setupThemePersistence() {
    document.addEventListener('DOMContentLoaded', () => {
      const btn = document.getElementById('themeToggle');
      if (!btn) return;
      btn.addEventListener('click', () => {
        const html = document.documentElement;
        const current = html.getAttribute('data-theme') || 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', next);
        try { localStorage.setItem('hdd-theme', next); } catch {}
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupReveal();
    setupRipples();
    setupThemePersistence();
  });
})();