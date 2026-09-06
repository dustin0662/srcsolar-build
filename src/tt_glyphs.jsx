import React from 'react';

/* Point rendering for the Task Tracker, using the skin pack's icons EXACTLY.
   Every point shows one pack icon for its highest install phase (pile, post
   cap, torque tube, module); tube and module icons are rotated to follow the
   row; thin phase-coloured rails join consecutive points down a row so
   finished rows read as continuous. Flags, the delete queue, the selection
   ring and "no progress" have no pack asset and stay drawn.

   Three renderers share the same artwork strings:
   - paintStack(): canvas, for the Leaflet satellite map (icons rasterised
     from the exact SVG at device-pixel size, pre-rotated, cached)
   - <StackSvg/> + <GlyphDefs/>: SVG <use> of the same markup (plan, 3D)
   - <Glyph/>: standalone inline icon for legends and cards               */

export const GLYPH = {
  s0: { name: 'No Progress', color: '#e8e8ea' },
  s1: { name: 'Piles', color: '#D6DCE4' },
  s2: { name: 'Post Caps', color: '#008CFF' },
  s3: { name: 'Torque Tube', color: '#B834F5' },
  s4: { name: 'Modules', color: '#1ED6A3' },
  q1: { name: 'Requires Attention', color: '#FFB020' },
  q2: { name: 'Flagged Issue', color: '#FF4F4F' },
  del: { name: 'Delete', color: '#FF4F4F' },
};
export const ORANGE = '#FF6B00';
const INK = 'rgba(2,8,16,.7)';
const RAIL = { s3: [GLYPH.s3.color, '#321044'], s4: [GLYPH.s4.color, '#0B5C4A'] };

export function glyphCode(stage, qc) { return qc === 2 ? 'q2' : qc === 1 ? 'q1' : 's' + (stage || 0); }
/* base unit (px) on the satellite map, by zoom — bigger as you get closer */
export function radiusForZoom(z) { return z >= 21 ? 14 : z >= 20 ? 11 : z >= 19 ? 8.5 : z >= 18 ? 6.5 : 5; }

/* ---------- row detection ----------
   Rows are the lines of piles a tracker sits on. We find the dominant
   neighbour direction and link every point to the next one along it, so
   tubes and modules know where to run to. Works in plan coordinates; the
   same links apply to the map because lon/lat is index-aligned. */
export function computeRowLinks(points) {
  const N = points ? points.length : 0;
  const next = new Int32Array(N).fill(-1);
  if (N < 2) return { next, dir: [0, 1], spacing: 10 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
  const cell = Math.max(Math.sqrt(Math.max(1e-9, (maxX - minX) * (maxY - minY)) / N), 1e-6);
  const grid = new Map();
  points.forEach((p, i) => { const k = Math.floor(p[0] / cell) + ':' + Math.floor(p[1] / cell); const a = grid.get(k); if (a) a.push(i); else grid.set(k, [i]); });
  const around = (i, span) => {
    const p = points[i]; const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell); const out = [];
    for (let dx = -span; dx <= span; dx++) for (let dy = -span; dy <= span; dy++) { const a = grid.get((cx + dx) + ':' + (cy + dy)); if (a) for (const j of a) if (j !== i) out.push(j); }
    return out;
  };
  const median = (arr) => { if (!arr.length) return 0; arr.sort((a, b) => a - b); return arr[Math.floor(arr.length / 2)]; };
  const step = Math.max(1, Math.floor(N / 1500));

  /* 1. typical nearest-neighbour distance, any direction */
  const nn = [];
  for (let i = 0; i < N; i += step) {
    let bd = Infinity;
    for (const j of around(i, 2)) { const dx = points[j][0] - points[i][0], dy = points[j][1] - points[i][1]; const d = dx * dx + dy * dy; if (d < bd) bd = d; }
    if (bd < Infinity) nn.push(Math.sqrt(bd));
  }
  const d0 = median(nn) || cell;

  /* 2. row direction. Tracker rows run north–south, so we look for the
     best-populated neighbour direction within 25° of vertical (this
     tolerates a rotated site) and never pick the across-row axis, even
     when piles sit closer to their neighbours across than along. */
  const bins = new Float64Array(36), vx = new Float64Array(36), vy = new Float64Array(36);
  const span0 = Math.max(1, Math.ceil((2.6 * d0) / cell));
  for (let i = 0; i < N; i += step) {
    for (const j of around(i, span0)) {
      let dx = points[j][0] - points[i][0], dy = points[j][1] - points[i][1]; const d = Math.hypot(dx, dy);
      if (!d || d > 2.6 * d0) continue; dx /= d; dy /= d;
      if (dy < 0 || (dy === 0 && dx < 0)) { dx = -dx; dy = -dy; }
      const b = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 36)) % 36) + 36) % 36;
      bins[b]++; vx[b] += dx; vy[b] += dy;
    }
  }
  let best = -1;
  for (let b = 0; b < 36; b++) {
    if (!bins[b]) continue;
    const mx = vx[b] / bins[b], my = vy[b] / bins[b];
    const tilt = Math.abs(Math.atan2(mx, my));                 // angle away from vertical
    if (tilt <= Math.PI / 180 * 25 && (best < 0 || bins[b] > bins[best])) best = b;
  }
  let dx = 0, dy = 1;
  if (best >= 0) { dx = vx[best] / bins[best]; dy = vy[best] / bins[best]; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L; }

  /* 3. spacing along the row: nearest neighbour inside a narrow cone */
  const alongs = [];
  const span1 = Math.max(1, Math.ceil((3.2 * d0) / cell));
  for (let i = 0; i < N; i += step) {
    let ba = Infinity;
    for (const j of around(i, span1)) {
      const ex = points[j][0] - points[i][0], ey = points[j][1] - points[i][1];
      const along = ex * dx + ey * dy; if (along <= 0 || along > 3.2 * d0) continue;
      const perp = Math.abs(ex * dy - ey * dx); if (perp > 0.3 * Math.max(along, d0)) continue;
      if (along < ba) ba = along;
    }
    if (ba < Infinity) alongs.push(ba);
  }
  const rs = median(alongs) || d0;

  /* 4. link every point to the next one down its row */
  const perpTol = 0.35 * Math.min(d0, rs);
  const span = Math.max(1, Math.ceil((1.7 * rs) / cell));
  for (let i = 0; i < N; i++) {
    let bestAlong = Infinity, bj = -1;
    for (const j of around(i, span)) {
      const ex = points[j][0] - points[i][0], ey = points[j][1] - points[i][1];
      const along = ex * dx + ey * dy; if (along <= 0.3 * rs || along > 1.6 * rs) continue;
      const perp = Math.abs(ex * dy - ey * dx); if (perp > perpTol) continue;
      if (along < bestAlong) { bestAlong = along; bj = j; }
    }
    next[i] = bj;
  }
  return { next, dir: [dx, dy], spacing: rs };
}

