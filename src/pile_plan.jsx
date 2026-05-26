import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { jsPDF } from 'jspdf';
import { DOTS, PLAN_W, PLAN_H } from './pile_data.js';
import { processImport } from './tt_import.js';
import { ModelViewer, renderOverheadPNG } from './glb_viewer.jsx';

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
const MODELS_ENDPOINT = '/.netlify/functions/ttmodels';
const MODEL_CHUNK = 3 * 1024 * 1024;
function b64ToBytes(b64) { const bin = atob(b64 || ''); const len = bin.length; const out = new Uint8Array(len); for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i); return out; }
function blobToB64(blob) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = rej; fr.readAsDataURL(blob); }); }

/* fixed staged statuses (sequence) — a point at stage k implies stages 1..k done */
const STAGES = [
  { name: 'No Progress', color: '#ffffff', mapColor: '#e8e8ea' },
  { name: 'Piles Installed', color: '#9ca3af', mapColor: '#9ca3af' },
  { name: 'Post Caps Installed', color: '#2563eb', mapColor: '#2563eb' },
  { name: 'Torque Tube Installed', color: '#7c3aed', mapColor: '#7c3aed' },
  { name: 'Modules Installed', color: '#16a34a', mapColor: '#16a34a' },
];
const QC_YELLOW = '#eab308', QC_ORANGE = '#ea580c';
const QC = [{ name: 'Clear Flag', color: 'transparent' }, { name: 'Requires Attention', color: QC_YELLOW }, { name: 'Flagged Issue', color: QC_ORANGE }];

/* assignable tasks within a project (for employee scoping) */
export const TASK_DEFS = [
  { id: 's1', label: 'Piles' },
  { id: 's2', label: 'Post Caps' },
  { id: 's3', label: 'Torque Tube' },
  { id: 's4', label: 'Modules' },
  { id: 'q', label: 'Quality Checks' },
];
/* returns a Set of allowed paint tokens, or null when unrestricted (all).
   scope absent/null => null (full access); [] => empty set (view only); [..] => those tasks */
function allowedPaintSet(scope) {
  if (scope == null || !Array.isArray(scope)) return null;
  const set = new Set(); let hasStage = false;
  scope.forEach((t) => {
    if (t === 'q') { set.add('q0'); set.add('q1'); set.add('q2'); }
    else if (t === 's1' || t === 's2' || t === 's3' || t === 's4') { set.add(t); hasStage = true; }
  });
  if (hasStage) set.add('s0');
  return set;
}
/* background photo display dimensions in plan coordinates */
function bgDims(bg, planW) { const w = planW * (bg.scale || 1); return { w, h: w * (bg.ar || 0.66) }; }
/* load + downscale an uploaded image to a JPEG data URL; returns { url, ar } */
function scaleImage(file, maxDim, q) {
  return new Promise((resolve, reject) => {
    const img = new Image(); const src = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.naturalWidth || 1, h = img.naturalHeight || 1;
      const f = Math.min(1, (maxDim || 1600) / Math.max(w, h)); w = Math.max(1, Math.round(w * f)); h = Math.max(1, Math.round(h * f));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      try { c.getContext('2d').drawImage(img, 0, 0, w, h); const url = c.toDataURL('image/jpeg', q || 0.82); URL.revokeObjectURL(src); resolve({ url, ar: h / w }); }
      catch (e) { URL.revokeObjectURL(src); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error('image load failed')); };
    img.src = src;
  });
}

let _idc = 1;
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
/* cumulative counts: stageCounts[s] = # points with stage >= s */
function computeStats(stage, qc) {
  const N = stage.length;
  const cum = [0, 0, 0, 0, 0];
  let sum = 0, yellow = 0, orange = 0, none = 0;
  for (let i = 0; i < N; i++) {
    const s = stage[i] || 0; sum += s;
    for (let k = 1; k <= s; k++) cum[k]++;
    if (s === 0) none++;
    const q = qc ? (qc[i] || 0) : 0;
    if (q === 1) yellow++; else if (q === 2) orange++;
  }
  return { N, cum, none, yellow, orange, overall: N ? sum / (N * 4) * 100 : 0 };
}
const dispColor = (s, q, forMap) => (q === 2 ? QC_ORANGE : q === 1 ? QC_YELLOW : (forMap ? STAGES[s || 0].mapColor : STAGES[s || 0].color));
const encNums = (a) => (a || []).join('');
const decNums = (s, n) => { const out = new Array(n).fill(0); if (typeof s === 'string') for (let i = 0; i < s.length && i < n; i++) out[i] = +s[i] || 0; return out; };

const DWYER_POINTS = DOTS.map((d) => [d[0], d[1]]);
function defaultProject(name) {
  const N = DWYER_POINTS.length;
  return { name: name || 'Project Alpha', w: PLAN_W, h: PLAN_H, points: DWYER_POINTS, sections: null, sectionCount: 0, stage: new Array(N).fill(0), qc: new Array(N).fill(0), by: new Array(N).fill(''), at: new Array(N).fill(0), notes: {}, bg: null, bgT: 0, overlay3d: null, log: [], lastModified: Date.now() };
}
function normalizeDoc(d) {
  if (!d) return defaultProject();
  const pts = Array.isArray(d.points) && d.points.length ? d.points : DWYER_POINTS;
  const N = pts.length;
  const stage = Array.isArray(d.stage) && d.stage.length === N ? d.stage : new Array(N).fill(0);
  const qc = Array.isArray(d.qc) && d.qc.length === N ? d.qc : new Array(N).fill(0);
  const by = Array.isArray(d.by) && d.by.length === N ? d.by : new Array(N).fill('');
  const at = Array.isArray(d.at) && d.at.length === N ? d.at : new Array(N).fill(0);
  const notes = (d.notes && typeof d.notes === 'object') ? d.notes : {};
  const bg = (d.bg && typeof d.bg === 'object' && d.bg.url) ? d.bg : null;
  const overlay3d = (d.overlay3d && typeof d.overlay3d === 'object') ? d.overlay3d : null;
  return { name: d.name || 'Project', w: d.w || PLAN_W, h: d.h || PLAN_H, points: pts, sections: d.sections || null, sectionCount: d.sectionCount || 0, stage, qc, by, at, notes, bg, bgT: d.bgT || 0, overlay3d, log: Array.isArray(d.log) ? d.log : [], lastModified: d.lastModified || Date.now() };
}
function ensureMigrated() {
  let reg = storage.get(REG_KEY);
  if (Array.isArray(reg) && reg.length) {
    let changed = false;
    reg = reg.map((p) => { if (p && /dwyer/i.test(p.name || '')) { changed = true; return { ...p, name: 'Project Alpha' }; } return p; });
    if (changed) { storage.set(REG_KEY, reg); reg.forEach((p) => { const d = storage.get(projKey(p.id)); if (d && /dwyer/i.test(d.name || '')) storage.set(projKey(p.id), { ...d, name: p.name }); }); }
    return reg;
  }
  storage.set(projKey('dwyer'), defaultProject('Project Alpha'));
  reg = [{ id: 'dwyer', name: 'Project Alpha', createdAt: Date.now() }];
  storage.set(REG_KEY, reg); storage.set(ACTIVE_KEY, 'dwyer');
  return reg;
}

/* KPI snapshot for dashboard / stakeholder (per active project) */
export function getTaskTrackerKPI() {
  let reg = storage.get(REG_KEY); let raw = null;
  if (Array.isArray(reg) && reg.length) { const aid = storage.get(ACTIVE_KEY) || reg[0].id; raw = storage.get(projKey(aid)) || storage.get(projKey(reg[0].id)); }
  const d = normalizeDoc(raw);
  const st = computeStats(d.stage, d.qc);
  const total = st.N;
  return {
    name: d.name || 'Project', total, overall: st.overall, lastModified: d.lastModified || 0,
    tasks: STAGES.slice(1).map((s, i) => ({ name: s.name.replace(' Installed', ''), color: s.color, count: st.cum[i + 1], pct: total ? st.cum[i + 1] / total * 100 : 0 })),
  };
}

/* ------------------------------------------------------------------ */
/*  PDF export                                                         */
/* ------------------------------------------------------------------ */
function renderMapDataURL(points, w, h, stage, qc) {
  const scale = Math.min(4, Math.max(1.4, 1100 / Math.max(w, 1))), pad = 8;
  const cw = Math.ceil(w * scale + pad * 2), ch = Math.ceil(h * scale + pad * 2);
  const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch);
  const r = Math.max(1.5, 3.7 * scale);
  for (let i = 0; i < points.length; i++) {
    ctx.fillStyle = dispColor(stage[i], qc ? qc[i] : 0, true);
    ctx.beginPath(); ctx.arc(points[i][0] * scale + pad, points[i][1] * scale + pad, r, 0, Math.PI * 2); ctx.fill();
  }
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
function exportPDF(projName, points, w, h, stage, qc, notes, stampTs, byUser, logo, overheadPNG) {
  const st = computeStats(stage, qc); const total = st.N;
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
  doc.setFontSize(32); doc.setTextColor(22, 163, 74); doc.text(st.overall.toFixed(1) + '%', M, y + 32);
  doc.setFillColor(225, 225, 225); doc.rect(M, y + 42, 232, 9, 'F');
  doc.setFillColor(249, 115, 22); doc.rect(M, y + 42, 232 * st.overall / 100, 9, 'F');
  let ly = y + 82;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(20, 20, 28); doc.text('INSTALL STATUS', M, ly); ly += 18;
  STAGES.slice(1).forEach((s, i) => {
    const cnt = st.cum[i + 1]; const p = total ? cnt / total * 100 : 0;
    doc.setFillColor(s.mapColor); doc.roundedRect(M, ly - 9, 14, 14, 2, 2, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(20, 20, 28); doc.text(s.name, M + 22, ly + 2);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(90, 90, 90);
    doc.text(`${cnt.toLocaleString()} / ${total.toLocaleString()}     ${p.toFixed(1)}%`, M + 22, ly + 16);
    doc.setFillColor(230, 230, 230); doc.rect(M + 22, ly + 21, 200, 4, 'F');
    doc.setFillColor(s.mapColor); doc.rect(M + 22, ly + 21, 200 * p / 100, 4, 'F');
    ly += 40;
  });
  ly += 4;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(20, 20, 28); doc.text('QUALITY CHECKS', M, ly); ly += 16;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(90, 90, 90);
  doc.setFillColor(QC_YELLOW); doc.rect(M, ly - 8, 12, 12, 'F'); doc.text('Requires Attention: ' + st.yellow, M + 18, ly + 1); ly += 16;
  doc.setFillColor(QC_ORANGE); doc.rect(M, ly - 8, 12, 12, 'F'); doc.text('Flagged Issues: ' + st.orange, M + 18, ly + 1); ly += 18;
  try {
    const url = renderMapDataURL(points, w, h, stage, qc); const imgW = 250; const imgH = h > 0 ? imgW * (h / w) : 300; const ix = 322; const iy = y;
    doc.setFillColor(255, 255, 255); doc.rect(ix - 4, iy - 4, imgW + 8, imgH + 8, 'F');
    doc.setDrawColor(210); doc.setLineWidth(1); doc.rect(ix - 4, iy - 4, imgW + 8, imgH + 8);
    doc.addImage(url, 'PNG', ix, iy, imgW, imgH);
    doc.setFontSize(8); doc.setTextColor(140, 140, 140); doc.text('Site layout (color = status)', ix, iy + imgH + 14);
  } catch (e) { /* */ }
  // overhead model render (page 2)
  if (overheadPNG) {
    try {
      doc.addPage(); drawWatermark(doc, logo);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(20, 20, 28); doc.text('SITE MODEL — OVERHEAD VIEW', M, M + 10);
      doc.setDrawColor(249, 115, 22); doc.setLineWidth(2); doc.line(M, M + 18, M + 230, M + 18);
      const pw = doc.internal.pageSize.getWidth() - M * 2;
      const props = doc.getImageProperties ? doc.getImageProperties(overheadPNG) : null;
      const ratio = props ? props.height / props.width : 0.75;
      let iw = pw, ih = pw * ratio; const maxH = doc.internal.pageSize.getHeight() - M - (M + 40);
      if (ih > maxH) { ih = maxH; iw = ih / ratio; }
      doc.addImage(overheadPNG, 'PNG', M + (pw - iw) / 2, M + 40, iw, ih);
    } catch (e) { /* */ }
  }
  // flagged-issue notes appendix
  const flagged = [];
  for (let i = 0; i < points.length; i++) if (qc[i] === 2 && notes[i]) flagged.push([i, notes[i]]);
  if (flagged.length) {
    doc.addPage(); drawWatermark(doc, logo);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(20, 20, 28); doc.text('FLAGGED ISSUES', M, M + 10);
    doc.setDrawColor(249, 115, 22); doc.setLineWidth(2); doc.line(M, M + 18, M + 160, M + 18);
    let fy = M + 44; doc.setFontSize(10);
    flagged.forEach(([i, note], idx) => {
      if (fy > 720) { doc.addPage(); drawWatermark(doc, logo); fy = M + 20; }
      doc.setFillColor(QC_ORANGE); doc.rect(M, fy - 9, 10, 10, 'F');
      doc.setFont('helvetica', 'bold'); doc.setTextColor(20, 20, 28); doc.text('Point #' + (i + 1), M + 16, fy);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(70, 70, 70);
      const lines = doc.splitTextToSize(String(note), 470); doc.text(lines, M + 16, fy + 14); fy += 14 + lines.length * 12 + 12;
    });
  }
  doc.save(`Task_Tracker_${safeName(projName)}_${fileStamp(stampTs)}.pdf`);
}

/* ------------------------------------------------------------------ */
/*  Live read-only preview for the public landing page                 */
/* ------------------------------------------------------------------ */
export function TaskTrackerPreview() {
  const mob = useIsMobile();
  const [doc, setDoc] = useState(() => { const p = storage.get(projKey('dwyer')); return p ? normalizeDoc(p) : null; });
  useEffect(() => {
    let alive = true;
    fetch(ENDPOINT + '?project=dwyer', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d && Array.isArray(d.points) && d.points.length) setDoc(normalizeDoc(d)); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const d = doc || normalizeDoc(null);
  const dispName = (d.name && !/dwyer/i.test(d.name)) ? d.name : 'Project Alpha';
  const st = computeStats(d.stage, d.qc); const total = st.N;
  const PAD = 16, VW = d.w + PAD * 2, VH = d.h + PAD * 2;
  return (
    <div style={{ border: '1px solid ' + LINE, background: 'rgba(8,8,18,.7)', backdropFilter: 'blur(8px)', display: 'flex', flexDirection: mob ? 'column' : 'row', overflow: 'hidden' }}>
      <div style={{ flex: mob ? 'none' : '0 0 300px', padding: mob ? 18 : 26, display: 'flex', flexDirection: 'column', gap: 12, borderRight: mob ? 'none' : '1px solid ' + LINE, borderBottom: mob ? '1px solid ' + LINE : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: NBF, fontSize: 11, fontWeight: 700, letterSpacing: '3px', textTransform: 'uppercase', color: ORANGE }}><span style={{ width: 18, height: 1, background: ORANGE }} />Live Site Progress</div>
        <div style={{ fontFamily: BBF, fontSize: mob ? 30 : 36, letterSpacing: 1, color: CREAM, lineHeight: .95 }}>{dispName.toUpperCase()}</div>
        <div><div style={{ fontFamily: BBF, fontSize: mob ? 58 : 74, color: GOLD, lineHeight: .85, textShadow: '0 0 26px rgba(234,179,8,.4)' }}>{st.overall.toFixed(1)}<span style={{ fontSize: '.42em' }}>%</span></div><div style={{ fontFamily: NBF, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: MUTE, marginTop: 2 }}>Overall Complete</div></div>
        <div style={{ height: 7, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}><div style={{ height: '100%', width: st.overall + '%', background: 'linear-gradient(90deg,' + ORANGE + ',' + GOLD + ')' }} /></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 2 }}>
          {STAGES.slice(1).map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 12, height: 12, background: s.color, flexShrink: 0, border: '1px solid rgba(255,255,255,.25)' }} />
              <span style={{ fontFamily: NBF, fontSize: 14, color: '#cfcabf', letterSpacing: .5 }}>{s.name.replace(' Installed', '')}</span>
              <span style={{ marginLeft: 'auto', fontFamily: BBF, fontSize: 18, color: s.color }}>{total ? (st.cum[i + 1] / total * 100).toFixed(0) : 0}%</span>
            </div>
          ))}
        </div>
        <div style={{ fontFamily: NBF, fontSize: 11, color: '#6b6b73', letterSpacing: 1 }}>{total.toLocaleString()} points{d.lastModified ? ' · updated ' + new Date(d.lastModified).toLocaleDateString() : ''}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0, background: 'radial-gradient(110% 90% at 50% 0%, #0e1426 0%, #06080f 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
        <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: mob ? 320 : 470, display: 'block' }}>
          {d.bg && d.bg.on && <image href={d.bg.url} x={d.bg.x + PAD} y={d.bg.y + PAD} width={bgDims(d.bg, d.w).w} height={bgDims(d.bg, d.w).h} opacity={d.bg.opacity != null ? d.bg.opacity : 0.85} preserveAspectRatio="none" />}
          {d.points.map((pt, i) => <circle key={i} cx={pt[0] + PAD} cy={pt[1] + PAD} r={4.1} fill={dispColor(d.stage[i], d.qc[i])} stroke="rgba(2,3,10,.55)" strokeWidth={0.45} />)}
        </svg>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Client portal (read-only) + helpers                                */
