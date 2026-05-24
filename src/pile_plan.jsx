import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { jsPDF } from 'jspdf';
import { DOTS, PLAN_W, PLAN_H } from './pile_data.js';
import { processImport } from './tt_import.js';

/* ------------------------------------------------------------------ */
/*  Storage shim                                                       */
/* ------------------------------------------------------------------ */
const storage = window.storage || {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { localStorage.setItem(k, JSON.stringify(v)); },
};

/* brand tokens */
const ORANGE = '#F97316', GOLD = '#EAB308', CREAM = '#F5F0EB';
const INK = '#0a0a14', INK2 = '#06060f', MUTE = '#9a958d';
const LINE = 'rgba(249,115,22,.20)', PANEL = 'rgba(12,12,22,.92)';
const BBF = "'Bebas Neue', sans-serif", NBF = "'Barlow Condensed', sans-serif";
const CLIP = 'polygon(9px 0%,100% 0%,calc(100% - 9px) 100%,0% 100%)';
const LOGO_URL = '/logo.webp';

const REG_KEY = 'tt-projects';
const ACTIVE_KEY = 'tt-active';
const projKey = (id) => 'tt-proj-' + id;
const MAX_LOG = 200;
const ENDPOINT = '/.netlify/functions/pileplan';

const DEFAULT_TASKS = [
  { id: 't0', name: 'Pending', color: '#9ca3af', done: false },
  { id: 't1', name: 'Installed', color: '#16a34a', done: true },
  { id: 't2', name: 'On Hold', color: '#dc2626', done: false },
];
const DEFAULT_TASK_BY_INDEX = ['t0', 't1', 't2'];
const SWATCHES = ['#9ca3af', '#16a34a', '#dc2626', '#2563eb', '#eab308', '#7c3aed', '#db2777', '#0891b2', '#ea580c', '#65a30d'];

let _idc = 100;
function newId() { return 't' + (_idc++) + '_' + Date.now().toString(36); }
function newProjId() { return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

function useIsMobile() {
  const [m, setM] = useState(typeof window !== 'undefined' && window.innerWidth < 768);
  useEffect(() => { const h = () => setM(window.innerWidth < 768); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); }, []);
  return m;
}

const fmtDate = (ts) => ts ? new Date(ts).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const fileStamp = (ts) => { const d = new Date(ts || Date.now()); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; };
const safeName = (s) => (s || 'Project').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');

function mergeLogs(a, b) {
  const seen = new Set(); const out = [];
  for (const e of [...(a || []), ...(b || [])]) { if (e && e.id && !seen.has(e.id)) { seen.add(e.id); out.push(e); } }
  out.sort((x, y) => (y.ts || 0) - (x.ts || 0));
  return out.slice(0, MAX_LOG);
}
function computeCounts(assign, tasks) { const c = {}; tasks.forEach((t) => { c[t.id] = 0; }); for (let i = 0; i < assign.length; i++) c[assign[i]] = (c[assign[i]] || 0) + 1; return c; }
function overallPct(counts, tasks, total) { if (!total) return 0; let done = 0; tasks.forEach((t) => { if (t.done) done += counts[t.id] || 0; }); return done / total * 100; }
function encAssign(assign, tasks) { const idx = {}; tasks.forEach((t, i) => { idx[t.id] = i; }); const at = (a) => (idx[a] !== undefined ? idx[a] : 0); if (tasks.length <= 36) return { m: 'c', d: assign.map((a) => at(a).toString(36)).join('') }; return { m: 'a', d: assign.map(at) }; }
function decAssign(enc, tasks) { const fb = tasks[0] ? tasks[0].id : 't0'; if (!enc) return []; const pick = (i) => (tasks[i] ? tasks[i].id : fb); if (enc.m === 'c') return enc.d.split('').map((ch) => pick(parseInt(ch, 36))); return enc.d.map(pick); }

const DWYER_POINTS = DOTS.map((d) => [d[0], d[1]]);
function defaultDwyerProject() {
  return { name: 'Dwyer Rd', w: PLAN_W, h: PLAN_H, points: DWYER_POINTS, sections: null, sectionCount: 0,
    tasks: DEFAULT_TASKS.map((t) => ({ ...t })), assign: DOTS.map((d) => DEFAULT_TASK_BY_INDEX[d[2]] || 't0'), log: [], lastModified: Date.now() };
}

/* one-time migration of the legacy single-tracker into a 'dwyer' project */
function ensureMigrated() {
  let reg = storage.get(REG_KEY);
  if (Array.isArray(reg) && reg.length) return reg;
  const lt = storage.get('pile-plan-tasks-v1'); const la = storage.get('pile-plan-assign-v1');
  const ll = storage.get('pile-plan-log-v1'); const lm = storage.get('pile-plan-meta-v1') || {};
  const proj = defaultDwyerProject();
  if (Array.isArray(lt) && lt.length) proj.tasks = lt.map((t) => ({ done: false, ...t }));
  if (Array.isArray(la) && la.length === DOTS.length) proj.assign = la;
  if (Array.isArray(ll)) proj.log = ll;
  if (lm.lastModified) proj.lastModified = lm.lastModified;
  storage.set(projKey('dwyer'), proj);
  reg = [{ id: 'dwyer', name: 'Dwyer Rd', createdAt: Date.now() }];
  storage.set(REG_KEY, reg);
  storage.set(ACTIVE_KEY, 'dwyer');
  return reg;
}

/* KPI snapshot (read-only) for dashboard / stakeholder reports */
export function getTaskTrackerKPI() {
  let reg = storage.get(REG_KEY);
  let proj = null;
  if (Array.isArray(reg) && reg.length) { const aid = storage.get(ACTIVE_KEY) || reg[0].id; proj = storage.get(projKey(aid)) || storage.get(projKey(reg[0].id)); }
  if (!proj) {
    const lt = storage.get('pile-plan-tasks-v1'); const la = storage.get('pile-plan-assign-v1');
    proj = defaultDwyerProject();
    if (Array.isArray(lt) && lt.length) proj.tasks = lt;
    if (Array.isArray(la) && la.length === DOTS.length) proj.assign = la;
  }
  const tasks = (proj.tasks || DEFAULT_TASKS).map((t) => ({ done: false, ...t }));
  const assign = proj.assign || [];
  const total = assign.length;
  const counts = computeCounts(assign, tasks);
  return { name: proj.name || 'Project', total, overall: overallPct(counts, tasks, total), lastModified: proj.lastModified || 0,
    tasks: tasks.map((t) => ({ name: t.name, color: t.color, done: !!t.done, count: counts[t.id] || 0, pct: total ? (counts[t.id] || 0) / total * 100 : 0 })) };
}