/* ---------- pack artwork, verbatim ----------
   Child markup of assets/icons/*.svg from the skin pack (96×96 boxes). The
   only edit is namespacing the gradient ids (p/b/t → ttg-*) so they cannot
   collide with anything else on the page. */
const PACK_GRAD = {
  "s1": "<linearGradient id=\"ttg-pile\" x1=\"0\" x2=\"1\"><stop stop-color=\"#697582\"/><stop offset=\".48\" stop-color=\"#F5F8FC\"/><stop offset=\"1\" stop-color=\"#8E99A6\"/></linearGradient>",
  "s2": "<linearGradient id=\"ttg-cap\" x1=\"0\" x2=\"1\"><stop stop-color=\"#005EB8\"/><stop offset=\".5\" stop-color=\"#38B8FF\"/><stop offset=\"1\" stop-color=\"#0078E8\"/></linearGradient>",
  "s3": "<linearGradient id=\"ttg-tube\" x1=\"0\" x2=\"0\" y1=\"0\" y2=\"1\"><stop stop-color=\"#E05BFF\"/><stop offset=\".5\" stop-color=\"#B834F5\"/><stop offset=\"1\" stop-color=\"#69129D\"/></linearGradient>"
};
const PACK_BODY = {
  "s1": "<path d=\"M30 76V27L48 16L66 27V76L48 86Z\" fill=\"url(#ttg-pile)\" stroke=\"#243343\" stroke-width=\"4\" stroke-linejoin=\"round\"/>\n<path d=\"M48 17V85M30 27L48 38L66 27\" fill=\"none\" stroke=\"#FFFFFF\" stroke-opacity=\".72\" stroke-width=\"3\"/>",
  "s2": "<path d=\"M31 76V35L48 26L65 35V76L48 86Z\" fill=\"url(#ttg-cap)\" stroke=\"#002B5B\" stroke-width=\"4\" stroke-linejoin=\"round\"/>\n<path d=\"M22 29L48 14L74 29L48 44Z\" fill=\"#008CFF\" stroke=\"#002B5B\" stroke-width=\"4\" stroke-linejoin=\"round\"/>\n<path d=\"M29 29L48 19L67 29L48 39Z\" fill=\"#52C6FF\"/>\n<path d=\"M48 45V84\" stroke=\"#93DDFF\" stroke-width=\"3\"/>",
  "s3": "<path d=\"M18 68L73 25\" stroke=\"#321044\" stroke-width=\"24\" stroke-linecap=\"round\"/>\n<path d=\"M18 65L73 22\" stroke=\"url(#ttg-tube)\" stroke-width=\"17\" stroke-linecap=\"round\"/>\n<path d=\"M22 60L69 24\" stroke=\"#F0A1FF\" stroke-width=\"4\" stroke-linecap=\"round\" opacity=\".8\"/>",
  "s4": "<path d=\"M17 77L30 19L80 25L67 83Z\" fill=\"#147C65\" stroke=\"#7BFFE0\" stroke-width=\"4\" stroke-linejoin=\"round\"/>\n<path d=\"M26 41L75 47M22 59L71 65M47 21L34 79M64 23L51 81\" fill=\"none\" stroke=\"#7BFFE0\" stroke-width=\"3\"/>\n<path d=\"M31 23L47 25L43 39L28 37Z\" fill=\"#1ED6A3\" opacity=\".6\"/>"
};
const PACK_GRAD_ALL = Object.values(PACK_GRAD).join('');
const PACK_BOX = '0 0 96 96';

/* icon box = ICON_K × base unit; the 96-box centre sits on the point */
export const ICON_K = 3.0;
/* undirected axis of the rail / panel inside each icon (y-down):
   tube rail runs (18,68)→(73,25); module panel from top-edge centre (55,22) to bottom-edge centre (42,80) */
export const ICON_AXIS = { s3: Math.atan2(25 - 68, 73 - 18), s4: Math.atan2(80 - 22, 42 - 55) };
/* rotation that aligns an icon's axis with the row, folded to (−90°, 90°] so
   the artwork stays nearest its authored orientation (never upside-down) */