/* ------------------------------------------------------------------ */
/* end-of-day snapshots: last log entry per calendar day, decoded */
function dailySnapshots(log, N) {
  const byDay = new Map();
  for (const e of (log || [])) {
    if (!e || !e.ts || typeof e.stage !== 'string') continue;
    const d = new Date(e.ts);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const prev = byDay.get(key);
    if (!prev || e.ts > prev.ts) byDay.set(key, e);
  }
  const out = [];
  for (const [key, e] of byDay) {
    const stage = decNums(e.stage, N), qc = decNums(e.qc, N);
    const st = computeStats(stage, qc);
    out.push({ day: key, ts: e.ts, stage, qc, notes: e.notes || {}, overall: st.overall, cum: st.cum, yellow: st.yellow, orange: st.orange });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

/* read-only project registry (local cache; cloud is authoritative) */
export function listProjects() {
  const reg = storage.get(REG_KEY);
  return Array.isArray(reg) ? reg : [];
}

function ReadonlyMap({ points, w, h, stage, qc, height, mob, bg, bgOn, onPick }) {
  const PAD = 16, VW = w + PAD * 2, VH = h + PAD * 2;
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: height || (mob ? 320 : 470), display: 'block' }}
      onClick={onPick ? (e) => { const el = e.target; if (el && el.dataset && el.dataset.i != null) onPick(+el.dataset.i); } : undefined}>
      {bg && bgOn && bg.url && <image href={bg.url} x={bg.x + PAD} y={bg.y + PAD} width={bgDims(bg, w).w} height={bgDims(bg, w).h} opacity={bg.opacity != null ? bg.opacity : 0.85} preserveAspectRatio="none" style={{ pointerEvents: 'none' }} />}
      {points.map((pt, i) => <circle key={i} data-i={i} cx={pt[0] + PAD} cy={pt[1] + PAD} r={4.1} fill={dispColor(stage[i], qc ? qc[i] : 0)} stroke="rgba(2,3,10,.55)" strokeWidth={0.45} style={onPick ? { cursor: 'pointer' } : undefined} />)}
    </svg>
  );
}

