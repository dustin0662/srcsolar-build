import React from 'react';

/* One drawing of every point state, in three flavours that stay in sync:
   - drawGlyph(): canvas, for the Leaflet satellite map (thousands of points)
   - <GlyphDefs/>: SVG <symbol>s, referenced with <use> by the plan and 3D views
   - <Glyph/>: a standalone inline SVG for legends and cards
   All shapes live in a -10..10 box. */

export const GLYPH = {
  s0: { name: 'No Progress', color: '#e8e8ea' },
  s1: { name: 'Piles', color: '#b9c0cc' },
  s2: { name: 'Post Caps', color: '#3b82f6' },
  s3: { name: 'Torque Tube', color: '#a855f7' },
  s4: { name: 'Modules', color: '#22c55e' },
  q1: { name: 'Requires Attention', color: '#facc15' },
  q2: { name: 'Flagged Issue', color: '#ef4444' },
  del: { name: 'Delete', color: '#dc2626' },
};
export const ORANGE = '#F97316';
const INK = 'rgba(2,3,10,.55)';

export function glyphCode(stage, qc) { return qc === 2 ? 'q2' : qc === 1 ? 'q1' : 's' + (stage || 0); }
/* marker radius on the satellite map, by zoom — bigger as you get closer */
export function radiusForZoom(z) { return z >= 21 ? 14 : z >= 20 ? 11 : z >= 19 ? 8.5 : z >= 18 ? 6.5 : 5; }
/* flags read bigger than install glyphs, like the concept art */
export function glyphScale(code, hot) { return (code === 'q1' || code === 'q2') ? 1.35 : hot ? 1.3 : 1; }

/* ---------- canvas ---------- */
function poly(ctx, pts) { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); }
function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function bang(ctx, color) { ctx.fillStyle = color; ctx.fillRect(-1.3, -4.5, 2.6, 6); ctx.beginPath(); ctx.arc(0, 4.4, 1.5, 0, Math.PI * 2); ctx.fill(); }

export function drawGlyph(ctx, x, y, r, code, opts) {
  const o = opts || {};
  const k = (r / 10) * glyphScale(code, o.hot);
  ctx.save();
  ctx.translate(x, y); ctx.scale(k, k);
  if (o.dimmed) ctx.globalAlpha = 0.2;
  ctx.lineJoin = 'round';
  if (o.hot) { ctx.beginPath(); ctx.arc(0, 0, 12.5, 0, Math.PI * 2); ctx.strokeStyle = ORANGE; ctx.lineWidth = 2.2; ctx.stroke(); }
  switch (code) {
    case 'del':
      ctx.beginPath(); ctx.arc(0, 0, 7.5, 0, Math.PI * 2); ctx.fillStyle = GLYPH.del.color; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); break;
    case 's1': /* pile: silver cylinder */
      ctx.beginPath(); ctx.ellipse(0, 6.5, 4.2, 1.9, 0, 0, Math.PI * 2); ctx.fillStyle = '#7d8593'; ctx.fill();
      ctx.fillStyle = '#aab2c0'; ctx.fillRect(-4.2, -6.5, 8.4, 13);
      ctx.fillStyle = '#dfe4ec'; ctx.fillRect(-4.2, -6.5, 2.6, 13);
      ctx.beginPath(); ctx.ellipse(0, -6.5, 4.2, 1.9, 0, 0, Math.PI * 2); ctx.fillStyle = '#f3f5f9'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 0.8; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-4.2, -6.5); ctx.lineTo(-4.2, 6.5); ctx.moveTo(4.2, -6.5); ctx.lineTo(4.2, 6.5); ctx.stroke();
      break;
    case 's2': /* post cap: blue cube */
      poly(ctx, [[0, -8.5], [7.5, -4.2], [0, 0.2], [-7.5, -4.2]]); ctx.fillStyle = '#8fbcff'; ctx.fill();
      poly(ctx, [[-7.5, -4.2], [0, 0.2], [0, 8.8], [-7.5, 4.4]]); ctx.fillStyle = '#2f6fe0'; ctx.fill();
      poly(ctx, [[0, 0.2], [7.5, -4.2], [7.5, 4.4], [0, 8.8]]); ctx.fillStyle = '#1b4aa8'; ctx.fill();
      poly(ctx, [[0, -8.5], [7.5, -4.2], [7.5, 4.4], [0, 8.8], [-7.5, 4.4], [-7.5, -4.2]]); ctx.strokeStyle = INK; ctx.lineWidth = 0.8; ctx.stroke();
      break;
    case 's3': /* torque tube: purple capsule */
      rrect(ctx, -9.5, -3.6, 19, 7.2, 3.6); ctx.fillStyle = '#7c3aed'; ctx.fill();
      rrect(ctx, -9.5, -3.6, 19, 4.2, 2.1); ctx.fillStyle = '#a56cf9'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(-7, -1.6); ctx.lineTo(7, -1.6); ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1.1; ctx.stroke();
      rrect(ctx, -9.5, -3.6, 19, 7.2, 3.6); ctx.strokeStyle = INK; ctx.lineWidth = 0.8; ctx.stroke();
      break;
    case 's4': /* module: green tilted panel */
      poly(ctx, [[-8.5, -3.5], [5.5, -8.5], [8.5, 3.5], [-5.5, 8.5]]); ctx.fillStyle = '#16a34a'; ctx.fill();
      ctx.strokeStyle = '#9ff5c0'; ctx.lineWidth = 0.9; ctx.beginPath();
      ctx.moveTo(-3.8, -5.2); ctx.lineTo(-0.8, 6.8); ctx.moveTo(0.9, -6.9); ctx.lineTo(3.9, 5.1); ctx.moveTo(-7, 0); ctx.lineTo(7, -5); ctx.stroke();
      poly(ctx, [[-8.5, -3.5], [5.5, -8.5], [8.5, 3.5], [-5.5, 8.5]]); ctx.strokeStyle = INK; ctx.lineWidth = 0.8; ctx.stroke();
      break;
    case 'q1': /* attention: yellow triangle */
      ctx.shadowColor = 'rgba(250,204,21,.8)'; ctx.shadowBlur = 8;
      poly(ctx, [[0, -9], [9.5, 7.5], [-9.5, 7.5]]); ctx.fillStyle = GLYPH.q1.color; ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = '#3b2a00'; ctx.lineWidth = 1; ctx.stroke(); bang(ctx, '#1a1206');
      break;
    case 'q2': /* flagged: red diamond */
      ctx.shadowColor = 'rgba(239,68,68,.85)'; ctx.shadowBlur = 8;
      poly(ctx, [[0, -10], [10, 0], [0, 10], [-10, 0]]); ctx.fillStyle = GLYPH.q2.color; ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); bang(ctx, '#fff');
      break;
    default: /* no progress: hollow dot */
      ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke();
  }
  ctx.restore();
}