export function iconRotation(code, rowAngle) {
  const ax = ICON_AXIS[code]; if (ax == null) return 0;
  let d = rowAngle - ax; d -= Math.PI * Math.round(d / Math.PI); return d;
}
export function railColor(s, ns) { return s >= 4 && ns >= 4 ? RAIL.s4 : s >= 3 && ns >= 3 ? RAIL.s3 : null; }
const deg = (rad) => rad * 180 / Math.PI;

/* ---------- canvas icon atlas ----------
   Each icon is rasterised by the browser from the exact SVG text at the
   device-pixel size it will be drawn at (no resampling), then pre-rotated
   into a square canvas per row angle. Loading is async; the map renderer
   subscribes with onIconsReady() and repaints once the images land. */
function packSvg(code, N) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${N}" height="${N}" viewBox="${PACK_BOX}"><defs>${PACK_GRAD[code] || ''}</defs>${PACK_BODY[code]}</svg>`;
}
const atlas = new Map();
const readyFns = new Set();
export function onIconsReady(fn) { readyFns.add(fn); return () => readyFns.delete(fn); }
function baseRaster(code, N) {
  const key = code + ':' + N; let e = atlas.get(key);
  if (e) return e;
  e = { img: null, ready: false, rot: new Map() }; atlas.set(key, e);
  if (typeof Image === 'undefined') return e;
  const img = new Image(); e.img = img;
  img.onload = () => { e.ready = true; readyFns.forEach((f) => { try { f(); } catch (err) { /* ignore */ } }); };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(packSvg(code, N));
  return e;
}
export function iconRaster(code, N, rotDeg) {
  const e = baseRaster(code, N); if (!e.ready) return null;
  const k = rotDeg | 0; let c = e.rot.get(k);
  if (!c) {
    const D = Math.ceil(N * 1.125);
    c = document.createElement('canvas'); c.width = c.height = D;
    const g = c.getContext('2d'); g.translate(D / 2, D / 2); g.rotate(k * Math.PI / 180); g.drawImage(e.img, -N / 2, -N / 2, N, N);
    e.rot.set(k, c);
  }
  return c;
}

/* ---------- reference skin: raster sprites cut from the concept mock ----------
   Only when window.__TT_SKIN === 'reference' (the standalone demo). Sprites
   live in window.__TT_REF_SPRITES (see src/tt_ref_sprites.js, generated by
   scripts/extract_ref_sprites.py). Sizes are the mock's own pixel sizes and
   scale with the row pitch: k = pitchPx / 36 (the mock's pitch). */
export const REF = typeof window !== 'undefined' && window.__TT_SKIN === 'reference';
const REF_SPRITES = (REF && window.__TT_REF_SPRITES) || {};
export const clampK = (k) => Math.min(4, Math.max(0.2, (k && isFinite(k)) ? k : 0.5));
/* sprites are authored vertical; rotate them to follow the row (folded to ±90°) */
export function refRotation(rowAngle) { let d = rowAngle - Math.PI / 2; d -= Math.PI * Math.round(d / Math.PI); return d; }
const refImgs = new Map();
export function refSprite(code) {
  const sp = REF_SPRITES[code]; if (!sp) return null;
  let e = refImgs.get(code); if (e) return e;
  e = { img: null, ready: false, rot: new Map(), w: sp.w, h: sp.h }; refImgs.set(code, e);
  if (typeof Image === 'undefined') return e;
  const img = new Image(); e.img = img;
  img.onload = () => { e.ready = true; readyFns.forEach((f) => { try { f(); } catch (err) { /* ignore */ } }); };
  img.src = sp.uri;
  return e;
}
export function refRaster(code, wDev, hDev, rotDeg) {
  const e = refSprite(code); if (!e || !e.ready) return null;
  wDev = Math.max(1, Math.round(wDev)); hDev = Math.max(1, Math.round(hDev)); const k = rotDeg | 0;
  const key = wDev + 'x' + hDev + ':' + k; let c = e.rot.get(key);
  if (!c) {
    if (e.rot.size > 96) e.rot.clear();
    c = document.createElement('canvas'); const g = c.getContext('2d');
    if (!k) { c.width = wDev; c.height = hDev; g.imageSmoothingQuality = 'high'; g.drawImage(e.img, 0, 0, wDev, hDev); }
    else { const D = Math.ceil(Math.hypot(wDev, hDev)); c.width = c.height = D; g.imageSmoothingQuality = 'high'; g.translate(D / 2, D / 2); g.rotate(k * Math.PI / 180); g.drawImage(e.img, -wDev / 2, -hDev / 2, wDev, hDev); }
    e.rot.set(key, c);
  }
  return c;
}

/* ---------- canvas painter ---------- */
function poly(ctx, pts) { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); }
function seg(ctx, x0, y0, x1, y1, w, color, cap) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineWidth = w; ctx.strokeStyle = color; ctx.lineCap = cap || 'round'; ctx.stroke(); }
function bang(ctx, x, y, s, color) { ctx.fillStyle = color; ctx.fillRect(x - 0.13 * s, y - 0.45 * s, 0.26 * s, 0.6 * s); ctx.beginPath(); ctx.arc(x, y + 0.44 * s, 0.15 * s, 0, Math.PI * 2); ctx.fill(); }
function drawFlag(ctx, x, y, r, code, lw) {
  const s = 1.45 * r;
  ctx.save();
  if (code === 'q1') {
    ctx.shadowColor = 'rgba(255,176,32,.85)'; ctx.shadowBlur = r;
    poly(ctx, [[x, y - 0.95 * s], [x + s, y + 0.75 * s], [x - s, y + 0.75 * s]]); ctx.fillStyle = GLYPH.q1.color; ctx.fill(); ctx.shadowBlur = 0;
    ctx.strokeStyle = '#3b2a00'; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke(); bang(ctx, x, y + 0.05 * s, s, '#1a1206');
  } else {
    ctx.shadowColor = 'rgba(255,79,79,.9)'; ctx.shadowBlur = r;
    poly(ctx, [[x, y - s], [x + s, y], [x, y + s], [x - s, y]]); ctx.fillStyle = GLYPH.q2.color; ctx.fill(); ctx.shadowBlur = 0;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke(); bang(ctx, x, y, s, '#fff');
  }
  ctx.restore();
}

