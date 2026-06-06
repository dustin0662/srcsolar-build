/* ============================================================
   New Mexico Raptor Run — site bootstrap
   Orchestrates the burnout loading screen, then wires up the
   nav, scroll reveals, FAQ and the join form.
   ============================================================ */

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- Loading screen ---------------- */
(function loadingScreen() {
  const loader = document.getElementById('loader');
  if (!loader) return;
  document.body.classList.add('is-loading');

  const fill = document.getElementById('loader-fill');
  const pctEl = document.getElementById('loader-pct');
  const skip = document.getElementById('loader-skip');
  const canvas = document.getElementById('burnout-canvas');

  let scene = null;
  let done = false;
  let pct = 0;

  // Kick off the 3D burnout. Failure must never block the site.
  import('./burnout.js')
    .then((m) => { scene = m.initBurnout(canvas); })
    .catch(() => { /* WebGL unavailable — bar still runs, then reveals site */ });

  // Drive the progress bar. Real assets are tiny, so this is a timed
  // "spool up" that always reaches 100% even on slow/old devices.
  const start = performance.now();
  const duration = reduced ? 900 : 3200;
  function tick(now) {
    const linear = Math.min((now - start) / duration, 1);
    // ease-out so it surges then settles
    const eased = 1 - Math.pow(1 - linear, 2.2);
    pct = Math.max(pct, Math.floor(eased * 100));
    if (fill) fill.style.width = pct + '%';
    if (pctEl) pctEl.textContent = String(pct);
    if (linear < 1 && !done) requestAnimationFrame(tick);
    else finish();
  }
  requestAnimationFrame(tick);

  function finish() {
    if (done) return;
    done = true;
    if (fill) fill.style.width = '100%';
    if (pctEl) pctEl.textContent = '100';
    const hold = reduced ? 120 : 520;
    setTimeout(() => {
      loader.classList.add('is-hidden');
      document.body.classList.remove('is-loading');
      setTimeout(() => {
        loader.remove();
        if (scene) scene.dispose();
        revealInView(); // reveal anything already on screen
      }, 750);
    }, hold);
  }

  skip?.addEventListener('click', finish);
})();

/* ---------------- Mobile nav ---------------- */
(function nav() {
  const header = document.querySelector('.nav');
  const toggle = document.getElementById('nav-toggle');
  const menu = document.getElementById('nav-menu');
  if (!header || !toggle || !menu) return;

  const close = () => { header.classList.remove('is-open'); toggle.setAttribute('aria-expanded', 'false'); };
  toggle.addEventListener('click', () => {
    const open = header.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
})();

/* ---------------- Scroll reveal ---------------- */
let revealInView = () => {};
(function reveal() {
  const items = Array.from(document.querySelectorAll('.reveal'));
  if (!items.length) return;
  if (reduced || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  items.forEach((el) => io.observe(el));
  revealInView = () => items.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight) el.classList.add('is-in');
  });
})();

/* ---------------- FAQ: one open at a time ---------------- */
(function faq() {
  const items = Array.from(document.querySelectorAll('.faq__item'));
  items.forEach((d) => d.addEventListener('toggle', () => {
    if (d.open) items.forEach((o) => { if (o !== d) o.open = false; });
  }));
})();

/* ---------------- Join form ---------------- */
(function joinForm() {
  const form = document.getElementById('join-form');
  const note = document.getElementById('join-note');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = form.name.value.trim();
    const email = form.email.value.trim();
    if (!name || !/^\S+@\S+\.\S+$/.test(email)) {
      if (note) { note.textContent = 'Add your name and a valid email so we can reach you.'; note.style.color = '#ffb38a'; }
      return;
    }
    if (note) {
      note.style.color = '';
      note.textContent = `Locked in, ${name.split(' ')[0]}. We'll be in touch about the next run.`;
    }
    form.reset();
  });
})();

/* ---------------- Footer year ---------------- */
(function year() {
  const el = document.getElementById('year');
  if (el) el.textContent = String(new Date().getFullYear());
})();
