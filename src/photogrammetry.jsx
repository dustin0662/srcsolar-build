/* photogrammetry.jsx — Photogrammetry Studio.
   Upload a set of overlapping site photos, build a 3D model from them in the
   browser, inspect it in the viewer and export it. Photos and finished models
   live in Netlify Blobs so the whole crew sees the same captures. */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PointCloudViewer, { viewerSnapshot } from './pg_viewer.jsx';
import { exportPLY, exportGLB, exportOBJ } from './pg_dense.js';
import { parseExif } from './pg_exif.js';
import { PRESETS, PRESET_ORDER, adaptSettings } from './pg_presets.js';
import { estimateBuildSeconds } from './pg_progress.js';

const ENDPOINT = '/.netlify/functions/photogrammetry';
const LOGO_URL = '/logo.webp';

const ORANGE = '#F97316';
const INK = '#0b0d15', INK2 = '#05060d';
const CREAM = '#F5F0EB';
const MUTE = '#94a3b8';
const LINE = 'rgba(255,255,255,.12)';
const CARD = 'rgba(255,255,255,.04)';
const GREEN = '#16a34a', RED = '#ef4444';
const BBF = "'Bebas Neue', 'Barlow Condensed', sans-serif";
const NBF = "'Barlow Condensed', 'Barlow', sans-serif";

const PART_BYTES = 3 * 1024 * 1024;      // stays clear of the 6 MB function limit
const CHUNK_CHARS = 700 * 1024;          // base64 slice when saving a model
const WORKING_MAX_DIM = 2600;            // stored working copy of each photo
const THUMB_DIM = 340;
const SAVED_POINT_CAP = 1500000;         // point cloud size kept in the capture

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
}
function fmtTime(ms) {
  if (!isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  return m + 'm ' + String(s % 60).padStart(2, '0') + 's';
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 8000);
}

/* ── styles ────────────────────────────────────────────────────────── */
const btn = {
  background: ORANGE, color: '#160b02', border: 'none', padding: '9px 16px', cursor: 'pointer',
  fontFamily: NBF, fontWeight: 700, fontSize: 13, letterSpacing: 2, textTransform: 'uppercase',
};
const ghost = { ...btn, background: 'transparent', color: CREAM, border: '1px solid ' + LINE };
const ghostSm = { ...ghost, padding: '6px 12px', fontSize: 11 };
const input = {
  background: 'rgba(0,0,0,.35)', border: '1px solid ' + LINE, color: CREAM, padding: '9px 12px',
  fontFamily: NBF, fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box',
};
const label = { fontFamily: NBF, fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', color: MUTE, marginBottom: 6 };
const card = { background: CARD, border: '1px solid ' + LINE, padding: 16 };

/* ── model container ───────────────────────────────────────────────────
   A tiny self-describing binary so a finished model can be stored and
   reopened without shipping a glTF parser to the client. */
const MAGIC = 0x53524350;  // 'SRCP'

/* Saved models travel back through the function as base64 chunks, so a
   multi-million point cloud is stored thinned. The full-resolution cloud stays
   available through the exports. */
function thinCloud(positions, colors, maxPoints) {
  const n = positions.length / 3;
  if (!maxPoints || n <= maxPoints) return { positions: positions, colors: colors, thinned: false };
  const step = n / maxPoints;
  const m = Math.floor(n / step);
  const p = new Float32Array(m * 3), c = new Uint8Array(m * 3);
  for (let k = 0; k < m; k++) {
    const i = Math.min(n - 1, Math.floor(k * step));
    p[k * 3] = positions[i * 3]; p[k * 3 + 1] = positions[i * 3 + 1]; p[k * 3 + 2] = positions[i * 3 + 2];
    c[k * 3] = colors[i * 3]; c[k * 3 + 1] = colors[i * 3 + 1]; c[k * 3 + 2] = colors[i * 3 + 2];
  }
  return { positions: p, colors: c, thinned: true };
}

function packModel(result, maxPoints) {
  const cloud = thinCloud(result.positions, result.colors, maxPoints);
  result = Object.assign({}, result, {
    positions: cloud.positions, colors: cloud.colors,
    stats: Object.assign({}, result.stats, cloud.thinned
      ? { savedPoints: cloud.positions.length / 3, savedThinned: true } : {}),
  });
  const meta = {
    v: 1, stats: result.stats, cameras: result.cameras,
    counts: {
      points: result.positions.length / 3,
      meshVerts: result.mesh ? result.mesh.positions.length / 3 : 0,
      meshIdx: result.mesh ? result.mesh.indices.length : 0,
      ortho: result.ortho ? [result.ortho.w, result.ortho.h] : null,
    },
  };
  const json = new TextEncoder().encode(JSON.stringify(meta));
  const pad = (n) => (n + 3) & ~3;
  const blocks = [
    new Uint8Array(result.positions.buffer, result.positions.byteOffset, result.positions.byteLength),
    result.colors,
    result.mesh ? new Uint8Array(result.mesh.positions.buffer, result.mesh.positions.byteOffset, result.mesh.positions.byteLength) : new Uint8Array(0),
    result.mesh ? result.mesh.colors : new Uint8Array(0),
    result.mesh ? new Uint8Array(result.mesh.indices.buffer, result.mesh.indices.byteOffset, result.mesh.indices.byteLength) : new Uint8Array(0),
    result.ortho ? new Uint8Array(result.ortho.rgba.buffer, result.ortho.rgba.byteOffset, result.ortho.rgba.byteLength) : new Uint8Array(0),
  ];
  let total = 12 + pad(json.length);
  for (const b of blocks) total += pad(b.length);
  const out = new ArrayBuffer(total);
  const dv = new DataView(out), u8 = new Uint8Array(out);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, 1, true);
  dv.setUint32(8, json.length, true);
  u8.set(json, 12);
  let off = 12 + pad(json.length);
  for (const b of blocks) { u8.set(b, off); off += pad(b.length); }
  return out;
}

/* ── network helpers ───────────────────────────────────────────────── */
async function api(path, opts) {
  const res = await fetch(ENDPOINT + path, opts);
  if (!res.ok) {
    let msg = res.status + ' ' + res.statusText;
    try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) { /* not json */ }
    throw new Error(msg);
  }
  return res;
}
const apiJson = (path, opts) => api(path, opts).then((r) => r.json());