/* items: [{ x, y, nx, ny, s, q, ns, dim, hot, del }] — nx/ny/ns describe the
   next point down the row (null / -1 at a row end). dir = unit row direction
   in the same pixel space. m = canvas device-pixel factor (Leaflet: 1 or 2). */
export function paintStack(ctx, items, r, dir, m) {
  const dpr = m || 1;
  const S = ICON_K * r, N = Math.round(S * dpr);
  const ux = dir ? dir[0] : 0, uy = dir ? dir[1] : 1;
  const rowAngle = Math.atan2(uy, ux);
  const rot = { s1: 0, s2: 0, s3: Math.round(deg(iconRotation('s3', rowAngle))), s4: Math.round(deg(iconRotation('s4', rowAngle))) };
  const lw = Math.max(0.6, r * 0.1);
  const core = Math.max(1.5, 0.18 * S), halo = Math.max(core + 1, 0.25 * S);
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.lineCap = 'round';

  /* 1. rails, batched per colour / dim */
  const groups = { s3: [], s3d: [], s4: [], s4d: [] };
  for (const it of items) {
    if (it.del || it.nx == null) continue;
    const rc = railColor(it.s, it.ns); if (!rc) continue;
    groups[(rc === RAIL.s4 ? 's4' : 's3') + (it.dim ? 'd' : '')].push(it);
  }
  const strokeGroup = (list, colors, alpha) => {
    if (!list.length) return; ctx.globalAlpha = alpha;
    for (const [w, c] of [[halo, colors[1]], [core, colors[0]]]) {
      ctx.beginPath(); for (const it of list) { ctx.moveTo(it.x, it.y); ctx.lineTo(it.nx, it.ny); }
      ctx.lineWidth = w; ctx.strokeStyle = c; ctx.stroke();
    }
  };
  strokeGroup(groups.s3d, RAIL.s3, 0.2); strokeGroup(groups.s3, RAIL.s3, 1);
  strokeGroup(groups.s4d, RAIL.s4, 0.2); strokeGroup(groups.s4, RAIL.s4, 1);

  /* 2. no-progress dots */
  for (const pass of [[true, 0.2], [false, 1]]) {
    let any = false; ctx.beginPath();
    for (const it of items) { if (it.del || it.s >= 1 || !!it.dim !== pass[0]) continue; ctx.moveTo(it.x + 0.5 * r, it.y); ctx.arc(it.x, it.y, 0.5 * r, 0, Math.PI * 2); any = true; }
    if (any) { ctx.globalAlpha = pass[1]; ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = lw; ctx.stroke(); }
  }

  /* 3. icons — lower on screen drawn last so nearer artwork overlaps */
  const order = items.filter((it) => !it.del && it.s >= 1).sort((a, b) => a.y - b.y);
  let curA = -1;
  for (const it of order) {
    const a = it.dim ? 0.2 : 1; if (a !== curA) { ctx.globalAlpha = a; curA = a; }
    const code = 's' + Math.min(4, it.s);
    const c = iconRaster(code, N, rot[code]);
    if (c) { const w = c.width / dpr; ctx.drawImage(c, it.x - w / 2, it.y - w / 2, w, w); }
    else { ctx.beginPath(); ctx.arc(it.x, it.y, 0.5 * r, 0, Math.PI * 2); ctx.fillStyle = GLYPH[code].color; ctx.fill(); }
  }

  /* 4. deletion queue, selection ring, flags */
  for (const it of items) {
    ctx.globalAlpha = 1;
    if (it.del) { ctx.beginPath(); ctx.arc(it.x, it.y, 0.35 * S, 0, Math.PI * 2); ctx.fillStyle = GLYPH.del.color; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1.2, lw * 2); ctx.stroke(); continue; }
    if (it.hot) { ctx.beginPath(); ctx.arc(it.x, it.y, 0.75 * S, 0, Math.PI * 2); ctx.strokeStyle = ORANGE; ctx.lineWidth = Math.max(1.5, lw * 2); ctx.stroke(); }
    if (it.q === 1 || it.q === 2) {
      if (it.dim) ctx.globalAlpha = 0.35;
      seg(ctx, it.x, it.y - 0.45 * S, it.x, it.y - 0.9 * S, Math.max(1, lw * 1.6), ORANGE);
      ctx.beginPath(); ctx.arc(it.x, it.y - 0.45 * S, 0.32 * r + 0.5, 0, Math.PI * 2); ctx.fillStyle = '#ffd7a8'; ctx.fill(); ctx.strokeStyle = ORANGE; ctx.lineWidth = Math.max(1, lw * 1.6); ctx.stroke();
      drawFlag(ctx, it.x, it.y - 1.2 * S, r, it.q === 1 ? 'q1' : 'q2', lw);
    }
  }
  ctx.restore();
}

