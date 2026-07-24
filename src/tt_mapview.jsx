/* ------------------------------------------------------------------ */
/*  Task Tracker — satellite map view (Leaflet + Esri World Imagery)    */
/* ------------------------------------------------------------------ */

import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const ESRI_SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTR = 'Imagery &copy; Esri, Maxar, Earthstar Geographics';
const OSM_STREETS = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTR = '&copy; OpenStreetMap contributors';

/*  Fill colors mirror the SVG dot palette in pile_plan.jsx / pile_data.js  */
function colorFor(stage, qc) {
  if (qc === 2) return '#ef4444';
  if (qc === 1) return '#f59e0b';
  if (stage === 4) return '#16a34a';
  if (stage === 3) return '#22c55e';
  if (stage === 2) return '#3b82f6';
  if (stage === 1) return '#a855f7';
  return '#94a3b8';
}

export default function TTMapView({
  geo, stage, qc, sections, sectionCount,
  onPickPoint, active, layerMode, onLayerMode,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const stageRef = useRef(stage); useEffect(() => { stageRef.current = stage; }, [stage]);
  const qcRef = useRef(qc); useEffect(() => { qcRef.current = qc; }, [qc]);
  const activeRef = useRef(active); useEffect(() => { activeRef.current = active; }, [active]);
  const onPickRef = useRef(onPickPoint); useEffect(() => { onPickRef.current = onPickPoint; }, [onPickPoint]);
  const baseLayerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true, preferCanvas: true });
    mapRef.current = map;
    baseLayerRef.current = L.tileLayer(
      layerMode === 'streets' ? OSM_STREETS : ESRI_SAT,
      { attribution: layerMode === 'streets' ? OSM_ATTR : ESRI_ATTR, maxZoom: 22, maxNativeZoom: 19 }
    ).addTo(map);
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

  useEffect(() => {
    const map = mapRef.current; if (!map || !geo || !geo.lonLat || !geo.lonLat.length) return;
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];
    const bounds = L.latLngBounds([]);
    geo.lonLat.forEach(([lon, lat], i) => {
      const ll = L.latLng(lat, lon);
      bounds.extend(ll);
      const m = L.circleMarker(ll, {
        radius: 5,
        color: 'rgba(2,3,10,.6)', weight: 0.8,
        fillColor: colorFor(stageRef.current[i], qcRef.current[i]),
        fillOpacity: 0.95,
      });
      m.on('click', () => { const fn = onPickRef.current; if (fn) fn(i); });
      m.addTo(map);
      markersRef.current.push(m);
    });
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 20 });
  }, [geo]);

  useEffect(() => {
    markersRef.current.forEach((m, i) => {
      m.setStyle({
        fillColor: colorFor(stage[i], qc[i]),
        radius: active === i ? 8 : 5,
        color: active === i ? '#F97316' : 'rgba(2,3,10,.6)',
        weight: active === i ? 2 : 0.8,
      });
    });
  }, [stage, qc, active]);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0, background: '#0b1020' }} />
      <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 500, display: 'flex', gap: 4, background: 'rgba(10,14,26,.85)', border: '1px solid rgba(255,255,255,.15)', padding: 3, borderRadius: 4 }}>
        {['satellite', 'streets'].map((k) => (
          <button key={k} onClick={() => onLayerMode(k)} style={{
            background: layerMode === k ? '#F97316' : 'transparent',
            color: layerMode === k ? '#1a1206' : '#F5F0EB',
            border: 'none', padding: '5px 10px',
            fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 12,
            letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer',
          }}>{k}</button>
        ))}
      </div>
    </div>
  );
}
