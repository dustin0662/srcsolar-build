import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import JSZip from 'jszip';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */
const STAGE_COLORS = {
  0: '#4b5563',
  1: '#dc2626', // Bores
  2: '#e86a10', // Piles
  3: '#eab308', // Post Caps
  4: '#0891b2', // Torque Tube
  5: '#16a34a', // Modules
};
const STAGE_LABELS = {
  1: 'Bores',
  2: 'Piles Installed',
  3: 'Post Caps Installed',
  4: 'Torque Tube Installed',
  5: 'Modules Installed',
};
const BRAND_ORANGE = '#F97316';
const STORAGE_KEY = 'task-tracker-kmz-v1';
const EXAMPLE_URL = '/example-site.kmz';
const EXAMPLE_NAME = 'Nottingham PCS 3.6/3.5/1.3';

/* ------------------------------------------------------------------ */
/*  KMZ / KML Parsing                                                  */
/* ------------------------------------------------------------------ */
async function parseKmzArrayBuffer(buf) {
  const zip = await JSZip.loadAsync(buf);
  let kmlText = null;
  const preferred = ['doc.kml'];
  for (const name of preferred) {
    if (zip.files[name]) { kmlText = await zip.files[name].async('string'); break; }
  }
  if (!kmlText) {
    for (const name of Object.keys(zip.files)) {
      if (name.toLowerCase().endsWith('.kml')) {
        kmlText = await zip.files[name].async('string');
        break;
      }
    }
  }
  if (!kmlText) throw new Error('No .kml file found inside KMZ');
  return parseKmlText(kmlText);
}