/* Reference-skin painter: one mock sprite per point, drawn the way the mock
   stacks them — piles, then caps, then tube segments running from a cap's
   post down to the next cube's top, then module panels in front (a purple
   sliver shows between panels), then flags / selection / deletion. */
export function paintRefStack(ctx, items, k, dir, m, pitch) {
  const dpr = m || 1; k = clampK(k); const P = pitch || 36 * k;
  const ux = dir ? dir[0] : 0, uy = dir ? dir[1] : 1;
  const rot = Math.round(refRotation(Math.atan2(uy, ux)) * 180 / Math.PI);
  const rotRad = rot * Math.PI / 180;
  const lw = Math.max(0.6, 1.2 * k);
  const SZ = (c) => REF_SPRITES[c] ? [REF_SPRITES[c].w, REF_SPRITES[c].h] : [14, 27];
  const [pw, ph] = SZ('s1'), [cw, chh] = SZ('s2'), [tw, th] = SZ('s3'), [mw, mh] = SZ('s4');
  const disc = (x, y, r, col) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); };
  const shadowOn = () => { ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 3 * dpr * k; ctx.shadowOffsetX = 1.5 * dpr * k; ctx.shadowOffsetY = 2 * dpr * k; };
  const shadowOff = () => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; };
  const blit = (code, x, y, w, h) => {
    const c = refRaster(code, w * dpr, h * dpr, rot); if (!c) return false;
    const cwv = c.width / dpr, chv = c.height / dpr; ctx.drawImage(c, x - cwv / 2, y - chv / 2, cwv, chv); return true;
  };
  const tube = refSprite('s3'), panel = refSprite('s4');
  /* tube from (x0,y0) to (x1,y1): ends unstretched (3-slice) so the shading reads like the mock */
  const drawTube = (x0, y0, x1, y1) => {
    const L = Math.hypot(x1 - x0, y1 - y0); if (L < 1.5 * k) return;
    const w = tw * k;
    if (!(tube && tube.ready)) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineWidth = 8 * k; ctx.strokeStyle = GLYPH.s3.color; ctx.lineCap = 'round'; ctx.stroke(); return; }
    ctx.save(); ctx.translate(x0, y0); ctx.rotate(Math.atan2(y1 - y0, x1 - x0) - Math.PI / 2);
    const img = tube.img, sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
    const capSrc = Math.round(sh * 6 / th), capDst = 6 * k;
    if (L > 2 * capDst + k) {
      ctx.drawImage(img, 0, 0, sw, capSrc, -w / 2, 0, w, capDst);
      ctx.drawImage(img, 0, capSrc, sw, sh - 2 * capSrc, -w / 2, capDst, w, L - 2 * capDst);
      ctx.drawImage(img, 0, sh - capSrc, sw, capSrc, -w / 2, L - capDst, w, capDst);
    } else ctx.drawImage(img, -w / 2, 0, w, L);
    ctx.restore();
  };
  const alpha = (it) => { ctx.globalAlpha = it.dim ? 0.2 : 1; };
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const order = items.filter((it) => !it.del).sort((a, b) => a.y - b.y);
  /* chain lookups for module runs */
  const byPos = new Map(); for (const it of order) byPos.set(it.x + ',' + it.y, it);
  const nextOf = (it) => (it.nx != null ? byPos.get(it.nx + ',' + it.ny) || null : null);
  const hasPrev = new Set();
  for (const it of order) if (it.s >= 4) { const n = nextOf(it); if (n && n.s >= 4) hasPrev.add(n); }
  const runs = [];
  for (const it of order) if (it.s >= 4 && !hasPrev.has(it)) {
    const pts = [it]; let cur = it;
    for (let guard = 0; guard < 4096; guard++) { const n = nextOf(cur); if (!n || n.s < 4) break; pts.push(n); cur = n; }
    runs.push(pts);
  }
  /* 1. no progress */
  for (const it of order) if (it.s < 1) { alpha(it); disc(it.x, it.y, 2.5 * k, 'rgba(255,255,255,.9)'); ctx.strokeStyle = INK; ctx.lineWidth = lw; ctx.stroke(); }
  shadowOn();
  /* 2. piles (a cap carries its own post) */
  for (const it of order) if (it.s === 1) { alpha(it); if (!blit('s1', it.x, it.y, pw * k, ph * k)) disc(it.x, it.y, 3 * k, GLYPH.s1.color); }
  /* 3. torque tubes — under the caps so each cube overlaps the tube end */
  for (const it of order) if (it.s === 3) {
    alpha(it);
    const jx = it.nx != null ? it.nx : it.x + ux * P, jy = it.ny != null ? it.ny : it.y + uy * P;
    const dx = jx - it.x, dy = jy - it.y, L0 = Math.hypot(dx, dy) || 1; const ex = dx / L0, ey = dy / L0;
    drawTube(it.x + ex * 3 * k, it.y + ey * 3 * k, jx - ex * 9 * k, jy - ey * 9 * k);
  }
  for (const pts of runs) {
    const A = pts[0], Z = pts[pts.length - 1]; alpha(A);
    let ex = ux, ey = uy; if (pts.length > 1) { const dx = Z.x - A.x, dy = Z.y - A.y, L0 = Math.hypot(dx, dy) || 1; ex = dx / L0; ey = dy / L0; }
    drawTube(A.x - ex * 11 * k, A.y - ey * 11 * k, Z.x + ex * 17 * k, Z.y + ey * 17 * k);
  }
  /* 4. post caps */
  for (const it of order) if (it.s === 2 || it.s === 3) { alpha(it); if (!blit('s2', it.x, it.y, cw * k, chh * k)) disc(it.x, it.y, 3 * k, GLYPH.s2.color); }
  /* 5. module panels, in front, tiled down each run at the mock's own 47 px pitch */
  for (const pts of runs) {
    const A = pts[0], Z = pts[pts.length - 1]; alpha(A);
    let ex = ux, ey = uy; if (pts.length > 1) { const dx = Z.x - A.x, dy = Z.y - A.y, L0 = Math.hypot(dx, dy) || 1; ex = dx / L0; ey = dy / L0; }
    const Lr = Math.hypot(Z.x - A.x, Z.y - A.y);
    if (!(panel && panel.ready)) { for (const it of pts) disc(it.x, it.y, 3 * k, GLYPH.s4.color); continue; }
    ctx.save(); ctx.translate(A.x, A.y); ctx.rotate(Math.atan2(ey, ex) - Math.PI / 2);
    for (let t = 9 * k, first = true; first || t + 39 * k <= Lr + 27 * k; t += 47 * k, first = false) ctx.drawImage(panel.img, -mw * k / 2, t - k, mw * k, mh * k);
    ctx.restore();
  }
  shadowOff();
  /* 6. deletion queue, selection ring, flags */
  for (const it of items) {
    ctx.globalAlpha = 1;
    if (it.del) { disc(it.x, it.y, 9 * k, GLYPH.del.color); ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1.2, 2 * k); ctx.stroke(); continue; }
    if (it.hot) { ctx.beginPath(); ctx.arc(it.x, it.y, 16 * k, 0, Math.PI * 2); ctx.strokeStyle = ORANGE; ctx.lineWidth = Math.max(1.5, 2 * k); ctx.stroke(); }
    if (it.q === 1 || it.q === 2) {
      if (it.dim) ctx.globalAlpha = 0.35;
      seg(ctx, it.x, it.y - 14 * k, it.x, it.y - 24 * k, Math.max(1, 1.6 * k), ORANGE);
      disc(it.x, it.y - 14 * k, 2 * k + 0.5, '#ffd7a8'); ctx.strokeStyle = ORANGE; ctx.lineWidth = Math.max(1, 1.6 * k); ctx.stroke();
      drawFlag(ctx, it.x, it.y - 30 * k, 6 * k, it.q === 1 ? 'q1' : 'q2', Math.max(0.6, 0.6 * k));
    }
  }
  ctx.restore();
}

