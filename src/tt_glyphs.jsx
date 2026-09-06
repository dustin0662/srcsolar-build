import React from 'react';

/* Point rendering for the Task Tracker, matching the concept art.
   Each point is a STACK, drawn in install order: a silver pile, a blue post
   cap on top of it, a purple torque tube that runs down the row through the
   caps, and green modules that sit on the tube. Tubes and modules join up
   with the next point in the row so finished rows read as continuous lines.

   Three renderers stay in sync:
   - paintStack(): canvas, used by the Leaflet satellite map (thousands of points)
   - <StackSvg/> + <GlyphDefs/>: SVG, used by the plan view and the 3D overlay
   - <Glyph/>: standalone icon for legends and cards                          */

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
/* phase palette from the skin pack (design-tokens.json → color.phase) */
const C = {
  pile: '#B9C3CF', pileHi: '#F5F8FC', pileLo: '#667280', pileTop: '#E9EEF4', pileBot: '#4F5A67',
  cubeTop: '#52C6FF', cubeL: '#008CFF', cubeR: '#005EB8',
  tube: '#B834F5', tubeHi: 'rgba(240,161,255,.85)', tubeLo: '#69129D',
  mod: '#147C65', modHi: '#7BFFE0', modLo: '#0B5C4A', modLite: '#1ED6A3',
};

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

/* ---------- canvas painter ---------- */
function poly(ctx, pts) { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); }
function seg(ctx, x0, y0, x1, y1, w, color, cap) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineWidth = w; ctx.strokeStyle = color; ctx.lineCap = cap || 'round'; ctx.stroke(); }
function drawPile(ctx, x, y, r, lw) {
  const w = 0.42 * r, h = 1.05 * r;
  ctx.beginPath(); ctx.ellipse(x, y + h, w, w * 0.45, 0, 0, Math.PI * 2); ctx.fillStyle = C.pileBot; ctx.fill();
  ctx.fillStyle = C.pile; ctx.fillRect(x - w, y - h, 2 * w, 2 * h);
  ctx.fillStyle = C.pileHi; ctx.fillRect(x - w, y - h, w * 0.6, 2 * h);
  ctx.fillStyle = C.pileLo; ctx.fillRect(x + w * 0.5, y - h, w * 0.5, 2 * h);
  ctx.strokeStyle = INK; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(x - w, y - h); ctx.lineTo(x - w, y + h); ctx.moveTo(x + w, y - h); ctx.lineTo(x + w, y + h); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(x, y - h, w, w * 0.45, 0, 0, Math.PI * 2); ctx.fillStyle = C.pileTop; ctx.fill(); ctx.stroke();
}
function drawCube(ctx, x, y, r, lw) {
  const w = 0.66 * r, cy = y - 0.95 * r;
  poly(ctx, [[x, cy - 0.95 * w], [x + w, cy - 0.45 * w], [x, cy + 0.05 * w], [x - w, cy - 0.45 * w]]); ctx.fillStyle = C.cubeTop; ctx.fill();
  poly(ctx, [[x - w, cy - 0.45 * w], [x, cy + 0.05 * w], [x, cy + 1.05 * w], [x - w, cy + 0.55 * w]]); ctx.fillStyle = C.cubeL; ctx.fill();
  poly(ctx, [[x, cy + 0.05 * w], [x + w, cy - 0.45 * w], [x + w, cy + 0.55 * w], [x, cy + 1.05 * w]]); ctx.fillStyle = C.cubeR; ctx.fill();
  poly(ctx, [[x, cy - 0.95 * w], [x + w, cy - 0.45 * w], [x + w, cy + 0.55 * w], [x, cy + 1.05 * w], [x - w, cy + 0.55 * w], [x - w, cy - 0.45 * w]]); ctx.strokeStyle = INK; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke();
}
function drawTube(ctx, x0, y0, x1, y1, r, lw) {
  const w = 0.7 * r; const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1; const px = -dy / L, py = dx / L;
  seg(ctx, x0, y0, x1, y1, w + 2 * lw, INK);
  seg(ctx, x0, y0, x1, y1, w, C.tube);
  seg(ctx, x0 - px * w * 0.3, y0 - py * w * 0.3, x1 - px * w * 0.3, y1 - py * w * 0.3, w * 0.3, C.tubeLo);
  seg(ctx, x0 + px * w * 0.22, y0 + py * w * 0.22, x1 + px * w * 0.22, y1 + py * w * 0.22, w * 0.24, C.tubeHi);
}
function drawModule(ctx, x0, y0, x1, y1, r, lw) {
  const w = 1.75 * r; const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1; const ux = dx / L, uy = dy / L, px = -uy, py = ux;
  seg(ctx, x0, y0, x1, y1, w + 2 * lw, INK, 'butt');
  seg(ctx, x0, y0, x1, y1, w, C.mod, 'butt');
  seg(ctx, x0 - px * w * 0.3, y0 - py * w * 0.3, x1 - px * w * 0.3, y1 - py * w * 0.3, w * 0.3, C.modLite, 'butt');
  seg(ctx, x0 + px * w * 0.36, y0 + py * w * 0.36, x1 + px * w * 0.36, y1 + py * w * 0.36, w * 0.14, C.modLo, 'butt');
  /* grid: centre line + cross ticks */
  seg(ctx, x0, y0, x1, y1, Math.max(0.6, w * 0.07), C.modHi, 'butt');
  const tick = Math.max(3, r * 0.9); const n = Math.floor(L / tick);
  ctx.beginPath(); for (let k = 1; k < n; k++) { const tx = x0 + ux * tick * k, ty = y0 + uy * tick * k; ctx.moveTo(tx - px * w / 2, ty - py * w / 2); ctx.lineTo(tx + px * w / 2, ty + py * w / 2); }
  ctx.lineWidth = Math.max(0.6, w * 0.06); ctx.strokeStyle = C.modHi; ctx.lineCap = 'butt'; ctx.stroke();
}
function bang(ctx, x, y, s, color) { ctx.fillStyle = color; ctx.fillRect(x - 0.13 * s, y - 0.45 * s, 0.26 * s, 0.6 * s); ctx.beginPath(); ctx.arc(x, y + 0.44 * s, 0.15 * s, 0, Math.PI * 2); ctx.fill(); }
function drawFlag(ctx, x, y, r, code, lw) {
  const s = 1.45 * r;
  ctx.save();
  if (code === 'q1') {
    ctx.shadowColor = 'rgba(250,204,21,.85)'; ctx.shadowBlur = r;
    poly(ctx, [[x, y - 0.95 * s], [x + s, y + 0.75 * s], [x - s, y + 0.75 * s]]); ctx.fillStyle = GLYPH.q1.color; ctx.fill(); ctx.shadowBlur = 0;
    ctx.strokeStyle = '#3b2a00'; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke(); bang(ctx, x, y + 0.05 * s, s, '#1a1206');
  } else {
    ctx.shadowColor = 'rgba(239,68,68,.9)'; ctx.shadowBlur = r;
    poly(ctx, [[x, y - s], [x + s, y], [x, y + s], [x - s, y]]); ctx.fillStyle = GLYPH.q2.color; ctx.fill(); ctx.shadowBlur = 0;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke(); bang(ctx, x, y, s, '#fff');
  }
  ctx.restore();
}

