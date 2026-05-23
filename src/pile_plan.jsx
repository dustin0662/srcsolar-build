import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { jsPDF } from 'jspdf';
import { DOTS, PLAN_W, PLAN_H } from './pile_data.js';

/* ------------------------------------------------------------------ */
/*  Storage shim (matches site_map.jsx)                               */
/* ------------------------------------------------------------------ */
const storage = window.storage || {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { localStorage.setItem(k, JSON.stringify(v)); },
};

const ORANGE = '#F97316';
const BG = '#0f172a';
const PANEL = '#1e293b';
const CANVAS_BG = '#f8fafc';
const FONT_HEADING = "'Bebas Neue', sans-serif";
const FONT_BODY = "'Barlow Condensed', sans-serif";

const STORE_TASKS = 'pile-plan-tasks-v1';
const STORE_ASSIGN = 'pile-plan-assign-v1';
const STORE_META = 'pile-plan-meta-v1';
const STORE_REVS = 'pile-plan-revs-v1';
const MAX_REVS = 25;

const DEFAULT_TASKS = [
  { id: 't0', name: 'Pending', color: '#9ca3af', done: false },
  { id: 't1', name: 'Installed', color: '#16a34a', done: true },
  { id: 't2', name: 'On Hold', color: '#dc2626', done: false },
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

const fmtDate = (ts) => ts ? new Date(ts).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const fileStamp = (ts) => { const d = new Date(ts || Date.now()); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; };

function computeCounts(assign, tasks) {
  const c = {}; tasks.forEach((t) => { c[t.id] = 0; });
  for (let i = 0; i < assign.length; i++) c[assign[i]] = (c[assign[i]] || 0) + 1;
  return c;
}
function overallPct(counts, tasks, total) {
  if (!total) return 0;
  let done = 0;
  tasks.forEach((t) => { if (t.done) done += counts[t.id] || 0; });
  return done / total * 100;
}

/* render the dot field to a PNG data URL for embedding in the PDF */
function renderMapDataURL(assign, colorById) {
  const scale = 2.2, pad = 8;
  const w = Math.ceil(PLAN_W * scale + pad * 2);
  const h = Math.ceil(PLAN_H * scale + pad * 2);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < DOTS.length; i++) {
    const d = DOTS[i];
    ctx.fillStyle = colorById[assign[i]] || '#9ca3af';
    ctx.beginPath();
    ctx.arc(d[0] * scale + pad, d[1] * scale + pad, 3.7 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
  return cv.toDataURL('image/png');
}

/* build + download the PDF */
function exportPDF(tasks, assign, lastModified) {
  const total = assign.length;
  const counts = computeCounts(assign, tasks);
  const colorById = {}; tasks.forEach((t) => { colorById[t.id] = t.color; });
  const overall = overallPct(counts, tasks, total);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const M = 40;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(20);
  doc.text('PILE PLAN  —  DWYER RD', M, M + 6);
  doc.setDrawColor(249, 115, 22); doc.setLineWidth(2); doc.line(M, M + 14, M + 200, M + 14);

  let y = M + 38;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(90);
  doc.text('Last modified:  ' + fmtDate(lastModified), M, y); y += 14;
  doc.text('Exported:  ' + fmtDate(Date.now()), M, y); y += 14;
  doc.text('Total piles:  ' + total.toLocaleString(), M, y); y += 22;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(20);
  doc.text('OVERALL COMPLETION', M, y);
  doc.setFontSize(30); doc.setTextColor(22, 163, 74);
  doc.text(overall.toFixed(1) + '%', M, y + 30);
  doc.setFillColor(230, 230, 230); doc.rect(M, y + 40, 230, 8, 'F');
  doc.setFillColor(22, 163, 74); doc.rect(M, y + 40, 230 * overall / 100, 8, 'F');

  // legend (left column)
  let ly = y + 78;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(20);
  doc.text('TASKS', M, ly); ly += 18;
  tasks.forEach((t) => {
    const c = counts[t.id] || 0; const p = total ? c / total * 100 : 0;
    doc.setFillColor(t.color); doc.roundedRect(M, ly - 9, 14, 14, 2, 2, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(20);
    doc.text(t.name + (t.done ? '  (complete)' : ''), M + 22, ly + 2);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(90);
    doc.text(`${c.toLocaleString()} / ${total.toLocaleString()}     ${p.toFixed(1)}%`, M + 22, ly + 16);
    doc.setFillColor(232, 232, 232); doc.rect(M + 22, ly + 21, 200, 4, 'F');
    doc.setFillColor(t.color); doc.rect(M + 22, ly + 21, 200 * p / 100, 4, 'F');
    ly += 40;
  });

  // map image (right column)
  try {
    const url = renderMapDataURL(assign, colorById);
    const imgW = 250; const imgH = imgW * (PLAN_H / PLAN_W);
    const ix = 322; const iy = y;
    doc.setDrawColor(210); doc.setLineWidth(1); doc.rect(ix - 2, iy - 2, imgW + 4, imgH + 4);
    doc.addImage(url, 'PNG', ix, iy, imgW, imgH);
    doc.setFontSize(8); doc.setTextColor(140); doc.text('Pile layout (color = task)', ix, iy + imgH + 12);
  } catch (e) { /* canvas tainting shouldn't happen for generated canvas */ }

  doc.save(`Pile_Plan_Dwyer_Rd_${fileStamp(lastModified)}.pdf`);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function PilePlan({ onExit }) {
  const TOTAL = DOTS.length;
  const mob = useIsMobile();

  const [tasks, setTasks] = useState(() => {
    const saved = storage.get(STORE_TASKS);
    const base = Array.isArray(saved) && saved.length ? saved : DEFAULT_TASKS;
    return base.map((t) => ({ done: false, ...t }));
  });
  const [assign, setAssign] = useState(() => {
    const saved = storage.get(STORE_ASSIGN);
    if (Array.isArray(saved) && saved.length === TOTAL) return saved;
    return DOTS.map((d) => DEFAULT_TASK_BY_INDEX[d[2]] || 't0');
  });
  const [lastModified, setLastModified] = useState(() => {
    const m = storage.get(STORE_META); return (m && m.lastModified) || Date.now();
  });
  const [revisions, setRevisions] = useState(() => {
    const r = storage.get(STORE_REVS); return Array.isArray(r) ? r : [];
  });
  const [activeId, setActiveId] = useState(tasks[0] ? tasks[0].id : 't0');
  const [mode, setMode] = useState('paint');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => { storage.set(STORE_TASKS, tasks); }, [tasks]);
  useEffect(() => { storage.set(STORE_ASSIGN, assign); }, [assign]);
  useEffect(() => { storage.set(STORE_REVS, revisions); }, [revisions]);
  useEffect(() => { storage.set(STORE_META, { lastModified }); }, [lastModified]);
  useEffect(() => {
    if (!tasks.find((t) => t.id === activeId) && tasks[0]) setActiveId(tasks[0].id);
  }, [tasks, activeId]);

  // bump lastModified on any real edit (skip initial mount)
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    setLastModified(Date.now());
  }, [tasks, assign]);

  const colorById = useMemo(() => { const m = {}; tasks.forEach((t) => { m[t.id] = t.color; }); return m; }, [tasks]);
  const counts = useMemo(() => computeCounts(assign, tasks), [assign, tasks]);
  const overall = useMemo(() => overallPct(counts, tasks, TOTAL), [counts, tasks, TOTAL]);
  const activeTask = tasks.find((t) => t.id === activeId) || tasks[0];
  const pct = (id) => TOTAL ? (counts[id] || 0) / TOTAL * 100 : 0;

  /* ----- refs ----- */
  const activeIdRef = useRef(activeId); useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  const modeRef = useRef(mode); useEffect(() => { modeRef.current = mode; }, [mode]);
  const paintingRef = useRef(false);
  const paintDot = useCallback((i) => {
    setAssign((prev) => { if (prev[i] === activeIdRef.current) return prev; const n = prev.slice(); n[i] = activeIdRef.current; return n; });
  }, []);
  const paintAt = useCallback((cx, cy) => {
    const el = document.elementFromPoint(cx, cy);
    if (el && el.dataset && el.dataset.i != null) paintDot(+el.dataset.i);
  }, [paintDot]);

  /* ----- pan / zoom ----- */
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const viewRef = useRef(view); useEffect(() => { viewRef.current = view; }, [view]);
  const svgRef = useRef(null);
  const PAD = 16; const VW = PLAN_W + PAD * 2; const VH = PLAN_H + PAD * 2;
  const toView = useCallback((cx, cy) => {
    const r = svgRef.current.getBoundingClientRect();
    return { x: (cx - r.left) / r.width * VW, y: (cy - r.top) / r.height * VH };
  }, [VW, VH]);
  const zoomAt = useCallback((px, py, factor) => {
    setView((v) => { const ns = Math.min(24, Math.max(1, v.s * factor)); const wx = (px - v.x) / v.s, wy = (py - v.y) / v.s; return { s: ns, x: px - wx * ns, y: py - wy * ns }; });
  }, []);
  const onWheel = useCallback((e) => { e.preventDefault(); const p = toView(e.clientX, e.clientY); zoomAt(p.x, p.y, e.deltaY < 0 ? 1.15 : 1 / 1.15); }, [toView, zoomAt]);
  useEffect(() => { const svg = svgRef.current; if (!svg) return; svg.addEventListener('wheel', onWheel, { passive: false }); return () => svg.removeEventListener('wheel', onWheel); }, [onWheel]);

  const pointersRef = useRef(new Map());
  const panRef = useRef(null);
  const pinchRef = useRef(null);
  const onPointerDown = (e) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      paintingRef.current = false; panRef.current = null;
      const pts = [...pointersRef.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const midC = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      pinchRef.current = { dist, mid: toView(midC.x, midC.y), s0: viewRef.current.s, x0: viewRef.current.x, y0: viewRef.current.y };
      return;
    }
    if (modeRef.current === 'paint') { paintingRef.current = true; paintAt(e.clientX, e.clientY); }
    else { const p = toView(e.clientX, e.clientY); panRef.current = { sx: p.x, sy: p.y, vx: viewRef.current.x, vy: viewRef.current.y }; }
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
    if (panRef.current) { const p = toView(e.clientX, e.clientY); setView((v) => ({ ...v, x: panRef.current.vx + (p.x - panRef.current.sx), y: panRef.current.vy + (p.y - panRef.current.sy) })); }
  };
  const endPointer = (e) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) { paintingRef.current = false; panRef.current = null; }
  };
  useEffect(() => {
    const mv = (e) => { if (paintingRef.current && modeRef.current === 'paint' && pointersRef.current.size < 2) paintAt(e.clientX, e.clientY); };
    const up = () => { paintingRef.current = false; };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, [paintAt]);
  const resetView = () => setView({ s: 1, x: 0, y: 0 });
  const zoomBtn = (f) => zoomAt(VW / 2, VH / 2, f);

  /* ----- task ops ----- */
  const renameTask = (id, name) => setTasks((ts) => ts.map((t) => t.id === id ? { ...t, name } : t));
  const recolorTask = (id, color) => setTasks((ts) => ts.map((t) => t.id === id ? { ...t, color } : t));
  const toggleDone = (id) => setTasks((ts) => ts.map((t) => t.id === id ? { ...t, done: !t.done } : t));
  const addTask = () => {
    const used = new Set(tasks.map((t) => t.color));
    const color = SWATCHES.find((c) => !used.has(c)) || '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
    const t = { id: newId(), name: 'New Task', color, done: false };
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
    setTasks(DEFAULT_TASKS.map((t) => ({ ...t })));
    setAssign(DOTS.map((d) => DEFAULT_TASK_BY_INDEX[d[2]] || 't0'));
    setActiveId('t0');
  };

  /* ----- revisions ----- */
  const snapshot = (note) => ({ id: 'r' + Date.now(), ts: Date.now(), note: note || '', overall, tasks: tasks.map((t) => ({ ...t })), assign: assign.slice() });
  const saveRevision = (note) => setRevisions((rs) => [snapshot(note), ...rs].slice(0, MAX_REVS));
  const restoreRevision = (rev) => {
    if (!window.confirm('Restore this revision from ' + fmtDate(rev.ts) + '? Current unsaved state will be replaced.')) return;
    setTasks(rev.tasks.map((t) => ({ done: false, ...t })));
    setAssign(rev.assign.slice());
    setActiveId(rev.tasks[0] ? rev.tasks[0].id : 't0');
    setHistoryOpen(false);
  };
  const handleExport = () => { exportPDF(tasks, assign, lastModified); saveRevision('Auto-saved on export'); };
  const exportRevision = (rev) => exportPDF(rev.tasks.map((t) => ({ done: false, ...t })), rev.assign, rev.ts);

  /* ----- dots ----- */
  const dotEls = useMemo(() => DOTS.map((d, i) => (
    <circle key={i} data-i={i} cx={d[0] + PAD} cy={d[1] + PAD} r={4.1} fill={colorById[assign[i]] || '#9ca3af'} stroke="#0f172a" strokeWidth={0.4} />
  )), [assign, colorById]);

  /* ----- legend body (shared) ----- */
  const legendBody = (
    <>
      <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, letterSpacing: 1, color: '#94a3b8' }}>OVERALL COMPLETION</span>
          <span style={{ fontFamily: FONT_HEADING, fontSize: 26, color: '#22c55e', lineHeight: 1 }}>{overall.toFixed(1)}%</span>
        </div>
        <div style={{ height: 7, borderRadius: 4, background: '#1e293b', marginTop: 8, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: overall + '%', background: '#22c55e', transition: 'width .2s' }} />
        </div>
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>Last modified: {fmtDate(lastModified)}</div>
      </div>

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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <button onClick={(e) => { e.stopPropagation(); toggleDone(t.id); }} title="Count this task toward overall completion"
                  style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'transparent', border: '1px solid ' + (t.done ? t.color : '#334155'), color: t.done ? t.color : '#94a3b8', borderRadius: 5, padding: '3px 7px', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>
                  <span style={{ fontSize: 13 }}>{t.done ? '☑' : '☐'}</span> complete
                </button>
                <span style={{ fontSize: 13, color: '#94a3b8', letterSpacing: 1 }}>{(counts[t.id] || 0).toLocaleString()} / {TOTAL.toLocaleString()}</span>
                <span style={{ marginLeft: 'auto', fontFamily: FONT_HEADING, fontSize: 20, color: t.color, lineHeight: 1 }}>{p.toFixed(1)}%</span>
              </div>
              <div style={{ height: 6, borderRadius: 4, background: '#1e293b', marginTop: 6, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: p + '%', background: t.color, transition: 'width .2s' }} />
              </div>
            </div>
          );
        })}
      </div>

      <button onClick={addTask} style={addBtn()}>+ ADD TASK</button>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={handleExport} style={{ ...primaryBtn(), flex: 2 }}>EXPORT PDF</button>
        <button onClick={() => saveRevision('Manual save')} style={{ ...secondaryBtn(), flex: 1 }}>SAVE REV</button>
      </div>
      <button onClick={() => setHistoryOpen(true)} style={secondaryBtn()}>REVISION HISTORY ({revisions.length})</button>
      <button onClick={resetAll} style={resetBtn()}>RESET TO ORIGINAL</button>
    </>
  );

  const historyPanel = historyOpen && (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2200, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: mob ? 'flex-end' : 'center', justifyContent: 'center' }} onClick={() => setHistoryOpen(false)}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: PANEL, border: '1px solid ' + ORANGE, borderRadius: mob ? '16px 16px 0 0' : 12, padding: 16, width: mob ? '100%' : 460, maxHeight: '80vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ fontFamily: FONT_HEADING, fontSize: 22, letterSpacing: 2, color: '#fff' }}>REVISION HISTORY</div>
          <button onClick={() => setHistoryOpen(false)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: '#94a3b8', fontSize: 28, lineHeight: 1, cursor: 'pointer' }}>&times;</button>
        </div>
        {revisions.length === 0 && <div style={{ color: '#64748b', fontSize: 14, padding: '12px 0' }}>No revisions yet. Use SAVE REV or EXPORT PDF to create one.</div>}
        {revisions.map((rev) => (
          <div key={rev.id} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, color: '#e2e8f0' }}>{fmtDate(rev.ts)}</div>
              <div style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{rev.note || '—'} · {(rev.overall || 0).toFixed(1)}% overall</div>
            </div>
            <button onClick={() => exportRevision(rev)} style={{ ...secondaryBtn(), padding: '6px 10px', fontSize: 12 }}>PDF</button>
            <button onClick={() => restoreRevision(rev)} style={{ ...primaryBtn(), padding: '6px 10px', fontSize: 12 }}>RESTORE</button>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: BG, display: 'flex', flexDirection: 'column', fontFamily: FONT_BODY, color: '#e2e8f0' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: mob ? '10px 12px' : '12px 18px', background: PANEL, borderBottom: '1px solid #334155' }}>
        {onExit && <button onClick={onExit} style={hbtn('#475569')} title="Back to dashboard">&#8592; Back</button>}
        <div style={{ fontFamily: FONT_HEADING, fontSize: mob ? 18 : 26, letterSpacing: 1.5, color: '#fff', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          PILE PLAN <span style={{ color: ORANGE }}>— DWYER RD</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontFamily: FONT_HEADING, fontSize: mob ? 18 : 22, color: '#22c55e', lineHeight: 1 }}>{overall.toFixed(0)}%</span>
          {!mob && <button onClick={handleExport} style={{ ...primaryBtn() }}>EXPORT PDF</button>}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {!mob && (
          <div style={{ width: 320, flexShrink: 0, background: PANEL, borderRight: '1px solid #334155', overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontFamily: FONT_HEADING, fontSize: 20, letterSpacing: 2, color: '#fff' }}>COLOR LEGEND</div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: -8, lineHeight: 1.3 }}>Select a task, then click or drag across dots to paint them.</div>
            {legendBody}
          </div>
        )}

        <div style={{ flex: 1, position: 'relative', background: CANVAS_BG, minWidth: 0 }}>
          <svg ref={svgRef} viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid meet"
            style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: mode === 'pan' ? 'grab' : 'crosshair' }}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endPointer} onPointerCancel={endPointer}>
            <g transform={`translate(${view.x} ${view.y}) scale(${view.s})`}>{dotEls}</g>
          </svg>
          <div style={{ position: 'absolute', bottom: mob ? 84 : 16, right: 12, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
            <button onClick={() => zoomBtn(1.3)} style={zbtn()}>+</button>
            <span style={{ fontFamily: FONT_HEADING, fontSize: 13, color: '#475569', background: 'rgba(255,255,255,.85)', borderRadius: 4, padding: '1px 4px', minWidth: 30, textAlign: 'center' }}>{Math.round(view.s * 100)}%</span>
            <button onClick={() => zoomBtn(1 / 1.3)} style={zbtn()}>&minus;</button>
            <button onClick={resetView} style={{ ...zbtn(), fontSize: 12 }} title="Fit">FIT</button>
          </div>
        </div>
      </div>

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

      {mob && sheetOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2100, background: 'rgba(0,0,0,.5)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }} onClick={() => setSheetOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: PANEL, borderTop: '2px solid ' + ORANGE, borderRadius: '16px 16px 0 0', padding: 16, maxHeight: '82vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ fontFamily: FONT_HEADING, fontSize: 22, letterSpacing: 2, color: '#fff' }}>COLOR LEGEND</div>
              <button onClick={() => setSheetOpen(false)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: '#94a3b8', fontSize: 28, lineHeight: 1, cursor: 'pointer' }}>&times;</button>
            </div>
            {legendBody}
            <button onClick={() => setSheetOpen(false)} style={{ ...hbtn(ORANGE), color: '#0f172a', fontWeight: 700, padding: '12px 0' }}>DONE</button>
          </div>
        </div>
      )}

      {historyPanel}
    </div>
  );
}