/* ---------- SVG ---------- */
function Bang({ color }) { return <><rect x={-1.3} y={-4.5} width={2.6} height={6} fill={color} /><circle cx={0} cy={4.4} r={1.5} fill={color} /></>; }
export function glyphBox(code) { return PACK_BODY[code] ? PACK_BOX : '-11 -11 22 22'; }
/* The three pack gradients. Rendered once in GlyphDefs and once inside every
   standalone <Glyph>; duplicates are identical and url(#id) resolves to the
   first in document order, so extra copies are harmless. */
export function PackGradients() { return <defs dangerouslySetInnerHTML={{ __html: PACK_GRAD_ALL }} />; }
export function GlyphShape({ code }) {
  if (PACK_BODY[code]) return <g dangerouslySetInnerHTML={{ __html: PACK_BODY[code] }} />;
  switch (code) {
    case 'del': return <circle r={7.5} fill={GLYPH.del.color} stroke="#fff" strokeWidth={2} />;
    case 'q1': return (<>
      <polygon points="0,-9 9.5,7.5 -9.5,7.5" fill={GLYPH.q1.color} stroke="#3b2a00" strokeWidth={1} strokeLinejoin="round" />
      <Bang color="#1a1206" />
    </>);
    case 'q2': return (<>
      <polygon points="0,-10 10,0 0,10 -10,0" fill={GLYPH.q2.color} stroke="#fff" strokeWidth={1} strokeLinejoin="round" />
      <Bang color="#fff" />
    </>);
    default: return <circle r={5.5} fill="rgba(255,255,255,.9)" stroke={INK} strokeWidth={1} />;
  }
}

const CODES = ['s0', 's1', 's2', 's3', 's4', 'q1', 'q2', 'del'];
/* Mount once per document; then <use href="#tt-g-s2"/> anywhere. */
export function GlyphDefs() {
  return (
    <svg width={0} height={0} style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} aria-hidden="true">
      <PackGradients />
      <defs>
        {CODES.map((c) => <symbol key={c} id={'tt-g-' + c} viewBox={glyphBox(c)} overflow="visible"><GlyphShape code={c} /></symbol>)}
        <symbol id="tt-g-hot" viewBox="-14 -14 28 28" overflow="visible"><circle r={12.5} fill="none" stroke={ORANGE} strokeWidth={2.2} /></symbol>
      </defs>
    </svg>
  );
}

/* the mock's raster sprite as an inline icon (legend, cards) */
export function RefSprite({ code, size = 16, rotate, style }) {
  const sp = REF_SPRITES[code]; if (!sp) return null;
  const rot = rotate != null ? rotate : 0;
  return <img src={sp.uri} alt="" draggable={false} style={{ height: size, width: size * sp.w / sp.h, transform: rot ? `rotate(${rot}deg)` : undefined, flexShrink: 0, imageRendering: 'auto', ...style }} />;
}

