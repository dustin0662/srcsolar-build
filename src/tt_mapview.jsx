/* ------------------------------------------------------------------ */
/*  Task Tracker — satellite map view (Leaflet + Esri World Imagery)    */
/* ------------------------------------------------------------------ */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { convexHull, padHull, normRect, rectContains, DRAG_SLOP } from './tt_geom.js';

const ESRI_SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTR = 'Imagery &copy; Esri, Maxar, Earthstar Geographics';
const OSM_STREETS = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTR = '&copy; OpenStreetMap contributors';
const ORANGE = '#F97316';

/*  Fill colors mirror the SVG dot palette in pile_plan.jsx / pile_data.js  */
import { paintStack, radiusForZoom } from './tt_glyphs.jsx';

/* One marker per point for hit-testing / clicks, but drawing happens in a
   single multi-pass painter so the stacks layer correctly: piles, then the
   tubes that join points down a row, then modules on the tubes, then post
   caps on top, then flags. Sizes follow the zoom level. */
const GlyphMarker = L.CircleMarker.extend({
  _project() {
    const map = this._map; const z = map.getZoom(); const r = radiusForZoom(z);
    this._radius = r * 1.1; this.options.radius = this._radius;
    this._point = map.latLngToLayerPoint(this._latlng);
    this._nextPoint = this.options.nextLatLng ? map.latLngToLayerPoint(this.options.nextLatLng) : null;
    const pad = r * 2.6 + 4;   // cube above, flags, module width, joint to the next point
    const b = L.bounds(this._point.subtract([pad, pad]), this._point.add([pad, pad]));
    if (this._nextPoint) { b.extend(this._nextPoint.subtract([pad, pad])); b.extend(this._nextPoint.add([pad, pad])); }
    this._pxBounds = b;
  },
  _updatePath() { /* drawn by GlyphRenderer._draw */ },
  _item() {
    const o = this.options;
    return { x: this._point.x, y: this._point.y, nx: this._nextPoint ? this._nextPoint.x : null, ny: this._nextPoint ? this._nextPoint.y : null, s: o.stage || 0, q: o.qc || 0, ns: o.nextStage == null ? -1 : o.nextStage, dim: !!o.dimmed, hot: !!o.hot, del: !!o.del };
  },
});
const GlyphRenderer = L.Canvas.extend({
  _draw() {
    const bounds = this._redrawBounds; const ctx = this._ctx;
    ctx.save();
    if (bounds) { const size = bounds.getSize(); ctx.beginPath(); ctx.rect(bounds.min.x, bounds.min.y, size.x, size.y); ctx.clip(); }
    this._drawing = true;
    const glyphs = [], others = [];
    for (let order = this._drawFirst; order; order = order.next) {
      const layer = order.layer;
      if (bounds && !(layer._pxBounds && layer._pxBounds.intersects(bounds))) continue;
      if (layer instanceof GlyphMarker) glyphs.push(layer); else others.push(layer);
    }
    if (glyphs.length) {
      const r = radiusForZoom(this._map.getZoom());
      let dir = [0, 1];
      for (const g of glyphs) if (g._nextPoint) { const dx = g._nextPoint.x - g._point.x, dy = g._nextPoint.y - g._point.y, L2 = Math.hypot(dx, dy) || 1; dir = [dx / L2, dy / L2]; break; }
      paintStack(ctx, glyphs.map((g) => g._item()), r, dir);
    }
    for (const layer of others) layer._updatePath();
    this._drawing = false;
    ctx.restore();
  },
});

function colorFor(stage, qc) {
  if (qc === 2) return '#ea580c';
  if (qc === 1) return '#eab308';
  if (stage === 4) return '#16a34a';
  if (stage === 3) return '#7c3aed';
  if (stage === 2) return '#2563eb';
  if (stage === 1) return '#9ca3af';
  return '#e8e8ea';
}

