import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { jsPDF } from 'jspdf';
import { DOTS, PLAN_W, PLAN_H } from './pile_data.js';
import { processImport } from './tt_import.js';
import { processKmzImport } from './kmz_import.js';
import TTMapView from './tt_mapview.jsx';
import TTModelView from './tt_modelview.jsx';
import { ModelViewer, renderOverheadPNG } from './glb_viewer.jsx';
import { sectionHull, normRect, rectContains, DRAG_SLOP, subsForParent, subFraction, subComplete } from './tt_geom.js';
import { Paintbrush, SquareDashed, Move, Trash2, Undo2, MapPin, ChevronRight, TriangleAlert, OctagonAlert, FileText, Box, History, Cylinder, Cable, LayoutGrid, ShieldCheck, Activity, ListChecks, Layers, RotateCcw, ArrowLeft, FileUp, Clock, BarChart3, Image as ImageIcon, Map as MapIcon } from 'lucide-react';
import { GlyphDefs, Glyph, glyphHref, glyphCode } from './tt_glyphs.jsx';

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
/* new skin: deep-navy panels with orange rules, rounded corners */
const NAVY = '#0a0f1e', NAVY2 = '#0f1630';
const PBOX = 'rgba(9,13,27,.94)', PBORDER = 'rgba(249,115,22,.38)';
const GREEN = '#22c55e';
function hexA(hex, a) { const h = String(hex).replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }

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
  { name: 'Piles Installed', color: '#b9c0cc', mapColor: '#b9c0cc' },
  { name: 'Post Caps Installed', color: '#3b82f6', mapColor: '#3b82f6' },
  { name: 'Torque Tube Installed', color: '#a855f7', mapColor: '#a855f7' },
  { name: 'Modules Installed', color: '#22c55e', mapColor: '#22c55e' },
];
const QC_YELLOW = '#facc15', QC_ORANGE = '#ef4444';
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
/* Paint tokens: 's0'…'s4' stages, 'q0'…'q2' quality flags, 'k:<id>' marks a
   custom subtask done, 'n:<id>' clears it. */
