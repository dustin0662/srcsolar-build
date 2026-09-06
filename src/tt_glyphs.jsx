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

/* standalone icon for legends / cards */
export function Glyph({ code, size = 20, style }) {
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