function parseKmlText(kmlText) {
  const doc = new DOMParser().parseFromString(kmlText, 'application/xml');
  const errNode = doc.querySelector('parsererror');
  if (errNode) throw new Error('KML parse error');
  const points = [];
  let idCounter = 1;

  function textOfChild(el, tag) {
    for (const c of el.children) if (c.tagName === tag || c.localName === tag) return c.textContent;
    return null;
  }

  function parsePlacemark(pm, folderName) {
    // Find Point / coordinates
    const ptEl = pm.getElementsByTagName('Point')[0]
              || pm.getElementsByTagName('point')[0];
    if (!ptEl) return null;
    const coordsEl = ptEl.getElementsByTagName('coordinates')[0];
    if (!coordsEl) return null;
    const raw = coordsEl.textContent.trim();
    const parts = raw.split(/[,\s]+/);
    const lon = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);
    if (!isFinite(lat) || !isFinite(lon)) return null;
    const name = textOfChild(pm, 'name') || '';
    const desc = textOfChild(pm, 'description') || '';
    // Try to pull "Row #" out of description for section grouping
    let row = null;
    const m = /Row\s*#?:?\s*([^<\n]+)/i.exec(desc);
    if (m) row = m[1].trim();
    return {
      id: pm.getAttribute('id') || `pm_${idCounter++}`,
      lat, lon,
      folder: folderName || 'default',
      row,
      name: name.trim(),
      desc: desc.trim(),
      stage: 0,
    };
  }

  function walkFolder(folderEl, inheritedName) {
    let folderName = inheritedName;
    for (const c of folderEl.children) {
      if (c.tagName === 'name' || c.localName === 'name') { folderName = c.textContent.trim(); break; }
    }
    for (const c of folderEl.children) {
      if (c.tagName === 'Placemark' || c.localName === 'Placemark') {
        const p = parsePlacemark(c, folderName);
        if (p) points.push(p);
      } else if (c.tagName === 'Folder' || c.localName === 'Folder') {
        walkFolder(c, folderName);
      } else if (c.tagName === 'Document' || c.localName === 'Document') {
        walkFolder(c, folderName);
      }
    }
  }

  const rootDocs = doc.getElementsByTagName('Document');
  const rootFolders = doc.getElementsByTagName('Folder');
  if (rootDocs.length) {
    for (const d of rootDocs) walkFolder(d, 'default');
  }
  if (points.length === 0 && rootFolders.length) {
    for (const f of rootFolders) walkFolder(f, 'default');
  }
  if (points.length === 0) {
    // No folders — take all placemarks directly
    const pms = doc.getElementsByTagName('Placemark');
    for (const pm of pms) {
      const p = parsePlacemark(pm, 'default');
      if (p) points.push(p);
    }
  }
  return points;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function KmzSatelliteTracker({ onExit, onSwitchToDrawing, initialKmzFile, onConsumeInitial }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);          // parallel to points[]
  const projCacheRef = useRef(new Map()); // id -> [x,y]
  const pointsRef = useRef([]);           // live mutable copy for perf
  const undoRef = useRef([]);
  const rafRef = useRef(0);

  const [points, setPoints] = useState([]);
  const [tool, setTool] = useState('brush'); // brush | fill | pan
  const [stage, setStage] = useState(2);
  const [brushRadius, setBrushRadius] = useState(24);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [projectName, setProjectName] = useState('Untitled');
  const [pointRadius, setPointRadius] = useState(4);

  /* -------- Persistence / initial load -------- */
  useEffect(() => {
    // 1. Explicit KMZ file handed in from the "New Project" flow wins.
    if (initialKmzFile) {
      loadKmzFile(initialKmzFile);
      if (onConsumeInitial) onConsumeInitial();
      return;
    }
    // 2. Restore previous session.
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data.points) && data.points.length) {
          setPoints(data.points);
          setProjectName(data.projectName || 'Untitled');
          return;
        }
      }
    } catch {}
    // 3. First run: auto-load bundled example.
    loadExample();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!points.length) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ points, projectName }));
    } catch {}
  }, [points, projectName]);

  /* -------- Init map (once) -------- */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [40.1877, -81.062],
      zoom: 17,
      zoomControl: false,
      preferCanvas: true,
      worldCopyJump: false,
    });
    // Esri World Imagery — no API key, high-res satellite
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }
    ).addTo(map);
    // Label overlay (roads, place names) at reduced opacity
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, opacity: 0.6 }
    ).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.scale({ position: 'bottomleft', imperial: true, metric: false }).addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  /* -------- Rebuild markers when points change -------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Remove existing
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];
    pointsRef.current = points;
    if (!points.length) { projCacheRef.current = new Map(); return; }
    const renderer = L.canvas({ padding: 0.5 });
    for (const p of points) {
      const m = L.circleMarker([p.lat, p.lon], {
        radius: pointRadius,
        weight: 1,
        color: '#0f172a',
        fillColor: STAGE_COLORS[p.stage || 0],
        fillOpacity: 0.95,
        renderer,
      });
      m.addTo(map);
      markersRef.current.push(m);
    }
    // Fit bounds
    const bounds = L.latLngBounds(points.map(p => [p.lat, p.lon]));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40] });
    updateProjectionCache();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  /* -------- Marker size when zoom / radius changes -------- */
  useEffect(() => {
    for (const m of markersRef.current) m.setStyle({ radius: pointRadius });
  }, [pointRadius]);

  /* -------- Projection cache -------- */
  const updateProjectionCache = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const cache = new Map();
    const list = pointsRef.current;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const pt = map.latLngToContainerPoint([p.lat, p.lon]);
      cache.set(i, [pt.x, pt.y]);
    }
    projCacheRef.current = cache;
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onView = () => updateProjectionCache();
    map.on('moveend zoomend resize', onView);
    return () => { map.off('moveend zoomend resize', onView); };
  }, [updateProjectionCache]);

  /* -------- Painting -------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const container = map.getContainer();

    // Enable/disable map dragging
    if (tool === 'pan') map.dragging.enable();
    else map.dragging.disable();

    if (tool === 'pan') return;

    let painting = false;
    let snapshotTaken = false;
    let pendingUpdate = false;

    function snapshot() {
      if (snapshotTaken) return;
      const snap = pointsRef.current.map(p => p.stage || 0);
      undoRef.current.push(snap);
      if (undoRef.current.length > 40) undoRef.current.shift();
      snapshotTaken = true;
    }

    function getContainerXY(e) {
      const rect = container.getBoundingClientRect();
      return [e.clientX - rect.left, e.clientY - rect.top];
    }

    function paintAt(cx, cy) {
      const cache = projCacheRef.current;
      const list = pointsRef.current;
      const rSq = brushRadius * brushRadius;
      const markers = markersRef.current;
      let changed = false;
      for (let i = 0; i < list.length; i++) {
        const xy = cache.get(i);
        if (!xy) continue;
        const dx = xy[0] - cx, dy = xy[1] - cy;
        if (dx * dx + dy * dy <= rSq) {
          if (list[i].stage !== stage) {
            list[i].stage = stage;
            if (markers[i]) markers[i].setStyle({ fillColor: STAGE_COLORS[stage] });
            changed = true;
          }
        }
      }
      if (changed) pendingUpdate = true;
    }

    function fillFolderAt(cx, cy) {
      const cache = projCacheRef.current;
      const list = pointsRef.current;
      let bestI = -1, bestD = Infinity;
      for (let i = 0; i < list.length; i++) {
        const xy = cache.get(i); if (!xy) continue;
        const dx = xy[0] - cx, dy = xy[1] - cy;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; bestI = i; }
      }
      if (bestI < 0 || bestD > 60 * 60) return;
      const folder = list[bestI].folder;
      const row = list[bestI].row;
      snapshot();
      const markers = markersRef.current;
      for (let i = 0; i < list.length; i++) {
        if (list[i].folder === folder && (row == null || list[i].row === row)) {
          list[i].stage = stage;
          if (markers[i]) markers[i].setStyle({ fillColor: STAGE_COLORS[stage] });
        }
      }
      commitState();
    }

    function commitState() {
      setPoints(pointsRef.current.map(p => ({ ...p })));
    }

    function onDown(e) {
      if (e.button != null && e.button !== 0) return;
      const [cx, cy] = getContainerXY(e);
      if (tool === 'brush') {
        painting = true;
        snapshot();
        paintAt(cx, cy);
      } else if (tool === 'fill') {
        fillFolderAt(cx, cy);
      }
    }
    function onMove(e) {
      if (!painting) return;
      const [cx, cy] = getContainerXY(e);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => paintAt(cx, cy));
    }
    function onUp() {
      if (!painting) return;
      painting = false;
      snapshotTaken = false;
      if (pendingUpdate) { commitState(); pendingUpdate = false; }
    }

    container.addEventListener('pointerdown', onDown);
    container.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [tool, stage, brushRadius]);

  /* -------- Actions -------- */
  const loadKmzFile = useCallback(async (file) => {
    try {
      setLoading(true); setError('');
      const buf = await file.arrayBuffer();
      const pts = await parseKmzArrayBuffer(buf);
      if (!pts.length) throw new Error('No point placemarks found in KMZ');
      undoRef.current = [];
      setProjectName(file.name.replace(/\.kmz$/i, '').replace(/[_-]/g, ' '));
      setPoints(pts);
    } catch (e) {
      setError(e.message || String(e));
    } finally { setLoading(false); }
  }, []);

  const loadExample = useCallback(async () => {
    try {
      setLoading(true); setError('');
      const r = await fetch(EXAMPLE_URL);
      if (!r.ok) throw new Error('Could not fetch example KMZ');
      const buf = await r.arrayBuffer();
      const pts = await parseKmzArrayBuffer(buf);
      undoRef.current = [];
      setProjectName(EXAMPLE_NAME);
      setPoints(pts);
    } catch (e) {
      setError(e.message || String(e));
    } finally { setLoading(false); }
  }, []);

  const undo = useCallback(() => {
    const snap = undoRef.current.pop();
    if (!snap) return;
    const list = pointsRef.current;
    const markers = markersRef.current;
    for (let i = 0; i < list.length && i < snap.length; i++) {
      list[i].stage = snap[i];
      if (markers[i]) markers[i].setStyle({ fillColor: STAGE_COLORS[snap[i] || 0] });
    }
    setPoints(list.map(p => ({ ...p })));
  }, []);

  const clearAll = useCallback(() => {
    if (!confirm('Clear all painted stages? (Points remain)')) return;
    undoRef.current.push(pointsRef.current.map(p => p.stage || 0));
    const list = pointsRef.current;
    const markers = markersRef.current;
    for (let i = 0; i < list.length; i++) {
      list[i].stage = 0;
      if (markers[i]) markers[i].setStyle({ fillColor: STAGE_COLORS[0] });
    }
    setPoints(list.map(p => ({ ...p })));
  }, []);

  const resetData = useCallback(() => {
    if (!confirm('Remove all imported points from this tracker?')) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    undoRef.current = [];
    setPoints([]);
    setProjectName('Untitled');
  }, []);

  const fitBounds = useCallback(() => {
    const map = mapRef.current;
    if (!map || !pointsRef.current.length) return;
    const bounds = L.latLngBounds(pointsRef.current.map(p => [p.lat, p.lon]));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40] });
  }, []);

  /* -------- Stats -------- */
  const stats = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0];
    for (const p of points) counts[p.stage || 0]++;
    const total = points.length;
    const foldersMap = new Map();
    for (const p of points) foldersMap.set(p.folder, (foldersMap.get(p.folder) || 0) + 1);
    return {
      total,
      counts,
      stagePct: [1, 2, 3, 4, 5].map(s => total ? (counts[s] / total) * 100 : 0),
      overall: total ? (counts[5] / total) * 100 : 0,
      folders: [...foldersMap.entries()],
    };
  }, [points]);

  /* -------- Render -------- */
  const cursor = tool === 'brush' ? 'crosshair' : tool === 'fill' ? 'copy' : 'grab';

  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'flex',
      background: '#0f172a', color: '#f1f5f9',
      fontFamily: "'Barlow Condensed', sans-serif",
    }}>
      <style>{`
        .kmz-btn{background:#1e293b;border:1px solid #334155;color:#f1f5f9;padding:6px 12px;font-size:12px;cursor:pointer;letter-spacing:1.5px;text-transform:uppercase;font-family:'Barlow Condensed',sans-serif;font-weight:600;transition:.15s}
        .kmz-btn:hover{background:#334155;border-color:#475569}
        .kmz-btn.active{background:${BRAND_ORANGE};color:#0f172a;border-color:${BRAND_ORANGE}}
        .kmz-btn.wide{width:100%;padding:8px 12px}
        .kmz-h{color:${BRAND_ORANGE};font-size:11px;letter-spacing:2px;font-weight:700;margin:0 0 10px;font-family:'Barlow Condensed',sans-serif}
        .kmz-select{width:100%;background:#0f172a;color:#f1f5f9;border:1px solid #334155;padding:8px 10px;font-size:14px;font-family:inherit;outline:none}
        .kmz-row{display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #1e293b;font-size:13px}
        .kmz-row:last-child{border-bottom:none}
        .kmz-swatch{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:8px;vertical-align:middle}
        .leaflet-container{background:#0b1220 !important;font-family:inherit}
        .leaflet-control-attribution{background:rgba(2,6,23,.7) !important;color:#94a3b8 !important;font-size:10px !important}
        .leaflet-control-attribution a{color:#94a3b8 !important}
        .leaflet-bar a{background:#1e293b !important;color:#f1f5f9 !important;border-color:#334155 !important}
        .leaflet-bar a:hover{background:#334155 !important}
      `}</style>

      {/* ============ SIDEBAR ============ */}
      <div style={{
        width: 300, background: '#020617', padding: 16, overflowY: 'auto',
        borderRight: '1px solid #1e293b', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <div style={{ height: 3, width: 32, background: BRAND_ORANGE }} />
          <div className="kmz-h" style={{ margin: 0 }}>STATUS LEGEND</div>
        </div>

        {/* Progress card */}
        <div style={{ background: '#0f172a', padding: 14, marginBottom: 16, border: '1px solid #1e293b' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ fontSize: 10, letterSpacing: 2, color: '#94a3b8' }}>OVERALL COMPLETION</div>
            <div style={{ fontSize: 34, fontWeight: 900, color: BRAND_ORANGE, fontFamily: "'Bebas Neue',sans-serif", lineHeight: 1 }}>
              {stats.overall.toFixed(1)}%
            </div>
          </div>
          <div style={{ height: 6, background: '#1e293b', marginTop: 8, borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${stats.overall}%`, background: BRAND_ORANGE }} />
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>
            {stats.total.toLocaleString()} points · {stats.folders.length} folders
          </div>
          <div style={{ marginTop: 4, fontSize: 11, color: '#22c55e' }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#22c55e', marginRight: 6 }} />
            Persisted locally
          </div>
        </div>

        {/* Painting */}
        <div className="kmz-h">PAINTING</div>
        <select className="kmz-select" value={stage} onChange={e => setStage(+e.target.value)}>
          {[1, 2, 3, 4, 5].map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button className={'kmz-btn' + (tool === 'brush' ? ' active' : '')} onClick={() => setTool('brush')} style={{ flex: 1 }}>Brush</button>
          <button className={'kmz-btn' + (tool === 'fill' ? ' active' : '')} onClick={() => setTool('fill')} style={{ flex: 1 }}>Fill</button>
          <button className={'kmz-btn' + (tool === 'pan' ? ' active' : '')} onClick={() => setTool('pan')} style={{ flex: 1 }}>Pan</button>
        </div>
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#94a3b8', letterSpacing: 1.5, minWidth: 46 }}>BRUSH</span>
          <input type="range" min="8" max="80" step="2" value={brushRadius} onChange={e => setBrushRadius(+e.target.value)} style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: '#64748b', minWidth: 36, textAlign: 'right' }}>{brushRadius}px</span>
        </div>
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#94a3b8', letterSpacing: 1.5, minWidth: 46 }}>POINT</span>
          <input type="range" min="2" max="10" step="1" value={pointRadius} onChange={e => setPointRadius(+e.target.value)} style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: '#64748b', minWidth: 36, textAlign: 'right' }}>{pointRadius}px</span>
        </div>
        <button className="kmz-btn wide" onClick={undo} style={{ marginTop: 10 }} disabled={!undoRef.current.length}>↺ Undo</button>

        {/* Data */}
        <div className="kmz-h" style={{ marginTop: 22 }}>DATA</div>
        <label className="kmz-btn wide" style={{ display: 'block', textAlign: 'center', cursor: 'pointer', background: BRAND_ORANGE, color: '#0f172a', borderColor: BRAND_ORANGE }}>
          IMPORT KMZ / KML
          <input type="file" accept=".kmz,.kml,application/vnd.google-earth.kmz,application/vnd.google-earth.kml+xml"
            hidden onChange={e => { if (e.target.files && e.target.files[0]) loadKmzFile(e.target.files[0]); e.target.value = ''; }} />
        </label>
        <button className="kmz-btn wide" onClick={loadExample} style={{ marginTop: 6 }}>Load Example (Nottingham)</button>
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <button className="kmz-btn" onClick={fitBounds} style={{ flex: 1 }}>Fit to Points</button>
          <button className="kmz-btn" onClick={clearAll} style={{ flex: 1 }}>Clear Paint</button>
        </div>
        <button className="kmz-btn wide" onClick={resetData} style={{ marginTop: 6, color: '#f87171', borderColor: '#7f1d1d' }}>Remove All Points</button>
        {loading && <div style={{ color: BRAND_ORANGE, fontSize: 12, marginTop: 8 }}>Loading…</div>}
        {error && <div style={{ color: '#f87171', fontSize: 12, marginTop: 8 }}>{error}</div>}

        {/* Install Status */}
        <div className="kmz-h" style={{ marginTop: 22 }}>INSTALL STATUS (CUMULATIVE)</div>
        {[1, 2, 3, 4, 5].map(s => (
          <div key={s} className="kmz-row">
            <span>
              <span className="kmz-swatch" style={{ background: STAGE_COLORS[s] }} />
              {STAGE_LABELS[s]}
            </span>
            <span style={{ color: STAGE_COLORS[s], fontWeight: 700 }}>
              {stats.counts[s]} <span style={{ color: '#64748b', marginLeft: 6, fontWeight: 400 }}>{stats.stagePct[s - 1].toFixed(0)}%</span>
            </span>
          </div>
        ))}

        {/* Folders */}
        {stats.folders.length > 0 && (
          <>
            <div className="kmz-h" style={{ marginTop: 22 }}>FOLDERS</div>
            {stats.folders.map(([name, n]) => (
              <div key={name} className="kmz-row">
                <span style={{ color: '#cbd5e1' }}>{name}</span>
                <span style={{ color: '#94a3b8' }}>{n}</span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* ============ MAIN ============ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Top bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 16px', background: '#020617',
          borderBottom: '1px solid #1e293b',
        }}>
          {onExit && <button className="kmz-btn" onClick={onExit}>← Dashboard</button>}
          {onSwitchToDrawing && <button className="kmz-btn" onClick={onSwitchToDrawing}>Drawing Mode</button>}
          <img src="/logo-sunrise.svg" alt="Sunrise Construction" style={{ width: 44, height: 32, objectFit: 'contain' }} />
          <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 24, letterSpacing: 3, color: BRAND_ORANGE }}>
            TASK TRACKER
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', letterSpacing: 2, textTransform: 'uppercase' }}>
            SATELLITE · {projectName}
          </div>
          <div style={{ marginLeft: 'auto', fontSize: 11, letterSpacing: 1.5, color: '#94a3b8' }}>
            <span style={{ color: BRAND_ORANGE, fontWeight: 700, fontSize: 14 }}>{stats.overall.toFixed(1)}%</span> · {stats.total.toLocaleString()} pts
          </div>
        </div>
        {/* Map */}
        <div ref={containerRef} style={{ flex: 1, position: 'relative', cursor }} />
      </div>
    </div>
  );
}
