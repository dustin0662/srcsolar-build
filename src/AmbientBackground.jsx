import React, { useEffect, useRef } from 'react'

/* Ambient skin background — one fixed canvas behind every screen.
   It paints the SUNRISE dark canvas (navy gradient, the night-time site
   photo at low opacity, the blueprint grid, drifting topo contour lines and
   glowing "site lights"), and it reacts to what the user does without ever
   sitting on top of content: taps ripple outward, swipes push the lights and
   shift the parallax, scrolling slides the grid and photo. pointer-events
   are off, it lives at z-index -1, and every page root above it is
   translucent so the motion shows through the dead space of each screen.
   Honours prefers-reduced-motion (static frame + tap ripples only), pauses
   when the tab is hidden, caps the backing store at 1.5x. */

const PHOTO = '/home-site.jpg'
const ORANGE = [255, 122, 33]

function makeGlow(size) {
  const c = document.createElement('canvas'); c.width = c.height = size
  const g = c.getContext('2d'); const r = size / 2
  const grad = g.createRadialGradient(r, r, 0, r, r, r)
  grad.addColorStop(0, 'rgba(255,190,120,1)'); grad.addColorStop(0.25, 'rgba(255,122,33,.85)')
  grad.addColorStop(0.6, 'rgba(255,107,24,.18)'); grad.addColorStop(1, 'rgba(255,107,24,0)')
  g.fillStyle = grad; g.fillRect(0, 0, size, size)
  return c
}

function makeGrid(step) {
  const c = document.createElement('canvas'); c.width = c.height = step
  const g = c.getContext('2d')
  g.strokeStyle = 'rgba(50,115,171,.16)'; g.lineWidth = 1
  g.beginPath(); g.moveTo(0, step - .5); g.lineTo(step, step - .5); g.moveTo(step - .5, 0); g.lineTo(step - .5, step); g.stroke()
  return c
}

