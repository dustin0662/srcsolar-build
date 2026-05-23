import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { DOTS, PLAN_W, PLAN_H } from './pile_data.js';

/* ------------------------------------------------------------------ */
/*  Storage shim (matches site_map.jsx)                               */
/* ------------------------------------------------------------------ */
const storage = window.storage || {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { localStorage.setItem(k, JSON.stringify(v)); },
};

/* ------------------------------------------------------------------ */
/*  Branding                                                          */
/* ------------------------------------------------------------------ */
const ORANGE = '#F97316';
const BG = '#0f172a';
const PANEL = '#1e293b';
const CANVAS_BG = '#f8fafc';
const FONT_HEADING = "'Bebas Neue', sans-serif";
const FONT_BODY = "'Barlow Condensed', sans-serif";

const STORE_TASKS = 'pile-plan-tasks-v1';
const STORE_ASSIGN = 'pile-plan-assign-v1';

const DEFAULT_TASKS = [
  { id: 't0', name: 'Pending', color: '#9ca3af' },
  { id: 't1', name: 'Installed', color: '#16a34a' },
  { id: 't2', name: 'On Hold', color: '#dc2626' },
];
const DEFAULT_TASK_BY_INDEX = ['t0', 't1', 't2'];
const SWATCHES = ['#9ca3af', '#16a34a', '#dc2626', '#2563eb', '#eab308', '#7c3aed', '#db2777', '#0891b2', '#ea580c', '#65a30d'];

let _idc = 100;
function newId() { return 't' + (_idc++) + '_' + Date.now().toString(36); }

