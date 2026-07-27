/* ------------------------------------------------------------------ */
/*  Task Tracker — GLB viewer with the point grid overlaid on top      */
/* ------------------------------------------------------------------ */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ModelViewer } from './glb_viewer.jsx';
import { sectionHull, normRect, rectContains, DRAG_SLOP } from './tt_geom.js';

const ORANGE = '#F97316', CREAM = '#F5F0EB', MUTE = '#9a958d';
const LINE = 'rgba(249,115,22,.20)';
const NBF = "'Barlow Condensed', sans-serif";
const MODELS_ENDPOINT = '/.netlify/functions/ttmodels';
const PAD = 16;

function b64ToBytes(b64) { const bin = atob(b64 || ''); const n = bin.length; const out = new Uint8Array(n); for (let i = 0; i < n; i++) out[i] = bin.charCodeAt(i); return out; }

const DEFAULT_OV = { on: true, locked: true, x: 0, y: 0, scale: 1, opacity: 0.9 };

export default function TTModelView({
  projectId, points, planW, planH, stage, qc, sections, selSection,
  overlay3d, onSaveOverlay, mode, canAlign, onModelBuffer,
  onPickPoint, onBrushStart, onBrushPoint, onBrushEnd, onRegionPoints,
  dispColor,
}) {
  const [models, setModels] = useState([]);
  const [buf, setBuf] = useState(null);
  const [curId, setCurId] = useState(null);
  const [status, setStatus] = useState('');
  const [ov, setOv] = useState(() => Object.assign({}, DEFAULT_OV, overlay3d || {}));
  const [aligning, setAligning] = useState(false);
  const wrapRef = useRef(null);
  const hostRef = useRef(null);
  /* ModelViewer sizes its renderer from a numeric height, so track the box */
  const [boxH, setBoxH] = useState(420);
  useEffect(() => {
    const el = hostRef.current; if (!el) return;
    const measure = () => { const h = Math.round(el.getBoundingClientRect().height); if (h > 40) setBoxH(h); };
    measure();
    if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure); }
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const dragRef = useRef(null);
  const paintRef = useRef(false);
  const marqRef = useRef(null);
  const [marq, setMarq] = useState(null);

  useEffect(() => { setOv(Object.assign({}, DEFAULT_OV, overlay3d || {})); }, [overlay3d]);

  /* Load the newest model for this project so the 3D tab is useful without a
     detour through the versions modal. */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(MODELS_ENDPOINT + '?project=' + encodeURIComponent(projectId) + '&list=1', { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json(); if (!alive) return;
        const list = j.models || []; setModels(list);
        if (list.length) loadModel(list[0]);
        else setStatus('No model uploaded yet — use "3D Model / Versions" to add a GLB.');
      } catch (e) { if (alive) setStatus('Could not reach model storage.'); }
    })();
    return () => { alive = false; };
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadModel = useCallback(async (m) => {
    setCurId(m.id); setStatus('Loading ' + (m.name || 'model') + '…');
    try {
      const parts = [];
      for (let i = 0; i < m.chunks; i++) {
        const r = await fetch(MODELS_ENDPOINT + '?project=' + encodeURIComponent(projectId) + '&chunk=1&model=' + encodeURIComponent(m.id) + '&index=' + i, { cache: 'no-store' });
        if (!r.ok) throw new Error('chunk ' + i);
        const j = await r.json(); parts.push(b64ToBytes(j.data));
      }
      const total = parts.reduce((s, p) => s + p.length, 0);
      const out = new Uint8Array(total); let off = 0;
      for (const p of parts) { out.set(p, off); off += p.length; }
      setBuf(out.buffer); setStatus('');
      if (typeof onModelBuffer === 'function') onModelBuffer(out.buffer);
    } catch (e) { setStatus('Could not load that model.'); }
  }, [projectId, onModelBuffer]);

  const VW = (planW || 1) + PAD * 2, VH = (planH || 1) + PAD * 2;

  const selHull = useMemo(() => {
    if (selSection == null || !sections) return null;
    const h = sectionHull(points, sections, selSection, 9);
    return h.length >= 3 ? h.map((p) => (p[0] + PAD) + ',' + (p[1] + PAD)).join(' ') : null;
  }, [selSection, sections, points]);

  /* Overlay-local coordinates: the SVG uses preserveAspectRatio="xMidYMid
     meet", so map a client point through the same fit the browser applied. */
  const toOverlay = useCallback((cx, cy) => {
    const el = wrapRef.current; if (!el) return null;
    const r = el.getBoundingClientRect();
    const s = Math.min(r.width / VW, r.height / VH);
    const offX = (r.width - VW * s) / 2, offY = (r.height - VH * s) / 2;
    const vx = (cx - r.left - offX) / s, vy = (cy - r.top - offY) / s;
    return { x: (vx - ov.x) / (ov.scale || 1), y: (vy - ov.y) / (ov.scale || 1) };
  }, [VW, VH, ov.x, ov.y, ov.scale]);

  const nearestPoint = useCallback((cx, cy) => {
    const p = toOverlay(cx, cy); if (!p) return -1;
    let best = -1, bd = 81; // ~9px in overlay units
    for (let i = 0; i < points.length; i++) {
      const dx = points[i][0] + PAD - p.x, dy = points[i][1] + PAD - p.y;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }, [points, toOverlay]);

  const painting = mode === 'brush' || mode === 'fill';
  /* The overlay only takes the pointer while aligning or painting — otherwise
     it would swallow the orbit/zoom gestures meant for the model itself. */
  const grabsPointer = aligning || painting;

  const onDown = (e) => {
    if (aligning) { dragRef.current = { sx: e.clientX, sy: e.clientY, x0: ov.x, y0: ov.y }; e.preventDefault(); return; }
    if (mode === 'brush') {
      paintRef.current = true; if (onBrushStart) onBrushStart();
      const i = nearestPoint(e.clientX, e.clientY); if (i >= 0 && onBrushPoint) onBrushPoint(i);
      e.preventDefault();
    } else if (mode === 'fill') {
      const p = toOverlay(e.clientX, e.clientY); if (!p) return;
      marqRef.current = { cx: e.clientX, cy: e.clientY, a: p, b: p, moved: false };
      setMarq({ a: p, b: p }); e.preventDefault();
    }
  };
  const onMove = (e) => {
    if (dragRef.current) { const d = dragRef.current; setOv((prev) => Object.assign({}, prev, { x: d.x0 + (e.clientX - d.sx), y: d.y0 + (e.clientY - d.sy) })); return; }
    if (paintRef.current) { const i = nearestPoint(e.clientX, e.clientY); if (i >= 0 && onBrushPoint) onBrushPoint(i); return; }
    if (marqRef.current) {
      const m = marqRef.current; const p = toOverlay(e.clientX, e.clientY); if (!p) return;
      m.b = p; if (Math.hypot(e.clientX - m.cx, e.clientY - m.cy) > DRAG_SLOP) m.moved = true;
      setMarq({ a: m.a, b: p });
    }
  };
  const finish = () => {
    if (dragRef.current) { dragRef.current = null; if (onSaveOverlay) onSaveOverlay(Object.assign({}, ov)); return; }
    if (paintRef.current) { paintRef.current = false; if (onBrushEnd) onBrushEnd(); return; }
    const m = marqRef.current; marqRef.current = null; setMarq(null);
    if (!m) return;
    if (!m.moved) { const i = nearestPoint(m.cx, m.cy); if (i >= 0 && onPickPoint) onPickPoint(i); return; }
    const r = normRect(m.a, m.b);
    const list = [];
    for (let i = 0; i < points.length; i++) if (rectContains(r, points[i][0] + PAD, points[i][1] + PAD)) list.push(i);
    if (list.length && onRegionPoints) onRegionPoints(list);
  };
  useEffect(() => {
    const up = () => finish();
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }); // re-bound each render so `finish` closes over current state

  const saveOv = (patch) => { const next = Object.assign({}, ov, patch); setOv(next); if (onSaveOverlay) onSaveOverlay(next); };

  return (
    <div ref={hostRef} style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 30%, #11203a, #06080f)', overflow: 'hidden' }}>
      {buf ? <ModelViewer arrayBuffer={buf} height={boxH} /> : (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTE, fontFamily: NBF, fontSize: 15, padding: 24, textAlign: 'center' }}>{status || 'Loading model…'}</div>
      )}

      {/* point grid, aligned over the model */}
      {ov.on && points.length > 0 && (
        <div ref={wrapRef} style={{ position: 'absolute', inset: 0, touchAction: 'none', cursor: aligning ? 'move' : painting ? 'crosshair' : 'default', pointerEvents: grabsPointer ? 'auto' : 'none' }}
          onPointerDown={onDown} onPointerMove={onMove}>
          <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block', opacity: ov.opacity != null ? ov.opacity : 0.9, pointerEvents: 'none' }}>
            <g transform={`translate(${ov.x} ${ov.y}) scale(${ov.scale})`}>
              {points.map((pt, i) => {
                const dim = selSection != null && sections && sections[i] !== selSection;
                return <circle key={i} cx={pt[0] + PAD} cy={pt[1] + PAD} r={4.3} fill={dispColor(stage[i] || 0, qc[i] || 0)} stroke="rgba(2,3,10,.6)" strokeWidth={0.6} opacity={dim ? 0.16 : 1} />;
              })}
              {selHull && <polygon points={selHull} fill="rgba(249,115,22,.10)" stroke={ORANGE} strokeWidth={2} strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 6px rgba(249,115,22,.7))' }} />}
              {marq && (() => { const r = normRect(marq.a, marq.b); return <rect x={r.x0} y={r.y0} width={r.x1 - r.x0} height={r.y1 - r.y0} fill="rgba(249,115,22,.14)" stroke={ORANGE} strokeWidth={1.6} strokeDasharray="6 4" />; })()}
            </g>
          </svg>
        </div>
      )}

      {/* controls */}
      <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 500, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 4, background: 'rgba(10,14,26,.88)', border: '1px solid ' + LINE, padding: 3, backdropFilter: 'blur(6px)' }}>
          <button onClick={() => saveOv({ on: !ov.on })} style={btn(ov.on)}>{ov.on ? 'Points On' : 'Points Off'}</button>
          {canAlign && ov.on && <button onClick={() => { const next = !aligning; setAligning(next); if (!next) saveOv({ locked: true }); else saveOv({ locked: false }); }} style={btn(aligning)}>{aligning ? 'Done Aligning' : 'Align'}</button>}
        </div>
        {aligning && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, background: 'rgba(10,14,26,.9)', border: '1px solid ' + LINE, padding: '8px 10px', backdropFilter: 'blur(6px)' }}>
            <div style={{ fontFamily: NBF, fontSize: 11, color: MUTE, letterSpacing: 1.2, textTransform: 'uppercase' }}>Drag the grid to line it up</div>
            <label style={row}><span style={lbl}>Scale</span><input type="range" min="0.2" max="3" step="0.01" value={ov.scale} onChange={(e) => setOv((p) => Object.assign({}, p, { scale: +e.target.value }))} onMouseUp={() => saveOv({})} onTouchEnd={() => saveOv({})} /></label>
            <label style={row}><span style={lbl}>Opacity</span><input type="range" min="0.15" max="1" step="0.05" value={ov.opacity} onChange={(e) => setOv((p) => Object.assign({}, p, { opacity: +e.target.value }))} onMouseUp={() => saveOv({})} onTouchEnd={() => saveOv({})} /></label>
          </div>
        )}
        {models.length > 1 && (
          <select value={curId || ''} onChange={(e) => { const m = models.find((x) => x.id === e.target.value); if (m) loadModel(m); }}
            style={{ background: 'rgba(10,14,26,.9)', color: CREAM, border: '1px solid ' + LINE, fontFamily: NBF, fontSize: 12, padding: '5px 7px', maxWidth: 220 }}>
            {models.map((m) => <option key={m.id} value={m.id}>{m.name || 'model.glb'} · {new Date(m.ts).toLocaleDateString()}</option>)}
          </select>
        )}
      </div>
      {status && buf && <div style={{ position: 'absolute', bottom: 10, left: 12, fontFamily: NBF, fontSize: 12, color: MUTE }}>{status}</div>}
    </div>
  );
}

const btn = (active) => ({ background: active ? ORANGE : 'transparent', color: active ? '#1a1206' : CREAM, border: 'none', padding: '5px 11px', fontFamily: NBF, fontWeight: 700, fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' });
const row = { display: 'flex', alignItems: 'center', gap: 8 };
const lbl = { fontFamily: NBF, fontSize: 12, color: MUTE, width: 52 };