/* styles */
function hbtn(bg) { return { background: bg, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', fontFamily: FONT_BODY, fontSize: 14, letterSpacing: 1, cursor: 'pointer', whiteSpace: 'nowrap' }; }
function modeBtn(active) { return { flex: 1, background: active ? ORANGE : '#0f172a', color: active ? '#0f172a' : '#94a3b8', border: '1px solid ' + (active ? ORANGE : '#334155'), borderRadius: 6, padding: '10px 0', fontFamily: FONT_BODY, fontWeight: 600, fontSize: 15, letterSpacing: 2, cursor: 'pointer' }; }
function addBtn() { return { background: 'transparent', color: ORANGE, border: '1px dashed rgba(249,115,22,.5)', borderRadius: 8, padding: '12px 0', fontFamily: FONT_BODY, fontSize: 15, letterSpacing: 2, cursor: 'pointer' }; }
function primaryBtn() { return { background: ORANGE, color: '#0f172a', border: 'none', borderRadius: 6, padding: '11px 0', fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, letterSpacing: 1.5, cursor: 'pointer', whiteSpace: 'nowrap' }; }
function secondaryBtn() { return { background: '#334155', color: '#e2e8f0', border: 'none', borderRadius: 6, padding: '11px 0', fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13, letterSpacing: 1, cursor: 'pointer', whiteSpace: 'nowrap' }; }
function resetBtn() { return { background: 'transparent', color: '#64748b', border: '1px solid #334155', borderRadius: 6, padding: '10px 0', fontFamily: FONT_BODY, fontSize: 13, letterSpacing: 1, cursor: 'pointer' }; }
function zbtn() { return { width: 42, height: 42, borderRadius: 8, background: PANEL, color: '#fff', border: '1px solid #334155', fontSize: 22, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,.3)' }; }