function useIsMobile() {
  const [m, setM] = useState(typeof window !== 'undefined' && window.innerWidth < 768);
  useEffect(() => {
    const h = () => setM(window.innerWidth < 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return m;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function PilePlan({ onExit }) {
  const TOTAL = DOTS.length;
  const mob = useIsMobile();

  const [tasks, setTasks] = useState(() => {
    const saved = storage.get(STORE_TASKS);
    return Array.isArray(saved) && saved.length ? saved : DEFAULT_TASKS;
  });
  const [assign, setAssign] = useState(() => {
    const saved = storage.get(STORE_ASSIGN);
    if (Array.isArray(saved) && saved.length === TOTAL) return saved;
    return DOTS.map((d) => DEFAULT_TASK_BY_INDEX[d[2]] || 't0');
  });
  const [activeId, setActiveId] = useState(tasks[0] ? tasks[0].id : 't0');
  const [mode, setMode] = useState('paint');
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => { storage.set(STORE_TASKS, tasks); }, [tasks]);
  useEffect(() => { storage.set(STORE_ASSIGN, assign); }, [assign]);
  useEffect(() => {
    if (!tasks.find((t) => t.id === activeId) && tasks[0]) setActiveId(tasks[0].id);
  }, [tasks, activeId]);

  const colorById = useMemo(() => {
    const m = {}; tasks.forEach((t) => { m[t.id] = t.color; }); return m;
  }, [tasks]);
  const counts = useMemo(() => {
    const c = {}; tasks.forEach((t) => { c[t.id] = 0; });
    for (let i = 0; i < assign.length; i++) c[assign[i]] = (c[assign[i]] || 0) + 1;
    return c;
  }, [assign, tasks]);
  const activeTask = tasks.find((t) => t.id === activeId) || tasks[0];

  /* ----- refs for stable handlers ----- */
  const activeIdRef = useRef(activeId); useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  const modeRef = useRef(mode); useEffect(() => { modeRef.current = mode; }, [mode]);
  const paintingRef = useRef(false);

  const paintDot = useCallback((i) => {
    setAssign((prev) => {
      if (prev[i] === activeIdRef.current) return prev;
      const next = prev.slice(); next[i] = activeIdRef.current; return next;
    });
  }, []);
  const paintAt = useCallback((cx, cy) => {
    const el = document.elementFromPoint(cx, cy);
    if (el && el.dataset && el.dataset.i != null) paintDot(+el.dataset.i);
  }, [paintDot]);

  /* ----- view (pan / zoom) ----- */
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const viewRef = useRef(view); useEffect(() => { viewRef.current = view; }, [view]);
  const svgRef = useRef(null);
  const PAD = 16;
  const VW = PLAN_W + PAD * 2;
  const VH = PLAN_H + PAD * 2;

  const toView = useCallback((clientX, clientY) => {
    const r = svgRef.current.getBoundingClientRect();
    return { x: (clientX - r.left) / r.width * VW, y: (clientY - r.top) / r.height * VH };
  }, [VW, VH]);

  const zoomAt = useCallback((px, py, factor) => {
    setView((v) => {
      const ns = Math.min(24, Math.max(1, v.s * factor));
      const wx = (px - v.x) / v.s, wy = (py - v.y) / v.s;
      return { s: ns, x: px - wx * ns, y: py - wy * ns };
    });
  }, []);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const p = toView(e.clientX, e.clientY);
    zoomAt(p.x, p.y, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, [toView, zoomAt]);
  useEffect(() => {
    const svg = svgRef.current; if (!svg) return;
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  /* ----- pointer handling: paint / pan / pinch ----- */
  const pointersRef = useRef(new Map());
  const panRef = useRef(null);
  const pinchRef = useRef(null);

  const onPointerDown = (e) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      // start pinch
      paintingRef.current = false; panRef.current = null;
      const pts = [...pointersRef.current.values()];
      const dx = pts[0].x - pts[1].x, dy = pts[0].y - pts[1].y;
      const dist = Math.hypot(dx, dy);
      const midC = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      pinchRef.current = { dist, mid: toView(midC.x, midC.y), s0: viewRef.current.s, x0: viewRef.current.x, y0: viewRef.current.y };
      return;
    }
    if (modeRef.current === 'paint') {
      paintingRef.current = true;
      paintAt(e.clientX, e.clientY);
    } else {
      const p = toView(e.clientX, e.clientY);
      panRef.current = { sx: p.x, sy: p.y, vx: viewRef.current.x, vy: viewRef.current.y };
    }
  };
  const onPointerMove = (e) => {
    if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchRef.current && pointersRef.current.size >= 2) {
      const pts = [...pointersRef.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const ratio = dist / (pinchRef.current.dist || 1);
      const ns = Math.min(24, Math.max(1, pinchRef.current.s0 * ratio));
      const { mid, s0, x0, y0 } = pinchRef.current;
      const wx = (mid.x - x0) / s0, wy = (mid.y - y0) / s0;
      setView({ s: ns, x: mid.x - wx * ns, y: mid.y - wy * ns });
      return;
    }
    if (panRef.current) {
      const p = toView(e.clientX, e.clientY);
      setView((v) => ({ ...v, x: panRef.current.vx + (p.x - panRef.current.sx), y: panRef.current.vy + (p.y - panRef.current.sy) }));
    }
  };
  const endPointer = (e) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) { paintingRef.current = false; panRef.current = null; }
  };

  // global move/up so touch-drag paints across dots (no pointer capture)
  useEffect(() => {
    const mv = (e) => { if (paintingRef.current && modeRef.current === 'paint' && pointersRef.current.size < 2) paintAt(e.clientX, e.clientY); };
    const up = () => { paintingRef.current = false; };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, [paintAt]);

  const resetView = () => setView({ s: 1, x: 0, y: 0 });
  const zoomBtn = (f) => zoomAt(VW / 2, VH / 2, f);

  /* ----- task ops ----- */
  const renameTask = (id, name) => setTasks((ts) => ts.map((t) => t.id === id ? { ...t, name } : t));
  const recolorTask = (id, color) => setTasks((ts) => ts.map((t) => t.id === id ? { ...t, color } : t));
  const addTask = () => {
    const used = new Set(tasks.map((t) => t.color));
    const color = SWATCHES.find((c) => !used.has(c)) || '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
    const t = { id: newId(), name: 'New Task', color };
    setTasks((ts) => [...ts, t]); setActiveId(t.id);
  };
  const removeTask = (id) => {
    if (tasks.length <= 1) return;
    const fallback = tasks.find((t) => t.id !== id).id;
    setAssign((prev) => prev.map((a) => (a === id ? fallback : a)));
    setTasks((ts) => ts.filter((t) => t.id !== id));
  };
  const resetAll = () => {
    if (!window.confirm('Reset all task colors and dot assignments back to the original drawing?')) return;
    setTasks(DEFAULT_TASKS);
    setAssign(DOTS.map((d) => DEFAULT_TASK_BY_INDEX[d[2]] || 't0'));
    setActiveId('t0');
  };

  /* ----- dots ----- */
  const dotEls = useMemo(() => DOTS.map((d, i) => (
    <circle key={i} data-i={i} cx={d[0] + PAD} cy={d[1] + PAD} r={4.1}
      fill={colorById[assign[i]] || '#9ca3af'} stroke="#0f172a" strokeWidth={0.4} />
  )), [assign, colorById]);

  const pct = (id) => TOTAL ? (counts[id] || 0) / TOTAL * 100 : 0;

  /* ----- legend body (shared desktop sidebar + mobile sheet) ----- */
  const legendBody = (
    <>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => setMode('paint')} style={modeBtn(mode === 'paint')}>PAINT</button>
        <button onClick={() => setMode('pan')} style={modeBtn(mode === 'pan')}>PAN</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tasks.map((t) => {
          const active = t.id === activeId; const p = pct(t.id);
          return (
            <div key={t.id} onClick={() => setActiveId(t.id)}
              style={{ border: '1px solid ' + (active ? ORANGE : '#334155'), borderRadius: 8, padding: 10, background: active ? 'rgba(249,115,22,.10)' : '#0f172a', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={{ position: 'relative', width: 28, height: 28, flexShrink: 0, borderRadius: 6, background: t.color, border: '2px solid rgba(255,255,255,.35)', cursor: 'pointer' }} title="Change color" onClick={(e) => e.stopPropagation()}>
                  <input type="color" value={t.color} onChange={(e) => recolorTask(t.id, e.target.value)} style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
                </label>
                <input value={t.name} onChange={(e) => renameTask(t.id, e.target.value)} onClick={(e) => e.stopPropagation()}
                  style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', borderBottom: '1px solid #334155', color: '#fff', fontFamily: FONT_BODY, fontSize: 17, padding: '4px 0', outline: 'none' }} />
                {tasks.length > 1 && (
                  <button onClick={(e) => { e.stopPropagation(); removeTask(t.id); }} title="Delete task"
                    style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: '0 4px' }}>&times;</button>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 8 }}>
                <span style={{ fontSize: 13, color: '#94a3b8', letterSpacing: 1 }}>{(counts[t.id] || 0).toLocaleString()} / {TOTAL.toLocaleString()}</span>
                <span style={{ fontFamily: FONT_HEADING, fontSize: 22, color: t.color, lineHeight: 1 }}>{p.toFixed(1)}%</span>
              </div>
              <div style={{ height: 6, borderRadius: 4, background: '#1e293b', marginTop: 6, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: p + '%', background: t.color, transition: 'width .2s' }} />
              </div>
            </div>
          );
        })}
      </div>
      <button onClick={addTask} style={addBtn()}>+ ADD TASK</button>
      <button onClick={resetAll} style={resetBtn()}>RESET TO ORIGINAL</button>
    </>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: BG, display: 'flex', flexDirection: 'column', fontFamily: FONT_BODY, color: '#e2e8f0' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: mob ? '10px 12px' : '12px 18px', background: PANEL, borderBottom: '1px solid #334155' }}>
        {onExit && <button onClick={onExit} style={hbtn('#475569')} title="Back to dashboard">&#8592; Back</button>}
        <div style={{ fontFamily: FONT_HEADING, fontSize: mob ? 18 : 26, letterSpacing: 1.5, color: '#fff', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          PILE PLAN <span style={{ color: ORANGE }}>— DWYER RD</span>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: mob ? 12 : 14, letterSpacing: 1, color: '#94a3b8', whiteSpace: 'nowrap' }}>{TOTAL.toLocaleString()}{mob ? '' : ' PILES'}</div>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* desktop sidebar */}
        {!mob && (
          <div style={{ width: 320, flexShrink: 0, background: PANEL, borderRight: '1px solid #334155', overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontFamily: FONT_HEADING, fontSize: 20, letterSpacing: 2, color: '#fff' }}>COLOR LEGEND</div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: -8, lineHeight: 1.3 }}>Select a task, then click or drag across dots to paint them.</div>
            {legendBody}
          </div>
        )}

        {/* canvas */}
        <div style={{ flex: 1, position: 'relative', background: CANVAS_BG, minWidth: 0 }}>
          <svg ref={svgRef} viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid meet"
            style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: mode === 'pan' ? 'grab' : 'crosshair' }}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endPointer} onPointerCancel={endPointer}>
            <g transform={`translate(${view.x} ${view.y}) scale(${view.s})`}>{dotEls}</g>
          </svg>

          {/* zoom controls */}
          <div style={{ position: 'absolute', bottom: mob ? 84 : 16, right: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button onClick={() => zoomBtn(1.3)} style={zbtn()}>+</button>
            <button onClick={() => zoomBtn(1 / 1.3)} style={zbtn()}>&minus;</button>
            <button onClick={resetView} style={{ ...zbtn(), fontSize: 12 }} title="Fit">FIT</button>
          </div>
        </div>
      </div>

      {/* mobile bottom bar */}
      {mob && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: PANEL, borderTop: '1px solid #334155' }}>
          <button onClick={() => setSheetOpen(true)} style={{ ...hbtn(ORANGE), color: '#0f172a', fontWeight: 700 }}>TASKS &#9650;</button>
          <div onClick={() => setSheetOpen(true)} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, cursor: 'pointer' }}>
            <span style={{ width: 18, height: 18, borderRadius: 4, background: activeTask ? activeTask.color : '#999', flexShrink: 0, border: '1px solid rgba(255,255,255,.4)' }} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 15 }}>{activeTask ? activeTask.name : ''}</span>
            <span style={{ marginLeft: 'auto', fontFamily: FONT_HEADING, fontSize: 18, color: activeTask ? activeTask.color : '#999' }}>{activeTask ? pct(activeTask.id).toFixed(1) + '%' : ''}</span>
          </div>
          <button onClick={() => setMode(mode === 'paint' ? 'pan' : 'paint')} style={{ ...hbtn('#334155'), fontWeight: 600 }}>{mode === 'paint' ? 'PAINT' : 'PAN'}</button>
        </div>
      )}

      {/* mobile legend sheet */}
      {mob && sheetOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2100, background: 'rgba(0,0,0,.5)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }} onClick={() => setSheetOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: PANEL, borderTop: '2px solid ' + ORANGE, borderRadius: '16px 16px 0 0', padding: 16, maxHeight: '78vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ fontFamily: FONT_HEADING, fontSize: 22, letterSpacing: 2, color: '#fff' }}>COLOR LEGEND</div>
              <button onClick={() => setSheetOpen(false)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: '#94a3b8', fontSize: 28, lineHeight: 1, cursor: 'pointer' }}>&times;</button>
            </div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: -6, lineHeight: 1.3 }}>Pick a task, close this, then drag across dots to paint. Counts and % update live.</div>
            {legendBody}
            <button onClick={() => setSheetOpen(false)} style={{ ...hbtn(ORANGE), color: '#0f172a', fontWeight: 700, padding: '12px 0' }}>DONE</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  styles                                                            */