/* items: [{ x, y, nx, ny, s, q, ns, dim, hot, del }] — nx/ny/ns describe the
   next point down the row (null / -1 when the row ends). dir = unit row
   direction in pixels for the stub drawn when there is no neighbour. */
export function paintStack(ctx, items, r, dir) {
  const lw = Math.max(0.6, r * 0.1);
  const ux = dir ? dir[0] : 0, uy = dir ? dir[1] : 1;
  const alpha = (it) => { ctx.globalAlpha = it.dim ? 0.2 : 1; };
  ctx.save();
  /* 1. piles / empty points */
  for (const it of items) {
    alpha(it);
    if (it.del) continue;
    if (it.s >= 1) drawPile(ctx, it.x, it.y, r, lw);
    else { ctx.beginPath(); ctx.arc(it.x, it.y, 0.5 * r, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = lw; ctx.stroke(); }
  }
  /* 2. torque tubes, joined down the row */
  for (const it of items) {
    if (it.del || it.s < 3) continue; alpha(it);
    if (it.nx != null && it.ns >= 3) drawTube(ctx, it.x, it.y - 0.95 * r, it.nx, it.ny - 0.95 * r, r, lw);
    else drawTube(ctx, it.x - ux * 0.6 * r, it.y - 0.95 * r - uy * 0.6 * r, it.x + ux * 0.6 * r, it.y - 0.95 * r + uy * 0.6 * r, r, lw);
  }
  /* 3. modules on the tube, leaving the cap visible at each joint */
  for (const it of items) {
    if (it.del || it.s < 4) continue; alpha(it);
    const g = 0.95 * r;
    if (it.nx != null && it.ns >= 4) {
      const dx = it.nx - it.x, dy = it.ny - it.y, L = Math.hypot(dx, dy) || 1;
      if (L > 2 * g + 2) drawModule(ctx, it.x + dx / L * g, it.y - 0.95 * r + dy / L * g, it.nx - dx / L * g, it.ny - 0.95 * r - dy / L * g, r, lw);
    } else drawModule(ctx, it.x - ux * 0.8 * r, it.y - 0.95 * r - uy * 0.8 * r, it.x + ux * 0.8 * r, it.y - 0.95 * r + uy * 0.8 * r, r, lw);
  }
  /* 4. post caps sit on top */
  for (const it of items) { if (it.del || it.s < 2) continue; alpha(it); drawCube(ctx, it.x, it.y, r, lw); }
  /* 5. selection, deletion queue, flags */
  for (const it of items) {
    ctx.globalAlpha = 1;
    if (it.del) { ctx.beginPath(); ctx.arc(it.x, it.y, 0.8 * r, 0, Math.PI * 2); ctx.fillStyle = GLYPH.del.color; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1.2, lw * 2); ctx.stroke(); continue; }
    if (it.hot) { ctx.beginPath(); ctx.arc(it.x, it.y - 0.4 * r, 1.7 * r, 0, Math.PI * 2); ctx.strokeStyle = ORANGE; ctx.lineWidth = Math.max(1.5, lw * 2); ctx.stroke(); }
    if (it.q === 1 || it.q === 2) {
      if (it.dim) ctx.globalAlpha = 0.35;
      /* flag floats above the point on a short leader, like the concept art */
      seg(ctx, it.x, it.y - 0.4 * r, it.x, it.y - 1.9 * r, Math.max(1, lw * 1.6), ORANGE);
      ctx.beginPath(); ctx.arc(it.x, it.y - 0.4 * r, 0.32 * r + 0.5, 0, Math.PI * 2); ctx.fillStyle = '#ffd7a8'; ctx.fill(); ctx.strokeStyle = ORANGE; ctx.lineWidth = Math.max(1, lw * 1.6); ctx.stroke();
      drawFlag(ctx, it.x, it.y - 3.1 * r, r, it.q === 1 ? 'q1' : 'q2', lw);
    }
  }
  ctx.restore();
}

