/* ============================================================
   Raptor burnout — 2D cartoon loading scene.
   Injects the cartoon red Raptor SVG (rear wheel spinning, body
   shaking via CSS) and pours canvas tire smoke off the back tire.
   Lightweight, mobile-friendly, no 3D / no external assets.
   ============================================================ */
import { raptorSVG } from './raptorTruck.js';

export function initBurnout(canvas) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Drop the cartoon truck into the loader.
  const host = document.querySelector('.loader__truck');
  if (host) host.innerHTML = raptorSVG({ burnout: true });
  const truckEl = host ? host.querySelector('.raptor') : null;

  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0, H = 0;
  function resize() {
    W = canvas.clientWidth || window.innerWidth;
    H = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  const puff = makePuff();
  const parts = [];
  const MAX = reduced ? 50 : 200;

  // Where the rear tire meets the ground, in canvas pixels.
  function emitter() {
    const c = canvas.getBoundingClientRect();
    const r = truckEl && truckEl.getBoundingClientRect();
    if (!r || !r.width) return { x: W * 0.3, y: H * 0.58, s: 34 };
    return {
      x: r.left - c.left + (138 / 460) * r.width,
      y: r.top - c.top + (200 / 260) * r.height,
      s: (r.width / 460) * 46,
    };
  }
  function spawn() {
    if (parts.length >= MAX) return;
    const e = emitter();
    parts.push({
      x: e.x + (Math.random() - 0.5) * e.s * 0.9,
      y: e.y + (Math.random() - 0.2) * e.s * 0.4,
      vx: -(34 + Math.random() * 70), // drift back (left) hard
      vy: -(16 + Math.random() * 34), // start rising
      life: 0,
      max: 1.2 + Math.random() * 1.3,
      r: e.s * (0.55 + Math.random() * 0.5),
    });
  }

  let raf = 0, running = true, last = performance.now();
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    ctx.clearRect(0, 0, W, H);
    const burst = reduced ? 1 : 5;
    for (let i = 0; i < burst; i++) spawn();

    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt;
      if (p.life >= p.max) { parts.splice(i, 1); continue; }
      p.vy -= dt * 20;       // buoyancy
      p.vx *= 1 - dt * 0.35; // drag
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const k = p.life / p.max;            // 0 -> 1
      const size = p.r * (1 + k * 2.8);    // billow out
      ctx.globalAlpha = Math.sin(k * Math.PI) * 0.6; // fade in then out
      ctx.drawImage(puff, p.x - size, p.y - size, size * 2, size * 2);
    }
    ctx.globalAlpha = 1;
  }
  raf = requestAnimationFrame(frame);

  return {
    dispose() {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      ctx.clearRect(0, 0, W, H);
    },
  };
}

// Pre-rendered soft smoke puff (cheap to blit many times).
function makePuff() {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(48, 48, 4, 48, 48, 46);
  grad.addColorStop(0, 'rgba(232,224,208,0.95)');
  grad.addColorStop(0.5, 'rgba(206,196,178,0.5)');
  grad.addColorStop(1, 'rgba(190,180,165,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(48, 48, 46, 0, Math.PI * 2);
  g.fill();
  return c;
}