/* ── main component ────────────────────────────────────────────────── */
export default function Photogrammetry({ onExit, portalUser }) {
  const [mob, setMob] = useState(typeof window !== 'undefined' && window.innerWidth < 860);
  useEffect(() => {
    const h = () => setMob(window.innerWidth < 860);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [models, setModels] = useState([]);
  const [tab, setTab] = useState('photos');
  const [unfinished, setUnfinished] = useState(null);   // a build that can be resumed
  const [autoSave, setAutoSave] = useState(null);       // a finished long build to store without being asked
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const project = useMemo(() => projects.find((p) => p.id === projectId) || null, [projects, projectId]);

  /* ── project + photo loading ── */
  const loadProjects = useCallback(async () => {
    try {
      const j = await apiJson('?projects=1');
      setProjects(j.projects || []);
      return j.projects || [];
    } catch (e) { setError('Could not reach storage: ' + e.message); return []; }
  }, []);

  const loadPhotos = useCallback(async (pid) => {
    if (!pid) { setPhotos([]); return; }
    try {
      const j = await apiJson('?photos=1&project=' + encodeURIComponent(pid));
      setPhotos(j.photos || []);
    } catch (e) { setError('Could not load photos: ' + e.message); }
  }, []);

  const loadBuilds = useCallback(async (pid) => {
    if (!pid) { setUnfinished(null); return; }
    try {
      const j = await apiJson('?builds=1&project=' + encodeURIComponent(pid));
      const open = (j.builds || []).filter((b) => !b.done);
      setUnfinished(open.length ? open[0] : null);
    } catch (e) { /* resume is a convenience, not a requirement */ }
  }, []);

  const loadModels = useCallback(async (pid) => {
    if (!pid) { setModels([]); return; }
    try {
      const j = await apiJson('?models=1&project=' + encodeURIComponent(pid));
      setModels(j.models || []);
    } catch (e) { /* models are optional */ }
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);
  useEffect(() => { loadPhotos(projectId); loadModels(projectId); loadBuilds(projectId); }, [projectId, loadPhotos, loadModels, loadBuilds]);

  const saveProject = useCallback(async (p) => {
    const j = await apiJson('?saveProject=1', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: p }),
    });
    setProjects(j.projects || []);
    return j;
  }, []);

  const createProject = useCallback(async (name) => {
    const p = {
      id: uid(), name: name || 'New capture', createdAt: Date.now(),
      createdBy: (portalUser && (portalUser.name || portalUser.email)) || 'Portal user', notes: '',
    };
    await saveProject(p);
    setProjectId(p.id);
    setTab('photos');
  }, [portalUser, saveProject]);

  const deleteProject = useCallback(async (id) => {
    if (!window.confirm('Delete this capture and every photo and model in it? This cannot be undone.')) return;
    setBusy(true);
    try {
      const j = await apiJson('?deleteProject=1', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: id }),
      });
      setProjects(j.projects || []);
      if (projectId === id) { setProjectId(null); setPhotos([]); setModels([]); }
    } catch (e) { setError('Delete failed: ' + e.message); }
    setBusy(false);
  }, [projectId]);

  /* ── uploading ── */
  const [uploads, setUploads] = useState({ active: false, done: 0, total: 0, name: '', failed: [] });
  const cancelUploadRef = useRef(false);

  const prepareImage = useCallback(async (file, keepOriginal) => {
    const buf = await file.arrayBuffer();
    const exif = parseExif(buf);
    let bmp;
    try { bmp = await createImageBitmap(new Blob([buf]), { imageOrientation: 'from-image' }); }
    catch (e) { bmp = await createImageBitmap(new Blob([buf])); }
    const fullW = bmp.width, fullH = bmp.height;

    const render = async (maxDim, quality) => {
      const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
      return { blob: blob, w: w, h: h };
    };

    const thumb = await render(THUMB_DIM, 0.72);
    let main;
    if (keepOriginal) main = { blob: file, w: fullW, h: fullH };
    else main = await render(WORKING_MAX_DIM, 0.86);
    bmp.close();
    return { exif: exif, thumb: thumb, main: main, fullW: fullW, fullH: fullH };
  }, []);

  const uploadFiles = useCallback(async (fileList, keepOriginal) => {
    if (!projectId) { setError('Create or open a capture first.'); return; }
    const files = Array.from(fileList).filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
    if (!files.length) { setError('Those files are not images.'); return; }
    cancelUploadRef.current = false;
    setError('');
    setUploads({ active: true, done: 0, total: files.length, name: '', failed: [], startedAt: Date.now() });
    const failed = [];
    const existing = new Set(photos.map((p) => p.name + ':' + p.originalBytes));

    /* Several photos at once, and one index write per batch — a six-hundred
       photo card takes long enough without doing it strictly one at a time. */
    const queue = files.slice();
    const pending = [];
    let done = 0;
    const flush = async () => {
      if (!pending.length) return;
      const batch = pending.splice(0, pending.length);
      try {
        const j = await apiJson('?photoMetaBatch=1&project=' + encodeURIComponent(projectId), {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ photos: batch }),
        });
        setPhotos(j.photos || []);
      } catch (e) {
        for (const b of batch) failed.push(b.name + ' — ' + e.message);
      }
    };

    const worker = async () => {
      while (queue.length && !cancelUploadRef.current) {
        const file = queue.shift();
        if (!file) break;
        setUploads((u) => ({ ...u, name: file.name }));
        if (existing.has(file.name + ':' + file.size)) { done++; continue; }
        try {
          const prep = await prepareImage(file, keepOriginal);
          const id = uid();
          const bytes = new Uint8Array(await prep.main.blob.arrayBuffer());
          const parts = Math.max(1, Math.ceil(bytes.length / PART_BYTES));
          for (let k = 0; k < parts; k++) {
            const slice = bytes.subarray(k * PART_BYTES, Math.min(bytes.length, (k + 1) * PART_BYTES));
            await api('?upload=1&project=' + encodeURIComponent(projectId) + '&photo=' + id + '&part=' + k, {
              method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: slice,
            });
          }
          await api('?upload=1&thumbFor=1&project=' + encodeURIComponent(projectId) + '&photo=' + id, {
            method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: await prep.thumb.blob.arrayBuffer(),
          });
          pending.push({
            id: id, name: file.name, parts: parts, bytes: bytes.length, originalBytes: file.size,
            w: prep.main.w, h: prep.main.h, fullW: prep.fullW, fullH: prep.fullH,
            uploadedAt: Date.now(), uploadedBy: (portalUser && (portalUser.name || portalUser.email)) || '',
            // the working copy is re-encoded through a canvas, which drops the
            // EXIF block — so keep the parsed values here and hand them to the
            // reconstruction, which needs focal length and GPS
            exif: prep.exif,
          });
        } catch (e) {
          failed.push(file.name + ' — ' + e.message);
        }
        done++;
        setUploads((u) => ({ ...u, done: done }));
        if (pending.length >= 10) await flush();
      }
    };

    const lanes = Math.min(3, Math.max(1, files.length));
    await Promise.all(Array.from({ length: lanes }, worker));
    await flush();
    setUploads({ active: false, done: done, total: files.length, name: '', failed: failed });
    if (failed.length) setError(failed.length + ' photo(s) failed to upload. ' + failed[0]);
  }, [projectId, photos, portalUser, prepareImage]);

  const deletePhotos = useCallback(async (ids) => {
    if (!ids.length || !projectId) return;
    if (!window.confirm('Remove ' + ids.length + ' photo(s) from this capture?')) return;
    try {
      const j = await apiJson('?deletePhoto=1&project=' + encodeURIComponent(projectId), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: ids }),
      });
      setPhotos(j.photos || []);
      setSelected(new Set());
    } catch (e) { setError('Could not remove: ' + e.message); }
  }, [projectId]);

  const [selected, setSelected] = useState(new Set());

  /* ── reconstruction ── */
  const [quality, setQuality] = useState('balanced');
  const [wantMesh, setWantMesh] = useState(true);
  const [wantGeo, setWantGeo] = useState(true);
  const [run, setRun] = useState(null);      // {pct, stage, msg, log[], startedAt}
  const [result, setResult] = useState(null);
  const workerRef = useRef(null);

  const gpsCount = useMemo(() => photos.filter((p) => p.exif && p.exif.lat != null).length, [photos]);
  // the same cost model the worker measures against, so the pre-build estimate
  // and the running countdown agree
  const plan = useMemo(() => adaptSettings(PRESETS[quality], photos.length || 0), [quality, photos.length]);
  const estimate = useMemo(() => (photos.length ? estimateBuildSeconds(plan.opt, photos.length, wantMesh) * 1000 : null),
    [plan, photos.length, wantMesh]);

  const discardBuild = useCallback(async (buildId) => {
    if (!projectId || !buildId) return;
    try {
      await apiJson('?deleteBuild=1&project=' + encodeURIComponent(projectId), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ buildId: buildId }),
      });
      setUnfinished(null);
    } catch (e) { setError('Could not clear the saved progress: ' + e.message); }
  }, [projectId]);

  const startBuild = useCallback((resumeBuild) => {
    if (!projectId || photos.length < 3) { setError('Upload at least 3 overlapping photos first.'); return; }
    setError('');
    setResult(null);
    setSavedAt(null);
    const started = Date.now();
    const buildId = (resumeBuild && resumeBuild.buildId) || uid();
    // one working build per capture: starting fresh retires the older one
    if (!resumeBuild && unfinished && unfinished.buildId) discardBuild(unfinished.buildId);
    setRun({
      pct: resumeBuild ? (resumeBuild.pct || 0) : 0, stage: 'starting',
      msg: resumeBuild ? 'Picking up where the last session stopped…' : 'Starting the reconstruction…',
      log: [], startedAt: started, buildId: buildId, resuming: !!resumeBuild,
    });
    setTab('model');
    try {
      if (workerRef.current) workerRef.current.terminate();
      const worker = new Worker(new URL('./pg_worker.js', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      worker.onmessage = (e) => {
        const m = e.data || {};
        if (m.type === 'progress') {
          setRun((r) => (r ? {
            ...r, pct: m.pct, stage: m.stage, stageLabel: m.stageLabel, msg: m.msg,
            etaMs: m.etaMs, elapsedMs: m.elapsedMs, done: m.done, units: m.units, at: Date.now(),
            log: r.log.length && r.log[r.log.length - 1] === m.msg ? r.log : r.log.concat([m.msg]).slice(-200),
          } : r));
        } else if (m.type === 'checkpoint') {
          setRun((r) => (r ? { ...r, savedAt: m.at } : r));
        } else if (m.type === 'note') {
          setRun((r) => (r ? { ...r, note: m.message, log: r.log.concat(['· ' + m.message]) } : r));
        } else if (m.type === 'done') {
          setResult(m.result);
          setUnfinished(null);
          setRun((r) => (r ? { ...r, pct: 1, stage: 'done', msg: 'Model complete', finishedAt: Date.now() } : r));
          worker.terminate(); workerRef.current = null;
          // a build worth checkpointing is worth keeping: save it to the capture
          // rather than leaving it to a tab that might get closed. Short builds
          // are cheap to repeat, so their working files go straight away.
          if (Date.now() - started > 120000) setAutoSave({ result: m.result, buildId: m.buildId });
          else if (m.buildId) discardBuild(m.buildId);
        } else if (m.type === 'cancelled') {
          setRun(null); worker.terminate(); workerRef.current = null;
          loadBuilds(projectId);          // a stopped build can be picked up again
        } else if (m.type === 'error') {
          setError(m.message);
          setRun((r) => (r ? { ...r, stage: 'error', msg: m.message } : r));
          worker.terminate(); workerRef.current = null;
          loadBuilds(projectId);
        }
      };
      worker.onerror = (e) => {
        setError('Reconstruction worker failed: ' + (e.message || 'unknown error'));
        setRun((r) => (r ? { ...r, stage: 'error' } : r));
      };
      worker.postMessage({
        type: 'build',
        quality: resumeBuild ? (resumeBuild.quality || quality) : quality,
        mesh: wantMesh,
        georeference: wantGeo,
        endpoint: ENDPOINT,
        projectId: projectId,
        buildId: buildId,
        resume: !!resumeBuild,
        photos: photos.map((p) => ({
          id: p.id, name: p.name, exif: p.exif || null,
          urls: Array.from({ length: p.parts || 1 }, (_, k) =>
            ENDPOINT + '?photo=' + encodeURIComponent(p.id) + '&project=' + encodeURIComponent(projectId) + '&part=' + k),
        })),
      });
    } catch (e) {
      setError('This browser cannot run the reconstruction engine: ' + e.message);
      setRun(null);
    }
  }, [projectId, photos, quality, wantMesh, wantGeo, loadBuilds, discardBuild, unfinished]);

  const cancelBuild = useCallback(() => {
    if (workerRef.current) { workerRef.current.terminate(); workerRef.current = null; }
    setRun(null);
    loadBuilds(projectId);
  }, [loadBuilds, projectId]);

  useEffect(() => () => { if (workerRef.current) workerRef.current.terminate(); }, []);

  /* ── saving / loading models ── */
  const [saveState, setSaveState] = useState('');
  const [savedAt, setSavedAt] = useState(null);
  const saveModel = useCallback(async () => {
    if (!result || !projectId) return;
    setSaveState('Packing…');
    try {
      const buf = packModel(result, SAVED_POINT_CAP);
      let bin = '';
      const u8 = new Uint8Array(buf);
      const step = 0x8000;
      for (let i = 0; i < u8.length; i += step) bin += String.fromCharCode.apply(null, u8.subarray(i, i + step));
      const b64 = btoa(bin);
      const chunks = Math.ceil(b64.length / CHUNK_CHARS);
      const modelId = uid();
      for (let i = 0; i < chunks; i++) {
        setSaveState('Saving ' + (i + 1) + '/' + chunks);
        await apiJson('?modelChunk=1&project=' + encodeURIComponent(projectId), {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ modelId: modelId, index: i, data: b64.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS) }),
        });
      }
      const model = {
        id: modelId, chunks: chunks, bytes: buf.byteLength, createdAt: Date.now(),
        createdBy: (portalUser && (portalUser.name || portalUser.email)) || '',
        name: (project ? project.name : 'Capture') + ' — ' + new Date().toLocaleString(),
        stats: result.stats,
      };
      const j = await apiJson('?modelFinalize=1&project=' + encodeURIComponent(projectId), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: model }),
      });
      setModels(j.models || []);
      setSavedAt({ at: Date.now(), points: model.stats && model.stats.savedPoints ? model.stats.savedPoints : result.positions.length / 3, bytes: buf.byteLength });
      setSaveState('Saved');
      setTimeout(() => setSaveState(''), 2500);
    } catch (e) {
      setSaveState('');
      setError('Could not save the model: ' + e.message);
    }
  }, [result, projectId, project, portalUser]);

  useEffect(() => {
    if (!autoSave || !result || saveState) return;
    setAutoSave(null);
    (async () => {
      await saveModel();
      // the model is stored; the working checkpoint has done its job
      if (autoSave.buildId) discardBuild(autoSave.buildId);
    })();
  }, [autoSave, result, saveState, saveModel, discardBuild]);

  const openModel = useCallback(async (m) => {
    setSaveState('Loading ' + m.name);
    try {
      let b64 = '';
      for (let i = 0; i < m.chunks; i++) {
        const j = await apiJson('?modelChunk=' + i + '&model=' + encodeURIComponent(m.id) + '&project=' + encodeURIComponent(projectId));
        b64 += j.data || '';
      }
      const bin = atob(b64);
      const buf = new ArrayBuffer(bin.length);
      const u8 = new Uint8Array(buf);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const dv = new DataView(buf);
      if (dv.getUint32(0, true) !== MAGIC) throw new Error('unrecognised model file');
      const jsonLen = dv.getUint32(8, true);
      const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, jsonLen)));
      const pad = (n) => (n + 3) & ~3;
      let off = 12 + pad(jsonLen);
      const c = meta.counts;
      const positions = new Float32Array(buf.slice(off, off + c.points * 12)); off += pad(c.points * 12);
      const colors = new Uint8Array(buf.slice(off, off + c.points * 3)); off += pad(c.points * 3);
      let mesh = null;
      if (c.meshVerts) {
        const mp = new Float32Array(buf.slice(off, off + c.meshVerts * 12)); off += pad(c.meshVerts * 12);
        const mc = new Uint8Array(buf.slice(off, off + c.meshVerts * 3)); off += pad(c.meshVerts * 3);
        const mi = new Uint32Array(buf.slice(off, off + c.meshIdx * 4)); off += pad(c.meshIdx * 4);
        mesh = { positions: mp, colors: mc, indices: mi, triangles: mi.length / 3 };
      }
      let ortho = null;
      if (c.ortho) {
        const [ow, oh] = c.ortho;
        ortho = { rgba: new Uint8ClampedArray(buf.slice(off, off + ow * oh * 4)), w: ow, h: oh };
      }
      setResult({ positions, colors, mesh, ortho, cameras: meta.cameras || [], stats: meta.stats || {} });
      setSavedAt(null);
      setRun(null);
      setTab('model');
      setSaveState('');
    } catch (e) {
      setSaveState('');
      setError('Could not open that model: ' + e.message);
    }
  }, [projectId]);

  const deleteModel = useCallback(async (m) => {
    if (!window.confirm('Delete saved model "' + m.name + '"?')) return;
    try {
      const j = await apiJson('?deleteModel=1&project=' + encodeURIComponent(projectId), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modelId: m.id }),
      });
      setModels(j.models || []);
    } catch (e) { setError('Delete failed: ' + e.message); }
  }, [projectId]);

  /* ── exports ── */
  const baseName = useMemo(() => ((project && project.name) || 'capture').replace(/[^\w\-]+/g, '_').toLowerCase(), [project]);
  const exportCloudPLY = () => download(new Blob([exportPLY(result.positions, result.colors, null, 'Sunrise Construction — ' + (project ? project.name : ''))]), baseName + '-points.ply');
  const exportMeshPLY = () => download(new Blob([exportPLY(result.mesh.positions, result.mesh.colors, result.mesh.indices, 'Sunrise Construction — ' + (project ? project.name : ''))]), baseName + '-mesh.ply');
  const exportCloudGLB = () => download(new Blob([exportGLB(result.positions, result.colors, null, result.stats)]), baseName + '-points.glb');
  const exportMeshGLB = () => download(new Blob([exportGLB(result.mesh.positions, result.mesh.colors, result.mesh.indices, result.stats)]), baseName + '-mesh.glb');
  const exportMeshOBJ = () => {
    // OBJ is text: a multi-million vertex mesh would build a string bigger than
    // the tab can hold, and PLY/GLB carry the same data
    if (result.mesh.positions.length / 3 > 1200000) {
      setError('This mesh is too large for OBJ (' + Math.round(result.mesh.positions.length / 3e6 * 10) / 10 + 'M vertices). Use the PLY or GLB export — every CAD package reads them.');
      return;
    }
    download(new Blob([exportOBJ(result.mesh.positions, result.mesh.colors, result.mesh.indices, project ? project.name : '')]), baseName + '-mesh.obj');
  };
  const exportOrtho = () => {
    const o = result.ortho;
    const canvas = document.createElement('canvas');
    canvas.width = o.w; canvas.height = o.h;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(o.w, o.h);
    // the grid runs bottom-up in plane coordinates; flip so north is up
    for (let y = 0; y < o.h; y++) {
      const src = (o.h - 1 - y) * o.w * 4, dst = y * o.w * 4;
      img.data.set(o.rgba.subarray(src, src + o.w * 4), dst);
    }
    ctx.putImageData(img, 0, 0);
    canvas.toBlob((b) => download(b, baseName + '-orthophoto.png'), 'image/png');
  };
  const exportCamerasCSV = () => {
    const rows = [['photo', 'x', 'y', 'z', 'units'].join(',')];
    for (const c of result.cameras) rows.push([JSON.stringify(c.name), c.C[0].toFixed(4), c.C[1].toFixed(4), c.C[2].toFixed(4), JSON.stringify(result.stats.units)].join(','));
    download(new Blob([rows.join('\n')], { type: 'text/csv' }), baseName + '-cameras.csv');
  };

  /* ── setting real-world scale without GPS ── */
  const applyScale = useCallback((idxA, idxB, metres) => {
    if (!result || !result.cameras || !(metres > 0)) return;
    const a = result.cameras[idxA], b = result.cameras[idxB];
    if (!a || !b) return;
    const cur = Math.hypot(a.C[0] - b.C[0], a.C[1] - b.C[1], a.C[2] - b.C[2]);
    if (!(cur > 1e-9)) { setError('Those two photos were taken from the same spot — pick two further apart.'); return; }
    const k = metres / cur;
    const positions = Float32Array.from(result.positions, (v) => v * k);
    const mesh = result.mesh ? {
      ...result.mesh, positions: Float32Array.from(result.mesh.positions, (v) => v * k),
    } : null;
    const cameras = result.cameras.map((c) => ({ ...c, C: c.C.map((v) => v * k) }));
    setResult({
      ...result, positions, mesh, cameras,
      stats: { ...result.stats, spacing: (result.stats.spacing || 0) * k, units: 'metres (scaled from a known distance)', scaledManually: true },
    });
    setStatus('Model rescaled: ' + metres + ' m between ' + a.name + ' and ' + b.name + '.');
  }, [result]);

  /* ── viewer state ── */
  const [viewMode, setViewMode] = useState('auto');
  const [ptSize, setPtSize] = useState(1);
  const [showCams, setShowCams] = useState(true);
  const viewerRef = useRef(null);

  /* ── rendering ── */
  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: mob ? 8 : 14, padding: mob ? '9px 12px' : '12px 22px', background: 'rgba(4,4,12,.85)', backdropFilter: 'blur(14px)', borderBottom: '1px solid ' + LINE, position: 'sticky', top: 0, zIndex: 5 }}>
      <button onClick={onExit} style={{ ...ghostSm }}>&larr; Portal</button>
      <img src={LOGO_URL} alt="SRC" style={{ width: mob ? 30 : 40, height: mob ? 30 : 40, objectFit: 'contain' }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: BBF, fontSize: mob ? 17 : 22, letterSpacing: 1.5, color: CREAM, lineHeight: 1 }}>PHOTOGRAMMETRY STUDIO</div>
        <div style={{ fontFamily: NBF, fontSize: 11, letterSpacing: 2, color: MUTE, textTransform: 'uppercase' }}>
          {project ? project.name : 'Site photos → 3D models'}
        </div>
      </div>
      {project && (
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {['photos', 'build', 'model'].map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{
              ...ghostSm,
              background: tab === t ? 'rgba(249,115,22,.18)' : 'transparent',
              borderColor: tab === t ? ORANGE : LINE, color: tab === t ? ORANGE : CREAM,
            }}>{t === 'photos' ? 'Photos' : t === 'build' ? 'Build' : 'Model'}</button>
          ))}
        </div>
      )}
    </div>
  );

  const banner = (error || status) ? (
    <div style={{ padding: '10px 16px', background: error ? 'rgba(239,68,68,.14)' : 'rgba(22,163,74,.14)', border: '1px solid ' + (error ? 'rgba(239,68,68,.4)' : 'rgba(22,163,74,.4)'), margin: mob ? '10px 12px 0' : '14px 22px 0', display: 'flex', gap: 10, alignItems: 'center' }}>
      <span style={{ fontFamily: NBF, fontSize: 13, color: error ? '#fecaca' : '#bbf7d0', flex: 1 }}>{error || status}</span>
      <button onClick={() => { setError(''); setStatus(''); }} style={{ ...ghostSm, padding: '3px 9px' }}>Dismiss</button>
    </div>
  ) : null;

  if (!project) {
    return (
      <div style={shell}>
        {header}
        {banner}
        <div style={{ padding: mob ? 14 : 26, maxWidth: 1000, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
          <div style={{ ...card, marginBottom: 18 }}>
            <div style={{ fontFamily: BBF, fontSize: 20, letterSpacing: 1.5, marginBottom: 8 }}>NEW CAPTURE</div>
            <div style={{ ...label, letterSpacing: 1.5, textTransform: 'none', fontSize: 12, marginBottom: 12, color: MUTE }}>
              A capture is one set of photos of one site or object. Fly or walk the subject with 60–80% overlap between
              shots, keep the camera settings fixed, and upload every frame here. The model is built in this browser —
              nothing is sent to an outside service.
            </div>
            <NewProjectForm onCreate={createProject} />
          </div>
          <div style={{ ...label }}>Captures</div>
          {!projects.length && <div style={{ ...card, color: MUTE, fontFamily: NBF }}>No captures yet.</div>}
          <div style={{ display: 'grid', gridTemplateColumns: mob ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {projects.map((p) => (
              <div key={p.id} style={{ ...card, cursor: 'pointer' }} onClick={() => setProjectId(p.id)}>
                <div style={{ fontFamily: BBF, fontSize: 19, letterSpacing: 1, color: CREAM }}>{p.name}</div>
                <div style={{ fontFamily: NBF, fontSize: 12, color: MUTE }}>
                  {new Date(p.createdAt || Date.now()).toLocaleDateString()} · {p.createdBy || '—'}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button style={{ ...btn, padding: '6px 12px', fontSize: 11 }} onClick={(e) => { e.stopPropagation(); setProjectId(p.id); }}>Open</button>
                  <button style={{ ...ghostSm, borderColor: 'rgba(239,68,68,.4)', color: '#fca5a5' }}
                    onClick={(e) => { e.stopPropagation(); deleteProject(p.id); }} disabled={busy}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={shell}>
      {header}
      {banner}
      <div style={{ padding: mob ? 12 : 22, maxWidth: 1400, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
          <button style={ghostSm} onClick={() => { setProjectId(null); setResult(null); setRun(null); }}>&larr; All captures</button>
          <span style={{ fontFamily: NBF, fontSize: 13, color: MUTE }}>
            {photos.length} photo{photos.length === 1 ? '' : 's'}
            {gpsCount ? ' · ' + gpsCount + ' with GPS' : ' · no GPS tags'}
            {models.length ? ' · ' + models.length + ' saved model' + (models.length === 1 ? '' : 's') : ''}
          </span>
          {!!unfinished && !run && (
            <button style={{ ...ghostSm, borderColor: ORANGE, color: ORANGE }} onClick={() => setTab('build')}>
              Unfinished build at {Math.round((unfinished.pct || 0) * 100)}% — resume
            </button>
          )}
        </div>

        {tab === 'photos' && (
          <PhotosTab
            mob={mob} projectId={projectId} photos={photos} uploads={uploads}
            onUpload={uploadFiles} onCancelUpload={() => { cancelUploadRef.current = true; }}
            onDelete={deletePhotos} selected={selected} setSelected={setSelected}
          />
        )}

        {tab === 'build' && (
          <BuildTab
            mob={mob} photos={photos} gpsCount={gpsCount} quality={quality} setQuality={setQuality}
            wantMesh={wantMesh} setWantMesh={setWantMesh} wantGeo={wantGeo} setWantGeo={setWantGeo}
            estimate={estimate} plan={plan} run={run} onBuild={() => startBuild(null)} onCancel={cancelBuild}
            models={models} onOpenModel={openModel} onDeleteModel={deleteModel} saveState={saveState}
            unfinished={unfinished} onResume={() => startBuild(unfinished)} onDiscard={() => discardBuild(unfinished.buildId)}
          />
        )}

        {tab === 'model' && (
          <ModelTab
            mob={mob} run={run} result={result} onCancel={cancelBuild} onBuild={() => setTab('build')}
            viewMode={viewMode} setViewMode={setViewMode} ptSize={ptSize} setPtSize={setPtSize}
            showCams={showCams} setShowCams={setShowCams} viewerRef={viewerRef}
            onSave={saveModel} saveState={saveState} savedAt={savedAt} baseName={baseName} onScale={applyScale}
            exports={{ exportCloudPLY, exportMeshPLY, exportCloudGLB, exportMeshGLB, exportMeshOBJ, exportOrtho, exportCamerasCSV }}
          />
        )}
      </div>
    </div>
  );
}

const shell = {
  position: 'fixed', inset: 0, zIndex: 2000,
  background: `radial-gradient(120% 80% at 50% -10%, #14182a 0%, ${INK} 55%, ${INK2} 100%)`,
  color: CREAM, fontFamily: NBF, display: 'flex', flexDirection: 'column', overflow: 'auto',
};

/* ── new project form ──────────────────────────────────────────────── */
function NewProjectForm({ onCreate }) {
  const [name, setName] = useState('');
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <input style={{ ...input, flex: '1 1 260px' }} placeholder="Capture name — e.g. Midway Block 3 · row 12 racking"
        value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { onCreate(name.trim()); setName(''); } }} />
      <button style={btn} disabled={!name.trim()} onClick={() => { onCreate(name.trim()); setName(''); }}>Create capture</button>
    </div>
  );
}

/* ── photos tab ────────────────────────────────────────────────────── */
function PhotosTab({ mob, projectId, photos, uploads, onUpload, onCancelUpload, onDelete, selected, setSelected }) {
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [drag, setDrag] = useState(false);
  const [limit, setLimit] = useState(240);   // a 600-photo grid does not need to mount at once
  const fileRef = useRef(null);

  const toggle = (id) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  return (
    <>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); onUpload(e.dataTransfer.files, keepOriginal); }}
        style={{
          ...card, borderStyle: 'dashed', borderColor: drag ? ORANGE : LINE,
          background: drag ? 'rgba(249,115,22,.08)' : CARD, textAlign: 'center', padding: mob ? 20 : 34, marginBottom: 16,
        }}>
        <div style={{ fontFamily: BBF, fontSize: 22, letterSpacing: 1.5, marginBottom: 6 }}>DROP PHOTOS HERE</div>
        <div style={{ fontFamily: NBF, fontSize: 13, color: MUTE, marginBottom: 14 }}>
          JPEG or PNG, straight off the drone or phone. Anything from 15 to 600 frames with heavy overlap.
          Uploads carry on where they left off — dropping the same folder again skips whatever is already here.
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
          onChange={(e) => { onUpload(e.target.files, keepOriginal); e.target.value = ''; }} />
        <button style={btn} onClick={() => fileRef.current && fileRef.current.click()} disabled={uploads.active}>
          {uploads.active ? 'Uploading…' : 'Choose photos'}
        </button>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 14, fontFamily: NBF, fontSize: 13, color: MUTE, cursor: 'pointer' }}>
          <input type="checkbox" checked={keepOriginal} onChange={(e) => setKeepOriginal(e.target.checked)} />
          Keep full-resolution originals
        </label>
        <div style={{ fontFamily: NBF, fontSize: 11, color: MUTE, marginTop: 8 }}>
          {keepOriginal
            ? 'Originals are stored as-is — slower uploads, larger storage.'
            : 'Photos are stored as ' + WORKING_MAX_DIM + ' px working copies (plenty for reconstruction).'}
        </div>
        {uploads.active && (
          <div style={{ marginTop: 14 }}>
            <Bar pct={uploads.total ? uploads.done / uploads.total : 0} />
            <div style={{ fontFamily: NBF, fontSize: 12, color: MUTE, marginTop: 6 }}>
              {uploads.done}/{uploads.total}
              {uploads.startedAt && uploads.done > 2
                ? ' · about ' + fmtTime((Date.now() - uploads.startedAt) / uploads.done * (uploads.total - uploads.done)) + ' left'
                : ''}
              {' · ' + uploads.name}
              <button style={{ ...ghostSm, marginLeft: 10, padding: '2px 8px' }} onClick={onCancelUpload}>Stop</button>
            </div>
          </div>
        )}
      </div>

      {!!photos.length && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: NBF, fontSize: 13, color: MUTE }}>
            {photos.length} photo{photos.length === 1 ? '' : 's'}
            {selected.size ? ' · ' + selected.size + ' selected' : ''}
          </span>
          <button style={ghostSm} onClick={() => setSelected(new Set(photos.map((p) => p.id)))}>Select all</button>
          {!!selected.size && <button style={ghostSm} onClick={() => setSelected(new Set())}>Clear</button>}
          {!!selected.size && (
            <button style={{ ...ghostSm, borderColor: 'rgba(239,68,68,.4)', color: '#fca5a5' }}
              onClick={() => onDelete([...selected])}>Remove selected</button>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: mob ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 }}>
        {photos.slice(0, limit).map((p) => (
          <div key={p.id} onClick={() => toggle(p.id)} style={{
            border: '1px solid ' + (selected.has(p.id) ? ORANGE : LINE), background: CARD, cursor: 'pointer', overflow: 'hidden',
          }}>
            <div style={{ aspectRatio: '4 / 3', background: '#0c0f18', overflow: 'hidden' }}>
              <img src={ENDPOINT + '?thumb=' + encodeURIComponent(p.id) + '&project=' + encodeURIComponent(projectId)}
                alt={p.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </div>
            <div style={{ padding: '6px 8px' }}>
              <div style={{ fontFamily: NBF, fontSize: 12, color: CREAM, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
              <div style={{ fontFamily: NBF, fontSize: 10, color: MUTE, letterSpacing: 1 }}>
                {p.w}×{p.h} · {fmtBytes(p.bytes)}{p.exif && p.exif.lat != null ? ' · GPS' : ''}
              </div>
            </div>
          </div>
        ))}
      </div>
      {photos.length > limit && (
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <button style={ghost} onClick={() => setLimit(limit + 480)}>
            Show more ({photos.length - limit} not shown)
          </button>
        </div>
      )}
      {!photos.length && !uploads.active && (
        <div style={{ ...card, color: MUTE, fontFamily: NBF }}>No photos in this capture yet.</div>
      )}
    </>
  );
}

/* ── build tab ─────────────────────────────────────────────────────── */
function BuildTab({
  mob, photos, gpsCount, quality, setQuality, wantMesh, setWantMesh, wantGeo, setWantGeo,
  estimate, plan, run, onBuild, onCancel, models, onOpenModel, onDeleteModel, saveState,
  unfinished, onResume, onDiscard,
}) {
  const keys = PRESET_ORDER;
  const running = run && run.stage !== 'done' && run.stage !== 'error';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: mob ? '1fr' : '1.4fr 1fr', gap: 16, alignItems: 'start' }}>
      {!!unfinished && !running && (
        <div style={{ ...card, gridColumn: '1 / -1', borderColor: 'rgba(249,115,22,.55)', background: 'rgba(249,115,22,.08)' }}>
          <div style={{ fontFamily: BBF, fontSize: 18, letterSpacing: 1.5, marginBottom: 6 }}>UNFINISHED BUILD</div>
          <div style={{ fontFamily: NBF, fontSize: 13, color: CREAM, marginBottom: 10 }}>
            A build of {unfinished.photoCount} photo{unfinished.photoCount === 1 ? '' : 's'} stopped at{' '}
            <strong>{Math.round((unfinished.pct || 0) * 100)}%</strong>
            {unfinished.stage ? ' during ' + STAGE_WORDS[unfinished.stage] : ''}, {timeAgo(unfinished.updatedAt)}.
            Everything it had finished is saved with the capture — resuming carries on from there instead of starting
            over, from this or any other machine.
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button style={btn} onClick={onResume}>Resume build</button>
            <button style={ghostSm} onClick={onDiscard}>Discard saved progress</button>
          </div>
        </div>
      )}
      <div style={card}>
        <div style={{ fontFamily: BBF, fontSize: 20, letterSpacing: 1.5, marginBottom: 4 }}>MODEL QUALITY</div>
        <div style={{ fontFamily: NBF, fontSize: 12, color: MUTE, marginBottom: 14 }}>
          Everything runs in this browser tab, so quality trades directly against time. Start Fast to confirm the
          capture worked, then re-run at High detail for the deliverable.
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {keys.map((k) => {
            const p = PRESETS[k];
            const on = quality === k;
            return (
              <div key={k} onClick={() => setQuality(k)} style={{
                border: '1px solid ' + (on ? ORANGE : LINE), background: on ? 'rgba(249,115,22,.10)' : 'transparent',
                padding: '10px 12px', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'flex-start',
              }}>
                <div style={{
                  width: 14, height: 14, borderRadius: '50%', border: '2px solid ' + (on ? ORANGE : MUTE),
                  background: on ? ORANGE : 'transparent', marginTop: 3, flex: '0 0 auto',
                }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: BBF, fontSize: 16, letterSpacing: 1, color: on ? ORANGE : CREAM }}>
                    {p.label.toUpperCase()}
                    <span style={{ fontFamily: NBF, fontSize: 11, letterSpacing: 1, color: MUTE, marginLeft: 8 }}>
                      {p.maxDim}px · {p.features.toLocaleString()} features{p.dense ? ' · dense every ' + p.denseStride + 'px' : ' · sparse only'}
                    </span>
                  </div>
                  <div style={{ fontFamily: NBF, fontSize: 12, color: MUTE }}>{p.note}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
          <label style={checkRow}>
            <input type="checkbox" checked={wantMesh} onChange={(e) => setWantMesh(e.target.checked)} />
            <span>Build a surface mesh and orthophoto from the point cloud</span>
          </label>
          <label style={{ ...checkRow, opacity: gpsCount >= 3 ? 1 : 0.55 }}>
            <input type="checkbox" checked={wantGeo && gpsCount >= 3} disabled={gpsCount < 3} onChange={(e) => setWantGeo(e.target.checked)} />
            <span>
              Scale and orient from EXIF GPS
              {gpsCount >= 3 ? ' (' + gpsCount + ' photos tagged — output in metres)' : ' (needs GPS on at least 3 photos)'}
            </span>
          </label>
        </div>

        <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {run && run.stage !== 'error' && run.stage !== 'done'
            ? <button style={{ ...btn, background: RED, color: '#fff' }} onClick={onCancel}>Stop build</button>
            : <button style={btn} onClick={onBuild} disabled={photos.length < 3}>Build model</button>}
          <span style={{ fontFamily: NBF, fontSize: 12, color: MUTE }}>
            {photos.length < 3 ? 'Upload at least 3 photos.' : 'Estimated ' + fmtTime(estimate) + ' for ' + photos.length + ' photos'}
          </span>
        </div>
        {!!(plan && plan.notes.length) && (
          <div style={{ fontFamily: NBF, fontSize: 12, color: '#fcd34d', marginTop: 8 }}>
            {photos.length} photos: {plan.notes.join(', ')} so the build fits in browser memory.
          </div>
        )}
        <div style={{ fontFamily: NBF, fontSize: 12, color: MUTE, marginTop: 8, lineHeight: 1.5 }}>
          The build runs in this tab, so closing it stops the work — but not the progress: each stage is saved as it
          finishes, and reopening this capture offers to carry on from there. Progress and time remaining are on the
          Model tab while it runs.
        </div>
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        <div style={card}>
          <div style={{ fontFamily: BBF, fontSize: 18, letterSpacing: 1.5, marginBottom: 8 }}>CAPTURE CHECKLIST</div>
          {[
            ['60–80% overlap between consecutive photos', photos.length >= 3],
            ['At least 15 photos for a full surface', photos.length >= 15],
            ['GPS tags for real-world scale', gpsCount >= 3],
            ['Same camera and zoom for every frame', true],
          ].map(([text, ok], i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontFamily: NBF, fontSize: 13, color: ok ? CREAM : MUTE, marginBottom: 4 }}>
              <span style={{ color: ok ? GREEN : MUTE }}>{ok ? '✓' : '○'}</span>{text}
            </div>
          ))}
          <div style={{ fontFamily: NBF, fontSize: 12, color: MUTE, marginTop: 10, lineHeight: 1.5 }}>
            Without GPS the model is geometrically correct but has no scale — distances come out in model units.
          </div>
        </div>

        <div style={card}>
          <div style={{ fontFamily: BBF, fontSize: 18, letterSpacing: 1.5, marginBottom: 8 }}>SAVED MODELS</div>
          {saveState && <div style={{ fontFamily: NBF, fontSize: 12, color: ORANGE, marginBottom: 8 }}>{saveState}</div>}
          {!models.length && <div style={{ fontFamily: NBF, fontSize: 13, color: MUTE }}>Nothing saved yet.</div>}
          {models.map((m) => (
            <div key={m.id} style={{ borderTop: '1px solid ' + LINE, padding: '8px 0' }}>
              <div style={{ fontFamily: NBF, fontSize: 13, color: CREAM }}>{m.name}</div>
              <div style={{ fontFamily: NBF, fontSize: 11, color: MUTE, letterSpacing: 1 }}>
                {(m.stats && m.stats.densePoints || 0).toLocaleString()} points
                {m.stats && m.stats.triangles ? ' · ' + m.stats.triangles.toLocaleString() + ' triangles' : ''}
                {' · ' + fmtBytes(m.bytes)}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button style={{ ...ghostSm }} onClick={() => onOpenModel(m)}>Open</button>
                <button style={{ ...ghostSm, borderColor: 'rgba(239,68,68,.4)', color: '#fca5a5' }} onClick={() => onDeleteModel(m)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const checkRow = { display: 'flex', gap: 8, alignItems: 'flex-start', fontFamily: NBF, fontSize: 13, color: CREAM, cursor: 'pointer' };

const STAGE_WORDS = {
  features: 'reading the photos', matching: 'matching photos', verify: 'checking geometry',
  register: 'placing cameras', sparse: 'placing cameras', bundle: 'refining the solution',
  dense: 'building depth maps', fuse: 'fusing the point cloud', mesh: 'building the surface',
};

function timeAgo(ts) {
  if (!ts) return 'a while ago';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 90) return s + ' seconds ago';
  const m = Math.round(s / 60);
  if (m < 90) return m + ' minute' + (m === 1 ? '' : 's') + ' ago';
  const h = Math.round(m / 60);
  if (h < 36) return h + ' hour' + (h === 1 ? '' : 's') + ' ago';
  return Math.round(h / 24) + ' days ago';
}

/* ── model tab ─────────────────────────────────────────────────────── */
function ModelTab({
  mob, run, result, onCancel, onBuild, viewMode, setViewMode, ptSize, setPtSize,
  showCams, setShowCams, viewerRef, onSave, saveState, savedAt, baseName, exports, onScale,
}) {
  const logRef = useRef(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [run && run.log && run.log.length]);
  // the worker only posts a few times a second; tick locally so the clock and
  // the countdown keep moving between messages
  const [, tick] = useState(0);
  const live = !!(run && run.stage !== 'done' && run.stage !== 'error');
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => tick((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, [live]);

  if (!result && !run) {
    return (
      <div style={{ ...card, textAlign: 'center', padding: 40 }}>
        <div style={{ fontFamily: BBF, fontSize: 20, letterSpacing: 1.5, marginBottom: 8 }}>NO MODEL LOADED</div>
        <div style={{ fontFamily: NBF, fontSize: 13, color: MUTE, marginBottom: 16 }}>Build one from this capture, or open a saved model.</div>
        <button style={btn} onClick={onBuild}>Go to build settings</button>
      </div>
    );
  }

  const running = run && run.stage !== 'done' && run.stage !== 'error';
  const s = result ? result.stats : null;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {run && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
            <div style={{ fontFamily: BBF, fontSize: 18, letterSpacing: 1.5 }}>
              {run.stage === 'error' ? 'BUILD FAILED' : run.stage === 'done' ? 'BUILD COMPLETE' : 'BUILDING MODEL'}
            </div>
            <div style={{ fontFamily: BBF, fontSize: 34, letterSpacing: 1, color: ORANGE, lineHeight: 1 }}>
              {Math.round((run.pct || 0) * 100)}%
            </div>
            <div style={{ fontFamily: NBF, fontSize: 13, color: CREAM }}>
              {running
                ? (run.etaMs != null ? fmtTime(Math.max(0, run.etaMs - (Date.now() - (run.at || run.startedAt)))) + ' remaining' : 'estimating…')
                : run.stage === 'done' ? 'finished in ' + fmtTime((run.finishedAt || Date.now()) - run.startedAt) : ''}
            </div>
            <div style={{ fontFamily: NBF, fontSize: 12, color: MUTE }}>
              elapsed {fmtTime((run.finishedAt || Date.now()) - run.startedAt)}
              {run.stageLabel ? ' · ' + run.stageLabel : ''}
              {run.units ? ' ' + Math.min(run.done, run.units) + '/' + run.units : ''}
            </div>
            {running && <button style={{ ...ghostSm, marginLeft: 'auto', borderColor: 'rgba(239,68,68,.4)', color: '#fca5a5' }} onClick={onCancel}>Stop</button>}
          </div>
          <Bar pct={run.pct || 0} />
          <div style={{ fontFamily: NBF, fontSize: 13, color: CREAM, marginTop: 8 }}>{run.msg}</div>
          {run.note && <div style={{ fontFamily: NBF, fontSize: 12, color: '#fcd34d', marginTop: 4 }}>{run.note}</div>}
          {running && (
            <div style={{ fontFamily: NBF, fontSize: 12, color: GREEN, marginTop: 6 }}>
              {run.savedAt ? 'Progress saved ' + Math.max(0, Math.round((Date.now() - run.savedAt) / 1000)) + 's ago' : 'Saving progress as it goes'}
              <span style={{ color: MUTE }}> — closing this tab pauses the build; reopen the capture on any machine to carry on.</span>
            </div>
          )}
          {!!(run.log && run.log.length) && (
            <div ref={logRef} style={{
              marginTop: 10, maxHeight: 120, overflow: 'auto', background: 'rgba(0,0,0,.35)', border: '1px solid ' + LINE,
              padding: 8, fontFamily: NBF, fontSize: 11, color: MUTE, lineHeight: 1.6,
            }}>
              {run.log.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
        </div>
      )}

      {result && (
        <>
          <div style={{ border: '1px solid ' + LINE, background: '#06080f' }}>
            <div style={{ display: 'flex', gap: 8, padding: 8, borderBottom: '1px solid ' + LINE, flexWrap: 'wrap', alignItems: 'center' }}>
              {[['auto', 'Auto'], ['points', 'Points'], ['mesh', 'Surface'], ['both', 'Both']].map(([k, lab]) => (
                <button key={k} onClick={() => setViewMode(k)} disabled={(k === 'mesh' || k === 'both') && !result.mesh}
                  style={{
                    ...ghostSm,
                    background: viewMode === k ? 'rgba(249,115,22,.18)' : 'transparent',
                    borderColor: viewMode === k ? ORANGE : LINE,
                    color: (k === 'mesh' || k === 'both') && !result.mesh ? '#555' : viewMode === k ? ORANGE : CREAM,
                  }}>{lab}</button>
              ))}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: NBF, fontSize: 11, color: MUTE, marginLeft: 6 }}>
                POINT SIZE
                <input type="range" min="0.4" max="4" step="0.2" value={ptSize} onChange={(e) => setPtSize(parseFloat(e.target.value))} style={{ width: 90 }} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: NBF, fontSize: 11, color: MUTE, cursor: 'pointer' }}>
                <input type="checkbox" checked={showCams} onChange={(e) => setShowCams(e.target.checked)} />
                CAMERAS
              </label>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button style={ghostSm} onClick={() => viewerRef.current && viewerRef.current.fit(true)}>Top view</button>
                <button style={ghostSm} onClick={() => viewerRef.current && viewerRef.current.fit(false)}>Reset view</button>
                <button style={ghostSm} onClick={() => viewerSnapshot(viewerRef.current, baseName + '-view.png')}>Snapshot</button>
              </div>
            </div>
            <PointCloudViewer
              positions={result.positions} colors={result.colors} mesh={result.mesh} cameras={result.cameras}
              height={mob ? 320 : 520} mode={viewMode} pointSize={ptSize} showCameras={showCams}
              onReady={(st) => { viewerRef.current = st; }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: mob ? '1fr' : '1fr 1fr', gap: 16 }}>
            <div style={card}>
              <div style={{ fontFamily: BBF, fontSize: 18, letterSpacing: 1.5, marginBottom: 10 }}>RESULT</div>
              {[
                ['Photos placed', s.registered + ' of ' + s.photos],
                ['Dense points', (s.densePoints || 0).toLocaleString()],
                ['Triangles', (s.triangles || 0).toLocaleString() || '—'],
                ['Tie points', (s.tiePoints || 0).toLocaleString()],
                ['Reprojection error', (s.reprojPx || 0).toFixed(2) + ' px'],
                ['Point spacing', s.spacing ? s.spacing.toFixed(s.georeferenced ? 2 : 4) + (s.georeferenced ? ' m' : ' units') : '—'],
                ['Units', s.units],
                ['Focal length', Math.round(s.focalPx) + ' px — ' + s.focalSource + (s.focalRefined ? ' (self-calibrated)' : '')],
                ['GPS fit', s.georeferenced ? '±' + (s.geoRms || 0).toFixed(1) + ' m on camera positions' : 'not georeferenced'],
                ['Preset', (PRESETS[s.quality] || {}).label || s.quality],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderTop: '1px solid ' + LINE, padding: '5px 0', fontFamily: NBF, fontSize: 13 }}>
                  <span style={{ color: MUTE }}>{k}</span><span style={{ color: CREAM, textAlign: 'right' }}>{v}</span>
                </div>
              ))}
              {!s.georeferenced && !!(result.cameras && result.cameras.length > 1) && (
                <ScaleBox cameras={result.cameras} onScale={onScale} scaled={!!s.scaledManually} />
              )}
              {!!(s.unregistered && s.unregistered.length) && (
                <div style={{ fontFamily: NBF, fontSize: 12, color: '#fcd34d', marginTop: 10 }}>
                  Not placed ({s.unregistered.length}): {s.unregistered.slice(0, 6).join(', ')}{s.unregistered.length > 6 ? '…' : ''} — usually too little overlap or motion blur.
                </div>
              )}
            </div>

            <div style={card}>
              <div style={{ fontFamily: BBF, fontSize: 18, letterSpacing: 1.5, marginBottom: 10 }}>EXPORT & SAVE</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button style={ghostSm} onClick={exports.exportCloudPLY}>Point cloud .PLY</button>
                <button style={ghostSm} onClick={exports.exportCloudGLB}>Point cloud .GLB</button>
                {result.mesh && <button style={ghostSm} onClick={exports.exportMeshPLY}>Mesh .PLY</button>}
                {result.mesh && <button style={ghostSm} onClick={exports.exportMeshGLB}>Mesh .GLB</button>}
                {result.mesh && <button style={ghostSm} onClick={exports.exportMeshOBJ}>Mesh .OBJ</button>}
                {result.ortho && <button style={ghostSm} onClick={exports.exportOrtho}>Orthophoto .PNG</button>}
                <button style={ghostSm} onClick={exports.exportCamerasCSV}>Camera positions .CSV</button>
              </div>
              <div style={{ fontFamily: NBF, fontSize: 12, color: MUTE, margin: '12px 0' }}>
                PLY and OBJ open in CloudCompare, Meshlab, Recap and Civil 3D. GLB drops straight into the Task Tracker
                3D view and any web viewer.
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button style={btn} onClick={onSave} disabled={!!saveState}>{saveState || 'Save to this capture'}</button>
                {savedAt && (
                  <span style={{ fontFamily: NBF, fontSize: 12, color: GREEN }}>
                    Last saved {new Date(savedAt.at).toLocaleTimeString()} · {Math.round(savedAt.points).toLocaleString()} points · {fmtBytes(savedAt.bytes)}
                  </span>
                )}
                <span style={{ fontFamily: NBF, fontSize: 12, color: MUTE }}>
                  Visible to everyone with portal access.
                  {s.densePoints > SAVED_POINT_CAP
                    ? ' Saved copies are thinned to ' + (SAVED_POINT_CAP / 1e6).toFixed(1) + 'M points — export above for the full cloud.'
                    : ''}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* No GPS in the photos means no scale. Two photo stations and the distance
   between them is the simplest measurement a crew can actually take on site. */
function ScaleBox({ cameras, onScale, scaled }) {
  const [a, setA] = useState(0);
  const [b, setB] = useState(cameras.length > 1 ? cameras.length - 1 : 0);
  const [dist, setDist] = useState('');
  const sel = { ...input, padding: '5px 8px', fontSize: 12, width: 'auto', maxWidth: 150 };
  return (
    <div style={{ borderTop: '1px solid ' + LINE, marginTop: 10, paddingTop: 10 }}>
      <div style={{ ...label, marginBottom: 6 }}>{scaled ? 'Scale applied' : 'Set real-world scale'}</div>
      <div style={{ fontFamily: NBF, fontSize: 12, color: MUTE, marginBottom: 8 }}>
        Measure the distance between two camera stations on site, then enter it here to put the model in metres.
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <select style={sel} value={a} onChange={(e) => setA(parseInt(e.target.value, 10))}>
          {cameras.map((c, i) => <option key={c.id || i} value={i}>{c.name}</option>)}
        </select>
        <span style={{ fontFamily: NBF, fontSize: 12, color: MUTE }}>to</span>
        <select style={sel} value={b} onChange={(e) => setB(parseInt(e.target.value, 10))}>
          {cameras.map((c, i) => <option key={c.id || i} value={i}>{c.name}</option>)}
        </select>
        <input style={{ ...input, width: 90 }} placeholder="metres" value={dist}
          onChange={(e) => setDist(e.target.value.replace(/[^0-9.]/g, ''))} />
        <button style={{ ...ghostSm }} disabled={!(parseFloat(dist) > 0) || a === b}
          onClick={() => onScale(a, b, parseFloat(dist))}>Apply</button>
      </div>
    </div>
  );
}

function Bar({ pct }) {
  return (
    <div style={{ height: 8, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
      <div style={{ height: '100%', width: Math.round((pct || 0) * 100) + '%', background: ORANGE, transition: 'width .3s' }} />
    </div>
  );
}