/* ------------------------------------------------------------------ */
function hbtn(bg) { return { background: bg, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', fontFamily: FONT_BODY, fontSize: 14, letterSpacing: 1, cursor: 'pointer', whiteSpace: 'nowrap' }; }
function modeBtn(active) { return { flex: 1, background: active ? ORANGE : '#0f172a', color: active ? '#0f172a' : '#94a3b8', border: '1px solid ' + (active ? ORANGE : '#334155'), borderRadius: 6, padding: '10px 0', fontFamily: FONT_BODY, fontWeight: 600, fontSize: 15, letterSpacing: 2, cursor: 'pointer' }; }
function addBtn() { return { background: 'transparent', color: ORANGE, border: '1px dashed rgba(249,115,22,.5)', borderRadius: 8, padding: '12px 0', fontFamily: FONT_BODY, fontSize: 15, letterSpacing: 2, cursor: 'pointer' }; }
function resetBtn() { return { background: 'transparent', color: '#64748b', border: '1px solid #334155', borderRadius: 6, padding: '10px 0', fontFamily: FONT_BODY, fontSize: 13, letterSpacing: 1, cursor: 'pointer' }; }
function zbtn() { return { width: 42, height: 42, borderRadius: 8, background: PANEL, color: '#fff', border: '1px solid #334155', fontSize: 22, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,.3)' }; }