/* ---------- SVG ---------- */
function Bang({ color }) { return <><rect x={-1.3} y={-4.5} width={2.6} height={6} fill={color} /><circle cx={0} cy={4.4} r={1.5} fill={color} /></>; }
/* Phase icons from the skin pack (assets/icons/*.svg, 96×96 boxes) plus the
   stack pieces used on the plan (pile / cap) and the flags. */
const PACK_BOX = { s1: '0 0 96 96', s2: '0 0 96 96', s3: '0 0 96 96', s4: '0 0 96 96' };
export function glyphBox(code) { return PACK_BOX[code] || '-11 -11 22 22'; }
export function GlyphShape({ code }) {
  switch (code) {
    case 'del': return <circle r={7.5} fill={GLYPH.del.color} stroke="#fff" strokeWidth={2} />;
    case 's1': return (<>
      <defs><linearGradient id="ttg-pile" x1="0" x2="1"><stop stopColor="#697582" /><stop offset=".48" stopColor="#F5F8FC" /><stop offset="1" stopColor="#8E99A6" /></linearGradient></defs>
      <path d="M30 76V27L48 16L66 27V76L48 86Z" fill="url(#ttg-pile)" stroke="#243343" strokeWidth={4} strokeLinejoin="round" />
      <path d="M48 17V85M30 27L48 38L66 27" fill="none" stroke="#FFFFFF" strokeOpacity=".72" strokeWidth={3} />
    </>);
    case 's2': return (<>
      <defs><linearGradient id="ttg-cap" x1="0" x2="1"><stop stopColor="#005EB8" /><stop offset=".5" stopColor="#38B8FF" /><stop offset="1" stopColor="#0078E8" /></linearGradient></defs>
      <path d="M31 76V35L48 26L65 35V76L48 86Z" fill="url(#ttg-cap)" stroke="#002B5B" strokeWidth={4} strokeLinejoin="round" />
      <path d="M22 29L48 14L74 29L48 44Z" fill="#008CFF" stroke="#002B5B" strokeWidth={4} strokeLinejoin="round" />
      <path d="M29 29L48 19L67 29L48 39Z" fill="#52C6FF" />
      <path d="M48 45V84" stroke="#93DDFF" strokeWidth={3} />
    </>);
    case 's3': return (<>
      <defs><linearGradient id="ttg-tube" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#E05BFF" /><stop offset=".5" stopColor="#B834F5" /><stop offset="1" stopColor="#69129D" /></linearGradient></defs>
      <path d="M18 68L73 25" stroke="#321044" strokeWidth={24} strokeLinecap="round" />
      <path d="M18 65L73 22" stroke="url(#ttg-tube)" strokeWidth={17} strokeLinecap="round" />
      <path d="M22 60L69 24" stroke="#F0A1FF" strokeWidth={4} strokeLinecap="round" opacity=".8" />
    </>);
    case 's4': return (<>
      <path d="M17 77L30 19L80 25L67 83Z" fill="#147C65" stroke="#7BFFE0" strokeWidth={4} strokeLinejoin="round" />
      <path d="M26 41L75 47M22 59L71 65M47 21L34 79M64 23L51 81" fill="none" stroke="#7BFFE0" strokeWidth={3} />
      <path d="M31 23L47 25L43 39L28 37Z" fill="#1ED6A3" opacity=".6" />
    </>);
    case 'pile': return (<>
      <ellipse cx={0} cy={9} rx={3.6} ry={1.6} fill={C.pileBot} />
      <rect x={-3.6} y={-9} width={7.2} height={18} fill={C.pile} />
      <rect x={-3.6} y={-9} width={2.2} height={18} fill={C.pileHi} />
      <rect x={1.8} y={-9} width={1.8} height={18} fill={C.pileLo} />
      <path d="M-3.6 -9 V9 M3.6 -9 V9" stroke={INK} strokeWidth={0.8} fill="none" />
      <ellipse cx={0} cy={-9} rx={3.6} ry={1.6} fill={C.pileTop} stroke={INK} strokeWidth={0.8} />
    </>);
    case 'cap': return (<>
      <polygon points="0,-8.5 7.5,-4.2 0,0.2 -7.5,-4.2" fill={C.cubeTop} />
      <polygon points="-7.5,-4.2 0,0.2 0,8.8 -7.5,4.4" fill={C.cubeL} />
      <polygon points="0,0.2 7.5,-4.2 7.5,4.4 0,8.8" fill={C.cubeR} />
      <polygon points="0,-8.5 7.5,-4.2 7.5,4.4 0,8.8 -7.5,4.4 -7.5,-4.2" fill="none" stroke={INK} strokeWidth={0.8} strokeLinejoin="round" />
    </>);
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

const CODES = ['s0', 's1', 's2', 's3', 's4', 'q1', 'q2', 'del', 'pile', 'cap'];
/* Mount once per document; then <use href="#tt-g-s2"/> anywhere. */
export function GlyphDefs() {
  return (
    <svg width={0} height={0} style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} aria-hidden="true">
      <defs>
        {CODES.map((c) => <symbol key={c} id={'tt-g-' + c} viewBox={glyphBox(c)} overflow="visible"><GlyphShape code={c} /></symbol>)}
        <symbol id="tt-g-hot" viewBox="-14 -14 28 28" overflow="visible"><circle r={12.5} fill="none" stroke={ORANGE} strokeWidth={2.2} /></symbol>
      </defs>
    </svg>
  );
}
export function glyphHref(code) { return '#tt-g-' + (GLYPH[code] || code === 'pile' || code === 'cap' ? code : 's0'); }

/* standalone icon for legends / cards */
export function Glyph({ code, size = 20, style }) {
  return (
    <svg width={size} height={size} viewBox={glyphBox(code)} style={{ flexShrink: 0, overflow: 'visible', ...style }} aria-hidden="true">
      <GlyphShape code={code} />
    </svg>
  );
}

/* The plan-view stack in SVG (plan units). Piles, caps, flags and deletions
   are <use> elements carrying data-i for hit-testing; tubes and modules are
   a handful of shared <path>s so a 5,000-point plan stays light. */
export function StackSvg({ points, stage, qc, rowNext, pad, isDim, marked, unit }) {
  const r = unit || 5; const PAD = pad || 0;
  const piles = [], cubes = [], flags = [];
  const tube = [], tubeDim = [], mod = [], modDim = [], modGrid = [];
  const N = points.length;
  for (let i = 0; i < N; i++) {
    const x = points[i][0] + PAD, y = points[i][1] + PAD;
    const s = stage[i] || 0, q = qc ? (qc[i] || 0) : 0;
    const del = marked && marked.has(i); const dim = !del && isDim && isDim(i);
    const op = dim ? 0.16 : 1;
    if (del) { flags.push(<use key={'d' + i} data-i={i} href="#tt-g-del" x={x - 1.1 * r} y={y - 1.1 * r} width={2.2 * r} height={2.2 * r} />); continue; }
    if (s >= 1) piles.push(<use key={'p' + i} data-i={i} href="#tt-g-pile" x={x - 1.1 * r} y={y - 1.1 * r} width={2.2 * r} height={2.2 * r} opacity={op} />);
    else piles.push(<use key={'p' + i} data-i={i} href="#tt-g-s0" x={x - 1.1 * r} y={y - 1.1 * r} width={2.2 * r} height={2.2 * r} opacity={op} />);
    const j = rowNext ? rowNext[i] : -1; const ns = j >= 0 ? (stage[j] || 0) : -1;
    const ty = y - 0.95 * r;
    if (s >= 3) {
      let d;
      if (j >= 0 && ns >= 3) d = `M${x} ${ty}L${points[j][0] + PAD} ${points[j][1] + PAD - 0.95 * r}`;
      else d = `M${x} ${ty - 0.6 * r}L${x} ${ty + 0.6 * r}`;
      (dim ? tubeDim : tube).push(d);
    }
    if (s >= 4) {
      let d;
      if (j >= 0 && ns >= 4) {
        const nx = points[j][0] + PAD, ny = points[j][1] + PAD - 0.95 * r; const dx = nx - x, dy = ny - ty, L = Math.hypot(dx, dy) || 1, g = 0.95 * r;
        if (L > 2 * g + 1) { d = `M${x + dx / L * g} ${ty + dy / L * g}L${nx - dx / L * g} ${ny - dy / L * g}`; }
      } else d = `M${x} ${ty - 0.8 * r}L${x} ${ty + 0.8 * r}`;
      if (d) { (dim ? modDim : mod).push(d); if (!dim) modGrid.push(d); }
    }
    if (s >= 2) cubes.push(<use key={'c' + i} data-i={i} href="#tt-g-cap" x={x - 0.78 * r} y={y - 0.95 * r - 0.78 * r} width={1.56 * r} height={1.56 * r} opacity={op} />);
    if (q === 1 || q === 2) flags.push(
      <g key={'f' + i} opacity={dim ? 0.4 : 1}>
        <line x1={x} y1={y - 0.4 * r} x2={x} y2={y - 1.9 * r} stroke={ORANGE} strokeWidth={0.32 * r} strokeLinecap="round" style={{ pointerEvents: 'none' }} />
        <circle cx={x} cy={y - 0.4 * r} r={0.36 * r} fill="#ffd7a8" stroke={ORANGE} strokeWidth={0.28 * r} style={{ pointerEvents: 'none' }} />
        <use data-i={i} href={q === 1 ? '#tt-g-q1' : '#tt-g-q2'} x={x - 1.45 * r} y={y - 3.1 * r - 1.45 * r} width={2.9 * r} height={2.9 * r} />
      </g>
    );
  }
  const noHit = { pointerEvents: 'none' };
  const tubeW = 0.7 * r, modW = 1.75 * r;
  return (
    <>
      {piles}
      {tube.length > 0 && <><path d={tube.join('')} stroke={INK} strokeWidth={tubeW + 0.8} strokeLinecap="round" fill="none" style={noHit} /><path d={tube.join('')} stroke={C.tube} strokeWidth={tubeW} strokeLinecap="round" fill="none" style={noHit} /><path d={tube.join('')} stroke={C.tubeHi} strokeWidth={tubeW * 0.28} strokeLinecap="round" fill="none" transform={`translate(${-tubeW * 0.22} 0)`} style={noHit} /></>}
      {tubeDim.length > 0 && <path d={tubeDim.join('')} stroke={C.tube} strokeWidth={tubeW} strokeLinecap="round" fill="none" opacity={0.16} style={noHit} />}
      {mod.length > 0 && <><path d={mod.join('')} stroke={INK} strokeWidth={modW + 0.8} fill="none" style={noHit} /><path d={mod.join('')} stroke={C.mod} strokeWidth={modW} fill="none" style={noHit} /><path d={modGrid.join('')} stroke={C.modHi} strokeWidth={Math.max(0.4, modW * 0.07)} fill="none" strokeDasharray={`${0.9 * r} ${0.12 * r}`} style={noHit} /></>}
      {modDim.length > 0 && <path d={modDim.join('')} stroke={C.mod} strokeWidth={modW} fill="none" opacity={0.16} style={noHit} />}
      {cubes}
      {flags}
    </>
  );
}