/* standalone icon for legends / cards */
export function Glyph({ code, size = 20, style }) {
  if (REF && REF_SPRITES[code]) return <RefSprite code={code} size={size} rotate={code === 's3' ? 66 : code === 's4' ? 90 : 0} style={style} />;
  return (
    <svg width={size} height={size} viewBox={glyphBox(code)} style={{ flexShrink: 0, overflow: 'visible', ...style }} aria-hidden="true">
      {PACK_BODY[code] ? <PackGradients /> : null}
      <GlyphShape code={code} />
    </svg>
  );
}

/* Plan-view points in SVG (plan units): one pack icon per point (rotated
   along the row for tube/module), rails as a few shared <path>s beneath,
   flags/deletes on top. Icons and flags carry data-i for hit-testing. */
export function StackSvg({ points, stage, qc, rowNext, rowDir, pad, isDim, marked, unit }) {
  if (REF && REF_SPRITES.s1) return <RefStackSvg points={points} stage={stage} qc={qc} rowNext={rowNext} rowDir={rowDir} pad={pad} isDim={isDim} marked={marked} unit={unit} />;
  const r = unit || 5; const S = ICON_K * r, h = S / 2; const PAD = pad || 0;
  const dir = rowDir || [0, 1]; const rowAngle = Math.atan2(dir[1], dir[0]);
  const deg3 = +deg(iconRotation('s3', rowAngle)).toFixed(1), deg4 = +deg(iconRotation('s4', rowAngle)).toFixed(1);
  const icons = [], flags = []; const rails = { s3: [], s3d: [], s4: [], s4d: [] };
  const N = points.length;
  for (let i = 0; i < N; i++) {
    const x = points[i][0] + PAD, y = points[i][1] + PAD;
    const s = stage[i] || 0, q = qc ? (qc[i] || 0) : 0;
    const del = marked && marked.has(i); const dim = !del && isDim && isDim(i);
    const op = dim ? 0.16 : 1;
    if (del) { flags.push(<use key={'d' + i} data-i={i} href="#tt-g-del" x={x - 0.7 * S} y={y - 0.7 * S} width={1.4 * S} height={1.4 * S} />); continue; }
    if (s >= 1) {
      const code = 's' + Math.min(4, s); const rot = s >= 4 ? deg4 : s >= 3 ? deg3 : 0;
      icons.push(<use key={'p' + i} data-i={i} href={'#tt-g-' + code} x={x - h} y={y - h} width={S} height={S} opacity={op} transform={rot ? `rotate(${rot} ${x} ${y})` : undefined} />);
    } else icons.push(<use key={'p' + i} data-i={i} href="#tt-g-s0" x={x - 1.1 * r} y={y - 1.1 * r} width={2.2 * r} height={2.2 * r} opacity={op} />);
    const j = rowNext ? rowNext[i] : -1;
    if (j >= 0) {
      const rc = railColor(s, stage[j] || 0);
      if (rc) rails[(rc === RAIL.s4 ? 's4' : 's3') + (dim ? 'd' : '')].push(`M${x} ${y}L${points[j][0] + PAD} ${points[j][1] + PAD}`);
    }
    if (q === 1 || q === 2) flags.push(
      <g key={'f' + i} opacity={dim ? 0.4 : 1}>
        <line x1={x} y1={y - 0.45 * S} x2={x} y2={y - 0.9 * S} stroke={ORANGE} strokeWidth={0.32 * r} strokeLinecap="round" style={{ pointerEvents: 'none' }} />
        <circle cx={x} cy={y - 0.45 * S} r={0.36 * r} fill="#ffd7a8" stroke={ORANGE} strokeWidth={0.28 * r} style={{ pointerEvents: 'none' }} />
        <use data-i={i} href={q === 1 ? '#tt-g-q1' : '#tt-g-q2'} x={x - 1.45 * r} y={y - 1.2 * S - 1.45 * r} width={2.9 * r} height={2.9 * r} />
      </g>
    );
  }
  const noHit = { pointerEvents: 'none' };
  const railEl = (key, colors, op) => rails[key].length ? (
    <g key={key} opacity={op} style={noHit}>
      <path d={rails[key].join('')} stroke={colors[1]} strokeWidth={0.25 * S} strokeLinecap="round" fill="none" />
      <path d={rails[key].join('')} stroke={colors[0]} strokeWidth={0.18 * S} strokeLinecap="round" fill="none" />
    </g>
  ) : null;
  return (
    <>
      {railEl('s3d', RAIL.s3, 0.16)}{railEl('s3', RAIL.s3, 1)}{railEl('s4d', RAIL.s4, 0.16)}{railEl('s4', RAIL.s4, 1)}
      {icons}
      {flags}
    </>
  );
}

/* Reference skin in SVG (plan view / 3D overlay): the mock's sprites as
   <image>s, stacked like paintRefStack. Point images carry data-i. */
