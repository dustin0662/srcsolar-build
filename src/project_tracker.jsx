import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';
import { useIsMobile } from './native/useIsMobile.js';

const ENDPOINT = '/.netlify/functions/projecttracker';
const LS_KEY = 'srcd_pt_v1';
const LOGO_URL = '/logo.webp';

/* SUNRISE dark skin tokens (see src/admin-skin.css) */
const ORANGE = '#ff6b18';
const HOT = '#ff7a21';
const GOLD = '#f4d457';
const INK = '#07121e';        // surface
const INK2 = '#0a1826';       // raised surface
const INPUT_BG = '#091522';   // input fill
const CREAM = '#f6f3ec';
const MUTE = '#aab3c0';
const DIM = '#717d8d';
const LINE = '#2b3949';       // hairline
const LINE_ORANGE = '#e65e20'; // orange keyline
const LINE_SOFT = '#a7461e';  // soft orange keyline
const PANEL = 'linear-gradient(145deg, rgba(10,24,38,.98), rgba(3,12,22,.98))';
const CARD = '#07121e';
const GHOST_BG = 'linear-gradient(180deg, rgba(15,30,47,.94), rgba(5,14,24,.96))';
const CTA_BG = 'linear-gradient(135deg, #ff6b18, #ff7a21)';
const ON_ORANGE = '#120a04';  // label text on orange
const RED = '#ff4655';
const GREEN = '#19d47b';
const BLUE = '#2c7dff';

const BBF = "'Barlow Condensed', 'Barlow', sans-serif"; // display (use with fontWeight 700)
const NBF = "'Barlow Condensed', 'Barlow', sans-serif";

const CLIP = 'polygon(8px 0%, 100% 0%, calc(100% - 8px) 100%, 0% 100%)';