/* read-only client view: live map, PDF download, daily snapshots + timelapse, latest 3D model */
export function ClientPortal({ user, onExit }) {
  const mob = useIsMobile();
  const assigned = (user && Array.isArray(user.assignedProjects)) ? user.assignedProjects : [];
  const [registry, setRegistry] = useState([]);
  const [activeId, setActiveId] = useState(assigned[0] || null);
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('progress'); // progress | snapshots | model
  const [modelBuf, setModelBuf] = useState(null);
  const [models, setModels] = useState([]);
  const [modelStatus, setModelStatus] = useState('');
  const [exporting, setExporting] = useState(false);
  const [cBgOn, setCBgOn] = useState(true); // client-local photo toggle
  const [selPt, setSelPt] = useState(null);
  const logoRef = useRef(null);

  useEffect(() => { const img = new Image(); img.onload = () => { try { const S = 256; const c = document.createElement('canvas'); c.width = S; c.height = Math.round(S * img.height / img.width); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); logoRef.current = { url: c.toDataURL('image/png'), w: c.width, h: c.height }; } catch (e) {} }; img.src = LOGO_URL; }, []);

  useEffect(() => {
    let alive = true;
    fetch(ENDPOINT + '?registry=1', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j && Array.isArray(j.projects)) setRegistry(j.projects); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const projects = useMemo(() => {
    const byId = {}; registry.forEach((p) => { byId[p.id] = p; });
    return assigned.map((id) => byId[id] || { id, name: 'Project' });
  }, [registry, assigned]);

  useEffect(() => { if (!activeId && assigned.length) setActiveId(assigned[0]); }, [assigned, activeId]);

  useEffect(() => {
    if (!activeId) { setLoading(false); return; }
    let alive = true; setLoading(true); setDoc(null);
    const pull = () => fetch(ENDPOINT + '?project=' + encodeURIComponent(activeId), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d && Array.isArray(d.points) && d.points.length) { setDoc(normalizeDoc(d)); setLoading(false); } else if (alive) setLoading(false); })
      .catch(() => { if (alive) setLoading(false); });
    pull(); const t = setInterval(pull, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [activeId]);

  useEffect(() => {
    if (!activeId) return;
    let alive = true; setModelBuf(null); setModels([]); setModelStatus('');
    fetch(MODELS_ENDPOINT + '?project=' + encodeURIComponent(activeId) + '&list=1', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then(async (j) => {
        if (!alive || !j || !Array.isArray(j.models) || !j.models.length) return;
        setModels(j.models);
        const m = j.models[0];
        setModelStatus('Loading latest model…');
        try {
          const parts = [];
          for (let i = 0; i < m.chunks; i++) { const r = await fetch(MODELS_ENDPOINT + '?project=' + encodeURIComponent(activeId) + '&chunk=1&model=' + encodeURIComponent(m.id) + '&index=' + i, { cache: 'no-store' }); if (!r.ok) throw new Error('chunk'); const cj = await r.json(); parts.push(b64ToBytes(cj.data)); }
          const total = parts.reduce((s, p) => s + p.length, 0); const out = new Uint8Array(total); let off = 0; for (const p of parts) { out.set(p, off); off += p.length; }
          if (alive) { setModelBuf(out.buffer); setModelStatus(''); }
        } catch (e) { if (alive) setModelStatus('Model unavailable.'); }
      }).catch(() => {});
    return () => { alive = false; };
  }, [activeId]);

  const snaps = useMemo(() => (doc ? dailySnapshots(doc.log, doc.points.length) : []), [doc]);
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(0);
  useEffect(() => { setFrame(snaps.length ? snaps.length - 1 : 0); setPlaying(false); }, [snaps.length, activeId]);
  useEffect(() => { setSelPt(null); setCBgOn(true); }, [activeId]);
  useEffect(() => {
    if (!playing || snaps.length < 2) return;
    const t = setInterval(() => setFrame((f) => (f >= snaps.length - 1 ? 0 : f + 1)), 900);
    return () => clearInterval(t);
  }, [playing, snaps.length]);

  const handleDownload = async () => {
    if (!doc) return;
    setExporting(true);
    let overhead = null;
    if (modelBuf) { try { overhead = await renderOverheadPNG(modelBuf); } catch (e) {} }
    exportPDF(doc.name, doc.points, doc.w, doc.h, doc.stage, doc.qc, doc.notes, doc.lastModified, (user && user.name) || 'Client', logoRef.current, overhead);
    setExporting(false);
  };

  const st = doc ? computeStats(doc.stage, doc.qc) : null;
  const total = st ? st.N : 0;
  const dispName = projects.find((p) => p.id === activeId)?.name || (doc && doc.name) || 'Project';
  const frameSnap = snaps[frame];

  const tabBtn = (id, label) => (
    <button onClick={() => setTab(id)} style={{ background: tab === id ? ORANGE : 'transparent', color: tab === id ? '#1a1206' : CREAM, border: '1px solid ' + (tab === id ? ORANGE : 'rgba(255,255,255,.18)'), padding: mob ? '8px 12px' : '9px 18px', fontFamily: NBF, fontWeight: 700, fontSize: 13, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer', clipPath: CLIP, whiteSpace: 'nowrap' }}>{label}</button>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: `radial-gradient(120% 80% at 50% -10%, #14182a 0%, ${INK} 55%, ${INK2} 100%)`, display: 'flex', flexDirection: 'column', fontFamily: NBF, color: CREAM, overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: mob ? 8 : 12, padding: mob ? '9px 12px' : '12px 22px', background: 'rgba(4,4,12,.85)', backdropFilter: 'blur(14px)', borderBottom: '1px solid ' + LINE, position: 'sticky', top: 0, zIndex: 5 }}>
        {onExit && <button onClick={onExit} style={backBtn} title="Sign out">&#8592;</button>}
        <img src={LOGO_URL} alt="SRC" style={{ width: mob ? 30 : 38, height: mob ? 30 : 38, objectFit: 'contain', borderRadius: 4 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: BBF, fontSize: mob ? 18 : 25, letterSpacing: 1.4, color: CREAM, lineHeight: .95 }}>CLIENT PORTAL</div>
          <div style={{ fontFamily: NBF, fontSize: mob ? 11 : 12, letterSpacing: 1.5, color: ORANGE, textTransform: 'uppercase' }}>{(user && user.name) || 'Client'}</div>
        </div>
        {projects.length > 1 && (
          <select value={activeId || ''} onChange={(e) => setActiveId(e.target.value)} style={{ marginLeft: 'auto', maxWidth: mob ? 150 : 260, background: '#0f1320', color: CREAM, border: '1px solid ' + LINE, padding: '8px 10px', fontFamily: NBF, fontSize: 14, outline: 'none' }}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>

      {(!assigned.length) ? (
        <div style={{ padding: 40, textAlign: 'center', color: MUTE, fontFamily: NBF, fontSize: 16 }}>No projects have been assigned to your account yet.</div>
      ) : loading && !doc ? (
        <div style={{ padding: 40, textAlign: 'center', color: MUTE, fontFamily: NBF, fontSize: 16 }}>Loading project…</div>
      ) : !doc ? (
        <div style={{ padding: 40, textAlign: 'center', color: MUTE, fontFamily: NBF, fontSize: 16 }}>This project has no published data yet. Check back soon.</div>
      ) : (
        <div style={{ maxWidth: 1200, margin: '0 auto', width: '100%', padding: mob ? 14 : 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16 }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontFamily: BBF, fontSize: mob ? 32 : 42, letterSpacing: 1, color: CREAM, lineHeight: .95 }}>{dispName.toUpperCase()}</div>
              <div style={{ fontFamily: NBF, fontSize: 12, color: MUTE, letterSpacing: 1, marginTop: 4 }}>{total.toLocaleString()} points · updated {fmtDate(doc.lastModified)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: BBF, fontSize: mob ? 54 : 70, color: GOLD, lineHeight: .85, textShadow: '0 0 26px rgba(234,179,8,.4)' }}>{st.overall.toFixed(1)}<span style={{ fontSize: '.42em' }}>%</span></div>
              <div style={{ fontFamily: NBF, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: MUTE }}>Overall Complete</div>
            </div>
            <button onClick={handleDownload} disabled={exporting} style={{ ...ctaBtn, opacity: exporting ? .6 : 1 }}>{exporting ? 'Preparing…' : 'Download PDF Report'}</button>
          </div>

          <div style={{ height: 8, background: 'rgba(255,255,255,.08)', overflow: 'hidden', borderRadius: 2 }}><div style={{ height: '100%', width: st.overall + '%', background: 'linear-gradient(90deg,' + ORANGE + ',' + GOLD + ')' }} /></div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {tabBtn('progress', 'Live Progress')}
            {tabBtn('snapshots', 'Daily Snapshots' + (snaps.length ? ' (' + snaps.length + ')' : ''))}
            {tabBtn('model', '3D Model')}
          </div>

          {tab === 'progress' && (
            <div style={{ display: 'flex', flexDirection: mob ? 'column' : 'row', gap: 16 }}>
              <div style={{ flex: '0 0 260px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={kicker}>Install Status</span>
                {STAGES.slice(1).map((s, i) => { const cnt = st.cum[i + 1]; const p = total ? cnt / total * 100 : 0; return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span style={{ width: 14, height: 14, background: s.color, border: '1px solid rgba(255,255,255,.3)', flexShrink: 0, clipPath: CLIP }} />
                    <span style={{ fontFamily: NBF, fontSize: 14, color: CREAM, flex: 1 }}>{s.name.replace(' Installed', '')}</span>
                    <span style={{ fontFamily: NBF, fontSize: 12, color: MUTE }}>{cnt.toLocaleString()}</span>
                    <span style={{ fontFamily: BBF, fontSize: 17, color: s.color, width: 44, textAlign: 'right' }}>{p.toFixed(0)}%</span>
                  </div>
                ); })}
                {(st.yellow > 0 || st.orange > 0) && <><span style={{ ...kicker, marginTop: 6 }}>Quality Checks</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><span style={{ width: 14, height: 14, background: QC_YELLOW, flexShrink: 0, clipPath: CLIP }} /><span style={{ fontFamily: NBF, fontSize: 14, color: CREAM, flex: 1 }}>Requires Attention</span><span style={{ fontFamily: BBF, fontSize: 17, color: QC_YELLOW }}>{st.yellow}</span></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><span style={{ width: 14, height: 14, background: QC_ORANGE, flexShrink: 0, clipPath: CLIP }} /><span style={{ fontFamily: NBF, fontSize: 14, color: CREAM, flex: 1 }}>Flagged Issue</span><span style={{ fontFamily: BBF, fontSize: 17, color: QC_ORANGE }}>{st.orange}</span></div></>}
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {doc.bg && <button onClick={() => setCBgOn((v) => !v)} style={{ ...miniBtn, color: cBgOn ? '#22c55e' : MUTE, borderColor: cBgOn ? '#22c55e' : 'rgba(255,255,255,.25)' }}>Site Photo {cBgOn ? 'On' : 'Off'}</button>}
                  <span style={{ fontFamily: NBF, fontSize: 11, color: MUTE }}>Tap any point for details</span>
                </div>
                <div style={{ flex: 1, minWidth: 0, background: 'radial-gradient(110% 90% at 50% 0%, #0e1426 0%, #06080f 100%)', border: '1px solid ' + LINE, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
                  <ReadonlyMap points={doc.points} w={doc.w} h={doc.h} stage={doc.stage} qc={doc.qc} mob={mob} bg={doc.bg} bgOn={cBgOn} onPick={setSelPt} />
                </div>
              </div>
            </div>
          )}

          {tab === 'snapshots' && (
            snaps.length === 0 ? <div style={{ color: MUTE, fontFamily: NBF, fontSize: 15, padding: '20px 0' }}>No daily snapshots recorded yet.</div> : (
            <div style={{ display: 'flex', flexDirection: mob ? 'column' : 'row', gap: 16 }}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ background: 'radial-gradient(110% 90% at 50% 0%, #0e1426 0%, #06080f 100%)', border: '1px solid ' + LINE, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
                  {frameSnap && <ReadonlyMap points={doc.points} w={doc.w} h={doc.h} stage={frameSnap.stage} qc={frameSnap.qc} height={mob ? 300 : 430} mob={mob} bg={doc.bg} bgOn={cBgOn} />}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button onClick={() => setPlaying((p) => !p)} disabled={snaps.length < 2} style={{ ...ctaBtn, padding: '10px 18px', opacity: snaps.length < 2 ? .5 : 1 }}>{playing ? '❚❚ Pause' : '► Play Timelapse'}</button>
                  <input type="range" min="0" max={Math.max(0, snaps.length - 1)} value={frame} onChange={(e) => { setPlaying(false); setFrame(+e.target.value); }} style={{ flex: 1 }} />
                </div>
                {frameSnap && <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: BBF, fontSize: 22, color: CREAM, letterSpacing: 1 }}>{new Date(frameSnap.ts).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                  <span style={{ fontFamily: BBF, fontSize: 30, color: GOLD }}>{frameSnap.overall.toFixed(1)}%</span>
                </div>}
              </div>
              <div style={{ flex: '0 0 250px', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: mob ? 240 : 480, overflowY: 'auto' }}>
                <span style={kicker}>End-of-Day Points</span>
                {[...snaps].reverse().map((s, ri) => { const idx = snaps.length - 1 - ri; return (
                  <div key={s.day} onClick={() => { setPlaying(false); setFrame(idx); }} style={{ cursor: 'pointer', padding: '8px 10px', border: '1px solid ' + (idx === frame ? ORANGE : 'rgba(255,255,255,.08)'), background: idx === frame ? 'rgba(249,115,22,.10)' : 'rgba(255,255,255,.02)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontFamily: NBF, fontSize: 14, color: CREAM }}>{new Date(s.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>{s.orange > 0 && <div style={{ fontFamily: NBF, fontSize: 11, color: QC_ORANGE }}>{s.orange} flagged</div>}</div>
                    <span style={{ fontFamily: BBF, fontSize: 18, color: GOLD }}>{s.overall.toFixed(0)}%</span>
                  </div>
                ); })}
              </div>
            </div>
          ))}

          {tab === 'model' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {modelBuf ? <div style={{ border: '1px solid ' + LINE }}><ModelViewer arrayBuffer={modelBuf} height={mob ? 320 : 500} /></div>
                : <div style={{ height: mob ? 320 : 500, border: '1px solid ' + LINE, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTE, fontFamily: NBF, fontSize: 14, background: 'radial-gradient(circle at 50% 30%, #11203a, #06080f)' }}>{modelStatus || 'No 3D model has been published for this project yet.'}</div>}
              {models[0] && <div style={{ fontFamily: NBF, fontSize: 12, color: MUTE }}>Latest model: {models[0].name || 'model.glb'} · {fmtDate(models[0].ts)}</div>}
            </div>
          )}
        </div>
      )}
      {selPt != null && doc && (
        <div style={overlay(mob)} onClick={() => setSelPt(null)}>
          <div onClick={(e) => e.stopPropagation()} style={modalCard(mob, 380)}>
            <div style={{ display: 'flex', alignItems: 'center' }}><div style={headTitle}>Point #{selPt + 1}</div><button onClick={() => setSelPt(null)} style={{ ...xBtn, marginLeft: 'auto' }}>&times;</button></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 14, height: 14, background: dispColor(doc.stage[selPt], doc.qc[selPt]), border: '1px solid rgba(255,255,255,.3)', clipPath: CLIP }} /><span style={{ fontFamily: NBF, fontSize: 15, color: CREAM }}>{STAGES[doc.stage[selPt]].name}{doc.qc[selPt] ? ' · ' + (doc.qc[selPt] === 2 ? 'Flagged Issue' : 'Requires Attention') : ''}</span></div>
            {doc.at && doc.at[selPt] ? <div style={{ fontFamily: NBF, fontSize: 13, color: MUTE }}>Last updated by <span style={{ color: ORANGE }}>{(doc.by && doc.by[selPt]) || 'Unknown'}</span><br />{fmtDate(doc.at[selPt])}</div> : <div style={{ fontFamily: NBF, fontSize: 13, color: MUTE }}>No updates recorded yet.</div>}
            {doc.notes && doc.notes[selPt] && <div style={{ fontFamily: NBF, fontSize: 14, color: CREAM, background: 'rgba(255,255,255,.05)', border: '1px solid ' + LINE, padding: 10 }}>{doc.notes[selPt]}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */
export default function PilePlan({ onExit, portalUser }) {
  const mob = useIsMobile();
  const pObj = (portalUser && typeof portalUser === 'object') ? portalUser : null;
  const userName = (typeof portalUser === 'string' ? portalUser : (pObj && pObj.name)) || 'Unknown user';
  const isAdmin = !!(pObj && pObj.role === 'admin');
  const assignedSet = (!isAdmin && pObj && Array.isArray(pObj.assignedProjects)) ? new Set(pObj.assignedProjects) : null; // null = unrestricted
  const myTaskScope = (pObj && pObj.taskScope && typeof pObj.taskScope === 'object') ? pObj.taskScope : {};

  const [projects, setProjects] = useState(() => ensureMigrated());
  const [activeId, setActiveId] = useState(() => storage.get(ACTIVE_KEY) || (storage.get(REG_KEY)?.[0]?.id) || 'dwyer');
  const [view, setView] = useState('dashboard'); // dashboard | tracker

  const loadDoc = (id) => normalizeDoc(storage.get(projKey(id)));
  const init = useRef(loadDoc(activeId));
  const [projName, setProjName] = useState(init.current.name);
  const [points, setPoints] = useState(init.current.points);
  const [planW, setPlanW] = useState(init.current.w);
  const [planH, setPlanH] = useState(init.current.h);
  const [sections, setSections] = useState(init.current.sections);
  const [sectionCount, setSectionCount] = useState(init.current.sectionCount);
  const [stage, setStage] = useState(init.current.stage);
  const [qc, setQc] = useState(init.current.qc);
  const [by, setBy] = useState(init.current.by);
  const [at, setAt] = useState(init.current.at);
  const [notes, setNotes] = useState(init.current.notes);
  const [bg, setBg] = useState(init.current.bg);
  const [bgT, setBgT] = useState(init.current.bgT);
  const [bgOn, setBgOn] = useState(!!(init.current.bg && init.current.bg.on)); // local view toggle
  const [overlay3d, setOverlay3d] = useState(init.current.overlay3d || null);
  const [log, setLog] = useState(init.current.log);
  const [lastModified, setLastModified] = useState(init.current.lastModified);

  /* effective edit permissions for the active project */
  const scopeForActive = isAdmin ? null : (Array.isArray(myTaskScope[activeId]) ? myTaskScope[activeId] : null);
  const allowed = allowedPaintSet(scopeForActive); // null = all allowed

  const [paint, setPaint] = useState('s1');         // s0-s4 stages, q1/q2 QC, q0 clear
  const [mode, setMode] = useState('brush');        // brush | fill | pan
  const [sheetOpen, setSheetOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [projOpen, setProjOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [notePt, setNotePt] = useState(null);
  const [canUndo, setCanUndo] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const modelBufRef = useRef(null); // latest viewed GLB ArrayBuffer (for PDF overhead)

  const TOTAL = points.length;
  const stats = useMemo(() => computeStats(stage, qc), [stage, qc]);

  /* persist */
  const skipPersist = useRef(false);
  useEffect(() => {
    if (skipPersist.current) { skipPersist.current = false; return; }
    storage.set(projKey(activeId), { name: projName, w: planW, h: planH, points, sections, sectionCount, stage, qc, by, at, notes, bg, bgT, overlay3d, log, lastModified });
  }, [activeId, projName, planW, planH, points, sections, sectionCount, stage, qc, by, at, notes, bg, bgT, overlay3d, log, lastModified]);
  useEffect(() => { storage.set(REG_KEY, projects); }, [projects]);
  useEffect(() => { storage.set(ACTIVE_KEY, activeId); }, [activeId]);
  // pull the shared project registry so assigned projects appear on any device
  useEffect(() => {
    let alive = true;
    fetch(ENDPOINT + '?registry=1', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!alive || !j || !Array.isArray(j.projects) || !j.projects.length) return;
      setProjects((local) => { const map = {}; (local || []).forEach((p) => { if (p && p.id) map[p.id] = p; }); j.projects.forEach((p) => { if (p && p.id) map[p.id] = Object.assign({}, map[p.id], p); }); return Object.values(map); });
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  /* refs */
  const activeIdRef = useRef(activeId); useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  const paintRef = useRef(paint); useEffect(() => { paintRef.current = paint; }, [paint]);
  const modeRef = useRef(mode); useEffect(() => { modeRef.current = mode; }, [mode]);
  const stageRef = useRef(stage); useEffect(() => { stageRef.current = stage; }, [stage]);
  const qcRef = useRef(qc); useEffect(() => { qcRef.current = qc; }, [qc]);
  const byRef = useRef(by); useEffect(() => { byRef.current = by; }, [by]);
  const atRef = useRef(at); useEffect(() => { atRef.current = at; }, [at]);
  const bgRef = useRef(bg); useEffect(() => { bgRef.current = bg; }, [bg]);
  const bgTRef = useRef(bgT); useEffect(() => { bgTRef.current = bgT; }, [bgT]);
  const overlay3dRef = useRef(overlay3d); useEffect(() => { overlay3dRef.current = overlay3d; }, [overlay3d]);
  const notesRef = useRef(notes); useEffect(() => { notesRef.current = notes; }, [notes]);
  const logRef = useRef(log); useEffect(() => { logRef.current = log; }, [log]);
  const lastModifiedRef = useRef(lastModified); useEffect(() => { lastModifiedRef.current = lastModified; }, [lastModified]);
  const projNameRef = useRef(projName); useEffect(() => { projNameRef.current = projName; }, [projName]);
  const pointsRef = useRef(points); useEffect(() => { pointsRef.current = points; }, [points]);
  const planWRef = useRef(planW); useEffect(() => { planWRef.current = planW; }, [planW]);
  const planHRef = useRef(planH); useEffect(() => { planHRef.current = planH; }, [planH]);
  const sectionsRef = useRef(sections); useEffect(() => { sectionsRef.current = sections; }, [sections]);
  const sectionCountRef = useRef(sectionCount); useEffect(() => { sectionCountRef.current = sectionCount; }, [sectionCount]);
  const paintingRef = useRef(false);
  const burstRef = useRef(null);
  const undoRef = useRef([]);

  /* ---- log + undo ---- */
  const pushLog = useCallback((summary) => {
    const entry = { id: 'h' + Date.now() + Math.random().toString(36).slice(2, 6), ts: Date.now(), user: userName, summary, stage: encNums(stageRef.current), qc: encNums(qcRef.current), notes: { ...notesRef.current } };
    setLog((prev) => [entry, ...prev].slice(0, MAX_LOG)); setLastModified(entry.ts);
    try { if (typeof window !== 'undefined' && window.__audit) window.__audit({ type: 'change', tool: 'pileplan', detail: 'Task Tracker — ' + (projNameRef.current || 'project') + ': ' + summary }); } catch (e) {}
  }, [userName]);
  const snapshotUndo = () => { undoRef.current.push({ stage: stageRef.current.slice(), qc: qcRef.current.slice(), by: byRef.current.slice(), at: atRef.current.slice(), notes: { ...notesRef.current } }); if (undoRef.current.length > 60) undoRef.current.shift(); setCanUndo(true); };
  const undo = () => {
    const snap = undoRef.current.pop(); if (!snap) { setCanUndo(false); return; }
    setStage(snap.stage); setQc(snap.qc); setBy(snap.by); setAt(snap.at); setNotes(snap.notes); setLastModified(Date.now()); setCanUndo(undoRef.current.length > 0);
    pushLog('undid last change');
  };

  /* ---- painting ---- */
  const allowedRef = useRef(allowed); useEffect(() => { allowedRef.current = allowed; }, [allowed]);
  const stampIndex = (i) => { const t = Date.now(); setAt((prev) => { const n = prev.slice(); n[i] = t; return n; }); setBy((prev) => { if (prev[i] === userName) return prev; const n = prev.slice(); n[i] = userName; return n; }); };
  const applyPaintToIndex = (i) => {
    const pv = paintRef.current;
    if (allowedRef.current && !allowedRef.current.has(pv)) return;
    if (pv[0] === 's') {
      const sv = +pv[1]; if (stageRef.current[i] === sv) return;
      if (burstRef.current) { burstRef.current.count++; burstRef.current.last = i; }
      setStage((prev) => { const n = prev.slice(); n[i] = sv; return n; });
    } else {
      const qv = +pv[1]; if (qcRef.current[i] === qv) return;
      if (burstRef.current) { burstRef.current.count++; burstRef.current.last = i; }
      setQc((prev) => { const n = prev.slice(); n[i] = qv; return n; });
    }
    stampIndex(i);
  };
  const paintAt = useCallback((cx, cy) => { const el = document.elementFromPoint(cx, cy); if (el && el.dataset && el.dataset.i != null) applyPaintToIndex(+el.dataset.i); }, []);
  const fillAt = (i) => {
    const pv = paintRef.current; if (allowedRef.current && !allowedRef.current.has(pv)) return;
    snapshotUndo();
    const secs = sectionsRef.current; const sec = secs ? secs[i] : null;
    const isStage = pv[0] === 's'; const v = +pv[1]; const t = Date.now();
    const inSec = (j) => (secs ? secs[j] === sec : true);
    if (isStage) setStage((prev) => prev.map((x, j) => (inSec(j) ? v : x)));
    else setQc((prev) => prev.map((x, j) => (inSec(j) ? v : x)));
    setAt((prev) => prev.map((x, j) => (inSec(j) ? t : x)));
    setBy((prev) => prev.map((x, j) => (inSec(j) ? userName : x)));
    const label = isStage ? STAGES[v].name : QC[v].name;
    pushLog(`filled ${secs ? 'section ' + (sec + 1) : 'all points'} → "${label}"`);
  };
  const burstFlush = () => {
    const b = burstRef.current; burstRef.current = null;
    if (!b || b.count === 0) return;
    const pv = b.paint; const isStage = pv[0] === 's'; const v = +pv[1];
    const label = isStage ? STAGES[v].name : QC[v].name;
    pushLog(`set ${b.count} point${b.count !== 1 ? 's' : ''} → "${label}"`);
    if (pv === 'q2' && b.count === 1 && b.last != null) setNotePt(b.last); // single flag → add note
  };

  /* ---- cloud sync ---- */
  const [cloudStatus, setCloudStatus] = useState('local');
  const syncedIdsRef = useRef(new Set());
  const lastRevRef = useRef(-1);
  const applyingRemoteRef = useRef(false);
  const readyRef = useRef(false);
  const pushTimerRef = useRef(null);
  const applyRemote = useCallback((d) => {
    applyingRemoteRef.current = true;
    const nd = normalizeDoc(d);
    const curPts = pointsRef.current;
    const sameLayout = Array.isArray(curPts) && Array.isArray(d.points) && d.points.length === curPts.length && curPts.length > 0;
    if (Array.isArray(d.points) && d.points.length && !sameLayout) {
      // different point layout → take remote wholesale
      setPoints(nd.points); setPlanW(nd.w); setPlanH(nd.h); setSections(nd.sections); setSectionCount(nd.sectionCount);
      setStage(nd.stage); setQc(nd.qc); setBy(nd.by); setAt(nd.at);
    } else {
      // per-point merge: take remote point only when its timestamp is newer
      const cs = stageRef.current, cq = qcRef.current, cb = byRef.current, ca = atRef.current;
      const N = nd.points.length; let changed = false;
      const ns = cs.slice(), nq = cq.slice(), nb = cb.slice(), na = ca.slice();
      for (let i = 0; i < N; i++) { const ra = nd.at[i] || 0; if (ra > (na[i] || 0)) { ns[i] = nd.stage[i]; nq[i] = nd.qc[i]; nb[i] = nd.by[i]; na[i] = ra; changed = true; } }
      if (changed) { setStage(ns); setQc(nq); setBy(nb); setAt(na); }
    }
    if ((d.lastModified || 0) > (lastModifiedRef.current || 0)) {
      if (d.name) setProjName(d.name);
      setNotes(nd.notes);
      setLastModified(d.lastModified);
    }
    if ((d.bgT || 0) > (bgTRef.current || 0)) { setBg(nd.bg); setBgT(d.bgT || 0); setBgOn(!!(nd.bg && nd.bg.on)); }
    if (d.overlay3d !== undefined) setOverlay3d(d.overlay3d || null);
    if (Array.isArray(d.log)) { setLog((local) => mergeLogs(local, d.log)); d.log.forEach((e) => syncedIdsRef.current.add(e.id)); }
    lastRevRef.current = d.rev;
    setTimeout(() => { applyingRemoteRef.current = false; }, 0);
  }, []);
  const pushCloud = useCallback(async () => {
    const id = activeIdRef.current;
    const entries = logRef.current.filter((e) => !syncedIdsRef.current.has(e.id));
    try {
      setCloudStatus('syncing');
      const body = { name: projNameRef.current, points: pointsRef.current, w: planWRef.current, h: planHRef.current, sections: sectionsRef.current, sectionCount: sectionCountRef.current, stage: stageRef.current, qc: qcRef.current, by: byRef.current, at: atRef.current, notes: notesRef.current, bg: bgRef.current, bgT: bgTRef.current, overlay3d: overlay3dRef.current, lastModified: lastModifiedRef.current, entries };
      const r = await fetch(ENDPOINT + '?project=' + encodeURIComponent(id), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error('http ' + r.status);
      const d = await r.json();
      entries.forEach((e) => syncedIdsRef.current.add(e.id)); lastRevRef.current = d.rev;
      if (Array.isArray(d.log)) { applyingRemoteRef.current = true; setLog((local) => mergeLogs(local, d.log)); d.log.forEach((e) => syncedIdsRef.current.add(e.id)); setTimeout(() => { applyingRemoteRef.current = false; }, 0); }
      setCloudStatus('synced');
    } catch (e) { setCloudStatus('offline'); }
  }, []);
  useEffect(() => {
    let alive = true; readyRef.current = false; lastRevRef.current = -1; syncedIdsRef.current = new Set(); setCloudStatus('local');
    const id = activeId;
    const pull = async (initial) => {
      try {
        const r = await fetch(ENDPOINT + '?project=' + encodeURIComponent(id), { cache: 'no-store' });
        if (!r.ok) throw new Error('http ' + r.status); const d = await r.json();
        if (!alive || activeIdRef.current !== id) return;
        if (initial && (!d || !Array.isArray(d.points) || !d.points.length)) { readyRef.current = true; await pushCloud(); return; }
        if (d.rev !== lastRevRef.current) applyRemote(d);
        setCloudStatus('synced'); readyRef.current = true;
      } catch (e) { if (alive && initial) { setCloudStatus('offline'); readyRef.current = true; } }
    };
    pull(true); const t = setInterval(() => pull(false), 6000);
    return () => { alive = false; clearInterval(t); };
  }, [activeId, applyRemote, pushCloud]);
  useEffect(() => {
    if (!readyRef.current || applyingRemoteRef.current) return;
    clearTimeout(pushTimerRef.current); pushTimerRef.current = setTimeout(() => { pushCloud(); }, 1000);
  }, [stage, qc, at, notes, bg, bgT, overlay3d, log, projName, points, pushCloud]);
  // redact legacy name
  useEffect(() => { if (/dwyer/i.test(projName || '')) { setProjName('Project Alpha'); setProjects((ps) => ps.map((p) => p.id === activeId ? { ...p, name: 'Project Alpha' } : p)); setLastModified(Date.now()); } }, [projName, activeId]);

  /* ---- logo for export ---- */
  const logoRef = useRef(null);
  useEffect(() => { const img = new Image(); img.onload = () => { try { const S = 256; const c = document.createElement('canvas'); c.width = S; c.height = Math.round(S * img.height / img.width); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); logoRef.current = { url: c.toDataURL('image/png'), w: c.width, h: c.height }; } catch (e) {} }; img.src = LOGO_URL; }, []);

  /* ---- pan / zoom ---- */
  const [vw, setVw] = useState({ s: 1, x: 0, y: 0 });
  const vwRef = useRef(vw); useEffect(() => { vwRef.current = vw; }, [vw]);
  const svgRef = useRef(null);
  const PAD = 16; const VW = planW + PAD * 2; const VH = planH + PAD * 2;
  const toView = useCallback((cx, cy) => { const el = svgRef.current; if (!el) return { x: 0, y: 0 }; const r = el.getBoundingClientRect(); if (!r.width || !r.height) return { x: 0, y: 0 }; return { x: (cx - r.left) / r.width * VW, y: (cy - r.top) / r.height * VH }; }, [VW, VH]);
  const clampView = useCallback((v) => { let s = isFinite(v.s) ? v.s : 1; s = Math.min(28, Math.max(1, s)); let x = isFinite(v.x) ? v.x : 0, y = isFinite(v.y) ? v.y : 0; x = Math.min(0, Math.max(VW * (1 - s), x)); y = Math.min(0, Math.max(VH * (1 - s), y)); return { s, x, y }; }, [VW, VH]);
  const zoomAt = useCallback((px, py, f) => { setVw((v) => { const ns = Math.min(28, Math.max(1, v.s * f)); const wx = (px - v.x) / v.s, wy = (py - v.y) / v.s; return clampView({ s: ns, x: px - wx * ns, y: py - wy * ns }); }); }, [clampView]);
  const onWheel = useCallback((e) => { e.preventDefault(); const p = toView(e.clientX, e.clientY); zoomAt(p.x, p.y, e.deltaY < 0 ? 1.15 : 1 / 1.15); }, [toView, zoomAt]);
  useEffect(() => { const svg = svgRef.current; if (!svg) return; svg.addEventListener('wheel', onWheel, { passive: false }); return () => svg.removeEventListener('wheel', onWheel); }, [onWheel, view]);
  const pointersRef = useRef(new Map()); const panRef = useRef(null); const pinchRef = useRef(null); const pannedRef = useRef(false); const bgDragRef = useRef(null);
  const onPointerDown = (e) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) { paintingRef.current = false; panRef.current = null; bgDragRef.current = null; const pts = [...pointersRef.current.values()]; const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y); const midC = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }; pinchRef.current = { dist, mid: toView(midC.x, midC.y), s0: vwRef.current.s, x0: vwRef.current.x, y0: vwRef.current.y }; return; }
    const m = modeRef.current;
    if (m === 'bg') { if (bgRef.current) { const p = toView(e.clientX, e.clientY); bgDragRef.current = { sx: p.x, sy: p.y, x0: bgRef.current.x, y0: bgRef.current.y }; } }
    else if (m === 'brush') { snapshotUndo(); paintingRef.current = true; burstRef.current = { count: 0, paint: paintRef.current, last: null }; paintAt(e.clientX, e.clientY); }
    else if (m === 'fill') { const el = document.elementFromPoint(e.clientX, e.clientY); if (el && el.dataset && el.dataset.i != null) fillAt(+el.dataset.i); }
    else { const p = toView(e.clientX, e.clientY); panRef.current = { sx: p.x, sy: p.y, vx: vwRef.current.x, vy: vwRef.current.y }; pannedRef.current = false; }
  };
  const onPointerMove = (e) => {
    if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchRef.current && pointersRef.current.size >= 2) { const pts = [...pointersRef.current.values()]; const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y); const ratio = dist / (pinchRef.current.dist || 1); const ns = Math.min(28, Math.max(1, pinchRef.current.s0 * ratio)); const { mid, s0, x0, y0 } = pinchRef.current; const wx = (mid.x - x0) / s0, wy = (mid.y - y0) / s0; setVw(clampView({ s: ns, x: mid.x - wx * ns, y: mid.y - wy * ns })); return; }
    if (bgDragRef.current && pointersRef.current.size < 2) { const bd = bgDragRef.current; const b = bgRef.current; if (b) { const p = toView(e.clientX, e.clientY); setBg({ ...b, x: bd.x0 + (p.x - bd.sx), y: bd.y0 + (p.y - bd.sy) }); } return; }
    if (panRef.current) { const pr = panRef.current; pannedRef.current = true; const p = toView(e.clientX, e.clientY); setVw((v) => clampView({ ...v, x: pr.vx + (p.x - pr.sx), y: pr.vy + (p.y - pr.sy) })); }
  };
  const endPointer = (e) => { pointersRef.current.delete(e.pointerId); if (pointersRef.current.size < 2) pinchRef.current = null; if (pointersRef.current.size === 0) { paintingRef.current = false; panRef.current = null; if (bgDragRef.current) { bgDragRef.current = null; setBgT(Date.now()); } } };
  useEffect(() => {
    const mv = (e) => { if (paintingRef.current && modeRef.current === 'brush' && pointersRef.current.size < 2) paintAt(e.clientX, e.clientY); };
    const up = () => { if (paintingRef.current) { paintingRef.current = false; burstFlush(); } if (bgDragRef.current) { bgDragRef.current = null; setBgT(Date.now()); } };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, [paintAt]);
  const resetView = () => setVw({ s: 1, x: 0, y: 0 });
  const zoomB = (f) => zoomAt(VW / 2, VH / 2, f);

  /* ---- project ops ---- */
  const openProject = (id) => {
    const d = loadDoc(id); skipPersist.current = true;
    setProjName(d.name); setPoints(d.points); setPlanW(d.w); setPlanH(d.h); setSections(d.sections); setSectionCount(d.sectionCount);
    setStage(d.stage); setQc(d.qc); setBy(d.by); setAt(d.at); setNotes(d.notes); setBg(d.bg); setBgT(d.bgT); setBgOn(!!(d.bg && d.bg.on)); setOverlay3d(d.overlay3d || null); setLog(d.log); setLastModified(d.lastModified);
    undoRef.current = []; setCanUndo(false); modelBufRef.current = null; setActiveId(id); resetView(); setView('tracker'); setProjOpen(false); setSheetOpen(false);
  };
  const renameProject = (id, name) => { setProjects((ps) => { const next = ps.map((p) => p.id === id ? { ...p, name } : p); fetch(ENDPOINT + '?registry=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projects: next }) }).catch(() => {}); return next; }); if (id === activeId) setProjName(name); else { const d = storage.get(projKey(id)); if (d) storage.set(projKey(id), { ...d, name }); } };
  const deleteProject = (id) => {
    if (projects.length <= 1) { window.alert('At least one project is required.'); return; }
    const p = projects.find((x) => x.id === id);
    if (!window.confirm('Delete project "' + (p ? p.name : id) + '" and all its data?')) return;
    const next = projects.filter((x) => x.id !== id); setProjects(next);
    fetch(ENDPOINT + '?registry=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projects: next }) }).catch(() => {});
    try { localStorage.removeItem(projKey(id)); } catch (e) {}
    if (id === activeId) openProject(next[0].id);
  };
  const createProject = (name, imp) => {
    const id = newProjId(); const N = imp.points.length;
    const doc = { name: name || 'New Project', w: imp.w, h: imp.h, points: imp.points, sections: imp.sectionCount > 1 ? imp.sections : null, sectionCount: imp.sectionCount > 1 ? imp.sectionCount : 0, stage: new Array(N).fill(0), qc: new Array(N).fill(0), by: new Array(N).fill(''), at: new Array(N).fill(0), notes: {}, bg: null, bgT: 0, log: [{ id: 'h' + Date.now(), ts: Date.now(), user: userName, summary: `created project from import (${imp.count} points${imp.sectionCount > 1 ? ', ' + imp.sectionCount + ' sections' : ''})`, stage: encNums(new Array(N).fill(0)), qc: encNums(new Array(N).fill(0)), notes: {} }], lastModified: Date.now() };
    storage.set(projKey(id), doc);
    const next = [...projects, { id, name: doc.name, createdAt: Date.now() }]; setProjects(next);
    fetch(ENDPOINT + '?registry=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projects: next }) }).catch(() => {});
    setImportOpen(false); openProject(id);
  };

  /* ---- export / history ---- */
  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    let overhead = null;
    if (modelBufRef.current) { setExporting(true); try { overhead = await renderOverheadPNG(modelBufRef.current); } catch (e) {} setExporting(false); }
    exportPDF(projName, points, planW, planH, stage, qc, notes, lastModified, userName, logoRef.current, overhead);
    pushLog('exported PDF' + (overhead ? ' (with model overhead)' : ''));
  };
  const restoreEntry = (entry) => {
    if (!window.confirm('Restore version from ' + fmtDate(entry.ts) + ' (by ' + entry.user + ')?')) return;
    snapshotUndo();
    setStage(decNums(entry.stage, TOTAL)); setQc(decNums(entry.qc, TOTAL)); setNotes(entry.notes || {});
    pushLog('restored version from ' + fmtDate(entry.ts)); setHistoryOpen(false);
  };

  /* ---- save note ---- */
  const saveNote = (i, text) => { snapshotUndo(); setNotes((n) => { const x = { ...n }; if (text && text.trim()) x[i] = text.trim(); else delete x[i]; return x; }); pushLog(`note on point #${i + 1}`); };

  /* ---- background photo ---- */
  const [bgBusy, setBgBusy] = useState(false);
  const onBgUpload = async (file) => {
    if (!file) return; setBgBusy(true);
    try { const { url, ar } = await scaleImage(file, 1600, 0.82); const h = planW * ar; setBg({ url, x: 0, y: (planH - h) / 2, scale: 1, ar, opacity: 0.85, on: true }); setBgT(Date.now()); setBgOn(true); pushLog('updated background photo'); }
    catch (e) { window.alert('Could not load that image.'); }
    setBgBusy(false); if (mode === 'bg') setMode('brush');
  };
  const toggleBg = () => { if (!bg) { setBgOn((v) => !v); return; } const nv = !bgOn; setBgOn(nv); setBg({ ...bg, on: nv }); setBgT(Date.now()); };
  const setBgScale = (s) => { if (!bg) return; const old = bgDims(bg, planW); const cx = bg.x + old.w / 2, cy = bg.y + old.h / 2; const nb = { ...bg, scale: s }; const nd = bgDims(nb, planW); nb.x = cx - nd.w / 2; nb.y = cy - nd.h / 2; setBg(nb); setBgT(Date.now()); };
  const setBgOpacity = (o) => { if (!bg) return; setBg({ ...bg, opacity: o }); setBgT(Date.now()); };
  const removeBg = () => { if (!bg) return; if (!window.confirm('Remove the background photo?')) return; setBg(null); setBgT(Date.now()); setBgOn(false); if (mode === 'bg') setMode('brush'); pushLog('removed background photo'); };

  /* keep paint tool within the user's allowed tasks */
  useEffect(() => {
    if (!allowed) return;
    if (!allowed.has(paint)) { const order = ['s1', 's2', 's3', 's4', 'q1', 'q2', 's0', 'q0']; setPaint(order.find((t) => allowed.has(t)) || 's0'); }
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- dots ---- */
  const dotEls = useMemo(() => points.map((d, i) => (
    <circle key={i} data-i={i} cx={d[0] + PAD} cy={d[1] + PAD} r={4.1} fill={dispColor(stage[i], qc[i])} stroke={stage[i] === 0 && !qc[i] ? 'rgba(180,185,200,.45)' : 'rgba(2,3,10,.55)'} strokeWidth={0.45} />
  )), [points, stage, qc]);

  const cloudLabel = cloudStatus === 'synced' ? 'Synced to cloud (shared)' : cloudStatus === 'syncing' ? 'Syncing…' : cloudStatus === 'offline' ? 'Offline — saved on device' : 'Connecting…';
  const cloudColor = cloudStatus === 'synced' ? '#22c55e' : cloudStatus === 'offline' ? GOLD : MUTE;
  const paintLabel = paint[0] === 's' ? STAGES[+paint[1]].name : QC[+paint[1]].name;
  const paintColor = paint[0] === 's' ? STAGES[+paint[1]].color : QC[+paint[1]].color;

  /* per-section completion */
  const sectionStats = useMemo(() => {
    if (!sections || sectionCount < 2) return null;
    const arr = Array.from({ length: sectionCount }, () => ({ total: 0, sum: 0 }));
    for (let i = 0; i < points.length; i++) { const s = sections[i]; if (s == null || !arr[s]) continue; arr[s].total++; arr[s].sum += stage[i] || 0; }
    return arr.map((a, i) => ({ i, total: a.total, pct: a.total ? a.sum / (a.total * 4) * 100 : 0 }));
  }, [sections, sectionCount, stage, points]);

  const isAllowed = (tok) => !allowed || allowed.has(tok);
  const canEditQC = isAllowed('q2');
  const legendBody = (
    <>
      {allowed && <div style={{ fontFamily: NBF, fontSize: 12, color: GOLD, background: 'rgba(234,179,8,.08)', border: '1px solid rgba(234,179,8,.3)', padding: '7px 10px' }}>You're assigned to: {(scopeForActive || []).map((t) => (TASK_DEFS.find((x) => x.id === t) || {}).label).filter(Boolean).join(', ') || 'view only'}.</div>}
      <div style={card()}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={kicker}>Overall Completion</span>
          <span style={{ fontFamily: BBF, fontSize: 34, color: GOLD, lineHeight: .9, textShadow: '0 0 22px rgba(234,179,8,.4)' }}>{stats.overall.toFixed(1)}%</span>
        </div>
        <div style={bar}><div style={{ height: '100%', width: stats.overall + '%', background: 'linear-gradient(90deg,' + ORANGE + ',' + GOLD + ')', transition: 'width .25s' }} /></div>
        <div style={{ fontFamily: NBF, fontSize: 12, color: MUTE, marginTop: 7 }}>{TOTAL.toLocaleString()} points{sectionCount > 1 ? ' · ' + sectionCount + ' sections' : ''} · {fmtDate(lastModified)}</div>
        <div style={{ fontFamily: NBF, fontSize: 12, marginTop: 2, color: cloudColor, display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: cloudColor, boxShadow: '0 0 8px ' + cloudColor }} />{cloudLabel}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ ...kicker, color: ORANGE }}>Painting</span>
        <select value={paint} onChange={(e) => setPaint(e.target.value)} style={selectStyle}>
          {STAGES.some((s, i) => isAllowed('s' + i)) && (
            <optgroup label="Install Status">
              {STAGES.map((s, i) => (isAllowed('s' + i) ? <option key={i} value={'s' + i}>{s.name}</option> : null))}
            </optgroup>
          )}
          {(isAllowed('q1') || isAllowed('q2') || isAllowed('q0')) && (
            <optgroup label="Quality Check">
              {isAllowed('q1') && <option value="q1">Requires Attention (yellow)</option>}
              {isAllowed('q2') && <option value="q2">Flagged Issue (orange)</option>}
              {isAllowed('q0') && <option value="q0">Clear Flag</option>}
            </optgroup>
          )}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 7 }}>
        <button onClick={() => setMode('brush')} style={segBtn(mode === 'brush')}>Brush</button>
        <button onClick={() => setMode('fill')} style={segBtn(mode === 'fill')}>Fill {sectionCount > 1 ? 'Section' : 'All'}</button>
        <button onClick={() => setMode('pan')} style={segBtn(mode === 'pan')}>Pan</button>
      </div>
      <button onClick={undo} disabled={!canUndo} style={{ ...ghostBtn, opacity: canUndo ? 1 : .4 }}>&#8634; Undo</button>

      <div style={card()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={kicker}>Site Photo</span>
          {bg && <button onClick={toggleBg} style={{ ...miniBtn, color: bgOn ? '#22c55e' : MUTE, borderColor: bgOn ? '#22c55e' : 'rgba(255,255,255,.25)' }}>{bgOn ? 'On' : 'Off'}</button>}
        </div>
        {!bg ? (
          <label style={{ ...ghostBtn, display: 'block', textAlign: 'center', padding: '10px 0', cursor: bgBusy ? 'default' : 'pointer', opacity: bgBusy ? .6 : 1 }}>{bgBusy ? 'Loading…' : 'Add Background Photo'}<input type="file" accept="image/*" hidden disabled={bgBusy} onChange={(e) => onBgUpload(e.target.files[0])} /></label>
        ) : (<>
          <button onClick={() => { const nm = mode === 'bg' ? 'brush' : 'bg'; setMode(nm); if (nm === 'bg') setSheetOpen(false); }} style={{ ...segBtn(mode === 'bg'), width: '100%', marginBottom: 8 }}>{mode === 'bg' ? 'Done — drag map to move photo' : 'Align Photo'}</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><span style={{ fontFamily: NBF, fontSize: 12, color: MUTE, width: 52 }}>Size</span><input type="range" min="0.2" max="4" step="0.02" value={bg.scale || 1} onChange={(e) => setBgScale(+e.target.value)} style={{ flex: 1 }} /></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><span style={{ fontFamily: NBF, fontSize: 12, color: MUTE, width: 52 }}>Opacity</span><input type="range" min="0.1" max="1" step="0.05" value={bg.opacity != null ? bg.opacity : 0.85} onChange={(e) => setBgOpacity(+e.target.value)} style={{ flex: 1 }} /></div>
          <div style={{ display: 'flex', gap: 7 }}>
            <label style={{ ...ghostBtn, flex: 1, textAlign: 'center', padding: '8px 0', fontSize: 12, cursor: 'pointer' }}>Replace<input type="file" accept="image/*" hidden onChange={(e) => onBgUpload(e.target.files[0])} /></label>
            <button onClick={removeBg} style={{ ...ghostBtn, flex: 1, padding: '8px 0', fontSize: 12, color: '#f87171', borderColor: 'rgba(248,113,113,.5)' }}>Remove</button>
          </div>
        </>)}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <span style={kicker}>Install Status (cumulative)</span>
        {STAGES.slice(1).map((s, i) => { const tok = 's' + (i + 1); const cnt = stats.cum[i + 1]; const p = TOTAL ? cnt / TOTAL * 100 : 0; const lock = !isAllowed(tok); return (
          <div key={i} style={{ ...statusRow(paint === tok && !lock), cursor: lock ? 'default' : 'pointer', opacity: lock ? .5 : 1 }} onClick={() => { if (!lock) setPaint(tok); }}>
            <span style={{ width: 16, height: 16, background: s.color, border: '1px solid rgba(255,255,255,.3)', flexShrink: 0, clipPath: CLIP }} />
            <span style={{ fontFamily: NBF, fontSize: 15, color: CREAM, flex: 1 }}>{s.name}</span>
            <span style={{ fontFamily: NBF, fontSize: 12, color: MUTE }}>{cnt.toLocaleString()}</span>
            <span style={{ fontFamily: BBF, fontSize: 18, color: s.color, width: 48, textAlign: 'right' }}>{p.toFixed(0)}%</span>
          </div>
        ); })}
        <span style={{ ...kicker, marginTop: 4 }}>Quality Checks</span>
        <div style={{ ...statusRow(paint === 'q1' && isAllowed('q1')), cursor: isAllowed('q1') ? 'pointer' : 'default', opacity: isAllowed('q1') ? 1 : .5 }} onClick={() => { if (isAllowed('q1')) setPaint('q1'); }}>
          <span style={{ width: 16, height: 16, background: QC_YELLOW, flexShrink: 0, clipPath: CLIP }} />
          <span style={{ fontFamily: NBF, fontSize: 15, color: CREAM, flex: 1 }}>Requires Attention</span>
          <span style={{ fontFamily: BBF, fontSize: 18, color: QC_YELLOW }}>{stats.yellow}</span>
        </div>
        <div style={{ ...statusRow(paint === 'q2' && isAllowed('q2')), cursor: isAllowed('q2') ? 'pointer' : 'default', opacity: isAllowed('q2') ? 1 : .5 }} onClick={() => { if (isAllowed('q2')) setPaint('q2'); }}>
          <span style={{ width: 16, height: 16, background: QC_ORANGE, flexShrink: 0, clipPath: CLIP }} />
          <span style={{ fontFamily: NBF, fontSize: 15, color: CREAM, flex: 1 }}>Flagged Issue</span>
          <span style={{ fontFamily: BBF, fontSize: 18, color: QC_ORANGE }}>{stats.orange}</span>
        </div>
        <div style={{ fontFamily: NBF, fontSize: 11, color: MUTE }}>Tap any point in Pan mode to see its status, who updated it, and notes.</div>
      </div>

      {sectionStats && (
        <div style={card()}>
          <div style={{ ...kicker, marginBottom: 8 }}>Sections ({sectionCount})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 150, overflowY: 'auto' }}>
            {sectionStats.map((s) => (<div key={s.i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ fontFamily: NBF, fontSize: 13, color: MUTE, width: 64, flexShrink: 0 }}>Block {s.i + 1}</span><div style={{ ...bar, flex: 1, marginTop: 0 }}><div style={{ height: '100%', width: s.pct + '%', background: GOLD }} /></div><span style={{ fontFamily: BBF, fontSize: 15, color: CREAM, width: 40, textAlign: 'right' }}>{s.pct.toFixed(0)}%</span></div>))}
          </div>
        </div>
      )}

      <button onClick={handleExport} style={ctaBtn}>{exporting ? 'Rendering…' : 'Export PDF'}</button>
      <button onClick={() => setModelsOpen(true)} style={ghostBtn}>3D Model / Versions</button>
      <button onClick={() => setHistoryOpen(true)} style={ghostBtn}>Edit History ({log.length})</button>
    </>
  );

  const sectionLabel = (txt) => (<div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: NBF, fontSize: 12, fontWeight: 700, letterSpacing: '3px', textTransform: 'uppercase', color: ORANGE }}><span style={{ width: 22, height: 2, background: ORANGE, display: 'inline-block' }} />{txt}</div>);

  const visibleProjects = (isAdmin || !assignedSet) ? projects : projects.filter((p) => assignedSet.has(p.id));

  /* ---- projects dashboard view ---- */
  if (view === 'dashboard') {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: `radial-gradient(120% 80% at 50% -10%, #14182a 0%, ${INK} 55%, ${INK2} 100%)`, display: 'flex', flexDirection: 'column', fontFamily: NBF, color: CREAM, overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: mob ? '10px 12px' : '12px 22px', background: 'rgba(4,4,12,.85)', backdropFilter: 'blur(14px)', borderBottom: '1px solid ' + LINE }}>
          {onExit && <button onClick={onExit} style={backBtn}>&#8592;</button>}
          <img src={LOGO_URL} alt="SRC" style={{ width: mob ? 30 : 38, height: mob ? 30 : 38, objectFit: 'contain', borderRadius: 4 }} />
          <div style={{ fontFamily: BBF, fontSize: mob ? 20 : 27, letterSpacing: 1.5, color: CREAM }}>TASK TRACKER <span style={{ color: ORANGE }}>— PROJECTS</span></div>
        </div>
        <div style={{ padding: mob ? 16 : 28, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
          {sectionLabel('Select a Project')}
          {visibleProjects.length === 0 && <div style={{ fontFamily: NBF, fontSize: 15, color: MUTE, marginTop: 16 }}>No projects have been assigned to you yet. Contact your administrator.</div>}
          <div style={{ display: 'grid', gridTemplateColumns: mob ? '1fr' : 'repeat(auto-fill,minmax(280px,1fr))', gap: 16, marginTop: 16 }}>
            {visibleProjects.map((pr) => {
              const d = normalizeDoc(storage.get(projKey(pr.id))); const s = computeStats(d.stage, d.qc);
              return (
                <div key={pr.id} onClick={() => openProject(pr.id)} style={{ cursor: 'pointer', background: 'rgba(255,255,255,.03)', border: '1px solid ' + LINE, padding: 16, transition: 'all .15s' }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = ORANGE; e.currentTarget.style.transform = 'translateY(-3px)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = LINE; e.currentTarget.style.transform = 'none'; }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <span style={{ fontFamily: BBF, fontSize: 24, color: CREAM, letterSpacing: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(pr.name || 'Project').toUpperCase()}</span>
                    <span style={{ fontFamily: BBF, fontSize: 28, color: GOLD }}>{s.overall.toFixed(0)}%</span>
                  </div>
                  <div style={{ display: 'flex', height: 8, marginTop: 10, overflow: 'hidden', borderRadius: 2, background: 'rgba(255,255,255,.06)' }}>
                    {STAGES.slice(1).map((stg, i) => <div key={i} style={{ width: (s.N ? (s.cum[i + 1] - (s.cum[i + 2] || 0)) / s.N * 100 : 0) + '%', background: stg.color }} />)}
                  </div>
                  <div style={{ fontFamily: NBF, fontSize: 12, color: MUTE, marginTop: 9 }}>{s.N.toLocaleString()} points{d.lastModified ? ' · ' + new Date(d.lastModified).toLocaleDateString() : ''}{s.orange ? ' · ' : ''}{s.orange ? <span style={{ color: QC_ORANGE }}>{s.orange} flagged</span> : null}</div>
                </div>
              );
            })}
            {isAdmin && <div onClick={() => setImportOpen(true)} style={{ cursor: 'pointer', border: '1px dashed rgba(249,115,22,.5)', padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 110, color: ORANGE, fontFamily: NBF, fontSize: 16, letterSpacing: 1, textTransform: 'uppercase' }}>+ New Project (Import)</div>}
          </div>
        </div>
        {importOpen && <ImportModal mob={mob} onClose={() => setImportOpen(false)} onCreate={createProject} />}
      </div>
    );
  }

  /* ---- tracker view ---- */
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: `radial-gradient(120% 80% at 50% -10%, #14182a 0%, ${INK} 55%, ${INK2} 100%)`, display: 'flex', flexDirection: 'column', fontFamily: NBF, color: CREAM }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: mob ? 8 : 12, padding: mob ? '9px 12px' : '12px 22px', background: 'rgba(4,4,12,.85)', backdropFilter: 'blur(14px)', borderBottom: '1px solid ' + LINE }}>
        <button onClick={() => setView('dashboard')} style={backBtn} title="Back to projects">&#8592;</button>
        <img src={LOGO_URL} alt="SRC" style={{ width: mob ? 28 : 36, height: mob ? 28 : 36, objectFit: 'contain', borderRadius: 4 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: BBF, fontSize: mob ? 17 : 24, letterSpacing: 1.2, color: CREAM, lineHeight: .95 }}>TASK TRACKER</div>
          <button onClick={() => setProjOpen(true)} style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, maxWidth: mob ? 150 : 260 }}>
            <span style={{ fontFamily: NBF, fontSize: mob ? 12 : 13, letterSpacing: 1.5, color: ORANGE, textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{projName}</span><span style={{ color: ORANGE, fontSize: 10 }}>&#9662;</span>
          </button>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: mob ? 8 : 14 }}>
          <div style={{ textAlign: 'right', lineHeight: 1 }}><div style={{ fontFamily: BBF, fontSize: mob ? 22 : 30, color: GOLD, textShadow: '0 0 18px rgba(234,179,8,.4)' }}>{stats.overall.toFixed(0)}%</div>{!mob && <div style={{ fontFamily: NBF, fontSize: 9, letterSpacing: 2, color: MUTE, textTransform: 'uppercase' }}>Complete</div>}</div>
          {!mob && <button onClick={handleExport} style={ctaBtn}>Export PDF</button>}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {!mob && (
          <div style={{ width: 340, flexShrink: 0, background: PANEL, borderRight: '1px solid ' + LINE, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {sectionLabel('Status Legend')}
            {legendBody}
          </div>
        )}
        <div style={{ flex: 1, position: 'relative', minWidth: 0, background: 'radial-gradient(110% 90% at 50% 0%, #0e1426 0%, #080b16 60%, #05060d 100%)' }}>
          <svg ref={svgRef} viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: mode === 'pan' ? 'grab' : mode === 'bg' ? 'move' : 'crosshair' }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endPointer} onPointerCancel={endPointer}
            onClick={(e) => { if (modeRef.current !== 'pan' || pannedRef.current) { pannedRef.current = false; return; } const el = e.target; if (el && el.dataset && el.dataset.i != null) setNotePt(+el.dataset.i); }}>
            <g transform={`translate(${vw.x} ${vw.y}) scale(${vw.s})`}>
              {bg && bgOn && <image href={bg.url} x={bg.x + PAD} y={bg.y + PAD} width={bgDims(bg, planW).w} height={bgDims(bg, planW).h} opacity={bg.opacity != null ? bg.opacity : 0.85} preserveAspectRatio="none" style={{ pointerEvents: 'none' }} />}
              {bg && bgOn && mode === 'bg' && <rect x={bg.x + PAD} y={bg.y + PAD} width={bgDims(bg, planW).w} height={bgDims(bg, planW).h} fill="none" stroke={ORANGE} strokeWidth={1.5 / vw.s} strokeDasharray={`${6 / vw.s} ${4 / vw.s}`} style={{ pointerEvents: 'none' }} />}
              {dotEls}
            </g>
          </svg>
          <div style={{ position: 'absolute', bottom: mob ? 86 : 18, right: 14, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
            <button onClick={() => zoomB(1.3)} style={zbtn}>+</button>
            <span style={{ fontFamily: BBF, fontSize: 13, color: CREAM, background: 'rgba(4,4,12,.75)', border: '1px solid ' + LINE, padding: '1px 5px', minWidth: 34, textAlign: 'center' }}>{Math.round(vw.s * 100)}%</span>
            <button onClick={() => zoomB(1 / 1.3)} style={zbtn}>&minus;</button>
            <button onClick={resetView} style={{ ...zbtn, fontSize: 12, fontFamily: NBF }} title="Fit">FIT</button>
          </div>
        </div>
      </div>

      {mob && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'rgba(4,4,12,.92)', borderTop: '1px solid ' + LINE }}>
          <button onClick={() => setSheetOpen(true)} style={{ ...ctaBtn, padding: '9px 14px' }}>Status &#9650;</button>
          <div onClick={() => setSheetOpen(true)} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, cursor: 'pointer' }}>
            <span style={{ width: 18, height: 18, background: paintColor, flexShrink: 0, border: '1px solid rgba(255,255,255,.4)', clipPath: CLIP }} />
            <span style={{ fontFamily: NBF, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 15 }}>{paintLabel}</span>
          </div>
          <button onClick={undo} disabled={!canUndo} style={{ ...ghostBtn, padding: '9px 11px', opacity: canUndo ? 1 : .4 }}>&#8634;</button>
          <button onClick={() => setMode(mode === 'brush' ? 'fill' : mode === 'fill' ? 'pan' : 'brush')} style={{ ...ghostBtn, padding: '9px 11px' }}>{mode === 'brush' ? 'Brush' : mode === 'fill' ? 'Fill' : 'Pan'}</button>
        </div>
      )}

      {mob && sheetOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2100, background: 'rgba(0,0,0,.55)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }} onClick={() => setSheetOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: `linear-gradient(180deg,#0d0f1c, ${INK})`, borderTop: '2px solid ' + ORANGE, borderRadius: '18px 18px 0 0', padding: 16, maxHeight: '85vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>{sectionLabel('Status Legend')}<button onClick={() => setSheetOpen(false)} style={{ ...xBtn, marginLeft: 'auto' }}>&times;</button></div>
            {legendBody}
            <button onClick={() => setSheetOpen(false)} style={{ ...ctaBtn, padding: '13px 0' }}>Done</button>
          </div>
        </div>
      )}

      {historyOpen && (
        <div style={overlay(mob)} onClick={() => setHistoryOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={modalCard(mob, 520)}>
            <div style={{ display: 'flex', alignItems: 'center' }}><div style={headTitle}>Edit History</div><button onClick={() => setHistoryOpen(false)} style={{ ...xBtn, marginLeft: 'auto' }}>&times;</button></div>
            {log.length === 0 && <div style={{ color: MUTE, fontFamily: NBF, fontSize: 15, padding: '12px 0' }}>No edits yet.</div>}
            {log.map((e) => (
              <div key={e.id} style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(249,115,22,.15)', padding: 11, display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontFamily: NBF, fontSize: 16, color: CREAM, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.summary}</div><div style={{ fontFamily: NBF, fontSize: 12, color: MUTE }}><span style={{ color: ORANGE }}>{e.user}</span> · {fmtDate(e.ts)}</div></div>
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
                <button onClick={() => openProject(p.id)} style={{ ...ctaBtn, padding: '6px 12px', fontSize: 12, boxShadow: 'none' }}>Open</button>
                {projects.length > 1 && <button onClick={() => deleteProject(p.id)} style={{ background: 'transparent', border: 'none', color: MUTE, fontSize: 20, cursor: 'pointer' }}>&times;</button>}
              </div>
            ))}
            <button onClick={() => { setProjOpen(false); setImportOpen(true); }} style={{ ...ctaBtn, padding: '12px 0' }}>+ New Project (Import)</button>
          </div>
        </div>
      )}

      {notePt != null && (
        <div style={overlay(mob)} onClick={() => setNotePt(null)}>
          <div onClick={(e) => e.stopPropagation()} style={modalCard(mob, 420)}>
            <div style={{ display: 'flex', alignItems: 'center' }}><div style={headTitle}>Point #{notePt + 1}</div><button onClick={() => setNotePt(null)} style={{ ...xBtn, marginLeft: 'auto' }}>&times;</button></div>
            <div style={{ fontFamily: NBF, fontSize: 13, color: MUTE }}>Status: {STAGES[stage[notePt]].name}{qc[notePt] ? ' · ' + (qc[notePt] === 2 ? 'Flagged Issue' : 'Requires Attention') : ''}</div>
            {at[notePt] ? <div style={{ fontFamily: NBF, fontSize: 13, color: MUTE }}>Last updated by <span style={{ color: ORANGE }}>{by[notePt] || 'Unknown'}</span> · {fmtDate(at[notePt])}</div> : <div style={{ fontFamily: NBF, fontSize: 13, color: MUTE }}>No updates recorded yet.</div>}
            {canEditQC ? (<>
              <textarea id="tt-note" defaultValue={notes[notePt] || ''} placeholder="Describe the issue at this point…" style={{ width: '100%', minHeight: 110, background: 'rgba(255,255,255,.05)', border: '1px solid ' + LINE, color: CREAM, fontFamily: NBF, fontSize: 15, padding: 10, outline: 'none', resize: 'vertical' }} />
              <button onClick={() => { const v = document.getElementById('tt-note').value; saveNote(notePt, v); setNotePt(null); }} style={{ ...ctaBtn, padding: '11px 0' }}>Save Note</button>
            </>) : (
              notes[notePt] ? <div style={{ fontFamily: NBF, fontSize: 15, color: CREAM, background: 'rgba(255,255,255,.05)', border: '1px solid ' + LINE, padding: 10 }}>{notes[notePt]}</div> : <div style={{ fontFamily: NBF, fontSize: 13, color: MUTE }}>No note on this point.</div>
            )}
          </div>
        </div>
      )}

      {importOpen && <ImportModal mob={mob} onClose={() => setImportOpen(false)} onCreate={createProject} />}
      {modelsOpen && <ModelsModal mob={mob} projectId={activeId} projName={projName} onClose={() => setModelsOpen(false)} onActiveModel={(buf) => { modelBufRef.current = buf; }} points={points} planW={planW} planH={planH} stage={stage} qc={qc} overlay3d={overlay3d} onApplyPaint={(i) => { snapshotUndo(); burstRef.current = { count: 0, paint: paintRef.current, last: null }; applyPaintToIndex(i); burstFlush(); }} onSaveOverlay={(ov) => { setOverlay3d(ov); setLastModified(Date.now()); pushLog(ov.on ? (ov.locked ? 'locked 3D overlay alignment' : 'updated 3D overlay alignment') : 'hid 3D overlay'); }} paintLabel={paintLabel} paintColor={paintColor} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  3D Models modal (upload + dated version history + viewer)          */
/* ------------------------------------------------------------------ */
function ModelsModal({ mob, projectId, projName, onClose, onActiveModel, points, planW, planH, stage, qc, overlay3d, onApplyPaint, onSaveOverlay, paintLabel, paintColor }) {
  const [models, setModels] = useState([]);
  const [buf, setBuf] = useState(null);
  const [curId, setCurId] = useState(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  // overlay state (working copy; saved via onSaveOverlay)
  const DEFAULT_OV = { on: false, locked: false, x: 0, y: 0, scale: 1, opacity: 0.85 };
  const [ov, setOv] = useState(() => Object.assign({}, DEFAULT_OV, overlay3d || {}));
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setOv(Object.assign({}, DEFAULT_OV, overlay3d || {})); setDirty(false); }, [overlay3d]);
  const dragRef = useRef(null);
  const containerRef = useRef(null);

  const refresh = useCallback(async () => {
    try { const r = await fetch(MODELS_ENDPOINT + '?project=' + encodeURIComponent(projectId) + '&list=1', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); setModels(j.models || []); } } catch (e) {}
  }, [projectId]);
  useEffect(() => { refresh(); }, [refresh]);

  const viewModel = async (m) => {
    setCurId(m.id); setStatus('Loading ' + (m.name || 'model') + '…'); setBusy(true);
    try {
      const parts = [];
      for (let i = 0; i < m.chunks; i++) { const r = await fetch(MODELS_ENDPOINT + '?project=' + encodeURIComponent(projectId) + '&chunk=1&model=' + encodeURIComponent(m.id) + '&index=' + i, { cache: 'no-store' }); if (!r.ok) throw new Error('chunk ' + i); const j = await r.json(); parts.push(b64ToBytes(j.data)); }
      const total = parts.reduce((s, p) => s + p.length, 0); const out = new Uint8Array(total); let off = 0; for (const p of parts) { out.set(p, off); off += p.length; }
      const ab = out.buffer; setBuf(ab); onActiveModel(ab); setStatus('');
    } catch (e) { setStatus('Could not load model (cloud unavailable).'); }
    setBusy(false);
  };

  const onUpload = async (file) => {
    if (!file) return;
    setBusy(true); setStatus('Reading…');
    const modelId = 'm_' + Date.now();
    try {
      const ab = await file.arrayBuffer(); setBuf(ab); onActiveModel(ab); setCurId(modelId); // immediate local view
      const chunks = Math.max(1, Math.ceil(file.size / MODEL_CHUNK));
      for (let i = 0; i < chunks; i++) {
        setStatus('Uploading ' + (i + 1) + '/' + chunks + '…');
        const b64 = await blobToB64(file.slice(i * MODEL_CHUNK, (i + 1) * MODEL_CHUNK));
        const r = await fetch(MODELS_ENDPOINT + '?project=' + encodeURIComponent(projectId) + '&chunk=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modelId, index: i, data: b64 }) });
        if (!r.ok) throw new Error('upload chunk ' + i);
      }
      const model = { id: modelId, name: file.name, ts: Date.now(), chunks, size: file.size, mime: file.type || 'model/gltf-binary' };
      const fr = await fetch(MODELS_ENDPOINT + '?project=' + encodeURIComponent(projectId) + '&finalize=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model }) });
      if (fr.ok) { const j = await fr.json(); setModels(j.models || []); setStatus('Uploaded ✓'); } else throw new Error('finalize');
    } catch (e) { setStatus('Saved locally for this session — cloud upload failed (large file or offline).'); refresh(); }
    setBusy(false);
  };

  return (
    <div style={overlay(mob)} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modalCard(mob, 760), padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid ' + LINE }}>
          <div style={headTitle}>3D Model — {projName}</div>
          <label style={{ ...ctaBtn, marginLeft: 'auto', padding: '9px 14px', fontSize: 12, cursor: busy ? 'default' : 'pointer', opacity: busy ? .6 : 1 }}>Upload GLB<input type="file" accept=".glb,.gltf,model/gltf-binary" hidden disabled={busy} onChange={(e) => onUpload(e.target.files[0])} /></label>
          <button onClick={onClose} style={{ ...xBtn, marginLeft: 10 }}>&times;</button>
        </div>
        <div style={{ display: 'flex', flexDirection: mob ? 'column' : 'row', minHeight: 0 }}>
          <div style={{ width: mob ? 'auto' : 240, flexShrink: 0, borderRight: mob ? 'none' : '1px solid ' + LINE, borderBottom: mob ? '1px solid ' + LINE : 'none', padding: 12, overflowY: 'auto', maxHeight: mob ? '30vh' : '60vh' }}>
            <div style={{ ...kicker, marginBottom: 8 }}>Version History ({models.length})</div>
            {models.length === 0 && <div style={{ fontFamily: NBF, fontSize: 13, color: MUTE }}>No models yet. Upload a GLB to start a dated version history.</div>}
            {models.map((m) => (
              <div key={m.id} onClick={() => viewModel(m)} style={{ padding: '8px 9px', marginBottom: 6, cursor: 'pointer', border: '1px solid ' + (curId === m.id ? ORANGE : 'rgba(255,255,255,.08)'), background: curId === m.id ? 'rgba(249,115,22,.10)' : 'rgba(255,255,255,.02)' }}>
                <div style={{ fontFamily: NBF, fontSize: 14, color: CREAM, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name || 'model.glb'}</div>
                <div style={{ fontFamily: NBF, fontSize: 11, color: MUTE }}>{fmtDate(m.ts)} · {(m.size / 1048576).toFixed(1)} MB</div>
              </div>
            ))}
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            {(() => {
              const H = mob ? 280 : 440;
              const PAD = 16; const VW = (planW || 1) + PAD * 2; const VH = (planH || 1) + PAD * 2;
              const onPtrDown = (e) => { if (!ov.on || ov.locked) return; const r = containerRef.current && containerRef.current.getBoundingClientRect(); if (!r) return; dragRef.current = { sx: e.clientX, sy: e.clientY, x0: ov.x, y0: ov.y, w: r.width, h: r.height }; e.preventDefault(); };
              const onPtrMove = (e) => { if (!dragRef.current) return; const d = dragRef.current; setOv((p) => Object.assign({}, p, { x: d.x0 + (e.clientX - d.sx), y: d.y0 + (e.clientY - d.sy) })); setDirty(true); };
              const onPtrUp = () => { dragRef.current = null; };
              const onDotClick = (i, e) => { if (!ov.on || !ov.locked || typeof onApplyPaint !== 'function') return; e.stopPropagation(); onApplyPaint(i); };
              const N = (points || []).length; const safeStage = stage || []; const safeQc = qc || [];
              return (
                <div ref={containerRef} style={{ position: 'relative', height: H, background: 'radial-gradient(circle at 50% 30%, #11203a, #06080f)' }} onPointerMove={onPtrMove} onPointerUp={onPtrUp} onPointerLeave={onPtrUp}>
                  {buf ? <ModelViewer arrayBuffer={buf} height={H} /> : <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTE, fontFamily: NBF, fontSize: 14 }}>Upload or select a model version to view</div>}
                  {ov.on && N > 0 && (
                    <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid meet" onPointerDown={onPtrDown} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: ov.locked ? 'none' : 'auto', cursor: ov.locked ? 'default' : 'move', opacity: ov.opacity != null ? ov.opacity : 0.85 }}>
                      <g transform={`translate(${ov.x} ${ov.y}) scale(${ov.scale})`}>
                        {(points || []).map((pt, i) => (
                          <circle key={i} data-i={i} cx={pt[0] + PAD} cy={pt[1] + PAD} r={4.5} fill={dispColor(safeStage[i] || 0, (safeQc[i] || 0))} stroke="rgba(2,3,10,.6)" strokeWidth={0.6} style={{ pointerEvents: ov.locked ? 'auto' : 'none', cursor: ov.locked ? 'crosshair' : 'default' }} onClick={(e) => onDotClick(i, e)} />
                        ))}
                      </g>
                    </svg>
                  )}
                  {ov.on && ov.locked && typeof onApplyPaint === 'function' && (
                    <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', alignItems: 'center', gap: 7, padding: '5px 10px', background: 'rgba(4,4,12,.78)', border: '1px solid ' + LINE, pointerEvents: 'none', backdropFilter: 'blur(6px)' }}>
                      <span style={{ width: 12, height: 12, background: paintColor || ORANGE, border: '1px solid rgba(255,255,255,.4)' }} />
                      <span style={{ fontFamily: NBF, fontSize: 11, color: CREAM, letterSpacing: 1, textTransform: 'uppercase' }}>Paint: {paintLabel || 'No tool'}</span>
                    </div>
                  )}
                </div>
              );
            })()}
            {/* overlay controls */}
            {buf && (points || []).length > 0 && (
              <div style={{ padding: '10px 12px', borderTop: '1px solid ' + LINE, background: 'rgba(255,255,255,.02)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: ov.on ? 8 : 0 }}>
                  <button onClick={() => { setOv((p) => Object.assign({}, p, { on: !p.on })); setDirty(true); }} style={{ ...ghostBtn, padding: '6px 12px', fontSize: 11, background: ov.on ? ORANGE : 'transparent', color: ov.on ? '#1a1206' : ORANGE }}>{ov.on ? '◉ Overlay On' : '○ Show Task Tracker Overlay'}</button>
                  {ov.on && <button onClick={() => { setOv((p) => Object.assign({}, p, { locked: !p.locked })); setDirty(true); }} style={{ ...ghostBtn, padding: '6px 12px', fontSize: 11, background: ov.locked ? GOLD : 'transparent', color: ov.locked ? '#1a1206' : GOLD, borderColor: GOLD }}>{ov.locked ? '🔒 Locked — Tap dots to paint' : '🔓 Aligning — Drag to move'}</button>}
                  {ov.on && <button onClick={() => { setOv(Object.assign({}, DEFAULT_OV, { on: true })); setDirty(true); }} style={{ ...ghostBtn, padding: '6px 12px', fontSize: 11 }}>Reset</button>}
                  {dirty && typeof onSaveOverlay === 'function' && <button onClick={() => { onSaveOverlay(ov); setDirty(false); }} style={{ ...ctaBtn, padding: '6px 14px', fontSize: 11 }}>Save Alignment</button>}
                </div>
                {ov.on && !ov.locked && (
                  <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontFamily: NBF, fontSize: 11, color: MUTE, letterSpacing: 1, textTransform: 'uppercase' }}>Size</span>
                    <input type="range" min="0.2" max="4" step="0.02" value={ov.scale || 1} onChange={(e) => { setOv((p) => Object.assign({}, p, { scale: +e.target.value })); setDirty(true); }} style={{ width: '100%' }} />
                    <span style={{ fontFamily: NBF, fontSize: 11, color: MUTE, letterSpacing: 1, textTransform: 'uppercase' }}>Opacity</span>
                    <input type="range" min="0.15" max="1" step="0.05" value={ov.opacity != null ? ov.opacity : 0.85} onChange={(e) => { setOv((p) => Object.assign({}, p, { opacity: +e.target.value })); setDirty(true); }} style={{ width: '100%' }} />
                  </div>
                )}
              </div>
            )}
            <div style={{ padding: '8px 12px', fontFamily: NBF, fontSize: 12, color: status.indexOf('failed') >= 0 || status.indexOf('not') >= 0 ? GOLD : MUTE, minHeight: 18 }}>{status} {busy ? '' : ''}</div>
            <div style={{ padding: '0 12px 12px', fontFamily: NBF, fontSize: 11, color: MUTE }}>Upload a fresh model each day to track progress. The latest viewed model is included as an overhead "map" page when you export the PDF. Toggle the Task Tracker overlay to float dots on top of the model — align with the scene then lock to paint statuses from this view.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Import modal                                                       */
/* ------------------------------------------------------------------ */
function ImportModal({ mob, onClose, onCreate }) {
  const [file, setFile] = useState(null);
  const [name, setName] = useState('');
  const [sensitivity, setSensitivity] = useState(5);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const run = async (f, sens) => { if (!f) return; setBusy(true); setErr(''); try { const r = await processImport(f, sens); setResult(r); if (!r.count) setErr('No dots detected — try adjusting the sensitivity.'); } catch (e) { setErr('Import failed: ' + (e && e.message ? e.message : 'unknown')); setResult(null); } setBusy(false); };
  const onFile = (f) => { if (!f) return; setFile(f); if (!name) setName(f.name.replace(/\.[^.]+$/, '')); run(f, sensitivity); };
  const previewVB = result && result.w ? `0 0 ${result.w} ${result.h}` : '0 0 100 100';
  return (
    <div style={overlay(mob)} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modalCard(mob, 560), gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}><div style={headTitle}>New Project — Import Plan</div><button onClick={onClose} style={{ ...xBtn, marginLeft: 'auto' }}>&times;</button></div>
        <label style={{ ...ghostBtn, textAlign: 'center', padding: '12px 0', display: 'block' }}>{file ? 'Choose a different file' : 'Upload PDF or Image'}<input type="file" accept=".pdf,image/*" hidden onChange={(e) => onFile(e.target.files[0])} /></label>
        {file && (<>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: NBF, fontSize: 13, color: MUTE, width: 90 }}>Sensitivity</span>
            <input type="range" min="1" max="10" value={sensitivity} onChange={(e) => setSensitivity(+e.target.value)} onMouseUp={() => run(file, sensitivity)} onTouchEnd={() => run(file, sensitivity)} style={{ flex: 1 }} />
            <button onClick={() => run(file, sensitivity)} style={{ ...ghostBtn, padding: '6px 10px', fontSize: 12 }}>Re-detect</button>
          </div>
          <div style={{ background: '#fff', border: '1px solid ' + LINE, height: mob ? 220 : 300, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {busy ? <span style={{ fontFamily: NBF, color: '#666' }}>Detecting…</span> : result && result.count ? (
              <svg viewBox={previewVB} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>{result.points.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={4} fill={result.sectionCount > 1 ? `hsl(${(result.sections[i] * 67) % 360} 70% 50%)` : '#16a34a'} />)}</svg>
            ) : <span style={{ fontFamily: NBF, color: '#999' }}>No preview</span>}
          </div>
          {result && result.count > 0 && <div style={{ fontFamily: NBF, fontSize: 14, color: CREAM }}>Detected <strong style={{ color: ORANGE }}>{result.count.toLocaleString()}</strong> points{result.sectionCount > 1 ? <> · <strong style={{ color: ORANGE }}>{result.sectionCount}</strong> sections</> : ' · no separate sections'}</div>}
          {err && <div style={{ fontFamily: NBF, fontSize: 14, color: GOLD }}>{err}</div>}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" style={{ background: 'rgba(255,255,255,.05)', border: '1px solid ' + LINE, color: CREAM, fontFamily: NBF, fontSize: 17, padding: '10px 12px', outline: 'none' }} />
          <button disabled={!result || !result.count || busy} onClick={() => onCreate(name || (file ? file.name.replace(/\.[^.]+$/, '') : 'New Project'), result)} style={{ ...ctaBtn, padding: '13px 0', opacity: (!result || !result.count || busy) ? .5 : 1 }}>Create Project</button>
        </>)}
        <div style={{ fontFamily: NBF, fontSize: 12, color: MUTE }}>Dots are auto-detected and split into sections by gaps. All points start at "No Progress".</div>
      </div>
    </div>
  );
}

/* styles */
const kicker = { fontFamily: NBF, fontSize: 12, fontWeight: 700, letterSpacing: '2.5px', textTransform: 'uppercase', color: MUTE };
const bar = { height: 7, background: 'rgba(255,255,255,.08)', marginTop: 8, overflow: 'hidden', borderRadius: 2 };
const headTitle = { fontFamily: BBF, fontSize: 24, letterSpacing: 1.5, color: CREAM };
const selectStyle = { width: '100%', background: '#0f1320', color: CREAM, border: '1px solid ' + LINE, padding: '10px', fontFamily: NBF, fontSize: 15, outline: 'none' };
function card() { return { background: 'rgba(255,255,255,.03)', border: '1px solid ' + LINE, padding: 12 }; }
function statusRow(active) { return { display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px', cursor: 'pointer', border: '1px solid ' + (active ? ORANGE : 'transparent'), background: active ? 'rgba(249,115,22,.10)' : 'rgba(255,255,255,.02)' }; }
function segBtn(active) { return { flex: 1, background: active ? ORANGE : 'transparent', color: active ? '#1a1206' : CREAM, border: '1px solid ' + (active ? ORANGE : 'rgba(255,255,255,.18)'), padding: '9px 0', fontFamily: NBF, fontWeight: 700, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer', clipPath: CLIP }; }
const ctaBtn = { background: ORANGE, color: '#1a1206', border: 'none', padding: '12px 18px', fontFamily: NBF, fontWeight: 700, fontSize: 14, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', clipPath: CLIP, whiteSpace: 'nowrap', boxShadow: '0 0 20px rgba(249,115,22,.30)' };
const ghostBtn = { background: 'transparent', color: ORANGE, border: '1px solid ' + ORANGE, padding: '10px 16px', fontFamily: NBF, fontWeight: 700, fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', clipPath: CLIP, whiteSpace: 'nowrap' };
const backBtn = { background: 'transparent', color: CREAM, border: '1px solid rgba(255,255,255,.2)', width: 38, height: 34, fontSize: 17, cursor: 'pointer', clipPath: CLIP, flexShrink: 0 };
const miniBtn = { background: 'transparent', border: '1px solid', borderColor: 'rgba(255,255,255,.25)', padding: '3px 12px', fontFamily: NBF, fontWeight: 700, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer', clipPath: CLIP };
const zbtn = { width: 44, height: 44, background: 'rgba(4,4,12,.8)', color: CREAM, border: '1px solid ' + LINE, fontSize: 22, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', clipPath: CLIP, backdropFilter: 'blur(6px)' };
const xBtn = { background: 'transparent', border: 'none', color: MUTE, fontSize: 30, lineHeight: 1, cursor: 'pointer' };
function overlay(mob) { return { position: 'fixed', inset: 0, zIndex: 2200, background: 'rgba(0,0,0,.62)', display: 'flex', alignItems: mob ? 'flex-end' : 'center', justifyContent: 'center' }; }
function modalCard(mob, w) { return { background: `linear-gradient(180deg,#0d0f1c, ${INK})`, border: '1px solid ' + ORANGE, borderRadius: mob ? '18px 18px 0 0' : 10, padding: 18, width: mob ? '100%' : w, maxHeight: '86vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 9, boxShadow: '0 0 60px rgba(0,0,0,.6)' }; }