/* ---------- SVG ---------- */
function Bang({ color }) { return <><rect x={-1.3} y={-4.5} width={2.6} height={6} fill={color} /><circle cx={0} cy={4.4} r={1.5} fill={color} /></>; }
export function GlyphShape({ code }) {
  switch (code) {
    case 'del': return <circle r={7.5} fill={GLYPH.del.color} stroke="#fff" strokeWidth={2} />;
    case 's1': return (<>
      <ellipse cx={0} cy={6.5} rx={4.2} ry={1.9} fill="#7d8593" />
      <rect x={-4.2} y={-6.5} width={8.4} height={13} fill="#aab2c0" />
      <rect x={-4.2} y={-6.5} width={2.6} height={13} fill="#dfe4ec" />
      <ellipse cx={0} cy={-6.5} rx={4.2} ry={1.9} fill="#f3f5f9" stroke={INK} strokeWidth={0.8} />
      <path d="M-4.2 -6.5 V6.5 M4.2 -6.5 V6.5" stroke={INK} strokeWidth={0.8} fill="none" />
    </>);
    case 's2': return (<>
      <polygon points="0,-8.5 7.5,-4.2 0,0.2 -7.5,-4.2" fill="#8fbcff" />
      <polygon points="-7.5,-4.2 0,0.2 0,8.8 -7.5,4.4" fill="#2f6fe0" />
      <polygon points="0,0.2 7.5,-4.2 7.5,4.4 0,8.8" fill="#1b4aa8" />
      <polygon points="0,-8.5 7.5,-4.2 7.5,4.4 0,8.8 -7.5,4.4 -7.5,-4.2" fill="none" stroke={INK} strokeWidth={0.8} strokeLinejoin="round" />
    </>);
    case 's3': return (<>
      <rect x={-9.5} y={-3.6} width={19} height={7.2} rx={3.6} fill="#7c3aed" />
      <rect x={-9.5} y={-3.6} width={19} height={4.2} rx={2.1} fill="#a56cf9" />
      <path d="M-7 -1.6 H7" stroke="rgba(255,255,255,.55)" strokeWidth={1.1} />
      <rect x={-9.5} y={-3.6} width={19} height={7.2} rx={3.6} fill="none" stroke={INK} strokeWidth={0.8} />
    </>);
    case 's4': return (<>
      <polygon points="-8.5,-3.5 5.5,-8.5 8.5,3.5 -5.5,8.5" fill="#16a34a" />
      <path d="M-3.8 -5.2 L-0.8 6.8 M0.9 -6.9 L3.9 5.1 M-7 0 L7 -5" stroke="#9ff5c0" strokeWidth={0.9} fill="none" />
      <polygon points="-8.5,-3.5 5.5,-8.5 8.5,3.5 -5.5,8.5" fill="none" stroke={INK} strokeWidth={0.8} strokeLinejoin="round" />
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

const CODES = ['s0', 's1', 's2', 's3', 's4', 'q1', 'q2', 'del'];
/* Mount once per document; then <use href="#tt-g-s2"/> anywhere. */
export function GlyphDefs() {
  return (
    <svg width={0} height={0} style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} aria-hidden="true">
      <defs>
        {CODES.map((c) => <symbol key={c} id={'tt-g-' + c} viewBox="-11 -11 22 22" overflow="visible"><GlyphShape code={c} /></symbol>)}
        <symbol id="tt-g-hot" viewBox="-14 -14 28 28" overflow="visible"><circle r={12.5} fill="none" stroke={ORANGE} strokeWidth={2.2} /></symbol>
      </defs>
    </svg>
  );
}
export function glyphHref(code) { return '#tt-g-' + (GLYPH[code] ? code : 's0'); }

/* standalone icon for legends / cards */
export function Glyph({ code, size = 20, style }) {
  return (
    <svg width={size} height={size} viewBox="-11 -11 22 22" style={{ flexShrink: 0, overflow: 'visible', ...style }} aria-hidden="true">
      <GlyphShape code={code} />
    </svg>
  );
}
