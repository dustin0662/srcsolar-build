/* ------------------------------------------------------------------ */
/*  KMZ / KML import — extracts Placemark points, projects to pixels    */
/* ------------------------------------------------------------------ */

import { unzipSync } from 'fflate';
import { medianSpacing, autoSection, TARGET_SPACING } from './tt_import.js';

async function readKmlFromKmz(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const files = unzipSync(buf);
  const keys = Object.keys(files);
  const preferred = keys.find((k) => /(^|\/)doc\.kml$/i.test(k)) || keys.find((k) => /\.kml$/i.test(k));
  if (!preferred) throw new Error('No .kml file found inside the KMZ');
  return new TextDecoder('utf-8').decode(files[preferred]);
}

function parseCoords(text) {
  const parts = text.trim().split(/[\s,]+/).map(Number);
  const out = [];
  for (let i = 0; i + 1 < parts.length; i += 3) {
    const lon = parts[i], lat = parts[i + 1];
    if (Number.isFinite(lon) && Number.isFinite(lat)) out.push([lon, lat]);
  }
  if (!out.length) {
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const lon = parts[i], lat = parts[i + 1];
      if (Number.isFinite(lon) && Number.isFinite(lat)) out.push([lon, lat]);
    }
  }
  return out;
}

function firstChildText(el, tag) {
  const c = el.getElementsByTagName(tag)[0];
  return c ? c.textContent.trim() : '';
}

function enclosingFolderName(pm) {
  let node = pm.parentNode;
  while (node && node.nodeType === 1) {
    if (node.tagName === 'Folder' || node.tagName === 'Document') {
      const name = firstChildText(node, 'name');
      if (name && node.tagName === 'Folder') return name;
    }
    node = node.parentNode;
  }
  return null;
}

function parseKml(kmlText) {
  const xml = new DOMParser().parseFromString(kmlText, 'text/xml');
  if (xml.getElementsByTagName('parsererror').length) throw new Error('KML is not valid XML');
  const placemarks = xml.getElementsByTagName('Placemark');
  const out = [];
  for (const pm of Array.from(placemarks)) {
    const folder = enclosingFolderName(pm);
    const pts = pm.getElementsByTagName('Point');
    for (const pe of Array.from(pts)) {
      const c = pe.getElementsByTagName('coordinates')[0];
      if (!c) continue;
      const parsed = parseCoords(c.textContent);
      for (const [lon, lat] of parsed) out.push({ lon, lat, folder });
    }
  }
  return out;
}

export async function processKmzImport(file) {
  const isKml = /\.kml$/i.test(file.name) || (file.type || '').includes('kml+xml');
  const kmlText = isKml ? await file.text() : await readKmlFromKmz(file);
  const geoPts = parseKml(kmlText);
  if (!geoPts.length) return { points: [], w: 0, h: 0, sections: [], sectionCount: 0, count: 0, geo: null };

  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const p of geoPts) {
    if (p.lon < minLon) minLon = p.lon; if (p.lon > maxLon) maxLon = p.lon;
    if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat;
  }

  const centerLat = (minLat + maxLat) / 2;
  const M_PER_DEG = 111320;
  const lonScale = Math.cos(centerLat * Math.PI / 180) * M_PER_DEG;
  const latScale = M_PER_DEG;

  const raw = geoPts.map((p) => [(p.lon - minLon) * lonScale, (maxLat - p.lat) * latScale]);
  const sp = medianSpacing(raw.map(([x, y]) => ({ x, y })));
  const scale = TARGET_SPACING / (sp || 1);

  const points = raw.map(([x, y]) => [Math.round(x * scale * 10) / 10, Math.round(y * scale * 10) / 10]);
  let maxX = 0, maxY = 0;
  for (const [x, y] of points) { if (x > maxX) maxX = x; if (y > maxY) maxY = y; }

  const folderNames = geoPts.map((p) => p.folder).filter(Boolean);
  const uniqFolders = [...new Set(folderNames)];
  let sec, count;
  if (uniqFolders.length > 1) {
    const idxOf = new Map();
    uniqFolders.forEach((f, i) => idxOf.set(f, i));
    let next = uniqFolders.length;
    sec = geoPts.map((p) => {
      if (p.folder && idxOf.has(p.folder)) return idxOf.get(p.folder);
      return next;
    });
    if (geoPts.some((p) => !p.folder || !idxOf.has(p.folder))) next++;
    count = next;
  } else {
    const r = autoSection(points, TARGET_SPACING);
    sec = r.sec; count = r.count;
  }

  const geo = {
    lonLat: geoPts.map((p) => [p.lon, p.lat]),
    bounds: { west: minLon, south: minLat, east: maxLon, north: maxLat },
  };

  return {
    points,
    w: Math.round(maxX * 10) / 10,
    h: Math.round(maxY * 10) / 10,
    sections: sec,
    sectionCount: count,
    count: points.length,
    geo,
  };
}