export default function AmbientBackground() {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let W = 0, H = 0, dpr = 1, raf = 0, last = 0, running = true
    const glow = makeGlow(64), grid = makeGrid(32)
    let gridPattern = null
    const photo = new Image(); let photoReady = false
    photo.onload = () => { photoReady = true }
    photo.src = PHOTO

    /* state */
    const lights = []
    const ripples = []
    const contours = [0, 1, 2, 3].map((i) => ({ y: 0.18 + i * 0.22, amp: 18 + i * 6, f1: 0.006 + i * 0.0012, f2: 0.0021 + i * 0.0007, ph: i * 1.7, speed: (i % 2 ? -1 : 1) * (8 + i * 3) }))
    const par = { x: 0, y: 0, tx: 0, ty: 0 }      // parallax (eased)
    const drift = { vx: 0, vy: 0 }                 // swipe momentum applied to the lights
    const pointer = { x: -9999, y: -9999, down: false, lx: 0, ly: 0, lt: 0 }
    let lastScrollY = window.scrollY || 0
    let t0 = performance.now()

    function seed() {
      lights.length = 0
      const n = Math.max(10, Math.min(70, Math.round((W * H) / 22000)))
      for (let i = 0; i < n; i++) lights.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * 6, vy: (Math.random() - .5) * 6, r: 1.2 + Math.random() * 2.2, tw: Math.random() * Math.PI * 2, tws: 0.6 + Math.random() * 1.4 })
    }
    function resize() {
      W = window.innerWidth; H = window.innerHeight
      dpr = Math.min(1.5, window.devicePixelRatio || 1)
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr)
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      gridPattern = ctx.createPattern(grid, 'repeat')
      seed()
      if (reduced) draw(performance.now(), 0)
    }

    function drawPhoto(t) {
      if (!photoReady) return
      const iw = photo.naturalWidth, ih = photo.naturalHeight
      const s = Math.max((W + 60) / iw, (H + 60) / ih)
      const dw = iw * s, dh = ih * s
      const ax = Math.sin(t / 19000) * 8, ay = Math.cos(t / 23000) * 6     // slow autonomous drift
      const x = (W - dw) / 2 + par.x * 0.6 + ax, y = (H - dh) / 2 + par.y * 0.6 + ay
      ctx.globalAlpha = 0.34; ctx.drawImage(photo, x, y, dw, dh); ctx.globalAlpha = 1
    }
    function drawGrid() {
      if (!gridPattern) return
      ctx.save(); ctx.translate((par.x * 0.35) % 32, (par.y * 0.35) % 32)
      ctx.fillStyle = gridPattern; ctx.fillRect(-32, -32, W + 64, H + 64); ctx.restore()
    }
    function drawContours(t) {
      ctx.lineWidth = 1; ctx.setLineDash([4, 5])
      for (const c of contours) {
        const base = c.y * H + par.y * 0.25
        ctx.beginPath()
        for (let x = -10; x <= W + 10; x += 10) {
          const s = x + par.x * 0.25 + c.speed * (t / 1000)
          const y = base + Math.sin(s * c.f1 + c.ph) * c.amp + Math.sin(s * c.f2 + c.ph * 2 + t / 7000) * c.amp * 0.6
          if (x === -10) ctx.moveTo(x, y); else ctx.lineTo(x, y)
        }
        ctx.strokeStyle = 'rgba(255,107,24,.13)'; ctx.stroke()
      }
      ctx.setLineDash([])
    }
    function drawLights(t, dt) {
      for (const p of lights) {
        // brownian drift + swipe momentum + pointer interaction
        p.vx += (Math.random() - .5) * 2 * dt; p.vy += (Math.random() - .5) * 2 * dt
        p.vx += drift.vx * dt * 0.8; p.vy += drift.vy * dt * 0.8
        const dx = p.x - pointer.x, dy = p.y - pointer.y, d2 = dx * dx + dy * dy
        if (d2 < 160 * 160 && d2 > 1) {
          const d = Math.sqrt(d2); const k = (1 - d / 160)
          if (pointer.down) { p.vx += (dx / d) * 260 * k * dt; p.vy += (dy / d) * 260 * k * dt }   // push away while pressing
          else { p.vx -= (dx / d) * 40 * k * dt; p.vy -= (dy / d) * 40 * k * dt }                 // gentle attraction on hover / move
        }
        const sp = Math.hypot(p.vx, p.vy); if (sp > 90) { p.vx *= 90 / sp; p.vy *= 90 / sp }
        p.vx *= (1 - 0.9 * dt); p.vy *= (1 - 0.9 * dt)
        p.x += p.vx * dt; p.y += p.vy * dt
        if (p.x < -20) p.x = W + 20; if (p.x > W + 20) p.x = -20; if (p.y < -20) p.y = H + 20; if (p.y > H + 20) p.y = -20
        p.tw += p.tws * dt
        const a = 0.45 + 0.4 * Math.sin(p.tw)
        const s = p.r * 10
        ctx.globalAlpha = a; ctx.drawImage(glow, p.x - s / 2, p.y - s / 2, s, s)
      }
      ctx.globalAlpha = 1
    }
    function drawRipples(t) {
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i]; const k = (t - r.t) / r.dur
        if (k >= 1) { ripples.splice(i, 1); continue }
        const ease = 1 - Math.pow(1 - k, 2)                 // fast start, long soft tail
        const rad = 12 + ease * r.max; const a = (1 - k) * 0.8
        // soft glow pool so the touch reads even under a module's tint
        const pool = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, rad)
        pool.addColorStop(0, `rgba(255,140,60,${a * 0.28})`); pool.addColorStop(0.7, `rgba(255,107,24,${a * 0.1})`); pool.addColorStop(1, 'rgba(255,107,24,0)')
        ctx.fillStyle = pool; ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, Math.PI * 2); ctx.fill()
        ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(${ORANGE[0]},${ORANGE[1]},${ORANGE[2]},${a})`; ctx.lineWidth = 2 + (1 - k) * 2.5; ctx.stroke()
        if (r.second) { ctx.beginPath(); ctx.arc(r.x, r.y, rad * 0.55, 0, Math.PI * 2); ctx.strokeStyle = `rgba(255,200,140,${a * 0.7})`; ctx.lineWidth = 1.25; ctx.stroke() }
      }
    }
    function draw(t, dt) {
      // base canvas
      const g = ctx.createLinearGradient(0, 0, 0, H)
      g.addColorStop(0, '#08162a'); g.addColorStop(0.45, '#030c17'); g.addColorStop(1, '#020811')
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
      drawPhoto(t)
      const veil = ctx.createLinearGradient(0, 0, 0, H)
      veil.addColorStop(0, 'rgba(2,8,17,.42)'); veil.addColorStop(1, 'rgba(2,8,17,.18)')
      ctx.fillStyle = veil; ctx.fillRect(0, 0, W, H)
      drawGrid()
      drawContours(t)
      drawLights(t, dt)
      drawRipples(t)
    }
    function frame(now) {
      if (!running) return
      raf = requestAnimationFrame(frame)
      const el = now - last; if (el < 22) return          // ~45 fps cap
      const dt = Math.min(0.05, el / 1000); last = now
      // ease parallax + decay swipe momentum
      par.x += (par.tx - par.x) * Math.min(1, dt * 4); par.y += (par.ty - par.y) * Math.min(1, dt * 4)
      drift.vx *= (1 - 2.5 * dt); drift.vy *= (1 - 2.5 * dt)
      draw(now, dt)
    }

    /* interaction: everything passive, never intercepting */
    const onDown = (e) => {
      pointer.x = e.clientX; pointer.y = e.clientY; pointer.down = true; pointer.lx = e.clientX; pointer.ly = e.clientY; pointer.lt = performance.now()
      ripples.push({ x: e.clientX, y: e.clientY, t: performance.now(), dur: 1400, max: 110 + Math.min(W, H) * 0.16, second: true })
      if (reduced) draw(performance.now(), 0)
    }
    const onMove = (e) => {
      pointer.x = e.clientX; pointer.y = e.clientY
      if (pointer.down) {
        const now = performance.now(); const dtm = Math.max(16, now - pointer.lt) / 1000
        const vx = (e.clientX - pointer.lx) / dtm, vy = (e.clientY - pointer.ly) / dtm
        drift.vx = Math.max(-60, Math.min(60, vx * 0.06)); drift.vy = Math.max(-60, Math.min(60, vy * 0.06))
        par.tx = Math.max(-40, Math.min(40, par.tx + (e.clientX - pointer.lx) * 0.08))
        par.ty = Math.max(-40, Math.min(40, par.ty + (e.clientY - pointer.ly) * 0.08))
        pointer.lx = e.clientX; pointer.ly = e.clientY; pointer.lt = now
      }
    }
    const onUp = () => { pointer.down = false; par.tx *= 0.5; par.ty *= 0.5 }
    const onLeave = () => { pointer.x = -9999; pointer.y = -9999; pointer.down = false }
    const onScroll = (e) => {
      const y = e && e.target && e.target !== document && e.target.scrollTop != null ? null : (window.scrollY || 0)
      if (y != null) { par.ty = Math.max(-40, Math.min(40, par.ty - (y - lastScrollY) * 0.06)); lastScrollY = y }
      else par.ty = Math.max(-40, Math.min(40, par.ty - 1.5)) // inner scroll containers: a gentle nudge
      ripples.length = Math.min(ripples.length, 6)
    }
    const onWheel = (e) => { par.ty = Math.max(-40, Math.min(40, par.ty - e.deltaY * 0.04)); drift.vy -= e.deltaY * 0.15 }
    const onVis = () => { running = !document.hidden; if (running && !reduced) { last = performance.now(); raf = requestAnimationFrame(frame) } else cancelAnimationFrame(raf) }

    resize()
    window.addEventListener('resize', resize)
    window.addEventListener('pointerdown', onDown, { passive: true, capture: true })
    window.addEventListener('pointermove', onMove, { passive: true, capture: true })
    window.addEventListener('pointerup', onUp, { passive: true, capture: true })
    window.addEventListener('pointercancel', onUp, { passive: true, capture: true })
    window.addEventListener('pointerleave', onLeave, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    window.addEventListener('wheel', onWheel, { passive: true, capture: true })
    document.addEventListener('visibilitychange', onVis)
    if (!reduced) { last = performance.now(); raf = requestAnimationFrame(frame) } else { photo.onload = () => { photoReady = true; draw(performance.now(), 0) } }
    return () => {
      running = false; cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointerdown', onDown, { capture: true })
      window.removeEventListener('pointermove', onMove, { capture: true })
      window.removeEventListener('pointerup', onUp, { capture: true })
      window.removeEventListener('pointercancel', onUp, { capture: true })
      window.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('wheel', onWheel, { capture: true })
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])
  return <canvas ref={ref} aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: -1, pointerEvents: 'none', display: 'block', background: '#020811' }} />
}