const STATUS_LABELS = { open: 'Open', in_progress: 'In Progress', closed: 'Closed' };
const KINDS = [
  { k: 'task', title: 'Tasks', singular: 'task' },
  { k: 'issue', title: 'Issues', singular: 'issue' },
  { k: 'action', title: 'Action Items', singular: 'action item' },
];
const CONFIDENTIAL = 'CONFIDENTIAL — VIEW ONLY. This report is prepared for Sun Rise Construction and Development LLC and must not be distributed outside the company.';

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function fmt(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function parseDate(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); }
function todayStr() { return fmt(new Date()); }
function shortDate(s) { try { return parseDate(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch (e) { return s; } }
function longDate(s) { try { return parseDate(s).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); } catch (e) { return s; } }
function noteTime(ts) { try { return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } }
function safeName(s) { return String(s || 'Project').replace(/[^\w-]+/g, '_'); }

function loadLocal() {
  try { const raw = localStorage.getItem(LS_KEY); if (raw) return JSON.parse(raw); } catch (e) {}
  return { projects: [], items: [], deletedProjects: [], deletedItems: [], lastModified: 0 };
}
function saveLocal(state) { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {} }

function visibleOn(it, date, today) {
  if (it.createdDate > date) return false;
  if (it.status === 'closed') return date <= (it.closedDate || date);
  return date <= (today > it.createdDate ? today : it.createdDate);
}

const seg = (active) => ({
  padding: '8px 16px', minHeight: 44, background: active ? CTA_BG : GHOST_BG, color: active ? ON_ORANGE : CREAM,
  border: '1px solid ' + (active ? HOT : LINE_ORANGE), fontFamily: NBF, fontWeight: 700, fontSize: 12,
  letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', marginRight: -1, clipPath: CLIP, whiteSpace: 'nowrap',
});
const ctaBtn = { background: CTA_BG, color: ON_ORANGE, border: '1px solid ' + HOT, padding: '9px 16px', minHeight: 44, fontFamily: NBF, fontWeight: 700, fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', clipPath: CLIP, whiteSpace: 'nowrap', boxShadow: '0 0 18px rgba(255,107,24,.28)' };
const ghostBtn = { background: GHOST_BG, color: HOT, border: '1px solid ' + LINE_ORANGE, padding: '8px 14px', minHeight: 44, fontFamily: NBF, fontWeight: 700, fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', clipPath: CLIP, whiteSpace: 'nowrap' };
const ghostSoft = { background: GHOST_BG, color: CREAM, border: '1px solid ' + LINE_SOFT, padding: '5px 10px', minHeight: 44, fontFamily: NBF, fontWeight: 600, fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer', clipPath: CLIP };
const inputStyle = { background: INPUT_BG, border: '1px solid ' + LINE_ORANGE, borderRadius: 6, color: CREAM, caretColor: ORANGE, fontFamily: NBF, fontSize: 15, padding: '8px 10px', minHeight: 48, outline: 'none', minWidth: 0 };
const kicker = { fontFamily: NBF, fontSize: 11, fontWeight: 700, letterSpacing: '3px', textTransform: 'uppercase', color: HOT };
const sectionTitle = { fontFamily: BBF, fontWeight: 700, fontSize: 18, letterSpacing: 2, textTransform: 'uppercase', color: CREAM };
const tag = (bg, fg) => ({ display: 'inline-block', padding: '2px 8px', fontFamily: NBF, fontWeight: 700, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', background: bg, color: fg, clipPath: CLIP });
const tagOutline = { display: 'inline-block', padding: '2px 8px', fontFamily: NBF, fontWeight: 700, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', background: 'transparent', color: MUTE, border: '1px solid ' + LINE_SOFT, clipPath: CLIP };

function statusStyle(status, active) {
  if (!active) return { padding: '5px 12px', minHeight: 44, background: GHOST_BG, color: MUTE, border: '1px solid ' + LINE_SOFT, fontFamily: NBF, fontWeight: 700, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer', marginRight: -1, clipPath: CLIP };
  const bg = status === 'open' ? BLUE : status === 'in_progress' ? ORANGE : status === 'closed' ? LINE : LINE;
  return { padding: '5px 12px', minHeight: 44, background: bg, color: bg === ORANGE ? ON_ORANGE : CREAM, border: '1px solid ' + bg, fontFamily: NBF, fontWeight: 700, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer', marginRight: -1, clipPath: CLIP };
}

/* ------------------------------------------------------------------ */
/*  Data hook — merges local + cloud, exposes CRUD                     */
/* ------------------------------------------------------------------ */
function useProjectTrackerData() {
  const [state, setState] = useState(() => loadLocal());
  const stateRef = useRef(state); useEffect(() => { stateRef.current = state; }, [state]);
  const [status, setStatus] = useState('local');
  const readyRef = useRef(false);
  const pushTimer = useRef(null);
  const applyingRemoteRef = useRef(false);

  const pushCloud = useCallback(async () => {
    const s = stateRef.current;
    try {
      setStatus('syncing');
      const body = { projects: s.projects, items: s.items, deletedProjects: s.deletedProjects || [], deletedItems: s.deletedItems || [] };
      const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error('http ' + r.status);
      const d = await r.json();
      applyingRemoteRef.current = true;
      setState((prev) => ({ ...prev, projects: d.projects || [], items: d.items || [], deletedProjects: [], deletedItems: [], lastModified: d.lastModified || Date.now() }));
      setTimeout(() => { applyingRemoteRef.current = false; }, 0);
      setStatus('synced');
    } catch (e) { setStatus('offline'); }
  }, []);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const r = await fetch(ENDPOINT, { cache: 'no-store' });
        if (!r.ok) throw new Error('http ' + r.status);
        const d = await r.json();
        if (!alive) return;
        applyingRemoteRef.current = true;
        setState((prev) => {
          const localOnlyProjects = (prev.projects || []).filter((p) => !(d.projects || []).find((x) => x.id === p.id));
          const localOnlyItems = (prev.items || []).filter((i) => !(d.items || []).find((x) => x.id === i.id));
          const merged = {
            projects: [...(d.projects || []), ...localOnlyProjects],
            items: [...(d.items || []), ...localOnlyItems],
            deletedProjects: prev.deletedProjects || [],
            deletedItems: prev.deletedItems || [],
            lastModified: d.lastModified || Date.now(),
          };
          return merged;
        });
        setTimeout(() => { applyingRemoteRef.current = false; }, 0);
        setStatus('synced'); readyRef.current = true;
        if (((stateRef.current.deletedProjects || []).length + (stateRef.current.deletedItems || []).length) > 0) pushCloud();
      } catch (e) { readyRef.current = true; setStatus('offline'); }
    };
    pull(); const t = setInterval(pull, 8000);
    return () => { alive = false; clearInterval(t); };
  }, [pushCloud]);

  useEffect(() => {
    saveLocal(state);
    if (!readyRef.current || applyingRemoteRef.current) return;
    clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => pushCloud(), 700);
  }, [state, pushCloud]);

  const mutate = useCallback((fn) => setState((prev) => {
    const next = JSON.parse(JSON.stringify(prev));
    fn(next);
    next.lastModified = Date.now();
    return next;
  }), []);

  return { state, mutate, status };
}

/* ------------------------------------------------------------------ */
/*  Export — PDF via jsPDF, Excel via xlsx                             */
/* ------------------------------------------------------------------ */
async function loadLogoDataUrl() {
  try {
    const res = await fetch(LOGO_URL); const blob = await res.blob();
    return await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => resolve(null); r.readAsDataURL(blob); });
  } catch (e) { return null; }
}

async function exportPDF(project, sel, itemsByKind, userName) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth(); const H = doc.internal.pageSize.getHeight();
  const M = 40;
  const logo = await loadLogoDataUrl();

  const drawHeader = () => {
    let x = M;
    if (logo) { try { doc.addImage(logo, 'PNG', x, M - 4, 46, 46); x += 58; } catch (e) {} }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(30, 32, 40);
    doc.text('Daily Report — ' + project.name, x, M + 12);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(90, 95, 110);
    doc.text(longDate(sel) + '  ·  Sun Rise Construction and Development LLC', x, M + 30);
    doc.setDrawColor(30, 32, 40); doc.setLineWidth(1.4); doc.line(M, M + 46, W - M, M + 46);
  };
  const drawFooter = () => {
    const y = H - 44;
    doc.setDrawColor(30, 32, 40); doc.setLineWidth(1.4); doc.line(M, y - 8, W - M, y - 8);
    if (logo) { try { doc.addImage(logo, 'PNG', M, y - 4, 22, 22); } catch (e) {} }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(30, 32, 40);
    doc.text('CONFIDENTIAL — VIEW ONLY.', M + 28, y + 3);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(80, 84, 96);
    const rest = 'This report is prepared for Sun Rise Construction and Development LLC and must not be distributed outside the company.';
    doc.text(doc.splitTextToSize(rest, W - M * 2 - 130), M + 28, y + 14);
    doc.setTextColor(140, 145, 160);
    doc.text('Exported ' + new Date().toLocaleString() + (userName ? ' · ' + userName : ''), W - M, y + 14, { align: 'right' });
  };
  drawHeader();

  let y = M + 70;
  const ensureRoom = (need) => { if (y + need > H - 80) { drawFooter(); doc.addPage(); drawHeader(); y = M + 70; } };

  for (const kd of KINDS) {
    const rows = itemsByKind[kd.k] || [];
    ensureRoom(28);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(30, 32, 40);
    doc.text(kd.title.toUpperCase() + '  ·  ' + rows.length + ' item' + (rows.length === 1 ? '' : 's'), M, y);
    y += 6; doc.setDrawColor(30, 32, 40); doc.setLineWidth(1); doc.line(M, y, W - M, y); y += 14;
    if (!rows.length) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(10); doc.setTextColor(120, 124, 140);
      doc.text('None on this date.', M, y); y += 20; continue;
    }
    for (const it of rows) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(30, 32, 40);
      const nameLines = doc.splitTextToSize(it.name, W - M * 2 - 190);
      const nameHeight = nameLines.length * 13;
      ensureRoom(nameHeight + 28);
      doc.text(nameLines, M, y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(80, 84, 96);
      doc.text(it.assignee || 'Unassigned', W - M - 190, y);
      doc.text(STATUS_LABELS[it.status], W - M - 90, y);
      doc.text(shortDate(it.createdDate), W - M, y, { align: 'right' });
      y += nameHeight + 2;
      if (it.desc) {
        const descLines = doc.splitTextToSize(it.desc, W - M * 2);
        ensureRoom(descLines.length * 12 + 8);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(70, 74, 88);
        doc.text(descLines, M, y); y += descLines.length * 12 + 2;
      }
      for (const n of it.notes || []) {
        const line = '· ' + noteTime(n.ts) + ' — ' + n.text;
        const noteLines = doc.splitTextToSize(line, W - M * 2 - 12);
        ensureRoom(noteLines.length * 11 + 4);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90, 94, 110);
        doc.text(noteLines, M + 12, y); y += noteLines.length * 11;
      }
      y += 12;
    }
    y += 6;
  }
  drawFooter();
  const fname = 'SunRise_' + safeName(project.name) + '_' + sel + '.pdf';
  doc.save(fname);
}

