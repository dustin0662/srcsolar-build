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

/* default tasks, one per color present in the imported drawing */
const DEFAULT_TASKS = [
  { id: 't0', name: 'Pending', color: '#9ca3af' },   // gray / no-color piles
  { id: 't1', name: 'Installed', color: '#16a34a' },  // green piles
  { id: 't2', name: 'On Hold', color: '#dc2626' },    // red piles
];
const DEFAULT_TASK_BY_INDEX = ['t0', 't1', 't2'];

const SWATCHES = ['#9ca3af', '#16a34a', '#dc2626', '#2563eb', '#eab308', '#7c3aed', '#db2777', '#0891b2', '#ea580c', '#65a30d'];

let _idc = 100;
function newId() { return 't' + (_idc++) + '_' + Date.now().toString(36); }

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function PilePlan({ onExit }) {
  const TOTAL = DOTS.length;

  const [tasks, setTasks] = useState(() => {
    const saved = storage.get(STORE_TASKS);
    return Array.isArray(saved) && saved.length ? saved : DEFAULT_TASKS;
  });

  // assign[i] = task id for dot i
  const [assign, setAssign] = useState(() => {
    const saved = storage.get(STORE_ASSIGN);
    if (Array.isArray(saved) && saved.length === TOTAL) return saved;
    return DOTS.map((d) => DEFAULT_TASK_BY_INDEX[d[2]] || 't0');
  });

  const [activeId, setActiveId] = useState(tasks[0] ? tasks[0].id : 't0');
  const [mode, setMode] = useState('paint'); // 'paint' | 'pan'

  // persist
  useEffect(() => { storage.set(STORE_TASKS, tasks); }, [tasks]);
  useEffect(() => { storage.set(STORE_ASSIGN, assign); }, [assign]);

  // keep a valid active task
  useEffect(() => {
    if (!tasks.find((t) => t.id === activeId) && tasks[0]) setActiveId(tasks[0].id);
  }, [tasks, activeId]);

  const colorById = useMemo(() => {
    const m = {};
    tasks.forEach((t) => { m[t.id] = t.color; });
    return m;
  }, [tasks]);

  const counts = useMemo(() => {
    const c = {};
    tasks.forEach((t) => { c[t.id] = 0; });
    for (let i = 0; i < assign.length; i++) c[assign[i]] = (c[assign[i]] || 0) + 1;
    return c;
  }, [assign, tasks]);

  /* ----- dot painting ----- */
  const paintingRef = useRef(false);
  const paintDot = useCallback((i) => {
    setAssign((prev) => {
      if (prev[i] === activeId) return prev;
      const next = prev.slice();
      next[i] = activeId;
      return next;
    });
  }, [activeId]);

  /* ----- pan / zoom ----- */
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const svgRef = useRef(null);
  const panRef = useRef(null);
  const PAD = 16;
  const VW = PLAN_W + PAD * 2;
  const VH = PLAN_H + PAD * 2;

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    // pointer in viewBox coords
    const px = (e.clientX - rect.left) / rect.width * VW;
    const py = (e.clientY - rect.top) / rect.height * VH;
    setView((v) => {
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const ns = Math.min(20, Math.max(1, v.s * factor));
      // keep pointer anchored: world point under cursor stays put
      const wx = (px - v.x) / v.s;
      const wy = (py - v.y) / v.s;
      return { s: ns, x: px - wx * ns, y: py - wy * ns };
    });
  }, [VW, VH]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  const toView = (e) => {
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width * VW,
      y: (e.clientY - rect.top) / rect.height * VH,
    };
  };

  const onBgPointerDown = (e) => {
    if (mode !== 'pan') return;
    const p = toView(e);
    panRef.current = { startX: p.x, startY: p.y, vx: view.x, vy: view.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onBgPointerMove = (e) => {
    if (mode !== 'pan' || !panRef.current) return;
    const p = toView(e);
    setView((v) => ({ ...v, x: panRef.current.vx + (p.x - panRef.current.startX), y: panRef.current.vy + (p.y - panRef.current.startY) }));
  };
  const onBgPointerUp = (e) => {
    panRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  };

  const resetView = () => setView({ s: 1, x: 0, y: 0 });
  const zoom = (f) => setView((v) => {
    const ns = Math.min(20, Math.max(1, v.s * f));
    const cx = VW / 2, cy = VH / 2;
    const wx = (cx - v.x) / v.s, wy = (cy - v.y) / v.s;
    return { s: ns, x: cx - wx * ns, y: cy - wy * ns };
  });

  /* ----- task ops ----- */
  const renameTask = (id, name) => setTasks((ts) => ts.map((t) => t.id === id ? { ...t, name } : t));
  const recolorTask = (id, color) => setTasks((ts) => ts.map((t) => t.id === id ? { ...t, color } : t));
  const addTask = () => {
    const used = new Set(tasks.map((t) => t.color));
    const color = SWATCHES.find((c) => !used.has(c)) || '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
    const t = { id: newId(), name: 'New Task', color };
    setTasks((ts) => [...ts, t]);
    setActiveId(t.id);
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

  /* ----- render dots ----- */
  const dotEls = useMemo(() => DOTS.map((d, i) => {
    const fill = colorById[assign[i]] || '#9ca3af';
    return (
      <circle
        key={i}
        cx={d[0] + PAD}
        cy={d[1] + PAD}
        r={4.1}
        fill={fill}
        stroke="#0f172a"
        strokeWidth={0.4}
        style={{ cursor: mode === 'paint' ? 'crosshair' : 'grab' }}
        onPointerDown={mode === 'paint' ? (e) => { e.stopPropagation(); paintingRef.current = true; paintDot(i); } : undefined}
        onPointerEnter={mode === 'paint' ? () => { if (paintingRef.current) paintDot(i); } : undefined}
      />
    );
  }), [assign, colorById, mode, paintDot]);

  useEffect(() => {
    const up = () => { paintingRef.current = false; };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  const pct = (id) => TOTAL ? (counts[id] || 0) / TOTAL * 100 : 0;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: BG, display: 'flex', flexDirection: 'column', fontFamily: FONT_BODY, color: '#e2e8f0' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 18px', background: PANEL, borderBottom: '1px solid #334155' }}>
        {onExit && (
          <button onClick={onExit} style={hbtn('#475569')} title="Back to dashboard">&#8592; Back</button>
        )}
        <div style={{ fontFamily: FONT_HEADING, fontSize: 26, letterSpacing: 2, color: '#fff', lineHeight: 1 }}>
          PILE PLAN <span style={{ color: ORANGE }}>— DWYER RD</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16, fontSize: 14, letterSpacing: 1, color: '#94a3b8' }}>
          <span>{TOTAL.toLocaleString()} PILES</span>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* legend / task panel */}
        <div style={{ width: 320, flexShrink: 0, background: PANEL, borderRight: '1px solid #334155', overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontFamily: FONT_HEADING, fontSize: 20, letterSpacing: 2, color: '#fff' }}>COLOR LEGEND</div>
          <div style={{ fontSize: 13, color: '#94a3b8', marginTop: -8, lineHeight: 1.3 }}>
            Select a task, then click or drag across dots to paint them. Counts and % update live.
          </div>

          {/* mode toggle */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setMode('paint')} style={modeBtn(mode === 'paint')}>PAINT</button>
            <button onClick={() => setMode('pan')} style={modeBtn(mode === 'pan')}>PAN</button>
          </div>

          {/* tasks */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tasks.map((t) => {
              const active = t.id === activeId;
              const p = pct(t.id);
              return (
                <div key={t.id}
                  onClick={() => setActiveId(t.id)}
                  style={{ border: '1px solid ' + (active ? ORANGE : '#334155'), borderRadius: 8, padding: 10, background: active ? 'rgba(249,115,22,.10)' : '#0f172a', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <label style={{ position: 'relative', width: 26, height: 26, flexShrink: 0, borderRadius: 6, background: t.color, border: '2px solid rgba(255,255,255,.35)', cursor: 'pointer' }} title="Change color" onClick={(e) => e.stopPropagation()}>
                      <input type="color" value={t.color} onChange={(e) => recolorTask(t.id, e.target.value)}
                        style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
                    </label>
                    <input value={t.name} onChange={(e) => renameTask(t.id, e.target.value)} onClick={(e) => e.stopPropagation()}
                      style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', borderBottom: '1px solid #334155', color: '#fff', fontFamily: FONT_BODY, fontSize: 16, padding: '2px 0', outline: 'none' }} />
                    {tasks.length > 1 && (
                      <button onClick={(e) => { e.stopPropagation(); removeTask(t.id); }} title="Delete task"
                        style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 2px' }}>&times;</button>
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
          <div style={{ flex: 1 }} />
          <button onClick={resetAll} style={resetBtn()}>RESET TO ORIGINAL</button>
        </div>

        {/* canvas */}
        <div style={{ flex: 1, position: 'relative', background: CANVAS_BG, minWidth: 0 }}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VW} ${VH}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: mode === 'pan' ? (panRef.current ? 'grabbing' : 'grab') : 'crosshair' }}
            onPointerDown={onBgPointerDown}
            onPointerMove={onBgPointerMove}
            onPointerUp={onBgPointerUp}
          >
            <g transform={`translate(${view.x} ${view.y}) scale(${view.s})`}>
              {dotEls}
            </g>
          </svg>

          {/* zoom controls */}
          <div style={{ position: 'absolute', bottom: 16, right: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button onClick={() => zoom(1.3)} style={zbtn()}>+</button>
            <button onClick={() => zoom(1 / 1.3)} style={zbtn()}>&minus;</button>
            <button onClick={resetView} style={{ ...zbtn(), fontSize: 12 }} title="Fit">FIT</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  styles                                                            */
/* ------------------------------------------------------------------ */
function hbtn(bg) {
  return { background: bg, color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', fontFamily: FONT_BODY, fontSize: 14, letterSpacing: 1, cursor: 'pointer' };
}
function modeBtn(active) {
  return { flex: 1, background: active ? ORANGE : '#0f172a', color: active ? '#0f172a' : '#94a3b8', border: '1px solid ' + (active ? ORANGE : '#334155'), borderRadius: 6, padding: '8px 0', fontFamily: FONT_BODY, fontWeight: 600, fontSize: 14, letterSpacing: 2, cursor: 'pointer' };
}
function addBtn() {
  return { background: 'transparent', color: ORANGE, border: '1px dashed rgba(249,115,22,.5)', borderRadius: 8, padding: '10px 0', fontFamily: FONT_BODY, fontSize: 15, letterSpacing: 2, cursor: 'pointer' };
}
function resetBtn() {
  return { background: 'transparent', color: '#64748b', border: '1px solid #334155', borderRadius: 6, padding: '8px 0', fontFamily: FONT_BODY, fontSize: 13, letterSpacing: 1, cursor: 'pointer' };
}
function zbtn() {
  return { width: 36, height: 36, borderRadius: 6, background: PANEL, color: '#fff', border: '1px solid #334155', fontSize: 20, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
}