export default function TTMapView({
  geo, stage, qc, sections, sectionNames, selSection,
  onPickPoint, onBrushStart, onBrushPoint, onBrushEnd, onRegionPoints,
  active, layerMode, onLayerMode, mode, marked, rowNext,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const baseLayerRef = useRef(null);
  const hullRef = useRef(null);
  const boxRef = useRef(null);
  const stageRef = useRef(stage); useEffect(() => { stageRef.current = stage; }, [stage]);
  const qcRef = useRef(qc); useEffect(() => { qcRef.current = qc; }, [qc]);
  const modeRef = useRef(mode); useEffect(() => { modeRef.current = mode; }, [mode]);
  const cb = useRef({}); cb.current = { onPickPoint, onBrushStart, onBrushPoint, onBrushEnd, onRegionPoints };
  const paintingRef = useRef(false);
  const marqRef = useRef(null);
  const rpanRef = useRef(null);
  const [ready, setReady] = useState(0);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true, renderer: new GlyphRenderer({ padding: 0.5 }) });
    mapRef.current = map;
    baseLayerRef.current = L.tileLayer(
      layerMode === 'streets' ? OSM_STREETS : ESRI_SAT,
      { attribution: layerMode === 'streets' ? OSM_ATTR : ESRI_ATTR, maxZoom: 22, maxNativeZoom: 19 }
    ).addTo(map);
    setReady((n) => n + 1);
    return () => { map.remove(); mapRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current; if (!map || !baseLayerRef.current) return;
    map.removeLayer(baseLayerRef.current);
    baseLayerRef.current = L.tileLayer(
      layerMode === 'streets' ? OSM_STREETS : ESRI_SAT,
      { attribution: layerMode === 'streets' ? OSM_ATTR : ESRI_ATTR, maxZoom: 22, maxNativeZoom: 19 }
    ).addTo(map);
  }, [layerMode]);

  /* markers */
  useEffect(() => {
    const map = mapRef.current; if (!map || !geo || !geo.lonLat || !geo.lonLat.length) return;
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];
    const bounds = L.latLngBounds([]);
    geo.lonLat.forEach(([lon, lat], i) => {
      const ll = L.latLng(lat, lon);
      bounds.extend(ll);
      const j = rowNext ? rowNext[i] : -1;
      const nll = j >= 0 && geo.lonLat[j] ? L.latLng(geo.lonLat[j][1], geo.lonLat[j][0]) : null;
      const m = new GlyphMarker(ll, { radius: 5, stage: stageRef.current[i] || 0, qc: qcRef.current[i] || 0, nextStage: j >= 0 ? (stageRef.current[j] || 0) : -1, nextLatLng: nll, interactive: true });
      m.on('click', () => { if (modeRef.current === 'pan' && cb.current.onPickPoint) cb.current.onPickPoint(i); });
      m.addTo(map);
      markersRef.current.push(m);
    });
    if (!bounds.isValid()) return;
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 20 });
    /* Keep the view over the site: pad the KMZ extent by a margin so the
       outermost points can still be centred and worked on, but the map can't
       be dragged off into empty imagery. */
    const pad = Math.max(bounds.getNorth() - bounds.getSouth(), bounds.getEast() - bounds.getWest()) * 0.25 || 0.0015;
    map.setMaxBounds(bounds.pad(0).extend([bounds.getNorth() + pad, bounds.getEast() + pad]).extend([bounds.getSouth() - pad, bounds.getWest() - pad]));
    map.options.maxBoundsViscosity = 1.0;
    /* don't let them zoom out past the whole site either */
    map.setMinZoom(Math.max(1, map.getBoundsZoom(bounds, false) - 2));
  }, [geo, ready, rowNext]);

  useEffect(() => {
    markersRef.current.forEach((m, i) => {
      const dim = selSection != null && sections && sections[i] !== selSection;
      const del = marked && marked.has(i);   // queued for deletion
      const j = rowNext ? rowNext[i] : -1;
      m.setStyle({ stage: stage[i] || 0, qc: qc[i] || 0, nextStage: j >= 0 ? (stage[j] || 0) : -1, del: !!del, hot: active === i, dimmed: !!(dim && !del) });
    });
  }, [stage, qc, active, selSection, sections, marked, rowNext]);

  /* silhouette outline around the selected block */
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    if (hullRef.current) { hullRef.current.remove(); hullRef.current = null; }
    if (selSection == null || !sections || !geo || !geo.lonLat) return;
    const pts = [];
    for (let i = 0; i < geo.lonLat.length; i++) if (sections[i] === selSection) pts.push(geo.lonLat[i]);
    if (pts.length < 3) return;
    /* hull in lon/lat, then nudge outward so the ring clears the outer dots */
    let spanLat = 0, spanLon = 0, minLa = 90, maxLa = -90, minLo = 180, maxLo = -180;
    for (const [lo, la] of pts) { if (la < minLa) minLa = la; if (la > maxLa) maxLa = la; if (lo < minLo) minLo = lo; if (lo > maxLo) maxLo = lo; }
    spanLat = maxLa - minLa; spanLon = maxLo - minLo;
    const pad = Math.max(spanLat, spanLon) * 0.02 || 0.00004;
    const hull = padHull(convexHull(pts), pad);
    if (hull.length < 3) return;
    hullRef.current = L.polygon(hull.map(([lo, la]) => [la, lo]), {
      color: ORANGE, weight: 3, opacity: 0.95, fillColor: ORANGE, fillOpacity: 0.08, interactive: false,
    }).addTo(map);
    const nm = (sectionNames || {})[selSection];
    hullRef.current.bindTooltip(nm && nm.trim() ? nm.trim() : 'Block ' + (selSection + 1), { permanent: true, direction: 'center', className: 'tt-block-label' });
  }, [selSection, sections, geo, sectionNames, ready]);

  /* Brush / Fill take over the pointer: dragging paints or boxes a region
     instead of panning the map. Pan mode hands the map back. */
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const painting = mode === 'brush' || mode === 'fill' || mode === 'delete';
    if (painting) { map.dragging.disable(); map.doubleClickZoom.disable(); map.boxZoom.disable(); }
    else { map.dragging.enable(); map.doubleClickZoom.enable(); map.boxZoom.enable(); }
    const el = map.getContainer();
    if (el) {
      el.style.cursor = painting ? 'crosshair' : '';
      /* Leaflet's stylesheet drops touch-action to "pan-x pan-y" as soon as
         dragging is disabled, so on a phone the browser claimed every brush
         stroke as a scroll and fired pointercancel after the first dot.
         Owning the gesture is what makes brush/fill work on touch. */
      el.style.touchAction = painting ? 'none' : '';
    }
  }, [mode]);

  /* hit-test in screen space — markers use the canvas renderer, so there are
     no per-dot DOM nodes to hit with elementFromPoint */
  const nearestPoint = useCallback((cx, cy) => {
    const map = mapRef.current; if (!map || !geo || !geo.lonLat) return -1;
    const r = map.getContainer().getBoundingClientRect();
    const pt = L.point(cx - r.left, cy - r.top);
    // 12px radius for a mouse; ~22px for a fingertip
    const coarse = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
    let best = -1, bd = coarse ? 484 : 144;
    for (let i = 0; i < geo.lonLat.length; i++) {
      const [lon, lat] = geo.lonLat[i];
      const p = map.latLngToContainerPoint(L.latLng(lat, lon));
      const dx = p.x - pt.x, dy = p.y - pt.y; const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }, [geo]);

  const drawBox = useCallback((a, b) => {
    const map = mapRef.current; if (!map) return;
    if (boxRef.current) boxRef.current.remove();
    boxRef.current = L.rectangle(L.latLngBounds(a, b), { color: ORANGE, weight: 1.6, dashArray: '6 4', fillColor: ORANGE, fillOpacity: 0.14, interactive: false }).addTo(map);
  }, []);
  const clearBox = useCallback(() => { if (boxRef.current) { boxRef.current.remove(); boxRef.current = null; } }, []);

  const toLatLng = useCallback((cx, cy) => {
    const map = mapRef.current; if (!map) return null;
    const r = map.getContainer().getBoundingClientRect();
    return map.containerPointToLatLng(L.point(cx - r.left, cy - r.top));
  }, []);

  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const el = map.getContainer();
    const down = (e) => {
      /* right button pans regardless of tool — Leaflet's own dragging is
         left-button only, so drive the centre by hand */
      if (e.button === 2) { rpanRef.current = { x: e.clientX, y: e.clientY }; e.preventDefault(); return; }
      if (e.isPrimary === false) return;   // second finger = pinch-zoom, not a stroke
      const m = modeRef.current;
      if (m === 'brush' || m === 'delete') {
        paintingRef.current = true;
        if (cb.current.onBrushStart) cb.current.onBrushStart();
        const i = nearestPoint(e.clientX, e.clientY);
        if (i >= 0 && cb.current.onBrushPoint) cb.current.onBrushPoint(i);
        e.preventDefault();
      } else if (m === 'fill') {
        const ll = toLatLng(e.clientX, e.clientY); if (!ll) return;
        marqRef.current = { cx: e.clientX, cy: e.clientY, a: ll, b: ll, moved: false };
        e.preventDefault();
      }
    };
    const move = (e) => {
      if (e.isPrimary === false) return;
      if (rpanRef.current) {
        const r = rpanRef.current; const dx = e.clientX - r.x, dy = e.clientY - r.y;
        if (dx || dy) { map.panBy([-dx, -dy], { animate: false }); rpanRef.current = { x: e.clientX, y: e.clientY }; }
        return;
      }
      if (paintingRef.current) {
        const i = nearestPoint(e.clientX, e.clientY);
        if (i >= 0 && cb.current.onBrushPoint) cb.current.onBrushPoint(i);
        return;
      }
      const mq = marqRef.current;
      if (mq) {
        const ll = toLatLng(e.clientX, e.clientY); if (!ll) return;
        mq.b = ll;
        if (Math.hypot(e.clientX - mq.cx, e.clientY - mq.cy) > DRAG_SLOP) mq.moved = true;
        if (mq.moved) drawBox(mq.a, mq.b);
      }
    };
    const up = () => {
      if (rpanRef.current) { rpanRef.current = null; return; }
      if (paintingRef.current) { paintingRef.current = false; if (cb.current.onBrushEnd) cb.current.onBrushEnd(); return; }
      const mq = marqRef.current; marqRef.current = null; clearBox();
      if (!mq) return;
      if (!mq.moved) { const i = nearestPoint(mq.cx, mq.cy); if (i >= 0 && cb.current.onPickPoint) cb.current.onPickPoint(i); return; }
      const r = normRect({ x: mq.a.lng, y: mq.a.lat }, { x: mq.b.lng, y: mq.b.lat });
      const list = [];
      const ll = (geo && geo.lonLat) || [];
      for (let i = 0; i < ll.length; i++) if (rectContains(r, ll[i][0], ll[i][1])) list.push(i);
      if (list.length && cb.current.onRegionPoints) cb.current.onRegionPoints(list);
    };
    const noMenu = (e) => e.preventDefault();
    el.addEventListener('contextmenu', noMenu);
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('contextmenu', noMenu);
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [nearestPoint, toLatLng, drawBox, clearBox, geo, ready]);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <style>{`.tt-block-label{background:rgba(10,14,26,.9);border:1px solid ${ORANGE};color:${ORANGE};font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;box-shadow:none;padding:2px 8px}.tt-block-label::before{display:none}`}</style>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0, background: '#0b1020' }} />
      <div style={{ position: 'absolute', top: 10, left: 52, zIndex: 500, display: 'flex', gap: 4, background: 'rgba(10,14,26,.88)', border: '1px solid rgba(255,255,255,.15)', padding: 3 }}>
        {['satellite', 'streets'].map((k) => (
          <button key={k} onClick={() => onLayerMode(k)} style={{
            background: layerMode === k ? ORANGE : 'transparent',
            color: layerMode === k ? '#1a1206' : '#F5F0EB',
            border: 'none', padding: '5px 10px', minHeight: 36,
            fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 12,
            letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer',
          }}>{k}</button>
        ))}
      </div>
    </div>
  );
}