function RefStackSvg({ points, stage, qc, rowNext, rowDir, pad, isDim, marked, unit }) {
  const PAD = pad || 0; const S = REF_SPRITES;
  const dir = rowDir || [0, 1]; const ux = dir[0], uy = dir[1];
  const rot = +(refRotation(Math.atan2(uy, ux)) * 180 / Math.PI).toFixed(1);
  const N = points.length;
  const ds = [];
  for (let i = 0; i < N; i++) { const j = rowNext ? rowNext[i] : -1; if (j >= 0) ds.push(Math.hypot(points[j][0] - points[i][0], points[j][1] - points[i][1])); }
  ds.sort((a, b) => a - b);
  const P = ds.length ? ds[ds.length >> 1] : 36 * (unit || 5) / 9;
  const k = clampK(P / 36);
  const dots = [], piles = [], caps = [], tubes = [], panels = [], flags = [];
  const noHit = { pointerEvents: 'none' };
  const px = (i) => points[i][0] + PAD, py = (i) => points[i][1] + PAD;
  const st = (i) => (marked && marked.has(i)) ? -1 : (stage[i] || 0);
  const tubeEl = (key, x0, y0, x1, y1, op) => {
    const L = Math.hypot(x1 - x0, y1 - y0); if (L < 1.5 * k) return null;
    const deg = Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI - 90;
    return <image key={key} href={S.s3.uri} x={x0 - S.s3.w * k / 2} y={y0} width={S.s3.w * k} height={L} preserveAspectRatio="none" opacity={op} transform={`rotate(${deg.toFixed(1)} ${x0} ${y0})`} style={noHit} />;
  };
  const hasPrev = new Set();
  for (let i = 0; i < N; i++) if (st(i) >= 4) { const j = rowNext ? rowNext[i] : -1; if (j >= 0 && st(j) >= 4) hasPrev.add(j); }
  for (let i = 0; i < N; i++) {
    const x = px(i), y = py(i); const s = st(i), q = qc ? (qc[i] || 0) : 0;
    const del = s < 0; const dim = !del && isDim && isDim(i); const op = dim ? 0.16 : 1;
    const tr = rot ? `rotate(${rot} ${x} ${y})` : undefined;
    if (del) { flags.push(<use key={'d' + i} data-i={i} href="#tt-g-del" x={x - 9 * k} y={y - 9 * k} width={18 * k} height={18 * k} />); continue; }
    if (s < 1) dots.push(<use key={'p' + i} data-i={i} href="#tt-g-s0" x={x - 2.75 * k} y={y - 2.75 * k} width={5.5 * k} height={5.5 * k} opacity={op} />);
    else if (s === 1) piles.push(<image key={'p' + i} data-i={i} href={S.s1.uri} x={x - S.s1.w * k / 2} y={y - S.s1.h * k / 2} width={S.s1.w * k} height={S.s1.h * k} opacity={op} transform={tr} />);
    else if (s === 2 || s === 3) caps.push(<image key={'p' + i} data-i={i} href={S.s2.uri} x={x - S.s2.w * k / 2} y={y - S.s2.h * k / 2} width={S.s2.w * k} height={S.s2.h * k} opacity={op} transform={tr} />);
    const j = rowNext ? rowNext[i] : -1;
    if (s === 3) {
      const jx = j >= 0 ? px(j) : x + ux * P, jy = j >= 0 ? py(j) : y + uy * P;
      const dx = jx - x, dy = jy - y, L0 = Math.hypot(dx, dy) || 1; const ex = dx / L0, ey = dy / L0;
      const el = tubeEl('t' + i, x + ex * 3 * k, y + ey * 3 * k, jx - ex * 9 * k, jy - ey * 9 * k, op); if (el) tubes.push(el);
    }
    if (s >= 4 && !hasPrev.has(i)) {
      /* a run of modules: one tube underneath, panels tiled at the mock pitch */
      const run = [i]; let cur = i;
      for (let g = 0; g < 4096; g++) { const n = rowNext ? rowNext[cur] : -1; if (n < 0 || st(n) < 4) break; run.push(n); cur = n; }
      const A = run[0], Z = run[run.length - 1];
      let ex = ux, ey = uy; if (run.length > 1) { const dx = px(Z) - px(A), dy = py(Z) - py(A), L0 = Math.hypot(dx, dy) || 1; ex = dx / L0; ey = dy / L0; }
      const Lr = Math.hypot(px(Z) - px(A), py(Z) - py(A));
      const el = tubeEl('tr' + i, px(A) - ex * 11 * k, py(A) - ey * 11 * k, px(Z) + ex * 17 * k, py(Z) + ey * 17 * k, op); if (el) tubes.push(el);
      const deg = Math.atan2(ey, ex) * 180 / Math.PI - 90; const ax = px(A), ay = py(A);
      let idx = 0;
      for (let t = 9 * k, first = true; first || t + 39 * k <= Lr + 27 * k; t += 47 * k, first = false, idx++) {
        const owner = run[Math.min(run.length - 1, Math.round(t / Math.max(P, 1e-6)))];
        panels.push(<image key={'m' + i + '_' + idx} data-i={owner} href={S.s4.uri} x={ax - S.s4.w * k / 2} y={ay + t - k} width={S.s4.w * k} height={S.s4.h * k} opacity={op} transform={`rotate(${deg.toFixed(1)} ${ax} ${ay})`} />);
      }
    }
    if (q === 1 || q === 2) flags.push(
      <g key={'f' + i} opacity={dim ? 0.4 : 1}>
        <line x1={x} y1={y - 14 * k} x2={x} y2={y - 24 * k} stroke={ORANGE} strokeWidth={1.6 * k} strokeLinecap="round" style={noHit} />
        <circle cx={x} cy={y - 14 * k} r={2 * k} fill="#ffd7a8" stroke={ORANGE} strokeWidth={1.4 * k} style={noHit} />
        <use data-i={i} href={q === 1 ? '#tt-g-q1' : '#tt-g-q2'} x={x - 8.7 * k} y={y - 30 * k - 8.7 * k} width={17.4 * k} height={17.4 * k} />
      </g>
    );
  }
  return <>{dots}{piles}{tubes}{caps}{panels}{flags}</>;
}