function exportXlsx(project, sel, itemsByKind) {
  const wb = XLSX.utils.book_new();
  for (const kd of KINDS) {
    const rows = itemsByKind[kd.k] || [];
    const aoa = [
      ['Sun Rise Construction and Development LLC'],
      ['Project: ' + project.name, 'Date: ' + sel, kd.title],
      [],
      ['Item', 'Description', 'Assignee', 'Status', 'Opened', 'Notes'],
      ...rows.map((it) => [
        it.name, it.desc || '', it.assignee || 'Unassigned', STATUS_LABELS[it.status],
        it.createdDate, (it.notes || []).map((n) => noteTime(n.ts) + ' — ' + n.text).join('  |  '),
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 34 }, { wch: 40 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, ws, kd.title.slice(0, 31));
  }
  XLSX.writeFile(wb, 'SunRise_' + safeName(project.name) + '_' + sel + '.xlsx');
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function ProjectTracker({ onExit, portalUser, allUsers }) {
  const { state, mutate, status } = useProjectTrackerData();
  const mob = useIsMobile();
  const [_, force] = useState(0);
  useEffect(() => {
    const h = () => force((n) => n + 1);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  const users = useMemo(() => {
    const seen = new Set(); const out = [];
    for (const u of allUsers || []) if (u && u.name && !seen.has(u.name)) { seen.add(u.name); out.push(u.name); }
    if (!out.length) return ['Kaiden Ray', 'Ethan Ray', 'Kaleb LeBaron', 'Rolando Parson', 'Jenna Hanson', 'Jasper Prevette', 'Alan LeBaron', 'Abel Ramirez'];
    return out.sort();
  }, [allUsers]);

  const [screen, setScreen] = useState('home');
  const [projectId, setProjectId] = useState(null);
  const [view, setView] = useState('calendar');
  const now = new Date();
  const [monthY, setMonthY] = useState(now.getFullYear());
  const [monthM, setMonthM] = useState(now.getMonth());
  const [selected, setSelected] = useState(todayStr());
  const [drafts, setDrafts] = useState({});
  const [expanded, setExpanded] = useState({});
  const [noteDrafts, setNoteDrafts] = useState({});
  const [newProject, setNewProject] = useState('');
  const [busyExport, setBusyExport] = useState('');

  const today = todayStr();
  const project = state.projects.find((p) => p.id === projectId) || null;
  const items = state.items;

  const addProject = () => {
    const name = newProject.trim(); if (!name) return;
    const p = { id: uid(), name, createdAt: today, lastModified: Date.now() };
    mutate((d) => { d.projects.push(p); });
    setNewProject(''); setProjectId(p.id); setScreen('project'); setView('calendar'); setSelected(today);
  };
  const openProject = (id) => { setProjectId(id); setScreen('project'); setView('calendar'); setSelected(today); setMonthY(now.getFullYear()); setMonthM(now.getMonth()); };
  const deleteProject = (p) => {
    if (!window.confirm('Delete project "' + p.name + '" and all its items?')) return;
    mutate((d) => {
      d.projects = d.projects.filter((x) => x.id !== p.id);
      d.items = d.items.filter((x) => x.projectId !== p.id);
      d.deletedProjects = [...(d.deletedProjects || []), p.id];
    });
    if (projectId === p.id) { setScreen('home'); setProjectId(null); }
  };
  const renameProject = () => {
    if (!project) return;
    const n = window.prompt('Project name:', project.name);
    if (!n || !n.trim()) return;
    mutate((d) => { const x = d.projects.find((y) => y.id === project.id); if (x) { x.name = n.trim(); x.lastModified = Date.now(); } });
  };

  const setDraft = (kind, field, val) => setDrafts((prev) => ({ ...prev, [kind]: { name: '', desc: '', assignee: '', ...(prev[kind] || {}), [field]: val } }));
  const addItem = (kind) => {
    const d = drafts[kind] || {}; const name = (d.name || '').trim(); if (!name) return;
    const it = { id: uid(), projectId: project.id, kind, name, desc: (d.desc || '').trim(), assignee: d.assignee || '', status: 'open', createdDate: selected, closedDate: null, notes: [], lastModified: Date.now() };
    mutate((x) => { x.items.push(it); });
    setDrafts((prev) => ({ ...prev, [kind]: { name: '', desc: '', assignee: d.assignee || '' } }));
  };
  const setItemStatus = (id, status) => mutate((x) => {
    const it = x.items.find((y) => y.id === id); if (!it) return;
    it.status = status; it.closedDate = status === 'closed' ? selected : null; it.lastModified = Date.now();
  });
  const setItemAssignee = (id, v) => mutate((x) => { const it = x.items.find((y) => y.id === id); if (it) { it.assignee = v; it.lastModified = Date.now(); } });
  const deleteItem = (it) => {
    if (!window.confirm('Delete "' + it.name + '"?')) return;
    mutate((x) => { x.items = x.items.filter((y) => y.id !== it.id); x.deletedItems = [...(x.deletedItems || []), it.id]; });
  };
  const addNote = (id) => {
    const text = (noteDrafts[id] || '').trim(); if (!text) return;
    mutate((x) => { const it = x.items.find((y) => y.id === id); if (it) { it.notes = it.notes || []; it.notes.push({ ts: Date.now(), text, by: portalUser ? portalUser.name : '' }); it.lastModified = Date.now(); } });
    setNoteDrafts((prev) => ({ ...prev, [id]: '' }));
  };

  const projectItems = useMemo(() => items.filter((i) => i.projectId === projectId), [items, projectId]);
  const rawForKind = (k, sel) => projectItems.filter((i) => i.kind === k && visibleOn(i, sel, today));

  const runExportPdf = async () => {
    if (!project) return;
    setBusyExport('pdf');
    try {
      const bucket = {}; KINDS.forEach((kd) => { bucket[kd.k] = rawForKind(kd.k, selected); });
      await exportPDF(project, selected, bucket, portalUser ? portalUser.name : '');
    } catch (e) { window.alert('Export failed: ' + (e.message || e)); }
    setBusyExport('');
  };
  const runExportXlsx = () => {
    if (!project) return;
    const bucket = {}; KINDS.forEach((kd) => { bucket[kd.k] = rawForKind(kd.k, selected); });
    try { exportXlsx(project, selected, bucket); } catch (e) { window.alert('Excel export failed: ' + (e.message || e)); }
  };

  /* ---- calendar grid ---- */
  const monthLabel = new Date(monthY, monthM, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const first = new Date(monthY, monthM, 1);
  const startOff = first.getDay();
  const gridStart = new Date(monthY, monthM, 1 - startOff);
  const notClosedOn = (ds) => projectItems.filter((i) => i.status !== 'closed' && visibleOn(i, ds, today)).length;
  const calDays = useMemo(() => {
    const out = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart); d.setDate(gridStart.getDate() + i);
      const ds = fmt(d);
      out.push({ ds, num: d.getDate(), inMonth: d.getMonth() === monthM, isToday: ds === today, isSel: ds === selected, count: notClosedOn(ds) });
    }
    return out;
  }, [gridStart, monthM, today, selected, projectItems]); // eslint-disable-line react-hooks/exhaustive-deps
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /* ---- log rows ---- */
  const logRows = useMemo(() => {
    return projectItems.filter((i) => i.kind !== 'task').sort((a, b) => (b.createdDate || '').localeCompare(a.createdDate || ''));
  }, [projectItems]);

  const statusColor = { open: BLUE, in_progress: ORANGE, closed: LINE };
  const statusChip = (s) => tag(statusColor[s] || LINE, s === 'in_progress' ? ON_ORANGE : CREAM);

  const cloudPill = (
    <span style={{ ...tagOutline, color: status === 'synced' ? GREEN : status === 'syncing' ? GOLD : status === 'offline' ? RED : MUTE, borderColor: 'currentColor' }}>
      {status === 'synced' ? 'Cloud synced' : status === 'syncing' ? 'Syncing…' : status === 'offline' ? 'Offline' : 'Local'}
    </span>
  );

  return (
    <div className="sunrise-admin" style={{ position: 'fixed', top: mob ? 'calc(64px + var(--sat, 0px))' : 60, left: 0, right: 0, bottom: 'var(--tabbar-h, 0px)', minHeight: 0, zIndex: 2000, background: 'rgba(2,8,17,.35)', color: CREAM, fontFamily: NBF, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: mob ? 8 : 14, padding: mob ? '9px 12px' : '12px 22px', background: 'rgba(1,7,14,.72)', backdropFilter: 'blur(14px)', borderBottom: '1px solid ' + LINE_SOFT, position: 'sticky', top: 0, zIndex: 5 }}>
        <button onClick={onExit} style={{ ...ghostSoft, padding: '6px 12px' }}>&larr; Portal</button>
        <img src={LOGO_URL} alt="SRC" style={{ width: mob ? 30 : 40, height: mob ? 30 : 40, objectFit: 'contain', background: '#fff', borderRadius: 4, padding: 2 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: BBF, fontWeight: 700, fontSize: mob ? 17 : 22, letterSpacing: 1.5, color: CREAM, lineHeight: 1 }}>PROJECT TRACKER</div>
          <div style={{ fontFamily: NBF, fontSize: 11, letterSpacing: 2, color: MUTE, textTransform: 'uppercase' }}>Daily tasks · Issues · Actions</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>{cloudPill}</div>
      </div>

      {/* Home */}
      {screen === 'home' && (
        <div style={{ maxWidth: 1200, width: '100%', margin: '0 auto', padding: mob ? '20px 14px 40px' : '36px 28px 60px', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={kicker}>Portfolio</div>
              <h1 style={{ fontFamily: BBF, fontWeight: 700, fontSize: mob ? 34 : 44, margin: '4px 0 0', letterSpacing: 1.5, color: CREAM }}>PROJECTS</h1>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input value={newProject} onChange={(e) => setNewProject(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addProject(); }} placeholder="New project name" style={{ ...inputStyle, width: mob ? 200 : 260 }} />
              <button onClick={addProject} style={ctaBtn}>Create Project</button>
            </div>
          </div>
          <div style={{ height: 2, background: LINE, margin: '18px 0 24px' }} />

          {state.projects.length === 0 && (
            <div style={{ color: MUTE, fontFamily: NBF, fontSize: 15, padding: '20px 0' }}>No projects yet — name one above and press Create.</div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 14 }}>
            {state.projects.map((p) => {
              const its = items.filter((i) => i.projectId === p.id);
              const open = its.filter((i) => i.status !== 'closed').length;
              const issues = its.filter((i) => i.kind !== 'task' && i.status !== 'closed').length;
              return (
                <div key={p.id} onClick={() => openProject(p.id)} style={{ background: PANEL, border: '1px solid ' + LINE_ORANGE, borderRadius: 12, padding: 16, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6, transition: 'border-color .2s, background .2s' }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = HOT; e.currentTarget.style.background = 'rgba(255,107,24,.08)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = LINE_ORANGE; e.currentTarget.style.background = PANEL; }}>
                  <div style={kicker}>Project</div>
                  <div style={{ fontFamily: BBF, fontWeight: 700, fontSize: 24, letterSpacing: 1, color: CREAM }}>{p.name}</div>
                  <div style={{ fontFamily: NBF, fontSize: 12, color: MUTE }}>Started {shortDate(p.createdAt)}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                    <span style={tag('rgba(255,107,24,.15)', HOT)}>{open} open item{open === 1 ? '' : 's'}</span>
                    <span style={tagOutline}>{issues} open issue{issues === 1 ? '' : 's'} / actions</span>
                    <button onClick={(e) => { e.stopPropagation(); deleteProject(p); }} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: MUTE, fontFamily: NBF, fontWeight: 600, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' }}>Delete</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Project view */}
      {screen === 'project' && project && (
        <div style={{ maxWidth: 1440, width: '100%', margin: '0 auto', padding: mob ? '16px 14px 40px' : '24px 28px 60px', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button onClick={() => setScreen('home')} style={{ ...ghostSoft, padding: '6px 12px' }}>&larr; Projects</button>
            <h1 style={{ fontFamily: BBF, fontWeight: 700, fontSize: mob ? 26 : 34, margin: 0, letterSpacing: 1.5, color: CREAM }}>{project.name}</h1>
            <button onClick={renameProject} style={{ ...ghostSoft, padding: '5px 10px' }}>Rename</button>
            <div style={{ marginLeft: 'auto', display: 'flex' }}>
              <button style={seg(view === 'calendar')} onClick={() => setView('calendar')}>Calendar</button>
              <button style={seg(view === 'log')} onClick={() => setView('log')}>Issues &amp; Log</button>
            </div>
          </div>
          <div style={{ height: 2, background: LINE, margin: '14px 0 20px' }} />

          {view === 'calendar' && (
            <div style={{ display: 'grid', gridTemplateColumns: mob ? '1fr' : 'minmax(360px,440px) 1fr', gap: 24, alignItems: 'start' }}>
              {/* Calendar card */}
              <div style={{ background: PANEL, border: '1px solid ' + LINE_ORANGE, borderRadius: 12, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                  <div style={{ fontFamily: BBF, fontWeight: 700, fontSize: 20, letterSpacing: 1, color: CREAM }}>{monthLabel}</div>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                    <button onClick={() => { const d = new Date(monthY, monthM - 1, 1); setMonthY(d.getFullYear()); setMonthM(d.getMonth()); }} style={ghostSoft}>&lsaquo;</button>
                    <button onClick={() => { const d = new Date(); setMonthY(d.getFullYear()); setMonthM(d.getMonth()); setSelected(fmt(d)); }} style={ghostSoft}>Today</button>
                    <button onClick={() => { const d = new Date(monthY, monthM + 1, 1); setMonthY(d.getFullYear()); setMonthM(d.getMonth()); }} style={ghostSoft}>&rsaquo;</button>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, marginBottom: 4 }}>
                  {weekdays.map((w) => <div key={w} style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: MUTE, padding: '2px 4px' }}>{w}</div>)}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4 }}>
                  {calDays.map((d) => (
                    <button key={d.ds} onClick={() => setSelected(d.ds)} style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'space-between',
                      gap: 4, minHeight: mob ? 46 : 52, padding: mob ? '4px 5px' : '5px 7px', textAlign: 'left',
                      background: d.isSel ? CTA_BG : INPUT_BG,
                      color: d.isSel ? ON_ORANGE : d.inMonth ? CREAM : DIM,
                      border: '1px solid ' + (d.isSel ? HOT : d.isToday ? GOLD : LINE), borderRadius: 6,
                      fontFamily: NBF, fontSize: 13, fontWeight: d.isToday ? 700 : 500, cursor: 'pointer',
                    }}>
                      <span>{d.num}</span>
                      {d.count > 0 && <span style={{ fontSize: 10, fontWeight: 700, padding: '0 6px', background: d.isSel ? ON_ORANGE : 'rgba(255,107,24,.18)', color: d.isSel ? CREAM : HOT, clipPath: CLIP }}>{d.count}</span>}
                    </button>
                  ))}
                </div>
                <p style={{ fontFamily: NBF, fontSize: 12, color: MUTE, margin: '12px 0 0' }}>Badge = items not yet closed. Anything left open rolls forward to today automatically.</p>
              </div>

              {/* Day panel */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <h2 style={{ fontFamily: BBF, fontWeight: 700, fontSize: 22, letterSpacing: 1, color: CREAM, margin: 0 }}>{longDate(selected)}</h2>
                  {selected === today && <span style={tag(ORANGE, ON_ORANGE)}>Today</span>}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <button disabled={busyExport === 'pdf'} onClick={runExportPdf} style={{ ...ghostBtn, opacity: busyExport === 'pdf' ? 0.5 : 1 }}>{busyExport === 'pdf' ? 'Building…' : 'Export PDF'}</button>
                    <button onClick={runExportXlsx} style={ghostBtn}>Export Excel</button>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 16 }}>
                  {KINDS.map((kd) => {
                    const rows = rawForKind(kd.k, selected);
                    const d = drafts[kd.k] || { name: '', desc: '', assignee: '' };
                    return (
                      <section key={kd.k}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, borderBottom: '2px solid ' + LINE, paddingBottom: 6 }}>
                          <h3 style={sectionTitle}>{kd.title}</h3>
                          <span style={{ fontSize: 12, color: MUTE }}>{rows.length} item{rows.length === 1 ? '' : 's'}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 6, margin: '10px 0', flexWrap: 'wrap' }}>
                          <input value={d.name} onChange={(e) => setDraft(kd.k, 'name', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addItem(kd.k); }} placeholder={'New ' + kd.singular} style={{ ...inputStyle, flex: mob ? '1 1 100%' : 1, minWidth: mob ? 0 : 140 }} />
                          <input value={d.desc} onChange={(e) => setDraft(kd.k, 'desc', e.target.value)} placeholder="Description (optional)" style={{ ...inputStyle, flex: mob ? '1 1 100%' : 2, minWidth: mob ? 0 : 180 }} />
                          <select value={d.assignee} onChange={(e) => setDraft(kd.k, 'assignee', e.target.value)} style={{ ...inputStyle, width: mob ? undefined : 170, flex: mob ? '1 1 60%' : undefined, minWidth: 0 }}>
                            <option value="">Unassigned</option>
                            {users.map((u) => <option key={u} value={u}>{u}</option>)}
                          </select>
                          <button onClick={() => addItem(kd.k)} style={{ ...ctaBtn, flex: mob ? '1 1 30%' : undefined, minHeight: mob ? 44 : undefined }}>Add</button>
                        </div>
                        {!rows.length && <div style={{ fontSize: 13, color: MUTE, margin: '4px 0 0' }}>No {kd.title.toLowerCase()} on this date.</div>}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {rows.map((it) => {
                            const isExp = !!expanded[it.id];
                            const openDays = Math.round((parseDate(selected) - parseDate(it.createdDate)) / 86400000);
                            const overdue = it.status !== 'closed' && openDays >= 3;
                            const rolled = it.createdDate < selected;
                            const nameStyle = it.status === 'closed'
                              ? { textDecoration: 'line-through', color: MUTE, fontWeight: 700, fontSize: 15 }
                              : { fontWeight: 700, fontSize: 15, color: overdue ? RED : CREAM };
                            return (
                              <div key={it.id} style={{ border: '1px solid ' + LINE_SOFT, borderRadius: 8, padding: 12, background: CARD, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                  <span style={nameStyle}>{it.name}</span>
                                  {it.assignee && <span style={tagOutline}>{it.assignee}</span>}
                                  {rolled && <span style={overdue ? tag('rgba(255,70,85,.18)', RED) : tagOutline}>{overdue ? openDays + ' days open' : 'since ' + shortDate(it.createdDate)}</span>}
                                  <button onClick={() => setExpanded((prev) => ({ ...prev, [it.id]: !isExp }))} style={{ ...ghostSoft, marginLeft: 'auto', padding: '3px 10px' }}>{isExp ? 'Close' : 'Notes (' + (it.notes || []).length + ')'}</button>
                                </div>
                                <div style={{ display: 'flex' }}>
                                  {['open', 'in_progress', 'closed'].map((s) => (
                                    <button key={s} onClick={() => setItemStatus(it.id, s)} style={statusStyle(s, it.status === s)}>{STATUS_LABELS[s]}</button>
                                  ))}
                                </div>
                                {isExp && (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid ' + LINE, paddingTop: 10 }}>
                                    {it.desc && <p style={{ margin: 0, fontSize: 14, color: 'rgba(246,243,236,.85)' }}>{it.desc}</p>}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                      <span style={{ ...kicker, letterSpacing: 2 }}>Assigned to</span>
                                      <select value={it.assignee || ''} onChange={(e) => setItemAssignee(it.id, e.target.value)} style={{ ...inputStyle, padding: '4px 8px', width: 170 }}>
                                        <option value="">Unassigned</option>
                                        {users.map((u) => <option key={u} value={u}>{u}</option>)}
                                      </select>
                                      <button onClick={() => deleteItem(it)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: RED, fontFamily: NBF, fontWeight: 600, fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' }}>Delete item</button>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                      {(it.notes || []).map((n, ni) => (
                                        <div key={ni} style={{ fontSize: 13, borderLeft: '2px solid ' + ORANGE, paddingLeft: 10 }}>
                                          <span style={{ color: MUTE }}>{noteTime(n.ts)}{n.by ? ' · ' + n.by : ''}</span> — {n.text}
                                        </div>
                                      ))}
                                    </div>
                                    <div style={{ display: 'flex', gap: 6 }}>
                                      <input value={noteDrafts[it.id] || ''} onChange={(e) => setNoteDrafts((prev) => ({ ...prev, [it.id]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') addNote(it.id); }} placeholder="Add a note" style={{ ...inputStyle, flex: 1 }} />
                                      <button onClick={() => addNote(it.id)} style={ghostBtn}>Add Note</button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {view === 'log' && (
            <div>
              <p style={{ fontSize: 14, color: MUTE, margin: '0 0 14px' }}>Every issue and action item on this project, across all dates. Click a row to jump to its date.</p>
              {logRows.length === 0 ? (
                <div style={{ color: MUTE, fontFamily: NBF, fontSize: 15 }}>No issues or action items on this project yet.</div>
              ) : (
                <div style={{ overflowX: 'auto', border: '1px solid ' + LINE_ORANGE, borderRadius: 12, background: CARD }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: NBF, fontSize: 14, color: CREAM }}>
                    <thead>
                      <tr style={{ background: INK2 }}>
                        {['Type', 'Name', 'Assignee', 'Status', 'Opened', 'Closed'].map((h) => (
                          <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontFamily: NBF, fontWeight: 700, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: MUTE, borderBottom: '1px solid ' + LINE }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {logRows.map((it) => {
                        const d = parseDate(it.createdDate);
                        return (
                          <tr key={it.id} onClick={() => { setView('calendar'); setSelected(it.createdDate); setMonthY(d.getFullYear()); setMonthM(d.getMonth()); }} style={{ cursor: 'pointer', borderBottom: '1px solid ' + LINE }}>
                            <td style={{ padding: '10px 12px' }}><span style={tagOutline}>{it.kind === 'issue' ? 'Issue' : 'Action'}</span></td>
                            <td style={{ padding: '10px 12px' }}>{it.name}</td>
                            <td style={{ padding: '10px 12px', color: it.assignee ? CREAM : MUTE }}>{it.assignee || 'Unassigned'}</td>
                            <td style={{ padding: '10px 12px' }}><span style={statusChip(it.status)}>{STATUS_LABELS[it.status]}</span></td>
                            <td style={{ padding: '10px 12px', color: MUTE }}>{shortDate(it.createdDate)}</td>
                            <td style={{ padding: '10px 12px', color: MUTE }}>{it.closedDate ? shortDate(it.closedDate) : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Footer disclaimer */}
      <div style={{ marginTop: 'auto', borderTop: '2px solid ' + LINE_SOFT, padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(1,7,14,.72)' }}>
        <img src={LOGO_URL} alt="" style={{ height: 26, objectFit: 'contain', background: '#fff', borderRadius: 4, padding: 2 }} />
        <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: MUTE }}>Sun Rise Construction and Development LLC</div>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: MUTE }}>Internal project tracker</div>
      </div>
    </div>
  );
}