function parsePaint(tok, subtasks) {
  const t = String(tok || '');
  if (t[0] === 'k' && t[1] === ':') return { kind: 'sub', id: t.slice(2), done: true, def: (subtasks || []).find((s) => s.id === t.slice(2)) || null };
  if (t[0] === 'n' && t[1] === ':') return { kind: 'sub', id: t.slice(2), done: false, def: (subtasks || []).find((s) => s.id === t.slice(2)) || null };
  if (t[0] === 'q') return { kind: 'qc', v: +t[1] || 0 };
  return { kind: 'stage', v: +t[1] || 0 };
}
/* Subtasks inherit the permission of the parent stage they hang off. */
function paintAllowed(allowed, tok, subtasks) {
  if (!allowed) return true;
  const p = parsePaint(tok, subtasks);
  if (p.kind === 'sub') return p.def ? allowed.has(p.def.parent) : false;
  return allowed.has(tok);
}
function paintTokenLabel(tok, subtasks) {
  const p = parsePaint(tok, subtasks);
  if (p.kind === 'sub') return (p.def ? p.def.label : 'Subtask') + (p.done ? '' : ' — clear');
  if (p.kind === 'qc') return QC[p.v].name;
  return STAGES[p.v].name;
}
function paintTokenColor(tok, subtasks) {
  const p = parsePaint(tok, subtasks);
  if (p.kind === 'sub') return p.def ? STAGES[+String(p.def.parent)[1] || 0].color : ORANGE;
  if (p.kind === 'qc') return QC[p.v].color;
  return STAGES[p.v].color;
}
const newSubId = () => 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
/* per-point completion bitstrings, one per subtask id */
function normSub(raw, N) {
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(raw)) {
      const v = String(raw[k] || '');
      out[k] = v.length === N ? v : (v + '0'.repeat(N)).slice(0, N);
    }
  }
  return out;
}
function setSubBit(bits, i, N, on) {
  const s = (bits && bits.length === N) ? bits : '0'.repeat(N);
  if ((s[i] === '1') === !!on) return s;
  return s.slice(0, i) + (on ? '1' : '0') + s.slice(i + 1);
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
function computeStats(stage, qc, subtasks, sub) {
  const N = stage.length;
  const cum = [0, 0, 0, 0, 0];
  const hasSubs = Array.isArray(subtasks) && subtasks.length > 0 && sub;
  let sum = 0, yellow = 0, orange = 0, none = 0;
  for (let i = 0; i < N; i++) {
    const s = stage[i] || 0; sum += s;
    /* partial credit toward the next stage from completed subtask weights */
    if (hasSubs && s < 4) sum += subFraction(subtasks, sub, s + 1, i);
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
  return { name: name || 'Project Alpha', w: PLAN_W, h: PLAN_H, points: DWYER_POINTS, sections: null, sectionCount: 0, sectionNames: {}, stage: new Array(N).fill(0), qc: new Array(N).fill(0), by: new Array(N).fill(''), at: new Array(N).fill(0), notes: {}, bg: null, bgT: 0, overlay3d: null, geo: null, subtasks: [], sub: {}, log: [], lastModified: Date.now() };
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
  const geo = (d.geo && typeof d.geo === 'object' && Array.isArray(d.geo.lonLat)) ? d.geo : null;
  const sectionNames = (d.sectionNames && typeof d.sectionNames === 'object') ? d.sectionNames : {};
  const subtasks = Array.isArray(d.subtasks) ? d.subtasks.filter((s) => s && s.id && s.parent) : [];
  const sub = normSub(d.sub, N);
  return { name: d.name || 'Project', w: d.w || PLAN_W, h: d.h || PLAN_H, points: pts, sections: d.sections || null, sectionCount: d.sectionCount || 0, sectionNames, stage, qc, by, at, notes, bg, bgT: d.bgT || 0, overlay3d, geo, subtasks, sub, log: Array.isArray(d.log) ? d.log : [], lastModified: d.lastModified || Date.now() };
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
  return kpiFromDoc(raw);
}
function kpiFromDoc(raw) {
  const d = normalizeDoc(raw);
  const st = computeStats(d.stage, d.qc, d.subtasks, d.sub);
  const total = st.N;
  return {
    name: d.name || 'Project', total, overall: st.overall, lastModified: d.lastModified || 0,
    flags: st.yellow + st.orange, attention: st.yellow, flagged: st.orange, blocks: d.sectionCount || 0,
    tasks: STAGES.slice(1).map((s, i) => ({ name: s.name.replace(' Installed', ''), color: s.color, count: st.cum[i + 1], pct: total ? st.cum[i + 1] / total * 100 : 0 })),
  };
}
/* Same snapshot straight from the cloud (no local side effects) — used by the
   home screen so a fresh install shows real numbers before the Task Tracker
   has ever been opened. Resolves null when offline or nothing is published. */
export async function fetchTaskTrackerKPI() {
  try {
    const reg = await fetch(ENDPOINT + '?registry=1', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null));
    const projects = (reg && Array.isArray(reg.projects)) ? reg.projects.filter((p) => p && p.id) : [];
    if (!projects.length) return null;
    const localActive = storage.get(ACTIVE_KEY);
    const pick = projects.find((p) => p.id === localActive) || projects[0];
    const doc = await fetch(ENDPOINT + '?project=' + encodeURIComponent(pick.id), { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null));
    if (!doc || !Array.isArray(doc.points) || !doc.points.length) return null;
    return { ...kpiFromDoc({ ...doc, name: doc.name || pick.name }), id: pick.id, projects: projects.map((p) => ({ id: p.id, name: p.name })) };
  } catch (e) { return null; }
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
function exportPDF(projName, points, w, h, stage, qc, notes, stampTs, byUser, logo, overheadPNG, subtasks, sub) {
  const st = computeStats(stage, qc, subtasks, sub); const total = st.N;
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
  const st = computeStats(d.stage, d.qc, d.subtasks, d.sub); const total = st.N;
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

/* circular progress used by the project cards */
function RingPct({ pct, size = 64, color = ORANGE }) {
  const r = (size - 9) / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct || 0));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth={7} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round" strokeDasharray={`${c * p / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fill={CREAM} style={{ fontFamily: BBF, fontSize: size * 0.3 }}>{Math.round(p)}%</text>
    </svg>
  );
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

  const st = doc ? computeStats(doc.stage, doc.qc, doc.subtasks, doc.sub) : null;
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
  const [geo, setGeo] = useState(init.current.geo || null);
  const [sectionNames, setSectionNames] = useState(init.current.sectionNames || {});
  const [subtasks, setSubtasks] = useState(init.current.subtasks || []);
  const [sub, setSub] = useState(init.current.sub || {});
  const [selSection, setSelSection] = useState(null);
  /* 'plan' = imported dot layout, 'sat' = Google-Earth style map, 'model' = GLB */
  const [viewMode, setViewMode] = useState(() => ((init.current.geo && init.current.geo.lonLat && init.current.geo.lonLat.length) ? 'sat' : 'plan'));
  const [tileLayer, setTileLayer] = useState('satellite');
  const [log, setLog] = useState(init.current.log);
  const [lastModified, setLastModified] = useState(init.current.lastModified);

  /* effective edit permissions for the active project */
  const scopeForActive = isAdmin ? null : (Array.isArray(myTaskScope[activeId]) ? myTaskScope[activeId] : null);
  const allowed = allowedPaintSet(scopeForActive); // null = all allowed

  const [paint, setPaint] = useState('s1');         // s0-s4 stages, q1/q2 QC, q0 clear
  const [mode, setMode] = useState('brush');        // brush | fill | pan | delete | bg
  const [delSel, setDelSel] = useState(() => new Set()); // points queued for deletion (delete mode)
  const [sheetOpen, setSheetOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(true);   // phone map legend (tap to collapse)
  const [historyOpen, setHistoryOpen] = useState(false);
  const [projOpen, setProjOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [notePt, setNotePt] = useState(null);
  const [canUndo, setCanUndo] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const modelBufRef = useRef(null); // latest viewed GLB ArrayBuffer (for PDF overhead)

  const TOTAL = points.length;
  const stats = useMemo(() => computeStats(stage, qc, subtasks, sub), [stage, qc, subtasks, sub]);

  /* persist */
  const skipPersist = useRef(false);
  useEffect(() => {
    if (skipPersist.current) { skipPersist.current = false; return; }
    storage.set(projKey(activeId), { name: projName, w: planW, h: planH, points, sections, sectionCount, sectionNames, stage, qc, by, at, notes, bg, bgT, overlay3d, geo, subtasks, sub, log, lastModified });
  }, [activeId, projName, planW, planH, points, sections, sectionCount, sectionNames, stage, qc, by, at, notes, bg, bgT, overlay3d, geo, subtasks, sub, log, lastModified]);
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
  const geoRef = useRef(geo); useEffect(() => { geoRef.current = geo; }, [geo]);
  const sectionNamesRef = useRef(sectionNames); useEffect(() => { sectionNamesRef.current = sectionNames; }, [sectionNames]);
  const subtasksRef = useRef(subtasks); useEffect(() => { subtasksRef.current = subtasks; }, [subtasks]);
  const subRef = useRef(sub); useEffect(() => { subRef.current = sub; }, [sub]);
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

  /* ---- delete mode: queue points, then remove them from every per-point array ---- */
  const markDel = (list) => setDelSel((prev) => { const n = new Set(prev); for (const i of list) n.add(i); return n; });
  const toggleDel = (i) => setDelSel((prev) => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const clearDel = () => setDelSel(new Set());
  const deleteMarked = () => {
    const del = delSel; if (!del.size) return;
    if (!window.confirm(`Delete ${del.size} point${del.size === 1 ? '' : 's'} from "${projName}"? This removes them from the plan, the map and every report, and cannot be undone.`)) return;
    const N = pointsRef.current.length;
    const keep = []; const remap = new Array(N).fill(-1);
    for (let i = 0; i < N; i++) if (!del.has(i)) { remap[i] = keep.length; keep.push(i); }
    const pick = (arr) => (Array.isArray(arr) && arr.length === N ? keep.map((i) => arr[i]) : arr);
    setPoints((p) => pick(p)); setSections((s) => pick(s));
    setStage((s) => pick(s)); setQc((q) => pick(q)); setBy((b) => pick(b)); setAt((a) => pick(a));
    setNotes((n) => { const out = {}; for (const k of Object.keys(n || {})) { const j = remap[+k]; if (j >= 0) out[j] = n[k]; } return out; });
    setSub((s) => { const out = {}; for (const k of Object.keys(s || {})) { const bits = String(s[k] || ''); let nb = ''; for (const i of keep) nb += bits[i] === '1' ? '1' : '0'; out[k] = nb; } return out; });
    setGeo((g) => { if (!g) return g; const out = { ...g }; for (const k of Object.keys(g)) if (Array.isArray(g[k]) && g[k].length === N) out[k] = pick(g[k]); return out; });
    setSelSection(null); setNotePt(null); setDelSel(new Set());
    undoRef.current = []; setCanUndo(false);   // undo snapshots predate the new indexing
    setLastModified(Date.now());
    pushLog(`deleted ${del.size} point${del.size === 1 ? '' : 's'}`);
  };

  /* ---- painting ---- */
  const allowedRef = useRef(allowed); useEffect(() => { allowedRef.current = allowed; }, [allowed]);
  /* blocks are "Block N" until someone names them */
  const sectionLabelFor = useCallback((idx) => {
    if (idx == null) return 'all points';
    const nm = (sectionNamesRef.current || {})[idx];
    return (nm && String(nm).trim()) ? String(nm).trim() : 'Block ' + (idx + 1);
  }, []);
  const stampIndex = (i) => { const t = Date.now(); setAt((prev) => { const n = prev.slice(); n[i] = t; return n; }); setBy((prev) => { if (prev[i] === userName) return prev; const n = prev.slice(); n[i] = userName; return n; }); };
  const applyPaintToIndex = (i) => {
    if (modeRef.current === 'delete') { markDel([i]); return; }
    const pv = paintRef.current;
    if (!paintAllowed(allowedRef.current, pv, subtasksRef.current)) return;
    const p = parsePaint(pv, subtasksRef.current);
    if (p.kind === 'sub') {
      if (!p.def) return;
      const N = pointsRef.current.length;
      const cur = subRef.current[p.id] || '';
      if ((cur[i] === '1') === !!p.done) return;
      if (burstRef.current) { burstRef.current.count++; burstRef.current.last = i; }
      setSub((prev) => Object.assign({}, prev, { [p.id]: setSubBit(prev[p.id], i, N, p.done) }));
      /* once completed subtask weights cover the whole stage, advance the point */
      const parentStage = +String(p.def.parent)[1] || 0;
      if (p.done && parentStage === (stageRef.current[i] || 0) + 1) {
        const probe = Object.assign({}, subRef.current, { [p.id]: setSubBit(subRef.current[p.id], i, N, true) });
        if (subComplete(subtasksRef.current, probe, parentStage, i)) setStage((prev) => { const n = prev.slice(); n[i] = parentStage; return n; });
      }
    } else if (p.kind === 'stage') {
      if (stageRef.current[i] === p.v) return;
      if (burstRef.current) { burstRef.current.count++; burstRef.current.last = i; }
      setStage((prev) => { const n = prev.slice(); n[i] = p.v; return n; });
      /* dropping a point back to "No Progress" clears its subtask credit too */
      if (p.v === 0) {
        const N = pointsRef.current.length;
        setSub((prev) => { const out = {}; let hit = false; for (const k of Object.keys(prev)) { const nv = setSubBit(prev[k], i, N, false); if (nv !== prev[k]) hit = true; out[k] = nv; } return hit ? out : prev; });
      }
    } else {
      if (qcRef.current[i] === p.v) return;
      if (burstRef.current) { burstRef.current.count++; burstRef.current.last = i; }
      setQc((prev) => { const n = prev.slice(); n[i] = p.v; return n; });
    }
    stampIndex(i);
  };
  const paintAt = useCallback((cx, cy) => { const el = document.elementFromPoint(cx, cy); if (el && el.dataset && el.dataset.i != null) applyPaintToIndex(+el.dataset.i); }, []);

  /* Apply the active paint to every index in `list` in one pass — used by the
     section fill and by the click-and-drag marquee. */
  const applyPaintToList = (list, describe) => {
    if (!list || !list.length) return;
    if (modeRef.current === 'delete') { markDel(list); return; }
    const pv = paintRef.current;
    if (!paintAllowed(allowedRef.current, pv, subtasksRef.current)) return;
    snapshotUndo();
    const p = parsePaint(pv, subtasksRef.current);
    const hit = new Set(list); const t = Date.now(); const N = pointsRef.current.length;
    if (p.kind === 'sub') {
      if (!p.def) return;
      setSub((prev) => { let bits = prev[p.id]; for (const j of hit) bits = setSubBit(bits, j, N, p.done); return Object.assign({}, prev, { [p.id]: bits }); });
      const parentStage = +String(p.def.parent)[1] || 0;
      if (p.done) {
        const probe = Object.assign({}, subRef.current);
        let bits = probe[p.id]; for (const j of hit) bits = setSubBit(bits, j, N, true); probe[p.id] = bits;
        setStage((prev) => prev.map((x, j) => (hit.has(j) && parentStage === x + 1 && subComplete(subtasksRef.current, probe, parentStage, j) ? parentStage : x)));
      }
    } else if (p.kind === 'stage') {
      setStage((prev) => prev.map((x, j) => (hit.has(j) ? p.v : x)));
      if (p.v === 0) setSub((prev) => { const out = {}; for (const k of Object.keys(prev)) { let bits = prev[k]; for (const j of hit) bits = setSubBit(bits, j, N, false); out[k] = bits; } return out; });
    } else {
      setQc((prev) => prev.map((x, j) => (hit.has(j) ? p.v : x)));
    }
    setAt((prev) => prev.map((x, j) => (hit.has(j) ? t : x)));
    setBy((prev) => prev.map((x, j) => (hit.has(j) ? userName : x)));
    pushLog(`${describe} → "${paintTokenLabel(pv, subtasksRef.current)}"`);
  };
  const fillAt = (i) => {
    const secs = sectionsRef.current; const sec = secs ? secs[i] : null;
    const list = []; for (let j = 0; j < pointsRef.current.length; j++) if (!secs || secs[j] === sec) list.push(j);
    applyPaintToList(list, 'filled ' + (secs ? sectionLabelFor(sec) : 'all points'));
  };
  /* click-and-drag marquee fill: paint every point inside the dragged box */
  const fillRegion = (list) => applyPaintToList(list, `filled ${list.length} selected point${list.length === 1 ? '' : 's'}`);
  const burstFlush = () => {
    const b = burstRef.current; burstRef.current = null;
    if (!b || b.count === 0) return;
    const label = paintTokenLabel(b.paint, subtasksRef.current);
    pushLog(`set ${b.count} point${b.count !== 1 ? 's' : ''} → "${label}"`);
    if (b.paint === 'q2' && b.count === 1 && b.last != null) setNotePt(b.last); // single flag → add note
  };

  /* Shared paint plumbing for the satellite + 3D overlays, so those views
     behave exactly like the plan SVG (brush drags, marquee fill, tap-to-note). */
  const overlayPick = (i) => {
    if (modeRef.current === 'delete') { toggleDel(i); return; }
    if (modeRef.current === 'pan') { setNotePt(i); return; }
    if (modeRef.current === 'fill') { fillAt(i); return; }
    if (!paintAllowed(allowedRef.current, paintRef.current, subtasksRef.current)) { setNotePt(i); return; }
    snapshotUndo(); burstRef.current = { count: 0, paint: paintRef.current, last: null };
    applyPaintToIndex(i); burstFlush();
  };
  const overlayBrushStart = () => { if (modeRef.current === 'delete') return; snapshotUndo(); burstRef.current = { count: 0, paint: paintRef.current, last: null }; };
  const overlayBrushPoint = (i) => applyPaintToIndex(i);
  const overlayBrushEnd = () => burstFlush();
  const saveOverlay3d = (ov) => { setOverlay3d(ov); setLastModified(Date.now()); pushLog(ov.on === false ? 'hid 3D overlay' : (ov.locked ? 'locked 3D overlay alignment' : 'updated 3D overlay alignment')); };

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
    /* An empty value from the server must never wipe a populated local one —
       the cloud copy starts out blank for every one of these fields, so a
       plain "remote wins" would erase the importer's map data on first pull.
       Take remote only when it actually carries something, or when we have
       nothing and remote is authoritative. */
    const remoteNewer = (d.lastModified || 0) > (lastModifiedRef.current || 0);
    const take = (remoteEmpty, localEmpty) => !remoteEmpty && (localEmpty || remoteNewer);
    if (take(!nd.overlay3d, !overlay3dRef.current)) setOverlay3d(nd.overlay3d);
    if (take(!(nd.geo && nd.geo.lonLat && nd.geo.lonLat.length), !geoRef.current)) setGeo(nd.geo);
    if (take(!Object.keys(nd.sectionNames || {}).length, !Object.keys(sectionNamesRef.current || {}).length)) setSectionNames(nd.sectionNames);
    if (take(!(nd.subtasks || []).length, !(subtasksRef.current || []).length)) setSubtasks(nd.subtasks);
    if (take(!Object.keys(nd.sub || {}).length, !Object.keys(subRef.current || {}).length)) setSub(nd.sub);
    if (Array.isArray(d.log)) { setLog((local) => mergeLogs(local, d.log)); d.log.forEach((e) => syncedIdsRef.current.add(e.id)); }
    lastRevRef.current = d.rev;
    setTimeout(() => { applyingRemoteRef.current = false; }, 0);
  }, []);
  const pushCloud = useCallback(async () => {
    const id = activeIdRef.current;
    const entries = logRef.current.filter((e) => !syncedIdsRef.current.has(e.id));
    try {
      setCloudStatus('syncing');
      const body = { name: projNameRef.current, points: pointsRef.current, w: planWRef.current, h: planHRef.current, sections: sectionsRef.current, sectionCount: sectionCountRef.current, stage: stageRef.current, qc: qcRef.current, by: byRef.current, at: atRef.current, notes: notesRef.current, bg: bgRef.current, bgT: bgTRef.current, overlay3d: overlay3dRef.current, geo: geoRef.current, sectionNames: sectionNamesRef.current, subtasks: subtasksRef.current, sub: subRef.current, lastModified: lastModifiedRef.current, entries };
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
        /* Projects imported before these fields existed (or before they were
           persisted) hold map data only on the machine that imported them.
           Push ours up so everyone else gets the satellite view too. */
        if (initial) {
          const missingGeo = geoRef.current && !(d.geo && d.geo.lonLat && d.geo.lonLat.length);
          const missingNames = Object.keys(sectionNamesRef.current || {}).length && !Object.keys(d.sectionNames || {}).length;
          const missingSubs = (subtasksRef.current || []).length && !(d.subtasks || []).length;
          if (missingGeo || missingNames || missingSubs) await pushCloud();
        }
      } catch (e) { if (alive && initial) { setCloudStatus('offline'); readyRef.current = true; } }
    };
    pull(true); const t = setInterval(() => pull(false), 6000);
    return () => { alive = false; clearInterval(t); };
  }, [activeId, applyRemote, pushCloud]);
  useEffect(() => {
    if (!readyRef.current || applyingRemoteRef.current) return;
    clearTimeout(pushTimerRef.current); pushTimerRef.current = setTimeout(() => { pushCloud(); }, 1000);
  }, [stage, qc, at, notes, bg, bgT, overlay3d, geo, sectionNames, subtasks, sub, log, projName, points, pushCloud]);
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
  /* click-and-drag selection box for Fill mode */
  const marqRef = useRef(null); const [marq, setMarq] = useState(null);
  const commitMarquee = useCallback(() => {
    const m = marqRef.current; marqRef.current = null; setMarq(null);
    if (!m) return;
    const v = vwRef.current;
    const toWorld = (p) => ({ x: (p.x - v.x) / v.s, y: (p.y - v.y) / v.s });
    const r = normRect(toWorld(m.a), toWorld(m.b));
    if (!m.moved) {
      /* a plain click still fills the whole block under the cursor */
      const el = document.elementFromPoint(m.cx, m.cy);
      if (el && el.dataset && el.dataset.i != null) fillAt(+el.dataset.i);
      return;
    }
    const list = [];
    const arr = pointsRef.current;
    for (let i = 0; i < arr.length; i++) if (rectContains(r, arr[i][0] + PAD, arr[i][1] + PAD)) list.push(i);
    if (list.length) fillRegion(list);
  }, [PAD]); // eslint-disable-line react-hooks/exhaustive-deps
  const onPointerDown = (e) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) { paintingRef.current = false; panRef.current = null; bgDragRef.current = null; const pts = [...pointersRef.current.values()]; const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y); const midC = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }; pinchRef.current = { dist, mid: toView(midC.x, midC.y), s0: vwRef.current.s, x0: vwRef.current.x, y0: vwRef.current.y }; return; }
    /* right button always pans, whatever tool is selected */
    if (e.button === 2) { const p = toView(e.clientX, e.clientY); panRef.current = { sx: p.x, sy: p.y, vx: vwRef.current.x, vy: vwRef.current.y }; pannedRef.current = false; return; }
    const m = modeRef.current;
    if (m === 'bg') { if (bgRef.current) { const p = toView(e.clientX, e.clientY); bgDragRef.current = { sx: p.x, sy: p.y, x0: bgRef.current.x, y0: bgRef.current.y }; } }
    else if (m === 'brush') { snapshotUndo(); paintingRef.current = true; burstRef.current = { count: 0, paint: paintRef.current, last: null }; paintAt(e.clientX, e.clientY); }
    else if (m === 'delete') { paintingRef.current = true; paintAt(e.clientX, e.clientY); }
    else if (m === 'fill') { const p = toView(e.clientX, e.clientY); marqRef.current = { cx: e.clientX, cy: e.clientY, a: p, b: p, moved: false }; setMarq({ a: p, b: p }); }
    else { const p = toView(e.clientX, e.clientY); panRef.current = { sx: p.x, sy: p.y, vx: vwRef.current.x, vy: vwRef.current.y }; pannedRef.current = false; }
  };
  const onPointerMove = (e) => {
    if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchRef.current && pointersRef.current.size >= 2) { const pts = [...pointersRef.current.values()]; const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y); const ratio = dist / (pinchRef.current.dist || 1); const ns = Math.min(28, Math.max(1, pinchRef.current.s0 * ratio)); const { mid, s0, x0, y0 } = pinchRef.current; const wx = (mid.x - x0) / s0, wy = (mid.y - y0) / s0; setVw(clampView({ s: ns, x: mid.x - wx * ns, y: mid.y - wy * ns })); return; }
    if (marqRef.current && pointersRef.current.size < 2) { const m = marqRef.current; const p = toView(e.clientX, e.clientY); m.b = p; if (Math.hypot(e.clientX - m.cx, e.clientY - m.cy) > DRAG_SLOP) m.moved = true; setMarq({ a: m.a, b: p }); return; }
    if (bgDragRef.current && pointersRef.current.size < 2) { const bd = bgDragRef.current; const b = bgRef.current; if (b) { const p = toView(e.clientX, e.clientY); setBg({ ...b, x: bd.x0 + (p.x - bd.sx), y: bd.y0 + (p.y - bd.sy) }); } return; }
    if (panRef.current) { const pr = panRef.current; pannedRef.current = true; const p = toView(e.clientX, e.clientY); setVw((v) => clampView({ ...v, x: pr.vx + (p.x - pr.sx), y: pr.vy + (p.y - pr.sy) })); }
  };
  const endPointer = (e) => { pointersRef.current.delete(e.pointerId); if (pointersRef.current.size < 2) pinchRef.current = null; if (pointersRef.current.size === 0) { paintingRef.current = false; panRef.current = null; if (marqRef.current) commitMarquee(); if (bgDragRef.current) { bgDragRef.current = null; setBgT(Date.now()); } } };
  useEffect(() => {
    const mv = (e) => { if (paintingRef.current && (modeRef.current === 'brush' || modeRef.current === 'delete') && pointersRef.current.size < 2) paintAt(e.clientX, e.clientY); };
    const up = () => { if (paintingRef.current) { paintingRef.current = false; burstFlush(); } if (marqRef.current) commitMarquee(); panRef.current = null; if (bgDragRef.current) { bgDragRef.current = null; setBgT(Date.now()); } };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, [paintAt, commitMarquee]);
  const resetView = () => setVw({ s: 1, x: 0, y: 0 });
  const zoomB = (f) => zoomAt(VW / 2, VH / 2, f);

  /* ---- project ops ---- */
  const openProject = (id) => {
    const d = loadDoc(id); skipPersist.current = true;
    setProjName(d.name); setPoints(d.points); setPlanW(d.w); setPlanH(d.h); setSections(d.sections); setSectionCount(d.sectionCount);
    setStage(d.stage); setQc(d.qc); setBy(d.by); setAt(d.at); setNotes(d.notes); setBg(d.bg); setBgT(d.bgT); setBgOn(!!(d.bg && d.bg.on)); setOverlay3d(d.overlay3d || null); setGeo(d.geo || null); setViewMode((d.geo && d.geo.lonLat && d.geo.lonLat.length) ? 'sat' : 'plan'); setSectionNames(d.sectionNames || {}); setSubtasks(d.subtasks || []); setSub(d.sub || {}); setSelSection(null); setLog(d.log); setLastModified(d.lastModified);
    undoRef.current = []; setCanUndo(false); setDelSel(new Set()); if (modeRef.current === 'delete') setMode('brush'); modelBufRef.current = null; setActiveId(id); resetView(); setView('tracker'); setProjOpen(false); setSheetOpen(false);
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
    const doc = { name: name || 'New Project', w: imp.w, h: imp.h, points: imp.points, sections: imp.sectionCount > 1 ? imp.sections : null, sectionCount: imp.sectionCount > 1 ? imp.sectionCount : 0, stage: new Array(N).fill(0), qc: new Array(N).fill(0), by: new Array(N).fill(''), at: new Array(N).fill(0), notes: {}, bg: null, bgT: 0, geo: imp.geo || null, sectionNames: {}, subtasks: [], sub: {}, log: [{ id: 'h' + Date.now(), ts: Date.now(), user: userName, summary: `created project from import (${imp.count} points${imp.sectionCount > 1 ? ', ' + imp.sectionCount + ' sections' : ''}${imp.geo ? ', geo-referenced' : ''})`, stage: encNums(new Array(N).fill(0)), qc: encNums(new Array(N).fill(0)), notes: {} }], lastModified: Date.now() };
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
    exportPDF(projName, points, planW, planH, stage, qc, notes, lastModified, userName, logoRef.current, overhead, subtasks, sub);
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

  /* ---- reset a task ----
     Scoped to the selected block when there is one, otherwise the whole
     project. Stages are cumulative, so clearing stage k drops every point at
     or above it back to k-1 and takes its subtask credit with it. */
  const scopedIndices = () => {
    const out = []; const secs = sections;
    for (let i = 0; i < points.length; i++) if (selSection == null || !secs || secs[i] === selSection) out.push(i);
    return out;
  };
  const scopeLabel = () => (selSection != null ? sectionLabelFor(selSection) : 'the whole project');
  const clearSubBitsFor = (hit, fromStage) => {
    const ids = (subtasks || []).filter((t) => (+String(t.parent)[1] || 0) >= fromStage).map((t) => t.id);
    if (!ids.length) return;
    const N = points.length;
    setSub((prev) => { const n = Object.assign({}, prev); for (const id of ids) { let bits = n[id]; if (!bits) continue; for (const j of hit) bits = setSubBit(bits, j, N, false); n[id] = bits; } return n; });
  };
  const stampList = (hit) => {
    const t = Date.now();
    setAt((prev) => prev.map((x, j) => (hit.has(j) ? t : x)));
    setBy((prev) => prev.map((x, j) => (hit.has(j) ? userName : x)));
  };
  const resetStage = (k) => {
    const list = scopedIndices().filter((i) => (stage[i] || 0) >= k);
    if (!list.length) { window.alert(`Nothing to clear — no points in ${scopeLabel()} have reached "${STAGES[k].name}".`); return; }
    if (!window.confirm(`Clear "${STAGES[k].name}" on ${list.length.toLocaleString()} point${list.length === 1 ? '' : 's'} in ${scopeLabel()}?\n\nThey drop back to "${STAGES[k - 1].name}".`)) return;
    snapshotUndo();
    const hit = new Set(list);
    setStage((prev) => prev.map((x, j) => (hit.has(j) ? k - 1 : x)));
    clearSubBitsFor(hit, k);
    stampList(hit);
    pushLog(`cleared "${STAGES[k].name}" on ${list.length} point${list.length === 1 ? '' : 's'} (${scopeLabel()})`);
  };
  const resetQc = (v) => {
    const list = scopedIndices().filter((i) => (qc[i] || 0) === v);
    if (!list.length) { window.alert(`No "${QC[v].name}" flags in ${scopeLabel()}.`); return; }
    if (!window.confirm(`Clear ${list.length.toLocaleString()} "${QC[v].name}" flag${list.length === 1 ? '' : 's'} in ${scopeLabel()}?`)) return;
    snapshotUndo();
    const hit = new Set(list);
    setQc((prev) => prev.map((x, j) => (hit.has(j) ? 0 : x)));
    stampList(hit);
    pushLog(`cleared ${list.length} "${QC[v].name}" flag${list.length === 1 ? '' : 's'} (${scopeLabel()})`);
  };
  const resetSubtask = (t) => {
    const bits = sub[t.id] || '';
    const list = scopedIndices().filter((i) => bits[i] === '1');
    if (!list.length) { window.alert(`No points are marked "${t.label}" in ${scopeLabel()}.`); return; }
    const k = +String(t.parent)[1] || 0;
    if (!window.confirm(`Clear "${t.label}" on ${list.length.toLocaleString()} point${list.length === 1 ? '' : 's'} in ${scopeLabel()}?`)) return;
    snapshotUndo();
    const hit = new Set(list); const N = points.length;
    const next = Object.assign({}, subRef.current);
    let b = next[t.id] || ''; for (const j of hit) b = setSubBit(b, j, N, false); next[t.id] = b;
    setSub(next);
    /* a point that only reached its stage on this subtask's credit steps back */
    setStage((prev) => prev.map((x, j) => (hit.has(j) && x === k && !subComplete(subtasksRef.current, next, k, j) ? k - 1 : x)));
    stampList(hit);
    pushLog(`cleared subtask "${t.label}" on ${list.length} point${list.length === 1 ? '' : 's'} (${scopeLabel()})`);
  };
  const resetAll = () => {
    const list = scopedIndices();
    if (!window.confirm(`Reset every task on all ${list.length.toLocaleString()} points in ${scopeLabel()}?\n\nInstall status, quality flags and subtask progress all go back to zero. Notes are kept.`)) return;
    snapshotUndo();
    const hit = new Set(list);
    setStage((prev) => prev.map((x, j) => (hit.has(j) ? 0 : x)));
    setQc((prev) => prev.map((x, j) => (hit.has(j) ? 0 : x)));
    clearSubBitsFor(hit, 0);
    stampList(hit);
    pushLog(`reset all tasks on ${list.length} point${list.length === 1 ? '' : 's'} (${scopeLabel()})`);
  };

  /* ---- named blocks ---- */
  const renameSection = (idx, name) => {
    setSectionNames((prev) => {
      const next = Object.assign({}, prev);
      if (name && name.trim()) next[idx] = name.trim(); else delete next[idx];
      return next;
    });
    setLastModified(Date.now());
    pushLog(`renamed Block ${idx + 1} → "${(name || '').trim() || 'Block ' + (idx + 1)}"`);
  };

  /* ---- custom subtasks (weighted portions of a parent install stage) ---- */
  const [subOpen, setSubOpen] = useState(false);
  const [qtyOpen, setQtyOpen] = useState(false);

  /* Blocks as index lists, for per-block quantity entry. */
  const blocks = useMemo(() => {
    if (!sections || sectionCount < 2) return [{ i: null, label: 'All points', idxs: points.map((_, j) => j) }];
    const out = Array.from({ length: sectionCount }, (_, j) => ({ i: j, label: sectionLabelFor(j), idxs: [] }));
    for (let j = 0; j < points.length; j++) { const s = sections[j]; if (out[s]) out[s].idxs.push(j); }
    return out;
  }, [sections, sectionCount, points, sectionNames, sectionLabelFor]);

  /* Count completed points for a subtask within a set of indices. */
  const subCountIn = (subId, idxs) => { const b = sub[subId] || ''; let c = 0; for (const i of idxs) if (b[i] === '1') c++; return c; };

  /* Type "45" against a block and 45 of its points get credited for that
     subtask — already-completed points are kept, so a number only ever moves
     the difference. */
  const applySubQuantities = (changes) => {
    const real = (changes || []).filter((c) => c.q !== c.cur);
    if (!real.length) return false;
    snapshotUndo();
    const N = points.length;
    const next = Object.assign({}, subRef.current);
    const touched = new Set();
    for (const c of real) {
      let bits = next[c.subId];
      if (!bits || bits.length !== N) bits = ((bits || '') + '0'.repeat(N)).slice(0, N);
      const arr = bits.split('');
      const done = [], todo = [];
      for (const i of c.idxs) (arr[i] === '1' ? done : todo).push(i);
      if (c.q >= done.length) { for (const i of todo.slice(0, c.q - done.length)) { arr[i] = '1'; touched.add(i); } }
      else { for (const i of done.slice(c.q)) { arr[i] = '0'; touched.add(i); } }
      next[c.subId] = arr.join('');
    }
    setSub(next);
    /* keep the parent stage honest in both directions: a point whose subtasks
       now add up to the full stage advances, one that no longer does drops back */
    setStage((prev) => prev.map((x, j) => {
      if (!touched.has(j)) return x;
      if (x < 4 && subComplete(subtasksRef.current, next, x + 1, j)) return x + 1;
      if (x >= 1 && subsForParent(subtasksRef.current, 's' + x).length && !subComplete(subtasksRef.current, next, x, j)) return x - 1;
      return x;
    }));
    stampList(touched);
    const total = real.reduce((a, c) => a + Math.abs(c.q - c.cur), 0);
    pushLog(`entered quantities — ${total} point${total === 1 ? '' : 's'} changed across ${real.length} entr${real.length === 1 ? 'y' : 'ies'}`);
    return true;
  };
  const addSubtask = (parent, label, weight) => {
    const lbl = (label || '').trim(); if (!lbl) return;
    const w = Math.max(1, Math.min(100, Math.round(+weight || 0))); if (!w) return;
    const t = { id: newSubId(), parent, label: lbl, weight: w };
    setSubtasks((prev) => [...prev, t]);
    setSub((prev) => Object.assign({}, prev, { [t.id]: '0'.repeat(points.length) }));
    setLastModified(Date.now());
    pushLog(`added subtask "${lbl}" (${w}% of ${STAGES[+parent[1]].name})`);
  };
  const updateSubtask = (id, patch) => {
    setSubtasks((prev) => prev.map((s) => (s.id === id ? Object.assign({}, s, patch) : s)));
    setLastModified(Date.now());
  };
  const removeSubtask = (t) => {
    if (!window.confirm(`Delete subtask "${t.label}"? Points already credited for it lose that credit.`)) return;
    setSubtasks((prev) => prev.filter((s) => s.id !== t.id));
    setSub((prev) => { const n = Object.assign({}, prev); delete n[t.id]; return n; });
    setLastModified(Date.now());
    pushLog(`deleted subtask "${t.label}"`);
    if (paint === 'k:' + t.id || paint === 'n:' + t.id) setPaint('s1');
  };

  /* ---- attach map coordinates to an existing project ----
     Lets a project that was imported from a PDF (or one whose coordinates were
     lost) gain satellite view without being recreated and losing its progress. */
  const [geoBusy, setGeoBusy] = useState(false);
  const onGeoUpload = async (file) => {
    if (!file) return;
    setGeoBusy(true);
    try {
      const r = await processKmzImport(file);
      if (!r || !r.geo || !r.count) { window.alert('No Placemark points found in that KMZ / KML.'); setGeoBusy(false); return; }
      if (r.count !== points.length) {
        window.alert(
          `That file has ${r.count.toLocaleString()} points but this project has ${points.length.toLocaleString()}.\n\n` +
          'Coordinates can only be attached when the counts match, so each point lines up with the right location. ' +
          'Use "New Project (Import)" if this is a different layout.'
        );
        setGeoBusy(false); return;
      }
      setGeo(r.geo); setLastModified(Date.now());
      if (!viewPickedRef.current) setViewMode('sat');
      pushLog(`attached map coordinates from ${file.name}`);
    } catch (e) { window.alert('Could not read that file: ' + (e && e.message ? e.message : 'unknown')); }
    setGeoBusy(false);
  };
  const removeGeo = () => {
    if (!window.confirm('Remove the map coordinates from this project? Satellite view will be unavailable until you attach a KMZ again.')) return;
    setGeo(null); setViewMode('plan'); setLastModified(Date.now()); pushLog('removed map coordinates');
  };

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
  const dotEls = useMemo(() => points.map((d, i) => {
    const dim = selSection != null && sections && sections[i] !== selSection;
    const del = delSel.has(i);
    const code = del ? 'del' : glyphCode(stage[i], qc[i]);
    const sz = code === 'q1' || code === 'q2' ? 13 : 10;
    return <use key={i} data-i={i} href={glyphHref(code)} x={d[0] + PAD - sz / 2} y={d[1] + PAD - sz / 2} width={sz} height={sz} opacity={dim && !del ? 0.16 : 1} />;
  }), [points, stage, qc, selSection, sections, delSel]);

  /* outline around the selected block, so you can see which one you picked */
  const selHull = useMemo(() => {
    if (selSection == null || !sections) return null;
    const h = sectionHull(points, sections, selSection, 9);
    return h.length >= 3 ? h.map((p) => (p[0] + PAD) + ',' + (p[1] + PAD)).join(' ') : null;
  }, [selSection, sections, points, PAD]);

  const cloudLabel = cloudStatus === 'synced' ? 'Synced to cloud (shared)' : cloudStatus === 'syncing' ? 'Syncing…' : cloudStatus === 'offline' ? 'Offline — saved on device' : 'Connecting…';
  const cloudColor = cloudStatus === 'synced' ? '#22c55e' : cloudStatus === 'offline' ? GOLD : MUTE;
  const hasGeo = !!(geo && geo.lonLat && geo.lonLat.length);
  /* On a device that didn't do the import, the coordinates arrive from the
     cloud a moment after mount — drop into satellite view once they land,
     unless the user has already picked a view themselves. */
  const viewPickedRef = useRef(false);
  const chooseView = (v) => { viewPickedRef.current = true; setViewMode(v); };
  useEffect(() => { if (hasGeo && !viewPickedRef.current && viewMode === 'plan') setViewMode('sat'); }, [hasGeo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { viewPickedRef.current = false; }, [activeId]);
  const paintLabel = paintTokenLabel(paint, subtasks);
  const paintColor = paintTokenColor(paint, subtasks);

  /* per-section completion */
  const sectionStats = useMemo(() => {
    if (!sections || sectionCount < 2) return null;
    const arr = Array.from({ length: sectionCount }, () => ({ total: 0, sum: 0 }));
    const hasSubs = subtasks.length > 0;
    for (let i = 0; i < points.length; i++) {
      const s = sections[i]; if (s == null || !arr[s]) continue;
      const v = stage[i] || 0;
      arr[s].total++; arr[s].sum += v + (hasSubs && v < 4 ? subFraction(subtasks, sub, v + 1, i) : 0);
    }
    return arr.map((a, i) => ({ i, total: a.total, pct: a.total ? a.sum / (a.total * 4) * 100 : 0 }));
  }, [sections, sectionCount, stage, points, subtasks, sub]);

  const isAllowed = (tok) => !allowed || allowed.has(tok);
  const canEditQC = isAllowed('q2');
  const health = stats.orange > 0 ? { label: 'Action Required', color: ORANGE } : stats.yellow > 0 ? { label: 'Needs Review', color: QC_YELLOW } : { label: 'On Track', color: GREEN };
  const PHASE_ICON = [null, Cylinder, Box, Cable, LayoutGrid];
  const toolBtn = (on, red) => ({ flex: 1, minHeight: 58, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, background: on ? (red ? 'rgba(220,38,38,.18)' : 'rgba(249,115,22,.16)') : 'rgba(255,255,255,.03)', border: '1px solid ' + (on ? (red ? '#dc2626' : ORANGE) : 'rgba(255,255,255,.08)'), borderRadius: 10, color: on ? (red ? '#f87171' : ORANGE) : CREAM, fontFamily: NBF, fontWeight: 700, fontSize: 10.5, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer', padding: '6px 2px' });
  const panelHead = (Icon, txt, right) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <Icon size={18} color={ORANGE} strokeWidth={2.2} /><span style={kicker}>{txt}</span>
      {right && <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>{right}</div>}
    </div>
  );
  const legendBody = (
    <>
      {allowed && <div style={{ fontFamily: NBF, fontSize: 12.5, color: GOLD, background: 'rgba(234,179,8,.08)', border: '1px solid rgba(234,179,8,.3)', borderRadius: 8, padding: '8px 10px' }}>You're assigned to: {(scopeForActive || []).map((t) => (TASK_DEFS.find((x) => x.id === t) || {}).label).filter(Boolean).join(', ') || 'view only'}.</div>}

      {/* overall completion + health */}
      <div style={{ ...card(), display: 'flex', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={kicker}>Overall Completion</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
            <span style={{ fontFamily: BBF, fontSize: 40, color: ORANGE, lineHeight: .9, textShadow: '0 0 22px rgba(249,115,22,.35)' }}>{stats.overall.toFixed(1)}%</span>
            <div style={{ ...bar, flex: 1, marginTop: 0, height: 12, borderRadius: 6 }}><div style={{ height: '100%', width: stats.overall + '%', background: 'linear-gradient(90deg,' + ORANGE + ',' + GOLD + ')', borderRadius: 6, transition: 'width .25s' }} /></div>
          </div>
          <div style={{ fontFamily: NBF, fontSize: 12.5, color: '#c9c4bc', marginTop: 8 }}>{TOTAL.toLocaleString()} points{sectionCount > 1 ? ' · ' + sectionCount + ' sections' : ''} · {fmtDate(lastModified)}</div>
          <div style={{ fontFamily: NBF, fontSize: 12.5, marginTop: 3, color: cloudColor, display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: cloudColor, boxShadow: '0 0 8px ' + cloudColor }} />{cloudLabel}</div>
        </div>
        <div style={{ width: 88, flexShrink: 0, borderLeft: '1px solid rgba(255,255,255,.08)', paddingLeft: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 4 }}>
          <Activity size={26} color={health.color} />
          <div style={{ fontFamily: NBF, fontWeight: 700, fontSize: 12.5, letterSpacing: 1.5, textTransform: 'uppercase', color: health.color, lineHeight: 1.1 }}>{health.label}</div>
          <div style={{ fontFamily: NBF, fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: MUTE }}>Project Health</div>
        </div>
      </div>

      {/* tools */}
      <div style={{ display: 'flex', gap: 7 }}>
        {[{ k: 'brush', l: 'Brush', I: Paintbrush }, { k: 'fill', l: 'Fill', I: SquareDashed }, { k: 'pan', l: 'Pan', I: Move }].concat(isAdmin ? [{ k: 'delete', l: 'Delete', I: Trash2, red: true }] : []).map((t) => (
          <button key={t.k} onClick={() => { if (t.k === 'delete') { setMode(mode === 'delete' ? 'brush' : 'delete'); clearDel(); } else { if (mode === 'delete') clearDel(); setMode(t.k); } }} style={toolBtn(mode === t.k, t.red)}><t.I size={20} /><span>{t.l}</span></button>
        ))}
        <div style={{ width: 1, background: 'rgba(255,255,255,.1)', margin: '8px 1px' }} />
        <button onClick={undo} disabled={!canUndo} style={{ ...toolBtn(false), flex: '0 0 64px', color: ORANGE, opacity: canUndo ? 1 : .4 }}><Undo2 size={20} /><span>Undo</span></button>
      </div>
      <div style={{ fontFamily: NBF, fontSize: 11.5, color: MUTE, marginTop: -4 }}>
        {mode === 'brush' ? 'Drag across points to paint them.'
          : mode === 'delete' ? `Tap or drag over points to queue them, then press Delete. ${delSel.size ? delSel.size + ' queued.' : ''}`
          : mode === 'fill' ? `Drag a box to fill everything inside it — a single tap fills the whole ${sectionCount > 1 ? 'block' : 'plan'}.`
            : 'Drag to move the view. Tap a point for its status, history and notes.'}
      </div>

      {/* painting */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ ...kicker, color: ORANGE }}>Painting</span>
        <select value={paint} onChange={(e) => setPaint(e.target.value)} style={selectStyle}>
          {STAGES.some((s, i) => isAllowed('s' + i)) && (
            <optgroup label="Install Status">
              {STAGES.map((s, i) => (isAllowed('s' + i) ? <option key={i} value={'s' + i}>{s.name}</option> : null))}
            </optgroup>
          )}
          {STAGES.map((s, i) => {
            if (i === 0 || !isAllowed('s' + i)) return null;
            const list = subsForParent(subtasks, 's' + i);
            if (!list.length) return null;
            return (
              <optgroup key={'sub' + i} label={s.name + ' — subtasks'}>
                {list.map((t) => <option key={t.id} value={'k:' + t.id}>{t.label} ({t.weight}%)</option>)}
                {list.map((t) => <option key={t.id + '-c'} value={'n:' + t.id}>— clear {t.label}</option>)}
              </optgroup>
            );
          })}
          {(isAllowed('q1') || isAllowed('q2') || isAllowed('q0')) && (
            <optgroup label="Quality Check">
              {isAllowed('q1') && <option value="q1">Requires Attention (yellow)</option>}
              {isAllowed('q2') && <option value="q2">Flagged Issue (red)</option>}
              {isAllowed('q0') && <option value="q0">Clear Flag</option>}
            </optgroup>
          )}
        </select>
      </div>

      {/* install status */}
      <div style={card()}>
        {panelHead(BarChart3, 'Install Status (cumulative)', !allowed
          ? <button onClick={resetAll} title={'Reset every task in ' + scopeLabel()} style={{ ...miniBtn, color: ORANGE, borderColor: ORANGE }}>Reset All</button>
          : <span style={{ fontFamily: NBF, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: MUTE }}>4 phases</span>)}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 8 }}>
          {STAGES.slice(1).map((s, i) => { const tok = 's' + (i + 1); const k = i + 1; const cnt = stats.cum[k]; const p = TOTAL ? cnt / TOTAL * 100 : 0; const lock = !isAllowed(tok); const on = paint === tok && !lock; const I = PHASE_ICON[k]; return (
            <div key={i} onClick={() => { if (!lock) setPaint(tok); }} style={{ minWidth: 0, borderRadius: 10, padding: '9px 9px 8px', border: '1px solid ' + (on ? s.color : hexA(s.color, .35)), background: on ? hexA(s.color, .16) : hexA(s.color, .05), boxShadow: on ? `0 0 0 1px ${s.color}, 0 0 18px ${hexA(s.color, .3)}` : 'none', opacity: lock ? .5 : 1, cursor: lock ? 'default' : 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <Glyph code={tok} size={28} style={{ filter: 'drop-shadow(0 0 6px ' + hexA(s.color, .6) + ')' }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontFamily: NBF, fontSize: 12, color: CREAM, fontWeight: 600, lineHeight: 1.1, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.name}</div>
                  <div style={{ fontFamily: BBF, fontSize: 21, color: CREAM, lineHeight: 1, marginTop: 3 }}>{cnt.toLocaleString()}</div>
                </div>
                {!lock && <button title={'Clear "' + s.name + '" in ' + scopeLabel()} onClick={(e) => { e.stopPropagation(); resetStage(k); }} style={resetX(cnt > 0)}><RotateCcw size={14} /></button>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7 }}>
                <div style={{ ...bar, flex: 1, marginTop: 0, height: 6 }}><div style={{ height: '100%', width: p + '%', background: s.color, borderRadius: 3, boxShadow: '0 0 8px ' + hexA(s.color, .7) }} /></div>
                <span style={{ fontFamily: BBF, fontSize: 16, color: s.color, width: 34, textAlign: 'right' }}>{p.toFixed(0)}%</span>
              </div>
            </div>
          ); })}
        </div>
      </div>

      {/* quality checks */}
      <div style={card()}>
        {panelHead(ShieldCheck, 'Quality Checks')}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[{ q: 1, tok: 'q1', I: TriangleAlert, col: QC_YELLOW, l: 'Requires Attention', n: stats.yellow }, { q: 2, tok: 'q2', I: OctagonAlert, col: QC_ORANGE, l: 'Flagged Issue', n: stats.orange }].map((r) => (
            <div key={r.q} style={{ ...statusRow(paint === r.tok && isAllowed(r.tok)), cursor: isAllowed(r.tok) ? 'pointer' : 'default', opacity: isAllowed(r.tok) ? 1 : .5 }} onClick={() => { if (isAllowed(r.tok)) setPaint(r.tok); }}>
              <Glyph code={r.tok} size={24} style={{ filter: 'drop-shadow(0 0 6px ' + hexA(r.col, .6) + ')' }} />
              <span style={{ fontFamily: NBF, fontSize: 15, color: CREAM, flex: 1 }}>{r.l}</span>
              <span style={{ fontFamily: BBF, fontSize: 20, color: r.col }}>{r.n}</span>
              {isAllowed(r.tok) && <button title={'Clear these flags in ' + scopeLabel()} onClick={(e) => { e.stopPropagation(); resetQc(r.q); }} style={resetX(r.n > 0)}><RotateCcw size={14} /></button>}
              <ChevronRight size={16} color={MUTE} />
            </div>
          ))}
        </div>
        <div style={{ fontFamily: NBF, fontSize: 11, color: MUTE, marginTop: 8 }}>
          {selSection != null
            ? <>Resets apply to <span style={{ color: ORANGE }}>{sectionLabelFor(selSection)}</span> only — clear the block selection to reset everything.</>
            : 'Tap ↺ to clear a task. Select a block first to reset just that block.'}
        </div>
      </div>

      {/* subtasks */}
      <div style={card()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <ListChecks size={18} color={ORANGE} strokeWidth={2.2} /><span style={kicker}>Subtasks</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {subtasks.length > 0 && !subOpen && <button onClick={() => setQtyOpen(true)} style={{ ...miniBtn, color: GOLD, borderColor: GOLD }}>Quantities</button>}
            <button onClick={() => setSubOpen((v) => !v)} style={{ ...miniBtn, color: ORANGE, borderColor: subOpen ? ORANGE : 'rgba(255,255,255,.22)' }}>{subOpen ? 'Done' : 'Manage'}</button>
          </div>
        </div>
        {subtasks.length === 0 && !subOpen && <div style={{ fontFamily: NBF, fontSize: 12.5, color: MUTE }}>None yet. Add weighted subtasks under any install stage — each one credits its share of that stage.</div>}
        {subtasks.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: subOpen ? 10 : 0 }}>
            {STAGES.map((st, si) => {
              if (si === 0) return null;
              const list = subsForParent(subtasks, 's' + si);
              if (!list.length) return null;
              const total = list.reduce((a, b) => a + (+b.weight || 0), 0);
              return (
                <div key={si} style={{ background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 10, padding: '8px 8px 4px' }}>
                  <div style={{ fontFamily: NBF, fontWeight: 700, fontSize: 11.5, letterSpacing: 2, textTransform: 'uppercase', color: CREAM, display: 'flex', alignItems: 'center', gap: 7, paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,.06)', marginBottom: 4 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 5, background: st.color, boxShadow: '0 0 8px ' + st.color }} />{st.name}<span style={{ marginLeft: 'auto', color: total === 100 ? MUTE : GOLD }}>{total}%</span>
                  </div>
                  {list.map((t) => {
                    const done = (() => { const b = sub[t.id] || ''; let c = 0; for (let i = 0; i < b.length; i++) if (b[i] === '1') c++; return c; })();
                    const dp = TOTAL ? done / TOTAL * 100 : 0;
                    return (
                      <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
                        {subOpen ? (
                          <>
                            <input defaultValue={t.label} onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== t.label) updateSubtask(t.id, { label: e.target.value.trim() }); }} style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', borderBottom: '1px solid rgba(249,115,22,.35)', color: CREAM, fontFamily: NBF, fontSize: 13.5, padding: '4px 0', outline: 'none' }} />
                            <input type="number" min="1" max="100" defaultValue={t.weight} onBlur={(e) => { const w = Math.max(1, Math.min(100, Math.round(+e.target.value || 0))); if (w && w !== t.weight) updateSubtask(t.id, { weight: w }); e.target.value = w || t.weight; }} style={{ width: 50, background: 'transparent', border: '1px solid ' + PBORDER, borderRadius: 6, color: CREAM, fontFamily: NBF, fontSize: 12.5, padding: '4px 4px', outline: 'none' }} />
                            <button onClick={() => removeSubtask(t)} style={{ background: 'transparent', border: 'none', color: MUTE, fontSize: 19, lineHeight: 1, cursor: 'pointer', minWidth: 32, minHeight: 32 }}>&times;</button>
                          </>
                        ) : (
                          <div onClick={() => setPaint('k:' + t.id)} style={{ ...statusRow(paint === 'k:' + t.id), flex: 1, padding: '6px 8px', gap: 8 }}>
                            <span style={{ fontFamily: NBF, fontSize: 13.5, color: CREAM, flex: '0 1 38%', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.label}</span>
                            <span style={{ fontFamily: NBF, fontSize: 12, color: MUTE, minWidth: 34, textAlign: 'right' }}>{done.toLocaleString()}</span>
                            <div style={{ ...bar, flex: 1, marginTop: 0, height: 6 }}><div style={{ height: '100%', width: dp + '%', background: 'linear-gradient(90deg,' + ORANGE + ',' + GOLD + ')', borderRadius: 3 }} /></div>
                            <span style={{ fontFamily: BBF, fontSize: 14, color: CREAM, width: 32, textAlign: 'right' }}>{dp.toFixed(0)}%</span>
                            <button title={'Clear "' + t.label + '" in ' + scopeLabel()} onClick={(e) => { e.stopPropagation(); resetSubtask(t); }} style={{ ...resetX(done > 0), width: 26, height: 26 }}><RotateCcw size={13} /></button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
        {subOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid rgba(255,255,255,.08)', paddingTop: 9 }}>
            <select id="tt-sub-parent" defaultValue="s1" style={{ ...selectStyle, padding: '8px' }}>
              {STAGES.map((s, i) => (i === 0 ? null : <option key={i} value={'s' + i}>{s.name}</option>))}
            </select>
            <div style={{ display: 'flex', gap: 6 }}>
              <input id="tt-sub-label" placeholder="Subtask name" style={{ flex: 1, minWidth: 0, background: NAVY2, border: '1px solid ' + PBORDER, borderRadius: 8, color: CREAM, fontFamily: NBF, fontSize: 14, padding: '8px 9px', outline: 'none' }} />
              <input id="tt-sub-weight" type="number" min="1" max="100" defaultValue="50" style={{ width: 62, background: NAVY2, border: '1px solid ' + PBORDER, borderRadius: 8, color: CREAM, fontFamily: NBF, fontSize: 14, padding: '8px 6px', outline: 'none' }} />
            </div>
            <button onClick={() => {
              const p = document.getElementById('tt-sub-parent'), l = document.getElementById('tt-sub-label'), w = document.getElementById('tt-sub-weight');
              if (!p || !l || !w) return;
              addSubtask(p.value, l.value, w.value); l.value = '';
            }} style={{ ...ctaBtn, padding: '10px 0', fontSize: 12 }}>+ Add Subtask</button>
            <div style={{ fontFamily: NBF, fontSize: 11, color: MUTE }}>Weights are a percentage of the parent stage. When a point's completed subtasks reach 100%, it advances to that stage automatically.</div>
          </div>
        )}
      </div>

      {/* blocks */}
      {sectionStats && (
        <div style={card()}>
          {panelHead(MapIcon, 'Blocks (' + sectionCount + ')', selSection != null ? <button onClick={() => setSelSection(null)} style={{ ...miniBtn, color: ORANGE, borderColor: ORANGE }}>Clear</button> : null)}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 230, overflowY: 'auto' }}>
            {sectionStats.map((s) => {
              const on = selSection === s.i;
              return (
                <div key={s.i} onClick={() => setSelSection(on ? null : s.i)} title="Tap to highlight this block on the map"
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', cursor: 'pointer', borderRadius: 8, border: '1px solid ' + (on ? ORANGE : 'rgba(255,255,255,.06)'), background: on ? 'rgba(249,115,22,.14)' : 'rgba(255,255,255,.03)' }}>
                  <MapPin size={18} color={ORANGE} style={{ flexShrink: 0 }} />
                  <input value={sectionNames[s.i] || ''} placeholder={'Block ' + (s.i + 1)} onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setSectionNames((prev) => Object.assign({}, prev, { [s.i]: e.target.value }))}
                    onBlur={(e) => renameSection(s.i, e.target.value)}
                    style={{ width: 74, flexShrink: 0, background: 'transparent', border: 'none', borderBottom: '1px solid rgba(249,115,22,.22)', color: on ? ORANGE : CREAM, fontFamily: NBF, fontSize: 14, fontWeight: 600, padding: '2px 0', outline: 'none' }} />
                  <div style={{ ...bar, flex: 1, marginTop: 0, height: 8 }}><div style={{ height: '100%', width: s.pct + '%', background: 'linear-gradient(90deg,' + ORANGE + ',' + GOLD + ')', borderRadius: 4 }} /></div>
                  <span style={{ fontFamily: BBF, fontSize: 16, color: CREAM, width: 38, textAlign: 'right' }}>{s.pct.toFixed(0)}%</span>
                  <ChevronRight size={16} color={MUTE} />
                </div>
              );
            })}
          </div>
          <div style={{ fontFamily: NBF, fontSize: 11, color: MUTE, marginTop: 8 }}>Type to name a block. Tap a row to outline it on the map.</div>
        </div>
      )}

      {/* site photo */}
      <div style={card()}>
        {panelHead(ImageIcon, 'Site Photo', bg ? <button onClick={toggleBg} style={{ ...miniBtn, color: bgOn ? GREEN : MUTE, borderColor: bgOn ? GREEN : 'rgba(255,255,255,.22)' }}>{bgOn ? 'On' : 'Off'}</button> : null)}
        {!bg ? (
          <label style={{ ...ghostBtn, display: 'block', textAlign: 'center', padding: '11px 0', cursor: bgBusy ? 'default' : 'pointer', opacity: bgBusy ? .6 : 1 }}>{bgBusy ? 'Loading…' : 'Add Background Photo'}<input type="file" accept="image/*" hidden disabled={bgBusy} onChange={(e) => onBgUpload(e.target.files[0])} /></label>
        ) : (<>
          <button onClick={() => { const nm = mode === 'bg' ? 'brush' : 'bg'; setMode(nm); if (nm === 'bg') setSheetOpen(false); }} style={{ ...segBtn(mode === 'bg'), width: '100%', marginBottom: 8 }}>{mode === 'bg' ? 'Done — drag map to move photo' : 'Align Photo'}</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><span style={{ fontFamily: NBF, fontSize: 12, color: MUTE, width: 52 }}>Size</span><input type="range" min="0.2" max="4" step="0.02" value={bg.scale || 1} onChange={(e) => setBgScale(+e.target.value)} style={{ flex: 1, accentColor: ORANGE }} /></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><span style={{ fontFamily: NBF, fontSize: 12, color: MUTE, width: 52 }}>Opacity</span><input type="range" min="0.1" max="1" step="0.05" value={bg.opacity != null ? bg.opacity : 0.85} onChange={(e) => setBgOpacity(+e.target.value)} style={{ flex: 1, accentColor: ORANGE }} /></div>
          <div style={{ display: 'flex', gap: 7 }}>
            <label style={{ ...ghostBtn, flex: 1, textAlign: 'center', padding: '9px 0', fontSize: 12, cursor: 'pointer' }}>Replace<input type="file" accept="image/*" hidden onChange={(e) => onBgUpload(e.target.files[0])} /></label>
            <button onClick={removeBg} style={{ ...ghostBtn, flex: 1, padding: '9px 0', fontSize: 12, color: '#f87171', borderColor: 'rgba(248,113,113,.5)', background: 'rgba(248,113,113,.06)' }}>Remove</button>
          </div>
        </>)}
      </div>

      {/* site map */}
      <div style={card()}>
        {panelHead(Layers, 'Site Map', hasGeo ? <button onClick={removeGeo} style={{ ...miniBtn, color: MUTE }}>Remove</button> : null)}
        {hasGeo ? (
          <div style={{ fontFamily: NBF, fontSize: 13, color: GREEN }}>Coordinates attached — satellite view available.</div>
        ) : (<>
          <label style={{ ...ghostBtn, display: 'block', textAlign: 'center', padding: '11px 0', cursor: geoBusy ? 'default' : 'pointer', opacity: geoBusy ? .6 : 1 }}>
            {geoBusy ? 'Reading…' : 'Add Map Coordinates (KMZ)'}
            <input type="file" accept=".kmz,.kml" hidden disabled={geoBusy} onChange={(e) => onGeoUpload(e.target.files[0])} />
          </label>
          <div style={{ fontFamily: NBF, fontSize: 11, color: MUTE, marginTop: 6 }}>Upload the KMZ this layout came from to turn on satellite view. It must have the same number of points ({points.length.toLocaleString()}); your progress is kept.</div>
        </>)}
      </div>

      {/* actions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <button onClick={handleExport} style={{ ...ctaBtn, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 50 }}><FileText size={18} />{exporting ? 'Rendering…' : 'Export PDF'}</button>
        <button onClick={() => setModelsOpen(true)} style={{ ...ghostBtn, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 50, padding: '10px 8px', fontSize: 12 }}><Box size={18} />3D Model / Versions</button>
      </div>
      <button onClick={() => setHistoryOpen(true)} style={{ ...ghostBtn, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48 }}><History size={18} />Edit History ({log.length})</button>
    </>
  );

  const sectionLabel = (txt) => (<div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: NBF, fontSize: 12, fontWeight: 700, letterSpacing: '3px', textTransform: 'uppercase', color: ORANGE }}><span style={{ width: 22, height: 2, background: ORANGE, display: 'inline-block' }} />{txt}</div>);

  const visibleProjects = (isAdmin || !assignedSet) ? projects : projects.filter((p) => assignedSet.has(p.id));

  /* ---- projects dashboard view ---- */
  if (view === 'dashboard') {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: `radial-gradient(120% 80% at 50% -10%, #151d3a 0%, ${NAVY} 50%, #05081a 100%)`, display: 'flex', flexDirection: 'column', fontFamily: NBF, color: CREAM, overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: mob ? 6 : 12, padding: mob ? '6px 10px 6px 4px' : '12px 22px', background: 'rgba(5,8,18,.92)', backdropFilter: 'blur(14px)', borderBottom: '1px solid ' + PBORDER, position: 'sticky', top: 0, zIndex: 5 }}>
          {onExit && <button onClick={onExit} style={backBtn} aria-label="Back"><ArrowLeft size={22} /></button>}
          <img src={LOGO_URL} alt="SRC" style={{ width: mob ? 32 : 38, height: mob ? 32 : 38, objectFit: 'contain', borderRadius: 4 }} />
          <div style={{ fontFamily: BBF, fontSize: mob ? 20 : 27, letterSpacing: 1.5, color: CREAM, marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>TASK TRACKER <span style={{ width: 1, height: 22, background: 'rgba(255,255,255,.2)' }} /><span style={{ color: ORANGE }}>PROJECTS</span></div>
        </div>
        <div style={{ padding: mob ? 14 : 28, paddingBottom: mob ? 'calc(24px + var(--sab, 0px))' : 40, maxWidth: 1100, margin: '0 auto', width: '100%' }}>
          {sectionLabel('Select a Project')}
          {visibleProjects.length === 0 && <div style={{ fontFamily: NBF, fontSize: 15, color: MUTE, marginTop: 16 }}>No projects have been assigned to you yet. Contact your administrator.</div>}
          <div style={{ display: 'grid', gridTemplateColumns: mob ? 'minmax(0,1fr)' : 'repeat(auto-fill,minmax(400px,1fr))', gap: 14, marginTop: 14 }}>
            {visibleProjects.map((pr) => {
              const d = normalizeDoc(storage.get(projKey(pr.id))); const s = computeStats(d.stage, d.qc, d.subtasks, d.sub);
              const hl = s.orange > 0 ? { label: 'Action Required', color: ORANGE } : s.yellow > 0 ? { label: 'Needs Review', color: QC_YELLOW } : { label: 'On Track', color: GREEN };
              const thumb = mob ? 112 : 150;
              return (
                <div key={pr.id} onClick={() => openProject(pr.id)} style={{ cursor: 'pointer', minWidth: 0, background: PBOX, border: '1px solid ' + PBORDER, borderRadius: 14, padding: 12, display: 'flex', gap: 12, alignItems: 'center', boxShadow: '0 10px 30px rgba(0,0,0,.45)', transition: 'border-color .15s, transform .15s' }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = ORANGE; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = PBORDER; e.currentTarget.style.transform = 'none'; }}>
                  <div style={{ width: thumb, height: thumb, flexShrink: 0, borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(249,115,22,.5)', background: 'radial-gradient(90% 90% at 50% 40%, #16204a 0%, #0b1129 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ReadonlyMap points={d.points} w={d.w} h={d.h} stage={d.stage} qc={d.qc} height={thumb - 8} mob={mob} bg={d.bg} bgOn={!!(d.bg && d.bg.on)} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontFamily: BBF, fontSize: mob ? 21 : 24, color: CREAM, letterSpacing: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{(pr.name || 'Project').toUpperCase()}</span>
                      <ChevronRight size={20} color={ORANGE} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                      <RingPct pct={s.overall} size={mob ? 62 : 72} />
                      <div style={{ borderLeft: '1px solid rgba(255,255,255,.1)', paddingLeft: 10, display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: NBF, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: MUTE, whiteSpace: 'nowrap' }}><BarChart3 size={14} color={MUTE} /><b style={{ fontFamily: BBF, fontSize: 17, color: CREAM, letterSpacing: .5 }}>{s.N.toLocaleString()}</b> points</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: NBF, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: MUTE, whiteSpace: 'nowrap' }}><Clock size={14} color={MUTE} />{d.lastModified ? new Date(d.lastModified).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'No edits yet'}</div>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start', border: '1px solid ' + hl.color, color: hl.color, borderRadius: 20, padding: '4px 10px', fontFamily: NBF, fontWeight: 700, fontSize: 10.5, letterSpacing: 1.5, textTransform: 'uppercase', whiteSpace: 'nowrap' }}><span style={{ width: 7, height: 7, borderRadius: 4, background: hl.color, boxShadow: '0 0 6px ' + hl.color }} />{hl.label}</div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {isAdmin && (
              <div onClick={() => setImportOpen(true)} style={{ cursor: 'pointer', border: '1.5px dashed rgba(249,115,22,.6)', borderRadius: 14, padding: mob ? 14 : 18, display: 'flex', alignItems: 'center', gap: 14, minHeight: 110, background: 'rgba(249,115,22,.04)' }}>
                <FileUp size={mob ? 40 : 48} color={ORANGE} strokeWidth={1.6} style={{ flexShrink: 0 }} />
                <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(249,115,22,.4)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: BBF, fontSize: mob ? 20 : 24, letterSpacing: 1.5, color: ORANGE }}>+ NEW PROJECT (IMPORT)</div>
                  <div style={{ fontFamily: NBF, fontSize: 12.5, color: MUTE, marginTop: 2 }}>Import a pile plan or KMZ to start tracking a new site</div>
                </div>
                <ChevronRight size={22} color={ORANGE} />
              </div>
            )}
          </div>
        </div>
        {importOpen && <ImportModal mob={mob} onClose={() => setImportOpen(false)} onCreate={createProject} />}
      </div>
    );
  }

  /* ---- tracker view ---- */
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: `radial-gradient(120% 80% at 50% -10%, #151d3a 0%, ${NAVY} 50%, #05081a 100%)`, display: 'flex', flexDirection: 'column', fontFamily: NBF, color: CREAM }}>
      <GlyphDefs />
      <div style={{ display: 'flex', alignItems: 'center', gap: mob ? 6 : 12, padding: mob ? '6px 10px 6px 2px' : '12px 22px', background: 'rgba(5,8,18,.92)', backdropFilter: 'blur(14px)', borderBottom: '1px solid ' + PBORDER }}>
        <button onClick={() => setView('dashboard')} style={backBtn} title="Back to projects" aria-label="Back to projects"><ArrowLeft size={22} /></button>
        <img src={LOGO_URL} alt="SRC" style={{ width: mob ? 30 : 36, height: mob ? 30 : 36, objectFit: 'contain', borderRadius: 4 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: BBF, fontSize: mob ? 18 : 24, letterSpacing: 1.2, color: CREAM, lineHeight: .95 }}>TASK TRACKER</div>
          <button onClick={() => setProjOpen(true)} style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, maxWidth: mob ? 150 : 260, minHeight: 22 }}>
            <span style={{ fontFamily: NBF, fontSize: mob ? 12 : 13, fontWeight: 700, letterSpacing: 1.5, color: ORANGE, textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{projName}</span><span style={{ color: ORANGE, fontSize: 10 }}>&#9662;</span>
          </button>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: mob ? 8 : 14 }}>
          <div style={{ textAlign: 'right', lineHeight: 1, minWidth: mob ? 60 : 90 }}>
            <div style={{ fontFamily: BBF, fontSize: mob ? 22 : 30, color: ORANGE, textShadow: '0 0 18px rgba(249,115,22,.4)' }}>{stats.overall.toFixed(0)}%</div>
            <div style={{ height: 5, background: 'rgba(255,255,255,.12)', borderRadius: 3, overflow: 'hidden', marginTop: 3 }}><div style={{ height: '100%', width: stats.overall + '%', background: 'linear-gradient(90deg,' + ORANGE + ',' + GOLD + ')' }} /></div>
            {!mob && <div style={{ fontFamily: NBF, fontSize: 9, letterSpacing: 2, color: MUTE, textTransform: 'uppercase', marginTop: 3 }}>Complete</div>}
          </div>
          {/* Export stays available on phones — the PDF goes to the share sheet there. */}
          <button onClick={handleExport} aria-label="Export PDF" style={mob ? { ...ctaBtn, padding: 0, width: 46, height: 46, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, fontSize: 9, letterSpacing: 1 } : ctaBtn}>{mob ? <><FileText size={20} />PDF</> : 'Export PDF'}</button>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {!mob && (
          <div style={{ width: 340, flexShrink: 0, background: PANEL, borderRight: '1px solid ' + LINE, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {sectionLabel('Status Legend')}
            {legendBody}
          </div>
        )}
        <div onContextMenu={(e) => e.preventDefault()} style={{ flex: 1, position: 'relative', minWidth: 0, background: 'radial-gradient(110% 90% at 50% 0%, #0e1426 0%, #080b16 60%, #05060d 100%)' }}>
          {viewMode === 'sat' && hasGeo ? (
            <TTMapView
              geo={geo}
              stage={stage}
              qc={qc}
              sections={sections}
              sectionNames={sectionNames}
              selSection={selSection}
              layerMode={tileLayer}
              onLayerMode={setTileLayer}
              active={notePt}
              mode={mode}
              marked={delSel}
              onPickPoint={overlayPick}
              onBrushStart={overlayBrushStart}
              onBrushPoint={overlayBrushPoint}
              onBrushEnd={overlayBrushEnd}
              onRegionPoints={fillRegion}
            />
          ) : viewMode === 'model' ? (
            <TTModelView
              projectId={activeId}
              points={points}
              planW={planW}
              planH={planH}
              stage={stage}
              qc={qc}
              sections={sections}
              selSection={selSection}
              overlay3d={overlay3d}
              onSaveOverlay={saveOverlay3d}
              mode={mode}
              canAlign={isAdmin}
              onModelBuffer={(b) => { modelBufRef.current = b; }}
              dispColor={dispColor}
              marked={delSel}
              onPickPoint={overlayPick}
              onBrushStart={overlayBrushStart}
              onBrushPoint={overlayBrushPoint}
              onBrushEnd={overlayBrushEnd}
              onRegionPoints={fillRegion}
            />
          ) : (
            <svg ref={svgRef} viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: mode === 'pan' ? 'grab' : mode === 'bg' ? 'move' : 'crosshair' }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endPointer} onPointerCancel={endPointer}
              onClick={(e) => { if (modeRef.current !== 'pan' || pannedRef.current) { pannedRef.current = false; return; } const el = e.target; if (el && el.dataset && el.dataset.i != null) setNotePt(+el.dataset.i); }}>
              <g transform={`translate(${vw.x} ${vw.y}) scale(${vw.s})`}>
                {bg && bgOn && <image href={bg.url} x={bg.x + PAD} y={bg.y + PAD} width={bgDims(bg, planW).w} height={bgDims(bg, planW).h} opacity={bg.opacity != null ? bg.opacity : 0.85} preserveAspectRatio="none" style={{ pointerEvents: 'none' }} />}
                {bg && bgOn && mode === 'bg' && <rect x={bg.x + PAD} y={bg.y + PAD} width={bgDims(bg, planW).w} height={bgDims(bg, planW).h} fill="none" stroke={ORANGE} strokeWidth={1.5 / vw.s} strokeDasharray={`${6 / vw.s} ${4 / vw.s}`} style={{ pointerEvents: 'none' }} />}
                {dotEls}
                {selHull && <polygon points={selHull} fill="rgba(249,115,22,.10)" stroke={ORANGE} strokeWidth={2 / vw.s} strokeLinejoin="round" style={{ pointerEvents: 'none', filter: 'drop-shadow(0 0 6px rgba(249,115,22,.7))' }} />}
              </g>
              {marq && (() => { const r = normRect(marq.a, marq.b); return <rect x={r.x0} y={r.y0} width={r.x1 - r.x0} height={r.y1 - r.y0} fill="rgba(249,115,22,.14)" stroke={ORANGE} strokeWidth={1.4} strokeDasharray="6 4" style={{ pointerEvents: 'none' }} />; })()}
            </svg>
          )}
          {/* on phones this drops to a second row so it clears the satellite/streets toggle */}
          <div style={{ position: 'absolute', top: mob ? 58 : 10, right: 14, zIndex: 600, display: 'flex', background: 'rgba(10,14,26,.88)', border: '1px solid ' + LINE, padding: 3, backdropFilter: 'blur(6px)' }}>
            {[{ k: 'plan', l: 'Plan' }, { k: 'sat', l: 'Satellite', need: hasGeo }, { k: 'model', l: '3D Model' }].map((v) => (
              v.need === false ? null : (
                <button key={v.k} onClick={() => chooseView(v.k)} title={v.k === 'sat' && !hasGeo ? 'Import a KMZ to enable satellite view' : ''}
                  style={{ background: viewMode === v.k ? ORANGE : 'transparent', color: viewMode === v.k ? '#1a1206' : CREAM, border: 'none', padding: mob ? '10px 11px' : '6px 12px', minHeight: mob ? 40 : undefined, fontFamily: NBF, fontWeight: 700, fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' }}>{mob && v.k === 'model' ? '3D' : v.l}</button>
              )
            ))}
          </div>
          {selSection != null && (
            <div style={mob
              ? { position: 'absolute', left: 12, bottom: 'calc(12px + var(--sab, 0px))', zIndex: 601, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(10,14,26,.92)', border: '1px solid ' + ORANGE, padding: '6px 10px', backdropFilter: 'blur(6px)', maxWidth: 'calc(100% - 90px)' }
              : { position: 'absolute', top: 54, right: 14, zIndex: 600, display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(10,14,26,.88)', border: '1px solid ' + ORANGE, padding: '5px 10px', backdropFilter: 'blur(6px)' }}>
              <span style={{ fontFamily: NBF, fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase', color: ORANGE, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sectionLabelFor(selSection)}</span>
              <button onClick={() => setSelSection(null)} style={{ background: 'transparent', border: 'none', color: MUTE, fontSize: 20, lineHeight: 1, cursor: 'pointer', minWidth: 32, minHeight: 32 }}>&times;</button>
            </div>
          )}
          {mob && (
            <div onClick={() => setLegendOpen((v) => !v)} style={{ position: 'absolute', left: 12, bottom: `calc(${selSection != null ? 62 : 12}px + var(--sab, 0px))`, zIndex: 600, background: 'rgba(6,9,20,.9)', border: '1px solid ' + PBORDER, borderRadius: 10, padding: legendOpen ? '8px 10px' : '7px 10px', backdropFilter: 'blur(6px)', maxWidth: 222, cursor: 'pointer' }}>
              {legendOpen ? (<>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 10px' }}>
                  {STAGES.slice(1).map((s, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: NBF, fontWeight: 700, fontSize: 9.5, letterSpacing: 1, textTransform: 'uppercase', color: CREAM, whiteSpace: 'nowrap' }}><Glyph code={'s' + (i + 1)} size={15} />{s.name.replace(' Installed', '')}</div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,.08)', fontFamily: NBF, fontWeight: 700, fontSize: 9.5, letterSpacing: 1, textTransform: 'uppercase', color: CREAM }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Glyph code="q1" size={13} />Attention <b style={{ color: QC_YELLOW }}>{stats.yellow}</b></span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Glyph code="q2" size={13} />Flagged <b style={{ color: QC_ORANGE }}>{stats.orange}</b></span>
                </div>
              </>) : (<div style={{ fontFamily: NBF, fontWeight: 700, fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: ORANGE }}>Legend &#9652;</div>)}
            </div>
          )}
          {viewMode === 'plan' && (
            <div style={{ position: 'absolute', bottom: mob ? 'calc(14px + var(--sab, 0px))' : 18, right: 14, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
              <button onClick={() => zoomB(1.3)} style={zbtn}>+</button>
              <span style={{ fontFamily: BBF, fontSize: 13, color: CREAM, background: 'rgba(4,4,12,.75)', border: '1px solid ' + LINE, padding: '1px 5px', minWidth: 34, textAlign: 'center' }}>{Math.round(vw.s * 100)}%</span>
              <button onClick={() => zoomB(1 / 1.3)} style={zbtn}>&minus;</button>
              <button onClick={resetView} style={{ ...zbtn, fontSize: 12, fontFamily: NBF }} title="Fit">FIT</button>
            </div>
          )}
        </div>
      </div>

      {mob && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '8px 10px', paddingBottom: 'calc(8px + var(--sab, 0px))', background: 'rgba(5,8,18,.96)', borderTop: '1px solid ' + PBORDER }}>
          {mode === 'delete' ? (
            /* delete mode: what's queued + the two actions */
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Trash2 size={18} color="#f87171" style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, fontFamily: NBF, fontWeight: 600, fontSize: 15, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{delSel.size ? `${delSel.size} point${delSel.size === 1 ? '' : 's'} selected` : 'Tap or drag over points to remove'}</span>
              <button onClick={clearDel} disabled={!delSel.size} style={{ ...ghostBtn, padding: '10px 13px', minHeight: 44, opacity: delSel.size ? 1 : .4 }}>Clear</button>
              <button onClick={deleteMarked} disabled={!delSel.size} style={{ ...ctaBtn, background: '#dc2626', color: '#fff', padding: '10px 14px', minHeight: 44, boxShadow: 'none', opacity: delSel.size ? 1 : .4 }}>Delete</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={() => setSheetOpen(true)} style={{ ...ctaBtn, padding: '10px 14px', minHeight: 44, display: 'flex', alignItems: 'center', gap: 8 }}>Status &#9650;</button>
              <div onClick={() => setSheetOpen(true)} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, minHeight: 44, cursor: 'pointer' }}>
                <span style={{ width: 16, height: 16, borderRadius: 8, background: paintColor, flexShrink: 0, boxShadow: '0 0 8px ' + paintColor }} />
                <span style={{ fontFamily: NBF, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 13 }}>{paintLabel}</span>
              </div>
              <button onClick={undo} disabled={!canUndo} aria-label="Undo" style={{ ...ghostBtn, padding: 0, width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: canUndo ? 1 : .4 }}><Undo2 size={20} /></button>
            </div>
          )}
          {/* explicit tool row — no more cycling through modes blind */}
          <div style={{ display: 'grid', gridTemplateColumns: isAdmin ? '1fr 1fr 1fr 1fr' : '1fr 1fr 1fr', gap: 6 }}>
            {[{ k: 'brush', l: 'Brush', hint: 'Drag to paint', I: Paintbrush }, { k: 'fill', l: 'Fill', hint: 'Box or tap a block', I: SquareDashed }, { k: 'pan', l: 'Pan', hint: 'Move & pinch', I: Move }].concat(isAdmin ? [{ k: 'delete', l: 'Delete', hint: 'Remove points', I: Trash2 }] : []).map((t) => {
              const on = mode === t.k; const red = t.k === 'delete';
              return (
                <button key={t.k} onClick={() => { if (mode === 'delete' && t.k !== 'delete') clearDel(); setMode(t.k); }}
                  style={{ minHeight: 60, padding: '6px 4px', borderRadius: 10, border: '1px solid ' + (on ? (red ? '#dc2626' : ORANGE) : 'rgba(255,255,255,.09)'), background: on ? (red ? 'rgba(220,38,38,.18)' : 'rgba(249,115,22,.16)') : 'rgba(255,255,255,.03)', color: on ? (red ? '#f87171' : ORANGE) : CREAM, fontFamily: NBF, fontWeight: 700, fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                  <t.I size={20} />
                  <span>{t.l}</span>
                  <span style={{ fontSize: 9, letterSpacing: .3, textTransform: 'none', fontWeight: 500, opacity: .75, color: CREAM }}>{t.hint}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {mob && sheetOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2100, background: 'rgba(0,0,0,.55)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }} onClick={() => setSheetOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: `linear-gradient(180deg,${NAVY2}, ${NAVY})`, border: '1px solid ' + ORANGE, borderBottom: 'none', borderRadius: '18px 18px 0 0', padding: 14, paddingBottom: 'calc(14px + var(--sab, 0px))', maxHeight: '88dvh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <ListChecks size={26} color={ORANGE} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontFamily: BBF, fontSize: 20, letterSpacing: 1.5, color: CREAM, lineHeight: 1, whiteSpace: 'nowrap' }}>TASK TRACKER</div>
                <button onClick={() => { setSheetOpen(false); setProjOpen(true); }} style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: NBF, fontWeight: 700, fontSize: 12, letterSpacing: 1.5, color: ORANGE, textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{projName} &#9662;</button>
              </div>
              <div style={{ textAlign: 'right', lineHeight: 1 }}>
                <div style={{ fontFamily: BBF, fontSize: 26, color: ORANGE }}>{stats.overall.toFixed(0)}%</div>
                <div style={{ fontFamily: NBF, fontSize: 9, letterSpacing: 1.5, color: MUTE, textTransform: 'uppercase', marginTop: 2 }}>Project progress</div>
              </div>
              <button onClick={() => setSheetOpen(false)} aria-label="Close" style={{ ...xBtn, minWidth: 40, minHeight: 40 }}>&times;</button>
            </div>
            {legendBody}
            <button onClick={() => setSheetOpen(false)} style={{ ...ctaBtn, padding: '14px 0', fontSize: 15 }}>Done</button>
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
            <div style={{ fontFamily: NBF, fontSize: 13, color: MUTE }}>Status: {STAGES[stage[notePt]].name}{qc[notePt] ? ' · ' + (qc[notePt] === 2 ? 'Flagged Issue' : 'Requires Attention') : ''}{sections ? ' · ' + sectionLabelFor(sections[notePt]) : ''}</div>
            {(() => {
              const next = (stage[notePt] || 0) + 1;
              const list = next <= 4 ? subsForParent(subtasks, 's' + next) : [];
              if (!list.length) return null;
              return (
                <div style={{ border: '1px solid ' + LINE, padding: '7px 9px' }}>
                  <div style={{ fontFamily: NBF, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: MUTE, marginBottom: 4 }}>Toward {STAGES[next].name} · {Math.round(subFraction(subtasks, sub, next, notePt) * 100)}%</div>
                  {list.map((t) => { const done = (sub[t.id] || '')[notePt] === '1'; return (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: NBF, fontSize: 13, color: done ? CREAM : MUTE, padding: '1px 0' }}>
                      <span style={{ width: 11, height: 11, background: done ? STAGES[next].color : 'transparent', border: '1px solid ' + (done ? STAGES[next].color : 'rgba(255,255,255,.3)'), flexShrink: 0 }} />
                      <span style={{ flex: 1 }}>{t.label}</span><span>{t.weight}%</span>
                    </div>
                  ); })}
                </div>
              );
            })()}
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

      {qtyOpen && <QuantitiesModal mob={mob} blocks={blocks} subtasks={subtasks} countIn={subCountIn} onClose={() => setQtyOpen(false)} onApply={applySubQuantities} />}
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
/*  Quantities modal — type how many points are done per block          */
/* ------------------------------------------------------------------ */
function QuantitiesModal({ mob, blocks, subtasks, countIn, onClose, onApply }) {
  /* current counts, keyed block:subtask — the draft starts from reality */
  const base = useMemo(() => {
    const o = {};
    blocks.forEach((b, bi) => subtasks.forEach((t) => { o[bi + ':' + t.id] = countIn(t.id, b.idxs); }));
    return o;
  }, [blocks, subtasks, countIn]);
  const [draft, setDraft] = useState(base);
  useEffect(() => { setDraft(base); }, [base]);

  const parents = useMemo(() => {
    const seen = [];
    STAGES.forEach((s, i) => { if (i && subsForParent(subtasks, 's' + i).length) seen.push({ i, s, list: subsForParent(subtasks, 's' + i) }); });
    return seen;
  }, [subtasks]);

  const dirty = Object.keys(draft).some((k) => (+draft[k] || 0) !== (base[k] || 0));
  const apply = () => {
    const changes = [];
    blocks.forEach((b, bi) => subtasks.forEach((t) => {
      const k = bi + ':' + t.id;
      const q = Math.max(0, Math.min(b.idxs.length, Math.round(+draft[k] || 0)));
      changes.push({ subId: t.id, idxs: b.idxs, q, cur: base[k] || 0 });
    }));
    onApply(changes); onClose();
  };
  const setVal = (k, v, max) => setDraft((p) => Object.assign({}, p, { [k]: v === '' ? '' : Math.max(0, Math.min(max, Math.round(+v || 0))) }));

  return (
    <div style={overlay(mob)} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modalCard(mob, 640), gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={headTitle}>Enter Quantities</div>
          <button onClick={onClose} style={{ ...xBtn, marginLeft: 'auto' }}>&times;</button>
        </div>
        <div style={{ fontFamily: NBF, fontSize: 13, color: MUTE }}>Type how many points are complete for each subtask, per block. Points already marked stay marked — only the difference moves.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '52vh', overflowY: 'auto' }}>
          {blocks.map((b, bi) => (
            <div key={bi} style={{ border: '1px solid ' + LINE, padding: 11 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                <span style={{ fontFamily: BBF, fontSize: 18, letterSpacing: 1, color: ORANGE }}>{b.label}</span>
                <span style={{ fontFamily: NBF, fontSize: 12, color: MUTE }}>{b.idxs.length.toLocaleString()} points</span>
              </div>
              {parents.map((p) => (
                <div key={p.i} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: NBF, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: MUTE, marginBottom: 4 }}>
                    <span style={{ width: 9, height: 9, background: p.s.color, clipPath: CLIP }} />{p.s.name}
                  </div>
                  {p.list.map((t) => {
                    const k = bi + ':' + t.id; const cur = base[k] || 0; const val = draft[k];
                    const changed = (+val || 0) !== cur && val !== '';
                    return (
                      <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0 3px 15px' }}>
                        <span style={{ fontFamily: NBF, fontSize: 14, color: CREAM, flex: 1, minWidth: 0 }}>{t.label} <span style={{ color: MUTE, fontSize: 12 }}>({t.weight}%)</span></span>
                        <input type="number" min="0" max={b.idxs.length} value={val} onFocus={(e) => e.target.select()}
                          onChange={(e) => setVal(k, e.target.value, b.idxs.length)}
                          style={{ width: 78, background: 'rgba(255,255,255,.05)', border: '1px solid ' + (changed ? ORANGE : LINE), color: changed ? ORANGE : CREAM, fontFamily: NBF, fontSize: 15, padding: '5px 7px', outline: 'none', textAlign: 'right' }} />
                        <span style={{ fontFamily: NBF, fontSize: 12, color: MUTE, width: 62 }}>of {b.idxs.length.toLocaleString()}</span>
                        <button onClick={() => setVal(k, b.idxs.length, b.idxs.length)} style={{ ...miniBtn, padding: '3px 8px', color: MUTE }}>All</button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div style={{ fontFamily: NBF, fontSize: 11, color: MUTE }}>When a point's subtasks add up to 100% of a stage it advances to that stage; drop it back below 100% and it returns.</div>
        <button disabled={!dirty} onClick={apply} style={{ ...ctaBtn, padding: '13px 0', opacity: dirty ? 1 : .5 }}>Apply Quantities</button>
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
  const isGeo = (f) => f && /\.(kmz|kml)$/i.test(f.name);
  const run = async (f, sens) => {
    if (!f) return; setBusy(true); setErr('');
    try {
      const r = isGeo(f) ? await processKmzImport(f) : await processImport(f, sens);
      setResult(r);
      if (!r.count) setErr(isGeo(f) ? 'No Placemark points found in the KMZ / KML.' : 'No dots detected — try adjusting the sensitivity.');
    } catch (e) { setErr('Import failed: ' + (e && e.message ? e.message : 'unknown')); setResult(null); }
    setBusy(false);
  };
  const onFile = (f) => { if (!f) return; setFile(f); if (!name) setName(f.name.replace(/\.[^.]+$/, '')); run(f, sensitivity); };
  const previewVB = result && result.w ? `0 0 ${result.w} ${result.h}` : '0 0 100 100';
  const geoImport = !!(result && result.geo);
  return (
    <div style={overlay(mob)} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modalCard(mob, 560), gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}><div style={headTitle}>New Project — Import Plan</div><button onClick={onClose} style={{ ...xBtn, marginLeft: 'auto' }}>&times;</button></div>
        <label style={{ ...ghostBtn, textAlign: 'center', padding: '12px 0', display: 'block' }}>{file ? 'Choose a different file' : 'Upload PDF · Image · KMZ · KML'}<input type="file" accept=".pdf,.kmz,.kml,image/*" hidden onChange={(e) => onFile(e.target.files[0])} /></label>
        {file && (<>
          {!isGeo(file) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontFamily: NBF, fontSize: 13, color: MUTE, width: 90 }}>Sensitivity</span>
              <input type="range" min="1" max="10" value={sensitivity} onChange={(e) => setSensitivity(+e.target.value)} onMouseUp={() => run(file, sensitivity)} onTouchEnd={() => run(file, sensitivity)} style={{ flex: 1 }} />
              <button onClick={() => run(file, sensitivity)} style={{ ...ghostBtn, padding: '6px 10px', fontSize: 12 }}>Re-detect</button>
            </div>
          )}
          <div style={{ background: '#fff', border: '1px solid ' + LINE, height: mob ? 220 : 300, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {busy ? <span style={{ fontFamily: NBF, color: '#666' }}>Detecting…</span> : result && result.count ? (
              <svg viewBox={previewVB} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>{result.points.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={4} fill={result.sectionCount > 1 ? `hsl(${(result.sections[i] * 67) % 360} 70% 50%)` : '#16a34a'} />)}</svg>
            ) : <span style={{ fontFamily: NBF, color: '#999' }}>No preview</span>}
          </div>
          {result && result.count > 0 && <div style={{ fontFamily: NBF, fontSize: 14, color: CREAM }}>Detected <strong style={{ color: ORANGE }}>{result.count.toLocaleString()}</strong> points{result.sectionCount > 1 ? <> · <strong style={{ color: ORANGE }}>{result.sectionCount}</strong> sections</> : ' · no separate sections'}{geoImport ? <> · <span style={{ color: GOLD }}>geo-referenced (satellite view)</span></> : null}</div>}
          {err && <div style={{ fontFamily: NBF, fontSize: 14, color: GOLD }}>{err}</div>}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" style={{ background: 'rgba(255,255,255,.05)', border: '1px solid ' + LINE, color: CREAM, fontFamily: NBF, fontSize: 17, padding: '10px 12px', outline: 'none' }} />
          <button disabled={!result || !result.count || busy} onClick={() => onCreate(name || (file ? file.name.replace(/\.[^.]+$/, '') : 'New Project'), result)} style={{ ...ctaBtn, padding: '13px 0', opacity: (!result || !result.count || busy) ? .5 : 1 }}>Create Project</button>
        </>)}
        <div style={{ fontFamily: NBF, fontSize: 12, color: MUTE }}>PDFs / images: dots are auto-detected and split into sections by gaps. KMZ / KML: Placemark points are pulled from the file and pinned on a satellite map. All points start at "No Progress".</div>
      </div>
    </div>
  );
}

/* styles */
const kicker = { fontFamily: NBF, fontSize: 12.5, fontWeight: 700, letterSpacing: '2.5px', textTransform: 'uppercase', color: CREAM };
const bar = { height: 8, background: 'rgba(255,255,255,.08)', marginTop: 8, overflow: 'hidden', borderRadius: 4 };
const headTitle = { fontFamily: BBF, fontSize: 24, letterSpacing: 1.5, color: CREAM };
const selectStyle = { width: '100%', background: NAVY2, color: CREAM, border: '1px solid ' + PBORDER, borderRadius: 8, padding: '10px', fontFamily: NBF, fontSize: 15, outline: 'none' };
function card() { return { background: PBOX, border: '1px solid ' + PBORDER, borderRadius: 12, padding: 12 }; }
function statusRow(active) { return { display: 'flex', alignItems: 'center', gap: 9, padding: '9px 10px', cursor: 'pointer', borderRadius: 8, border: '1px solid ' + (active ? ORANGE : 'rgba(255,255,255,.07)'), background: active ? 'rgba(249,115,22,.14)' : 'rgba(255,255,255,.03)' }; }
function segBtn(active) { return { flex: 1, background: active ? 'rgba(249,115,22,.16)' : 'rgba(255,255,255,.03)', color: active ? ORANGE : CREAM, border: '1px solid ' + (active ? ORANGE : 'rgba(255,255,255,.10)'), borderRadius: 8, padding: '9px 0', fontFamily: NBF, fontWeight: 700, fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' }; }
const ctaBtn = { background: ORANGE, color: '#1a1206', border: 'none', borderRadius: 8, padding: '13px 18px', fontFamily: NBF, fontWeight: 700, fontSize: 14, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 6px 18px rgba(249,115,22,.28)' };
const ghostBtn = { background: 'rgba(249,115,22,.06)', color: ORANGE, border: '1px solid ' + ORANGE, borderRadius: 8, padding: '11px 16px', fontFamily: NBF, fontWeight: 700, fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', whiteSpace: 'nowrap' };
const backBtn = { background: 'transparent', color: CREAM, border: 'none', width: 40, height: 40, fontSize: 22, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 };
/* small ↺ that clears a task straight from its legend row */
function resetX(active) { return { background: 'transparent', border: 'none', color: active ? ORANGE : 'rgba(255,255,255,.22)', width: 30, height: 30, fontSize: 16, lineHeight: 1, cursor: 'pointer', flexShrink: 0, borderRadius: 15, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }; }
const miniBtn = { background: 'transparent', border: 'none', borderBottom: '2px solid', borderColor: 'rgba(255,255,255,.22)', padding: '4px 8px', fontFamily: NBF, fontWeight: 700, fontSize: 12.5, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' };
const zbtn = { width: 44, height: 44, background: 'rgba(6,9,20,.88)', color: CREAM, border: '1px solid ' + PBORDER, borderRadius: 8, fontSize: 22, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(6px)' };
const xBtn = { background: 'transparent', border: 'none', color: ORANGE, fontSize: 30, lineHeight: 1, cursor: 'pointer' };
function overlay(mob) { return { position: 'fixed', inset: 0, zIndex: 2200, background: 'rgba(0,0,0,.62)', display: 'flex', alignItems: mob ? 'flex-end' : 'center', justifyContent: 'center' }; }
function modalCard(mob, w) { return { background: `linear-gradient(180deg,${NAVY2}, ${NAVY})`, border: '1px solid ' + ORANGE, borderRadius: mob ? '18px 18px 0 0' : 14, padding: 18, width: mob ? '100%' : w, maxHeight: '86vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 9, boxShadow: '0 0 60px rgba(0,0,0,.6)' }; }