/* dot field → PNG for the PDF */
function renderMapDataURL(points, w, h, assign, colorById) {
  const scale = Math.min(4, Math.max(1.4, 1100 / Math.max(w, 1))), pad = 8;
  const cw = Math.ceil(w * scale + pad * 2), ch = Math.ceil(h * scale + pad * 2);
  const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch);
  const r = Math.max(1.5, 3.7 * scale);
  for (let i = 0; i < points.length; i++) { ctx.fillStyle = colorById[assign[i]] || '#9ca3af'; ctx.beginPath(); ctx.arc(points[i][0] * scale + pad, points[i][1] * scale + pad, r, 0, Math.PI * 2); ctx.fill(); }
  return cv.toDataURL('image/png');
}
function drawWatermark(doc, logo) {
  if (!logo) return;
  const pw = doc.internal.pageSize.getWidth(), ph = doc.internal.pageSize.getHeight();
  const size = 115, step = 165, ratio = logo.h / logo.w;
  doc.saveGraphicsState(); doc.setGState(doc.GState({ opacity: 0.045 }));
  for (let y = -10; y < ph; y += step) for (let x = -10; x < pw; x += step) doc.addImage(logo.url, 'PNG', x, y, size, size * ratio);
  doc.restoreGraphicsState();
}
function exportPDF(projName, points, w, h, tasks, assign, stampTs, byUser, logo) {
  const total = assign.length;
  const counts = computeCounts(assign, tasks);
  const colorById = {}; tasks.forEach((t) => { colorById[t.id] = t.color; });
  const overall = overallPct(counts, tasks, total);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const M = 40;
  drawWatermark(doc, logo);
  let titleX = M;
  if (logo) { const lw = 34; doc.addImage(logo.url, 'PNG', M, M - 10, lw, lw * (logo.h / logo.w)); titleX = M + lw + 12; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(20, 20, 28);
  doc.text('TASK TRACKER  —  ' + (projName || '').toUpperCase(), titleX, M + 8);
  doc.setDrawColor(249, 115, 22); doc.setLineWidth(2.5); doc.line(titleX, M + 16, titleX + 210, M + 16);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(150, 150, 150);
  doc.text('SUNRISE CONSTRUCTION & DEVELOPMENT', titleX, M + 28);
  let y = M + 56;
  doc.setFontSize(10); doc.setTextColor(90, 90, 90);
  doc.text('Last modified:  ' + fmtDate(stampTs), M, y); y += 14;
  if (byUser) { doc.text('By:  ' + byUser, M, y); y += 14; }
  doc.text('Exported:  ' + fmtDate(Date.now()), M, y); y += 14;
  doc.text('Total points:  ' + total.toLocaleString(), M, y); y += 24;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(20, 20, 28);
  doc.text('OVERALL COMPLETION', M, y);
  doc.setFontSize(32); doc.setTextColor(234, 179, 8);
  doc.text(overall.toFixed(1) + '%', M, y + 32);
  doc.setFillColor(225, 225, 225); doc.rect(M, y + 42, 232, 9, 'F');
  doc.setFillColor(249, 115, 22); doc.rect(M, y + 42, 232 * overall / 100, 9, 'F');
  let ly = y + 82;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(20, 20, 28);
  doc.text('TASKS', M, ly); ly += 18;
  tasks.forEach((t) => {
    const c = counts[t.id] || 0; const p = total ? c / total * 100 : 0;
    doc.setFillColor(t.color); doc.roundedRect(M, ly - 9, 14, 14, 2, 2, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(20, 20, 28);
    doc.text(t.name + (t.done ? '  (complete)' : ''), M + 22, ly + 2);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(90, 90, 90);
    doc.text(`${c.toLocaleString()} / ${total.toLocaleString()}     ${p.toFixed(1)}%`, M + 22, ly + 16);
    doc.setFillColor(230, 230, 230); doc.rect(M + 22, ly + 21, 200, 4, 'F');
    doc.setFillColor(t.color); doc.rect(M + 22, ly + 21, 200 * p / 100, 4, 'F');
    ly += 40;
  });
  try {
    const url = renderMapDataURL(points, w, h, assign, colorById);
    const imgW = 250; const imgH = h > 0 ? imgW * (h / w) : 300;
    const ix = 322; const iy = y;
    doc.setFillColor(255, 255, 255); doc.rect(ix - 4, iy - 4, imgW + 8, imgH + 8, 'F');
    doc.setDrawColor(210); doc.setLineWidth(1); doc.rect(ix - 4, iy - 4, imgW + 8, imgH + 8);
    doc.addImage(url, 'PNG', ix, iy, imgW, imgH);
    doc.setFontSize(8); doc.setTextColor(140, 140, 140); doc.text('Layout (color = task)', ix, iy + imgH + 14);
  } catch (e) { /* */ }
  doc.save(`Task_Tracker_${safeName(projName)}_${fileStamp(stampTs)}.pdf`);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function PilePlan({ onExit, portalUser }) {
  const mob = useIsMobile();
  const userName = (typeof portalUser === 'string' ? portalUser : (portalUser && portalUser.name)) || 'Unknown user';

  const [projects, setProjects] = useState(() => ensureMigrated());
  const [activeId, setActiveId] = useState(() => storage.get(ACTIVE_KEY) || (projects[0] && projects[0].id) || 'dwyer');

  const loadDoc = (id) => storage.get(projKey(id)) || defaultDwyerProject();
  const init = useRef(loadDoc(activeId));
  const [projName, setProjName] = useState(init.current.name || 'Project');
  const [points, setPoints] = useState(init.current.points || DWYER_POINTS);
  const [planW, setPlanW] = useState(init.current.w || PLAN_W);
  const [planH, setPlanH] = useState(init.current.h || PLAN_H);
  const [sections, setSections] = useState(init.current.sections || null);
  const [sectionCount, setSectionCount] = useState(init.current.sectionCount || 0);
  const [tasks, setTasks] = useState((init.current.tasks || DEFAULT_TASKS).map((t) => ({ done: false, ...t })));
  const [assign, setAssign] = useState(init.current.assign || []);
  const [log, setLog] = useState(init.current.log || []);
  const [lastModified, setLastModified] = useState(init.current.lastModified || Date.now());

  const TOTAL = points.length;
  const [activeTaskId, setActiveTaskId] = useState(tasks[0] ? tasks[0].id : 't0');
  const [mode, setMode] = useState('paint');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [projOpen, setProjOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  /* persist active project doc + registry */
  const skipPersist = useRef(false);
  useEffect(() => {
    if (skipPersist.current) { skipPersist.current = false; return; }
    storage.set(projKey(activeId), { name: projName, w: planW, h: planH, points, sections, sectionCount, tasks, assign, log, lastModified });
  }, [activeId, projName, planW, planH, points, sections, sectionCount, tasks, assign, log, lastModified]);
  useEffect(() => { storage.set(REG_KEY, projects); }, [projects]);
  useEffect(() => { storage.set(ACTIVE_KEY, activeId); }, [activeId]);
  useEffect(() => { if (!tasks.find((t) => t.id === activeTaskId) && tasks[0]) setActiveTaskId(tasks[0].id); }, [tasks, activeTaskId]);

  const colorById = useMemo(() => { const m = {}; tasks.forEach((t) => { m[t.id] = t.color; }); return m; }, [tasks]);
  const counts = useMemo(() => computeCounts(assign, tasks), [assign, tasks]);
  const overall = useMemo(() => overallPct(counts, tasks, TOTAL), [counts, tasks, TOTAL]);
  const activeTask = tasks.find((t) => t.id === activeTaskId) || tasks[0];
  const pct = (id) => TOTAL ? (counts[id] || 0) / TOTAL * 100 : 0;

  /* per-section completion */
  const sectionStats = useMemo(() => {
    if (!sections || sectionCount < 2) return null;
    const arr = Array.from({ length: sectionCount }, () => ({ total: 0, done: 0 }));
    const doneIds = new Set(tasks.filter((t) => t.done).map((t) => t.id));
    for (let i = 0; i < points.length; i++) { const s = sections[i]; if (s == null || !arr[s]) continue; arr[s].total++; if (doneIds.has(assign[i])) arr[s].done++; }
    return arr.map((a, i) => ({ i, total: a.total, pct: a.total ? a.done / a.total * 100 : 0 }));
  }, [sections, sectionCount, assign, tasks, points]);

  /* logo for export */
  const logoRef = useRef(null);
  useEffect(() => { const img = new Image(); img.onload = () => { try { const S = 256; const c = document.createElement('canvas'); c.width = S; c.height = Math.round(S * img.height / img.width); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); logoRef.current = { url: c.toDataURL('image/png'), w: c.width, h: c.height }; } catch (e) {} }; img.src = LOGO_URL; }, []);

  /* refs */
  const activeIdRef = useRef(activeId); useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  const activeTaskIdRef = useRef(activeTaskId); useEffect(() => { activeTaskIdRef.current = activeTaskId; }, [activeTaskId]);
  const modeRef = useRef(mode); useEffect(() => { modeRef.current = mode; }, [mode]);
  const tasksRef = useRef(tasks); useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  const assignRef = useRef(assign); useEffect(() => { assignRef.current = assign; }, [assign]);
  const logRef = useRef(log); useEffect(() => { logRef.current = log; }, [log]);
  const lastModifiedRef = useRef(lastModified); useEffect(() => { lastModifiedRef.current = lastModified; }, [lastModified]);
  const paintingRef = useRef(false);
  const burstRef = useRef(null);
  const editBeforeRef = useRef(null);

  const pushLog = useCallback((summary, snapTasks, snapAssign) => {
    const entry = { id: 'h' + Date.now() + Math.random().toString(36).slice(2, 6), ts: Date.now(), user: userName, summary, tasks: snapTasks.map((t) => ({ ...t })), assign: encAssign(snapAssign, snapTasks) };
    setLog((prev) => [entry, ...prev].slice(0, MAX_LOG)); setLastModified(entry.ts);
  }, [userName]);

  const paintDot = useCallback((i) => { setAssign((prev) => { if (prev[i] === activeTaskIdRef.current) return prev; if (burstRef.current) burstRef.current.count++; const n = prev.slice(); n[i] = activeTaskIdRef.current; return n; }); }, []);
  const paintAt = useCallback((cx, cy) => { const el = document.elementFromPoint(cx, cy); if (el && el.dataset && el.dataset.i != null) paintDot(+el.dataset.i); }, [paintDot]);

  /* ---- cloud sync (per active project) + registry ---- */
  const [cloudStatus, setCloudStatus] = useState('local');
  const syncedIdsRef = useRef(new Set());
  const lastRevRef = useRef(-1);
  const applyingRemoteRef = useRef(false);
  const readyRef = useRef(false);
  const pushTimerRef = useRef(null);

  const applyRemote = useCallback((doc) => {
    applyingRemoteRef.current = true;
    if ((doc.lastModified || 0) > (lastModifiedRef.current || 0)) {
      if (Array.isArray(doc.tasks) && doc.tasks.length) setTasks(doc.tasks.map((t) => ({ done: false, ...t })));
      if (Array.isArray(doc.assign)) setAssign(doc.assign);
      if (Array.isArray(doc.points) && doc.points.length) { setPoints(doc.points); setPlanW(doc.w || 0); setPlanH(doc.h || 0); setSections(doc.sections || null); setSectionCount(doc.sectionCount || 0); }
      if (typeof doc.name === 'string' && doc.name) setProjName(doc.name);
      setLastModified(doc.lastModified);
    }
    if (Array.isArray(doc.log)) { setLog((local) => mergeLogs(local, doc.log)); doc.log.forEach((e) => syncedIdsRef.current.add(e.id)); }
    lastRevRef.current = doc.rev;
    setTimeout(() => { applyingRemoteRef.current = false; }, 0);
  }, []);

  const pushCloud = useCallback(async () => {
    const id = activeIdRef.current;
    const entries = logRef.current.filter((e) => !syncedIdsRef.current.has(e.id));
    try {
      setCloudStatus('syncing');
      const body = { tasks: tasksRef.current, assign: assignRef.current, lastModified: lastModifiedRef.current, entries, name: projNameRef.current, points: pointsRef.current, w: planWRef.current, h: planHRef.current, sections: sectionsRef.current, sectionCount: sectionCountRef.current };
      const r = await fetch(ENDPOINT + '?project=' + encodeURIComponent(id), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error('http ' + r.status);
      const doc = await r.json();
      entries.forEach((e) => syncedIdsRef.current.add(e.id));
      lastRevRef.current = doc.rev;
      if (Array.isArray(doc.log)) { applyingRemoteRef.current = true; setLog((local) => mergeLogs(local, doc.log)); doc.log.forEach((e) => syncedIdsRef.current.add(e.id)); setTimeout(() => { applyingRemoteRef.current = false; }, 0); }
      setCloudStatus('synced');
    } catch (e) { setCloudStatus('offline'); }
  }, []);

  // refs for layout used in pushCloud
  const projNameRef = useRef(projName); useEffect(() => { projNameRef.current = projName; }, [projName]);
  const pointsRef = useRef(points); useEffect(() => { pointsRef.current = points; }, [points]);
  const planWRef = useRef(planW); useEffect(() => { planWRef.current = planW; }, [planW]);
  const planHRef = useRef(planH); useEffect(() => { planHRef.current = planH; }, [planH]);
  const sectionsRef = useRef(sections); useEffect(() => { sectionsRef.current = sections; }, [sections]);
  const sectionCountRef = useRef(sectionCount); useEffect(() => { sectionCountRef.current = sectionCount; }, [sectionCount]);

  // pull + poll for the active project; reset when project changes
  useEffect(() => {
    let alive = true;
    readyRef.current = false; lastRevRef.current = -1; syncedIdsRef.current = new Set(); setCloudStatus('local');
    const id = activeId;
    const pull = async (initial) => {
      try {
        const r = await fetch(ENDPOINT + '?project=' + encodeURIComponent(id), { cache: 'no-store' });
        if (!r.ok) throw new Error('http ' + r.status);
        const doc = await r.json();
        if (!alive || activeIdRef.current !== id) return;
        if (initial && (!doc || !Array.isArray(doc.assign) || !doc.assign.length)) { readyRef.current = true; await pushCloud(); return; }
        if (doc.rev !== lastRevRef.current) applyRemote(doc);
        setCloudStatus('synced'); readyRef.current = true;
      } catch (e) { if (alive && initial) { setCloudStatus('offline'); readyRef.current = true; } }
    };
    pull(true);
    const t = setInterval(() => pull(false), 6000);
    return () => { alive = false; clearInterval(t); };
  }, [activeId, applyRemote, pushCloud]);

  useEffect(() => {
    if (!readyRef.current || applyingRemoteRef.current) return;
    clearTimeout(pushTimerRef.current);
    pushTimerRef.current = setTimeout(() => { pushCloud(); }, 1000);
  }, [tasks, assign, log, projName, points, pushCloud]);

  // registry cloud sync (best-effort)
  const regSyncedRef = useRef(false);
  useEffect(() => {
    let alive = true;
    (async () => { try { const r = await fetch(ENDPOINT + '?registry=1', { cache: 'no-store' }); if (!r.ok) return; const doc = await r.json(); if (!alive) return; if (Array.isArray(doc.projects) && doc.projects.length) { setProjects((local) => { const map = {}; [...doc.projects, ...local].forEach((p) => { if (p && p.id && !map[p.id]) map[p.id] = p; }); return Object.values(map); }); } regSyncedRef.current = true; } catch (e) {} })();
    return () => { alive = false; };
  }, []);
  const pushRegistry = useCallback((list) => { fetch(ENDPOINT + '?registry=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projects: list }) }).catch(() => {}); }, []);

  /* ---- pan / zoom ---- */
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const viewRef = useRef(view); useEffect(() => { viewRef.current = view; }, [view]);
  const svgRef = useRef(null);
  const PAD = 16; const VW = planW + PAD * 2; const VH = planH + PAD * 2;
  const toView = useCallback((cx, cy) => { const el = svgRef.current; if (!el) return { x: 0, y: 0 }; const r = el.getBoundingClientRect(); if (!r.width || !r.height) return { x: 0, y: 0 }; return { x: (cx - r.left) / r.width * VW, y: (cy - r.top) / r.height * VH }; }, [VW, VH]);
  const clampView = useCallback((v) => {
    let s = v.s; if (!isFinite(s)) s = 1; s = Math.min(28, Math.max(1, s));
    let x = isFinite(v.x) ? v.x : 0; let y = isFinite(v.y) ? v.y : 0;
    x = Math.min(0, Math.max(VW * (1 - s), x));
    y = Math.min(0, Math.max(VH * (1 - s), y));
    return { s, x, y };
  }, [VW, VH]);
  const zoomAt = useCallback((px, py, factor) => { setView((v) => { const ns = Math.min(28, Math.max(1, v.s * factor)); const wx = (px - v.x) / v.s, wy = (py - v.y) / v.s; return clampView({ s: ns, x: px - wx * ns, y: py - wy * ns }); }); }, [clampView]);
  const onWheel = useCallback((e) => { e.preventDefault(); const p = toView(e.clientX, e.clientY); zoomAt(p.x, p.y, e.deltaY < 0 ? 1.15 : 1 / 1.15); }, [toView, zoomAt]);
  useEffect(() => { const svg = svgRef.current; if (!svg) return; svg.addEventListener('wheel', onWheel, { passive: false }); return () => svg.removeEventListener('wheel', onWheel); }, [onWheel]);
  const pointersRef = useRef(new Map()); const panRef = useRef(null); const pinchRef = useRef(null);
  const onPointerDown = (e) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) { paintingRef.current = false; panRef.current = null; const pts = [...pointersRef.current.values()]; const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y); const midC = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }; pinchRef.current = { dist, mid: toView(midC.x, midC.y), s0: viewRef.current.s, x0: viewRef.current.x, y0: viewRef.current.y }; return; }
    if (modeRef.current === 'paint') { paintingRef.current = true; burstRef.current = { taskId: activeTaskIdRef.current, count: 0 }; paintAt(e.clientX, e.clientY); }
    else { const p = toView(e.clientX, e.clientY); panRef.current = { sx: p.x, sy: p.y, vx: viewRef.current.x, vy: viewRef.current.y }; }
  };
  const onPointerMove = (e) => {
    if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchRef.current && pointersRef.current.size >= 2) { const pts = [...pointersRef.current.values()]; const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y); const ratio = dist / (pinchRef.current.dist || 1); const ns = Math.min(28, Math.max(1, pinchRef.current.s0 * ratio)); const { mid, s0, x0, y0 } = pinchRef.current; const wx = (mid.x - x0) / s0, wy = (mid.y - y0) / s0; setView(clampView({ s: ns, x: mid.x - wx * ns, y: mid.y - wy * ns })); return; }
    if (panRef.current) { const pr = panRef.current; const p = toView(e.clientX, e.clientY); setView((v) => clampView({ ...v, x: pr.vx + (p.x - pr.sx), y: pr.vy + (p.y - pr.sy) })); }
  };
  const endPointer = (e) => { pointersRef.current.delete(e.pointerId); if (pointersRef.current.size < 2) pinchRef.current = null; if (pointersRef.current.size === 0) { paintingRef.current = false; panRef.current = null; } };
  useEffect(() => {
    const mv = (e) => { if (paintingRef.current && modeRef.current === 'paint' && pointersRef.current.size < 2) paintAt(e.clientX, e.clientY); };
    const up = () => { paintingRef.current = false; const b = burstRef.current; if (b && b.count > 0) { const tn = tasksRef.current.find((t) => t.id === b.taskId); pushLog(`painted ${b.count} point${b.count !== 1 ? 's' : ''} → "${tn ? tn.name : '?'}"`, tasksRef.current, assignRef.current); } burstRef.current = null; };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, [paintAt, pushLog]);
  const resetView = () => setView({ s: 1, x: 0, y: 0 });
  const zoomB = (f) => zoomAt(VW / 2, VH / 2, f);

  /* ---- task ops ---- */
  const renameTask = (id, name) => setTasks((ts) => ts.map((t) => t.id === id ? { ...t, name } : t));
  const recolorTask = (id, color) => setTasks((ts) => ts.map((t) => t.id === id ? { ...t, color } : t));
  const onEditFocus = (type, t) => { editBeforeRef.current = { type, id: t.id, before: type === 'name' ? t.name : t.color }; };
  const onEditBlur = () => { const b = editBeforeRef.current; editBeforeRef.current = null; if (!b) return; const cur = tasksRef.current.find((x) => x.id === b.id); if (!cur) return; if (b.type === 'name' && cur.name !== b.before) pushLog(`renamed "${b.before}" → "${cur.name}"`, tasksRef.current, assignRef.current); if (b.type === 'color' && cur.color !== b.before) pushLog(`recolored "${cur.name}" to ${cur.color}`, tasksRef.current, assignRef.current); };
  const toggleDone = (id) => { const next = tasksRef.current.map((t) => t.id === id ? { ...t, done: !t.done } : t); const t = next.find((x) => x.id === id); setTasks(next); pushLog(`marked "${t.name}" as ${t.done ? 'complete' : 'not complete'}`, next, assignRef.current); };
  const addTask = () => { const used = new Set(tasksRef.current.map((t) => t.color)); const color = SWATCHES.find((c) => !used.has(c)) || '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'); const t = { id: newId(), name: 'New Task', color, done: false }; const next = [...tasksRef.current, t]; setTasks(next); setActiveTaskId(t.id); pushLog(`added task "${t.name}"`, next, assignRef.current); };
  const removeTask = (id) => { if (tasksRef.current.length <= 1) return; const removed = tasksRef.current.find((t) => t.id === id); const fb = tasksRef.current.find((t) => t.id !== id).id; const na = assignRef.current.map((a) => (a === id ? fb : a)); const nt = tasksRef.current.filter((t) => t.id !== id); setAssign(na); setTasks(nt); pushLog(`deleted task "${removed ? removed.name : '?'}"`, nt, na); };
  const resetAll = () => { if (!window.confirm('Reset all tasks for "' + projName + '" to defaults? (layout/points are kept)')) return; const nt = DEFAULT_TASKS.map((t) => ({ ...t })); const na = points.map(() => 't0'); setTasks(nt); setAssign(na); setActiveTaskId('t0'); pushLog('reset tasks to defaults', nt, na); };

  const handleExport = () => { exportPDF(projName, points, planW, planH, tasks, assign, lastModified, userName, logoRef.current); pushLog('exported PDF', tasks, assign); };
  const exportEntry = (entry) => exportPDF(projName, points, planW, planH, entry.tasks.map((t) => ({ done: false, ...t })), decAssign(entry.assign, entry.tasks), entry.ts, entry.user, logoRef.current);
  const restoreEntry = (entry) => { if (!window.confirm('Restore the version from ' + fmtDate(entry.ts) + ' (by ' + entry.user + ')?')) return; const rt = entry.tasks.map((t) => ({ done: false, ...t })); const ra = decAssign(entry.assign, entry.tasks); setTasks(rt); setAssign(ra); setActiveTaskId(rt[0] ? rt[0].id : 't0'); pushLog('restored version from ' + fmtDate(entry.ts), rt, ra); setHistoryOpen(false); };

  /* ---- project ops ---- */
  const switchProject = (id) => {
    if (id === activeId) { setProjOpen(false); return; }
    const doc = loadDoc(id);
    skipPersist.current = true;
    setProjName(doc.name || 'Project'); setPoints(doc.points || []); setPlanW(doc.w || 0); setPlanH(doc.h || 0);
    setSections(doc.sections || null); setSectionCount(doc.sectionCount || 0);
    setTasks((doc.tasks || DEFAULT_TASKS).map((t) => ({ done: false, ...t }))); setAssign(doc.assign || []);
    setLog(doc.log || []); setLastModified(doc.lastModified || Date.now());
    setActiveTaskId((doc.tasks && doc.tasks[0] && doc.tasks[0].id) || 't0');
    setActiveId(id); resetView(); setProjOpen(false); setSheetOpen(false);
  };
  const renameProject = (id, name) => { setProjects((ps) => { const next = ps.map((p) => p.id === id ? { ...p, name } : p); pushRegistry(next); return next; }); if (id === activeId) setProjName(name); else { const d = loadDoc(id); storage.set(projKey(id), { ...d, name }); } };
  const deleteProject = (id) => {
    if (projects.length <= 1) { window.alert('At least one project is required.'); return; }
    const p = projects.find((x) => x.id === id);
    if (!window.confirm('Delete project "' + (p ? p.name : id) + '" and all its data? This cannot be undone.')) return;
    const next = projects.filter((x) => x.id !== id); setProjects(next); pushRegistry(next);
    try { localStorage.removeItem(projKey(id)); } catch (e) {}
    if (id === activeId) switchProject(next[0].id);
  };
  const createProject = (name, imp) => {
    const id = newProjId();
    const doc = { name: name || 'New Project', w: imp.w, h: imp.h, points: imp.points, sections: imp.sectionCount > 1 ? imp.sections : null, sectionCount: imp.sectionCount > 1 ? imp.sectionCount : 0,
      tasks: DEFAULT_TASKS.map((t) => ({ ...t })), assign: imp.points.map(() => 't0'), log: [{ id: 'h' + Date.now(), ts: Date.now(), user: userName, summary: `created project from import (${imp.count} points${imp.sectionCount > 1 ? ', ' + imp.sectionCount + ' sections' : ''})`, tasks: DEFAULT_TASKS.map((t) => ({ ...t })), assign: encAssign(imp.points.map(() => 't0'), DEFAULT_TASKS) }], lastModified: Date.now() };
    storage.set(projKey(id), doc);
    const next = [...projects, { id, name: doc.name, createdAt: Date.now() }]; setProjects(next); pushRegistry(next);
    setImportOpen(false); setProjOpen(false);
    switchProject(id);
  };

  /* ---- dots ---- */
  const dotEls = useMemo(() => points.map((d, i) => (
    <circle key={i} data-i={i} cx={d[0] + PAD} cy={d[1] + PAD} r={4.1} fill={colorById[assign[i]] || '#9ca3af'} stroke="rgba(2,3,10,.55)" strokeWidth={0.45} />
  )), [points, assign, colorById]);

  const cloudLabel = cloudStatus === 'synced' ? 'Synced to cloud (shared)' : cloudStatus === 'syncing' ? 'Syncing…' : cloudStatus === 'offline' ? 'Offline — saved on device' : 'Connecting…';
  const cloudColor = cloudStatus === 'synced' ? '#22c55e' : cloudStatus === 'offline' ? GOLD : MUTE;

  const legendBody = (
    <>
      <div style={card()}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={kicker}>Overall Completion</span>
          <span style={{ fontFamily: BBF, fontSize: 34, color: GOLD, lineHeight: .9, textShadow: '0 0 22px rgba(234,179,8,.4)' }}>{overall.toFixed(1)}%</span>
        </div>
        <div style={bar}><div style={{ height: '100%', width: overall + '%', background: 'linear-gradient(90deg,' + ORANGE + ',' + GOLD + ')', transition: 'width .25s' }} /></div>
        <div style={{ fontFamily: NBF, fontSize: 12, color: MUTE, marginTop: 7 }}>{TOTAL.toLocaleString()} points{sectionCount > 1 ? ' · ' + sectionCount + ' sections' : ''} · {fmtDate(lastModified)}</div>
        <div style={{ fontFamily: NBF, fontSize: 12, marginTop: 2, color: cloudColor, display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: cloudColor, boxShadow: '0 0 8px ' + cloudColor }} />{cloudLabel}</div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => setMode('paint')} style={segBtn(mode === 'paint')}>Paint</button>
        <button onClick={() => setMode('pan')} style={segBtn(mode === 'pan')}>Pan</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {tasks.map((t) => { const active = t.id === activeTaskId; const p = pct(t.id); return (
          <div key={t.id} onClick={() => setActiveTaskId(t.id)} style={taskCard(active)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <label style={{ position: 'relative', width: 30, height: 30, flexShrink: 0, background: t.color, border: '2px solid rgba(255,255,255,.4)', cursor: 'pointer', clipPath: CLIP }} onClick={(e) => e.stopPropagation()}>
                <input type="color" value={t.color} onChange={(e) => recolorTask(t.id, e.target.value)} onFocus={() => onEditFocus('color', t)} onBlur={onEditBlur} style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
              </label>
              <input value={t.name} onChange={(e) => renameTask(t.id, e.target.value)} onFocus={() => onEditFocus('name', t)} onBlur={onEditBlur} onClick={(e) => e.stopPropagation()} style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', borderBottom: '1px solid rgba(249,115,22,.25)', color: CREAM, fontFamily: NBF, fontSize: 19, fontWeight: 600, padding: '3px 0', outline: 'none' }} />
              {tasks.length > 1 && <button onClick={(e) => { e.stopPropagation(); removeTask(t.id); }} style={{ background: 'transparent', border: 'none', color: MUTE, cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: '0 4px' }}>&times;</button>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9 }}>
              <button onClick={(e) => { e.stopPropagation(); toggleDone(t.id); }} style={{ display: 'flex', alignItems: 'center', gap: 5, background: t.done ? 'rgba(249,115,22,.14)' : 'transparent', border: '1px solid ' + (t.done ? t.color : 'rgba(255,255,255,.15)'), color: t.done ? t.color : MUTE, padding: '3px 8px', fontFamily: NBF, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer', flexShrink: 0 }}><span style={{ fontSize: 13 }}>{t.done ? '☑' : '☐'}</span> complete</button>
              <span style={{ fontFamily: NBF, fontSize: 13, color: MUTE }}>{(counts[t.id] || 0).toLocaleString()} / {TOTAL.toLocaleString()}</span>
              <span style={{ marginLeft: 'auto', fontFamily: BBF, fontSize: 22, color: t.color, lineHeight: 1 }}>{p.toFixed(1)}%</span>
            </div>
            <div style={{ ...bar, marginTop: 7 }}><div style={{ height: '100%', width: p + '%', background: t.color, transition: 'width .2s' }} /></div>
          </div>
        ); })}
      </div>

      {sectionStats && (
        <div style={card()}>
          <div style={{ ...kicker, marginBottom: 8 }}>Sections ({sectionCount})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 160, overflowY: 'auto' }}>
            {sectionStats.map((s) => (
              <div key={s.i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: NBF, fontSize: 13, color: MUTE, width: 70, flexShrink: 0 }}>Block {s.i + 1}</span>
                <div style={{ ...bar, flex: 1, marginTop: 0 }}><div style={{ height: '100%', width: s.pct + '%', background: GOLD }} /></div>
                <span style={{ fontFamily: BBF, fontSize: 16, color: CREAM, width: 44, textAlign: 'right' }}>{s.pct.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <button onClick={addTask} style={dashBtn}>+ Add Task</button>
      <button onClick={handleExport} style={ctaBtn}>Export PDF</button>
      <button onClick={() => setHistoryOpen(true)} style={ghostBtn}>Edit History ({log.length})</button>
      <button onClick={resetAll} style={resetBtn}>Reset Tasks</button>
    </>
  );

  const sectionLabel = (txt) => (<div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: NBF, fontSize: 12, fontWeight: 700, letterSpacing: '3px', textTransform: 'uppercase', color: ORANGE }}><span style={{ width: 22, height: 2, background: ORANGE, display: 'inline-block' }} />{txt}</div>);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: `radial-gradient(120% 80% at 50% -10%, #14182a 0%, ${INK} 55%, ${INK2} 100%)`, display: 'flex', flexDirection: 'column', fontFamily: NBF, color: CREAM }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: mob ? 9 : 14, padding: mob ? '9px 12px' : '12px 22px', background: 'rgba(4,4,12,.85)', backdropFilter: 'blur(14px)', borderBottom: '1px solid ' + LINE }}>
        {onExit && <button onClick={onExit} style={backBtn}>&#8592;</button>}
        <img src={LOGO_URL} alt="SRC" style={{ width: mob ? 30 : 38, height: mob ? 30 : 38, objectFit: 'contain', borderRadius: 4 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: BBF, fontSize: mob ? 18 : 25, letterSpacing: 1.2, color: CREAM, lineHeight: .95 }}>TASK TRACKER</div>
          <button onClick={() => setProjOpen(true)} style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, maxWidth: mob ? 150 : 260 }}>
            <span style={{ fontFamily: NBF, fontSize: mob ? 12 : 13, letterSpacing: 1.5, color: ORANGE, textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{projName}</span>
            <span style={{ color: ORANGE, fontSize: 10 }}>&#9662;</span>
          </button>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: mob ? 8 : 14 }}>
          <div style={{ textAlign: 'right', lineHeight: 1 }}>
            <div style={{ fontFamily: BBF, fontSize: mob ? 22 : 30, color: GOLD, textShadow: '0 0 18px rgba(234,179,8,.4)' }}>{overall.toFixed(0)}%</div>
            {!mob && <div style={{ fontFamily: NBF, fontSize: 9, letterSpacing: 2, color: MUTE, textTransform: 'uppercase' }}>Complete</div>}
          </div>
          {!mob && <button onClick={() => setProjOpen(true)} style={ghostBtn}>Projects</button>}
          {!mob && <button onClick={handleExport} style={ctaBtn}>Export PDF</button>}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {!mob && (
          <div style={{ width: 340, flexShrink: 0, background: PANEL, borderRight: '1px solid ' + LINE, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 13 }}>
            {sectionLabel('Color Legend')}
            <div style={{ fontFamily: NBF, fontSize: 13, color: MUTE, marginTop: -6 }}>Pick a task, then click or drag across the dots to paint them.</div>
            {legendBody}
          </div>
        )}
        <div style={{ flex: 1, position: 'relative', minWidth: 0, background: 'radial-gradient(110% 90% at 50% 0%, #0e1426 0%, #080b16 60%, #05060d 100%)' }}>
          {TOTAL === 0 ? (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center' }}>
              <div style={{ fontFamily: BBF, fontSize: 26, color: MUTE }}>No layout yet</div>
              <button onClick={() => setImportOpen(true)} style={ctaBtn}>Import a plan</button>
            </div>
          ) : (
            <svg ref={svgRef} viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: mode === 'pan' ? 'grab' : 'crosshair' }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endPointer} onPointerCancel={endPointer}>
              <g transform={`translate(${view.x} ${view.y}) scale(${view.s})`}>{dotEls}</g>
            </svg>
          )}
          <div style={{ position: 'absolute', bottom: mob ? 86 : 18, right: 14, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
            <button onClick={() => zoomB(1.3)} style={zbtn}>+</button>
            <span style={{ fontFamily: BBF, fontSize: 13, color: CREAM, background: 'rgba(4,4,12,.75)', border: '1px solid ' + LINE, padding: '1px 5px', minWidth: 34, textAlign: 'center' }}>{Math.round(view.s * 100)}%</span>
            <button onClick={() => zoomB(1 / 1.3)} style={zbtn}>&minus;</button>
            <button onClick={resetView} style={{ ...zbtn, fontSize: 12, fontFamily: NBF }} title="Fit">FIT</button>
          </div>
        </div>
      </div>

      {mob && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'rgba(4,4,12,.92)', borderTop: '1px solid ' + LINE }}>
          <button onClick={() => setSheetOpen(true)} style={{ ...ctaBtn, padding: '9px 14px' }}>Tasks &#9650;</button>
          <div onClick={() => setSheetOpen(true)} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, cursor: 'pointer' }}>
            <span style={{ width: 18, height: 18, background: activeTask ? activeTask.color : '#999', flexShrink: 0, border: '1px solid rgba(255,255,255,.4)', clipPath: CLIP }} />
            <span style={{ fontFamily: NBF, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 16 }}>{activeTask ? activeTask.name : ''}</span>
            <span style={{ marginLeft: 'auto', fontFamily: BBF, fontSize: 19, color: activeTask ? activeTask.color : '#999' }}>{activeTask ? pct(activeTask.id).toFixed(1) + '%' : ''}</span>
          </div>
          <button onClick={() => setMode(mode === 'paint' ? 'pan' : 'paint')} style={{ ...ghostBtn, padding: '9px 13px' }}>{mode === 'paint' ? 'Paint' : 'Pan'}</button>
        </div>
      )}

      {mob && sheetOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2100, background: 'rgba(0,0,0,.55)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }} onClick={() => setSheetOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: `linear-gradient(180deg,#0d0f1c, ${INK})`, borderTop: '2px solid ' + ORANGE, borderRadius: '18px 18px 0 0', padding: 16, maxHeight: '84vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>{sectionLabel('Color Legend')}<button onClick={() => setSheetOpen(false)} style={{ ...xBtn, marginLeft: 'auto' }}>&times;</button></div>
            {legendBody}
            <button onClick={() => setSheetOpen(false)} style={{ ...ctaBtn, padding: '13px 0' }}>Done</button>
          </div>
        </div>
      )}

      {historyOpen && (
        <div style={overlay(mob)} onClick={() => setHistoryOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={modalCard(mob, 520)}>
            <div style={{ display: 'flex', alignItems: 'center' }}><div style={headTitle}>Edit History</div><button onClick={() => setHistoryOpen(false)} style={{ ...xBtn, marginLeft: 'auto' }}>&times;</button></div>
            <div style={{ fontFamily: NBF, fontSize: 13, color: MUTE }}>Every change is logged with who made it and when. Shared across devices.</div>
            {log.length === 0 && <div style={{ color: MUTE, fontFamily: NBF, fontSize: 15, padding: '12px 0' }}>No edits yet.</div>}
            {log.map((e) => (
              <div key={e.id} style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(249,115,22,.15)', padding: 11, display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontFamily: NBF, fontSize: 16, color: CREAM, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.summary}</div><div style={{ fontFamily: NBF, fontSize: 12, color: MUTE }}><span style={{ color: ORANGE }}>{e.user}</span> · {fmtDate(e.ts)}</div></div>
                <button onClick={() => exportEntry(e)} style={{ ...ghostBtn, padding: '6px 10px', fontSize: 12 }}>PDF</button>
                <button onClick={() => restoreEntry(e)} style={{ ...ctaBtn, padding: '6px 12px', fontSize: 12, boxShadow: 'none' }}>Restore</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {projOpen && (
        <div style={overlay(mob)} onClick={() => setProjOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={modalCard(mob, 460)}>
            <div style={{ display: 'flex', alignItems: 'center' }}><div style={headTitle}>Projects</div><button onClick={() => setProjOpen(false)} style={{ ...xBtn, marginLeft: 'auto' }}>&times;</button></div>
            {projects.map((p) => (
              <div key={p.id} style={{ background: p.id === activeId ? 'rgba(249,115,22,.12)' : 'rgba(255,255,255,.03)', border: '1px solid ' + (p.id === activeId ? ORANGE : 'rgba(249,115,22,.15)'), padding: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                <input defaultValue={p.name} onClick={(e) => e.stopPropagation()} onBlur={(e) => { if (e.target.value && e.target.value !== p.name) renameProject(p.id, e.target.value); }} style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', borderBottom: '1px solid rgba(249,115,22,.25)', color: CREAM, fontFamily: NBF, fontSize: 17, fontWeight: 600, padding: '3px 0', outline: 'none' }} />
                {p.id !== activeId && <button onClick={() => switchProject(p.id)} style={{ ...ctaBtn, padding: '6px 12px', fontSize: 12, boxShadow: 'none' }}>Open</button>}
                {p.id === activeId && <span style={{ fontFamily: NBF, fontSize: 11, color: ORANGE, letterSpacing: 1, textTransform: 'uppercase' }}>Active</span>}
                {projects.length > 1 && <button onClick={() => deleteProject(p.id)} style={{ background: 'transparent', border: 'none', color: MUTE, cursor: 'pointer', fontSize: 20 }}>&times;</button>}
              </div>
            ))}
            <button onClick={() => { setImportOpen(true); }} style={{ ...ctaBtn, padding: '12px 0' }}>+ New Project (Import Plan)</button>
          </div>
        </div>
      )}

      {importOpen && <ImportModal mob={mob} onClose={() => setImportOpen(false)} onCreate={createProject} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Import modal                                                        */
/* ------------------------------------------------------------------ */
function ImportModal({ mob, onClose, onCreate }) {
  const [file, setFile] = useState(null);
  const [name, setName] = useState('');
  const [sensitivity, setSensitivity] = useState(5);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  const run = async (f, sens) => {
    if (!f) return;
    setBusy(true); setErr('');
    try { const r = await processImport(f, sens); setResult(r); if (!r.count) setErr('No dots detected — try adjusting the sensitivity.'); }
    catch (e) { setErr('Import failed: ' + (e && e.message ? e.message : 'unknown')); setResult(null); }
    setBusy(false);
  };
  const onFile = (f) => { if (!f) return; setFile(f); if (!name) setName(f.name.replace(/\.[^.]+$/, '')); run(f, sensitivity); };

  const previewVB = result && result.w ? `0 0 ${result.w} ${result.h}` : '0 0 100 100';

  return (
    <div style={overlay(mob)} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modalCard(mob, 560), gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}><div style={headTitle}>New Project — Import Plan</div><button onClick={onClose} style={{ ...xBtn, marginLeft: 'auto' }}>&times;</button></div>

        <label style={{ ...ghostBtn, textAlign: 'center', padding: '12px 0', display: 'block' }}>
          {file ? 'Choose a different file' : 'Upload PDF or Image'}
          <input type="file" accept=".pdf,image/*" hidden onChange={(e) => onFile(e.target.files[0])} />
        </label>

        {file && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontFamily: NBF, fontSize: 13, color: MUTE, width: 90 }}>Sensitivity</span>
              <input type="range" min="1" max="10" value={sensitivity} onChange={(e) => { const v = +e.target.value; setSensitivity(v); }} onMouseUp={() => run(file, sensitivity)} onTouchEnd={() => run(file, sensitivity)} style={{ flex: 1 }} />
              <button onClick={() => run(file, sensitivity)} style={{ ...ghostBtn, padding: '6px 10px', fontSize: 12 }}>Re-detect</button>
            </div>

            <div style={{ background: '#fff', border: '1px solid ' + LINE, height: mob ? 220 : 300, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {busy ? <span style={{ fontFamily: NBF, color: '#666' }}>Detecting…</span> : result && result.count ? (
                <svg viewBox={previewVB} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
                  {result.points.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={4} fill={result.sectionCount > 1 ? `hsl(${(result.sections[i] * 67) % 360} 70% 50%)` : '#16a34a'} />)}
                </svg>
              ) : <span style={{ fontFamily: NBF, color: '#999' }}>No preview</span>}
            </div>

            {result && result.count > 0 && (
              <div style={{ fontFamily: NBF, fontSize: 14, color: CREAM }}>Detected <strong style={{ color: ORANGE }}>{result.count.toLocaleString()}</strong> points{result.sectionCount > 1 ? <> · <strong style={{ color: ORANGE }}>{result.sectionCount}</strong> sections (by gaps)</> : ' · no separate sections'}</div>
            )}
            {err && <div style={{ fontFamily: NBF, fontSize: 14, color: GOLD }}>{err}</div>}

            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" style={{ background: 'rgba(255,255,255,.05)', border: '1px solid ' + LINE, color: CREAM, fontFamily: NBF, fontSize: 17, padding: '10px 12px', outline: 'none' }} />
            <button disabled={!result || !result.count || busy} onClick={() => onCreate(name || (file ? file.name.replace(/\.[^.]+$/, '') : 'New Project'), result)} style={{ ...ctaBtn, padding: '13px 0', opacity: (!result || !result.count || busy) ? .5 : 1 }}>Create Project</button>
          </>
        )}
        <div style={{ fontFamily: NBF, fontSize: 12, color: MUTE }}>Dots are auto-detected from the drawing and split into sections where there are clear gaps. Adjust sensitivity if too many/few are found. (The background image isn't stored — only the detected dots.)</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Live read-only preview for the public landing page                 */
/* ------------------------------------------------------------------ */
export function TaskTrackerPreview() {
  const mob = useIsMobile();
  const [doc, setDoc] = useState(() => {
    const p = storage.get(projKey('dwyer'));
    return p && Array.isArray(p.assign) ? { tasks: p.tasks, assign: p.assign, lastModified: p.lastModified } : null;
  });
  useEffect(() => {
    let alive = true;
    fetch(ENDPOINT + '?project=dwyer', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d && Array.isArray(d.assign) && d.assign.length === DOTS.length) setDoc({ tasks: d.tasks, assign: d.assign, lastModified: d.lastModified }); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const tasks = ((doc && doc.tasks && doc.tasks.length) ? doc.tasks : DEFAULT_TASKS).map((t) => ({ done: false, ...t }));
  const assign = (doc && Array.isArray(doc.assign) && doc.assign.length === DOTS.length) ? doc.assign : DOTS.map((d) => DEFAULT_TASK_BY_INDEX[d[2]] || 't0');
  const colorById = {}; tasks.forEach((t) => { colorById[t.id] = t.color; });
  const total = DOTS.length;
  const counts = computeCounts(assign, tasks);
  const overall = overallPct(counts, tasks, total);
  const PAD = 16, VW = PLAN_W + PAD * 2, VH = PLAN_H + PAD * 2;
  const lm = doc && doc.lastModified;

  return (
    <div style={{ border: '1px solid ' + LINE, background: 'rgba(8,8,18,.7)', backdropFilter: 'blur(8px)', display: 'flex', flexDirection: mob ? 'column' : 'row', overflow: 'hidden' }}>
      <div style={{ flex: mob ? 'none' : '0 0 300px', padding: mob ? 18 : 26, display: 'flex', flexDirection: 'column', gap: 13, borderRight: mob ? 'none' : '1px solid ' + LINE, borderBottom: mob ? '1px solid ' + LINE : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: NBF, fontSize: 11, fontWeight: 700, letterSpacing: '3px', textTransform: 'uppercase', color: ORANGE }}>
          <span style={{ width: 18, height: 1, background: ORANGE }} />Live Site Progress
        </div>
        <div style={{ fontFamily: BBF, fontSize: mob ? 30 : 36, letterSpacing: 1, color: CREAM, lineHeight: .95 }}>DWYER RD</div>
        <div>
          <div style={{ fontFamily: BBF, fontSize: mob ? 58 : 74, color: GOLD, lineHeight: .85, textShadow: '0 0 26px rgba(234,179,8,.4)' }}>{overall.toFixed(1)}<span style={{ fontSize: '.42em' }}>%</span></div>
          <div style={{ fontFamily: NBF, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: MUTE, marginTop: 2 }}>Overall Complete</div>
        </div>
        <div style={{ height: 7, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}><div style={{ height: '100%', width: overall + '%', background: 'linear-gradient(90deg,' + ORANGE + ',' + GOLD + ')' }} /></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 2 }}>
          {tasks.map((t) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 12, height: 12, background: t.color, flexShrink: 0 }} />
              <span style={{ fontFamily: NBF, fontSize: 14, color: '#cfcabf', letterSpacing: .5 }}>{t.name}</span>
              <span style={{ marginLeft: 'auto', fontFamily: BBF, fontSize: 18, color: t.color }}>{((counts[t.id] || 0) / total * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
        <div style={{ fontFamily: NBF, fontSize: 11, color: '#6b6b73', letterSpacing: 1 }}>{total.toLocaleString()} piles{lm ? ' · updated ' + new Date(lm).toLocaleDateString() : ''}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0, background: 'radial-gradient(110% 90% at 50% 0%, #0e1426 0%, #06080f 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
        <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: mob ? 320 : 470, display: 'block' }}>
          {DOTS.map((d, i) => <circle key={i} cx={d[0] + PAD} cy={d[1] + PAD} r={4.1} fill={colorById[assign[i]] || '#9ca3af'} stroke="rgba(2,3,10,.5)" strokeWidth={0.4} />)}
        </svg>
      </div>
    </div>
  );
}

/* styles */
const kicker = { fontFamily: NBF, fontSize: 12, fontWeight: 700, letterSpacing: '2.5px', textTransform: 'uppercase', color: MUTE };
const bar = { height: 7, background: 'rgba(255,255,255,.08)', marginTop: 8, overflow: 'hidden', borderRadius: 2 };
const headTitle = { fontFamily: BBF, fontSize: 24, letterSpacing: 1.5, color: CREAM };
function card() { return { background: 'rgba(255,255,255,.03)', border: '1px solid ' + LINE, padding: 12 }; }
function taskCard(active) { return { border: '1px solid ' + (active ? ORANGE : 'rgba(255,255,255,.08)'), padding: 11, background: active ? 'rgba(249,115,22,.10)' : 'rgba(255,255,255,.02)', cursor: 'pointer', boxShadow: active ? '0 0 16px rgba(249,115,22,.18)' : 'none' }; }
function segBtn(active) { return { flex: 1, background: active ? ORANGE : 'transparent', color: active ? '#1a1206' : CREAM, border: '1px solid ' + (active ? ORANGE : 'rgba(255,255,255,.18)'), padding: '10px 0', fontFamily: NBF, fontWeight: 700, fontSize: 14, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', clipPath: CLIP }; }
const ctaBtn = { background: ORANGE, color: '#1a1206', border: 'none', padding: '12px 18px', fontFamily: NBF, fontWeight: 700, fontSize: 14, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', clipPath: CLIP, whiteSpace: 'nowrap', boxShadow: '0 0 20px rgba(249,115,22,.30)' };
const ghostBtn = { background: 'transparent', color: ORANGE, border: '1px solid ' + ORANGE, padding: '10px 16px', fontFamily: NBF, fontWeight: 700, fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', clipPath: CLIP, whiteSpace: 'nowrap' };
const dashBtn = { background: 'transparent', color: ORANGE, border: '1px dashed rgba(249,115,22,.5)', padding: '12px 0', fontFamily: NBF, fontWeight: 600, fontSize: 15, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' };
const resetBtn = { background: 'transparent', color: MUTE, border: '1px solid rgba(255,255,255,.12)', padding: '10px 0', fontFamily: NBF, fontSize: 13, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' };
const backBtn = { background: 'transparent', color: CREAM, border: '1px solid rgba(255,255,255,.2)', width: 38, height: 34, fontSize: 17, cursor: 'pointer', clipPath: CLIP, flexShrink: 0 };
const zbtn = { width: 44, height: 44, background: 'rgba(4,4,12,.8)', color: CREAM, border: '1px solid ' + LINE, fontSize: 22, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', clipPath: CLIP, backdropFilter: 'blur(6px)' };
const xBtn = { background: 'transparent', border: 'none', color: MUTE, fontSize: 30, lineHeight: 1, cursor: 'pointer' };
function overlay(mob) { return { position: 'fixed', inset: 0, zIndex: 2200, background: 'rgba(0,0,0,.62)', display: 'flex', alignItems: mob ? 'flex-end' : 'center', justifyContent: 'center' }; }
function modalCard(mob, w) { return { background: `linear-gradient(180deg,#0d0f1c, ${INK})`, border: '1px solid ' + ORANGE, borderRadius: mob ? '18px 18px 0 0' : 10, padding: 18, width: mob ? '100%' : w, maxHeight: '86vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 9, boxShadow: '0 0 60px rgba(0,0,0,.6)' }; }
