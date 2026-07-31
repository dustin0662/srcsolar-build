/* pg_worker.js — the reconstruction engine, off the main thread.
   Decodes the uploaded photos, extracts features, matches them, runs
   structure-from-motion, then multi-view stereo, then a surface grid, and
   posts progress the whole way. Everything runs in the browser: no upload of
   imagery to a third-party service, no server-side compute. */

import { toGray, detectAndDescribe, matchDescriptors, imageSignature, signatureScore } from './pg_features.js';
import { reconstruct, cameraCentre } from './pg_sfm.js';
import {
  analyseViews, computeDepthMap, medianFilterDepth, fuseDepthMaps, sampleSpacing,
  voxelDownsample, removeOutliers, buildSurfaceGrid,
} from './pg_dense.js';
import { parseExif, focalPixels, defaultFocal, gpsToEnu } from './pg_exif.js';
import { umeyama, mat3Vec, median } from './pg_math.js';
import { PRESETS } from './pg_presets.js';

let cancelled = false;

const post = (msg, transfer) => self.postMessage(msg, transfer || []);
const progress = (stage, pct, msg) => post({ type: 'progress', stage: stage, pct: Math.max(0, Math.min(1, pct)), msg: msg });
function checkCancel() { if (cancelled) throw new Error('__cancelled__'); }

/* ── image decoding ────────────────────────────────────────────────── */

async function fetchPhoto(photo) {
  // photos larger than the function body limit were stored as several parts
  const urls = photo.urls && photo.urls.length ? photo.urls : [photo.url];
  const parts = [];
  let total = 0;
  for (const u of urls) {
    const res = await fetch(u, { cache: 'force-cache' });
    if (!res.ok) throw new Error('could not load ' + photo.name + ' (' + res.status + ')');
    const b = await res.arrayBuffer();
    parts.push(new Uint8Array(b)); total += b.byteLength;
  }
  if (parts.length === 1) return parts[0].buffer;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out.buffer;
}

async function decode(buf, maxDim) {
  const blob = new Blob([buf]);
  let bmp;
  try { bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
  catch (e) { bmp = await createImageBitmap(blob); }
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const rgba = ctx.getImageData(0, 0, w, h).data;
  return { rgba: rgba, w: w, h: h };
}

/* Keeps a handful of decoded images alive during the dense pass; every view
   needs itself plus its neighbours, and re-decoding costs far less than
   holding a hundred full-resolution buffers in memory. */
function makeCache(limit, maxDim) {
  const map = new Map();
  return {
    async get(photo) {
      const hit = map.get(photo.id);
      if (hit) { map.delete(photo.id); map.set(photo.id, hit); return hit; }
      const buf = await fetchPhoto(photo);
      const img = await decode(buf, maxDim);
      const entry = { rgba: img.rgba, gray: toGray(img.rgba, img.w, img.h), w: img.w, h: img.h };
      map.set(photo.id, entry);
      while (map.size > limit) map.delete(map.keys().next().value);
      return entry;
    },
    clear() { map.clear(); },
  };
}

/* ── the pipeline ──────────────────────────────────────────────────── */

async function build(job) {
  const photos = job.photos || [];
  const preset = PRESETS[job.quality] || PRESETS.balanced;
  const opt = Object.assign({}, preset, job.overrides || {});
  if (photos.length < 3) throw new Error('at least 3 photos are needed — 15 to 60 with plenty of overlap works best');

  /* 1 — decode + features */
  const feats = [], meta = [];
  for (let i = 0; i < photos.length; i++) {
    checkCancel();
    progress('features', 0.02 + 0.22 * (i / photos.length), 'Reading ' + photos[i].name + ' (' + (i + 1) + '/' + photos.length + ')');
    const buf = await fetchPhoto(photos[i]);
    // stored working copies are re-encoded and carry no EXIF, so fall back to
    // the values captured at upload time
    const embedded = parseExif(buf);
    const exif = (embedded && (embedded.focal35 || embedded.focalMm || embedded.lat != null))
      ? embedded : Object.assign({}, photos[i].exif || {}, embedded || {});
    const img = await decode(buf, opt.maxDim);
    const gray = toGray(img.rgba, img.w, img.h);
    const f = detectAndDescribe(gray, img.w, img.h, {
      maxFeatures: opt.features, fastThreshold: opt.fastThreshold,
    });
    const fp = focalPixels(exif, img.w, img.h);
    feats.push({ kps: f.kps, desc: f.desc, count: f.count, sig: imageSignature(gray, img.w, img.h) });
    meta.push({
      id: photos[i].id, name: photos[i].name, w: img.w, h: img.h, exif: exif,
      focal: fp ? fp.f : defaultFocal(img.w, img.h), focalSource: fp ? fp.source : 'assumed 62° field of view',
      hasExifFocal: !!fp,
    });
  }
  const noExifFocal = meta.filter((m) => !m.hasExifFocal).length;
  progress('features', 0.24, 'Found ' + meta.reduce((a, _, i) => a + feats[i].count, 0).toLocaleString() + ' features across ' + photos.length + ' photos');

  /* 2 — decide which pairs to match: thumbnail similarity plus capture order */
  checkCancel();
  const N = photos.length;
  const wanted = new Map();
  for (let i = 0; i < N; i++) {
    const ranked = [];
    for (let j = 0; j < N; j++) if (j !== i) ranked.push([j, signatureScore(feats[i].sig, feats[j].sig)]);
    ranked.sort((a, b) => b[1] - a[1]);
    const cand = new Set(ranked.slice(0, opt.candidates).map((r) => r[0]));
    for (let d = 1; d <= 2; d++) { if (i + d < N) cand.add(i + d); if (i - d >= 0) cand.add(i - d); }
    for (const j of cand) {
      const key = Math.min(i, j) + ',' + Math.max(i, j);
      if (!wanted.has(key)) wanted.set(key, [Math.min(i, j), Math.max(i, j)]);
    }
  }
  const pairList = [...wanted.values()];
  const pairs = [];
  for (let k = 0; k < pairList.length; k++) {
    checkCancel();
    const [a, b] = pairList[k];
    const m = matchDescriptors(feats[a].desc, feats[a].count, feats[b].desc, feats[b].count, {});
    if (m.length >= 40) pairs.push({ i: a, j: b, matches: m });
    if (k % 5 === 0 || k === pairList.length - 1) {
      progress('matching', 0.25 + 0.18 * ((k + 1) / pairList.length), 'Matching image pairs ' + (k + 1) + '/' + pairList.length + ' (' + pairs.length + ' usable)');
    }
  }
  if (pairs.length < 2) throw new Error('the photos do not overlap enough to match — aim for 60-80% overlap between consecutive shots');

  /* 3 — structure from motion */
  checkCancel();
  const images = meta.map((m, i) => ({ w: m.w, h: m.h, f: m.focal, cx: m.w / 2, cy: m.h / 2, kps: feats[i].kps }));
  const rec = reconstruct(images, pairs, {
    seed: 20240611,
    thresholdPx: 3,
    refineFocal: job.refineFocal != null ? job.refineFocal : noExifFocal > photos.length / 2,
    onProgress: (stage, pct, msg) => {
      const base = stage === 'verify' ? 0.43 : stage === 'register' ? 0.5 : 0.58;
      const span = stage === 'verify' ? 0.07 : stage === 'register' ? 0.08 : 0.04;
      progress('sparse', base + span * pct, msg);
    },
  });
  if (rec.stats.error) throw new Error(rec.stats.error);
  const registered = rec.cams.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
  if (registered.length < 3) throw new Error('only ' + registered.length + ' photos could be placed — try more overlap or a slower orbit around the subject');
  progress('sparse', 0.62, 'Placed ' + registered.length + '/' + N + ' cameras, ' + rec.points.length.toLocaleString() + ' tie points');

  /* 4 — georeference from EXIF GPS when the flight recorded it, otherwise the
     model is metrically correct only up to a single unknown scale */
  let geo = null;
  const gpsCams = registered.filter((i) => meta[i].exif && meta[i].exif.lat != null);
  if (job.georeference !== false && gpsCams.length >= 3) {
    const ref = { lat: meta[gpsCams[0]].exif.lat, lon: meta[gpsCams[0]].exif.lon, alt: meta[gpsCams[0]].exif.alt || 0 };
    const src = gpsCams.map((i) => cameraCentre(rec.cams[i].R, rec.cams[i].t));
    const dst = gpsCams.map((i) => gpsToEnu(meta[i].exif.lat, meta[i].exif.lon, meta[i].exif.alt || 0, ref));
    const fit = umeyama(src, dst, true);
    if (fit && isFinite(fit.s) && fit.s > 0) {
      const resid = src.map((p, k) => {
        const q = mat3Vec(fit.R, p);
        return Math.hypot(q[0] * fit.s + fit.t[0] - dst[k][0], q[1] * fit.s + fit.t[1] - dst[k][1], q[2] * fit.s + fit.t[2] - dst[k][2]);
      });
      geo = { fit: fit, ref: ref, rms: median(resid), cameras: gpsCams.length };
      progress('georef', 0.64, 'Georeferenced from ' + gpsCams.length + ' GPS tags (±' + geo.rms.toFixed(1) + ' m on camera positions)');
    }
  }

  /* 5 — dense stereo */
  const info = analyseViews(rec.cams, rec.points, { neighbours: opt.neighbours });
  let dense = null, spacing = 0;
  const denseViews = [];
  if (opt.dense) {
    const cache = makeCache(Math.max(4, opt.neighbours + 3), opt.maxDim);
    const usable = registered.filter((i) => info[i] && info[i].neighbours.length >= 2);
    if (!usable.length) throw new Error('no view has enough stereo partners for a dense model — try the Draft preset');
    for (let k = 0; k < usable.length; k++) {
      checkCancel();
      const i = usable[k];
      progress('dense', 0.65 + 0.26 * (k / usable.length), 'Depth map ' + (k + 1) + '/' + usable.length + ' — ' + meta[i].name);
      const refImg = await cache.get(photos[i]);
      const ref = {
        gray: refImg.gray, rgb: refImg.rgba, w: refImg.w, h: refImg.h,
        f: images[i].f, cx: images[i].cx, cy: images[i].cy,
        R: rec.cams[i].R, t: rec.cams[i].t, dmin: info[i].dmin, dmax: info[i].dmax,
        medianDepth: info[i].medianDepth,
      };
      const nbs = [];
      for (const j of info[i].neighbours) {
        const im = await cache.get(photos[j]);
        nbs.push({ gray: im.gray, w: im.w, h: im.h, f: images[j].f, cx: images[j].cx, cy: images[j].cy, R: rec.cams[j].R, t: rec.cams[j].t });
      }
      const dm = computeDepthMap(ref, nbs, { stride: opt.denseStride, samples: opt.denseSamples, minScore: opt.minScore });
      ref.depth = medianFilterDepth(dm.depth, ref.w, ref.h, opt.denseStride);
      denseViews.push(ref);
    }
    cache.clear();
    checkCancel();
    progress('dense', 0.92, 'Fusing ' + denseViews.length + ' depth maps');
    const fused = fuseDepthMaps(denseViews, {
      consistency: opt.denseStride <= 2 ? 2 : 1,
      searchRadius: opt.denseStride,
      maxPoints: job.maxPoints || 6000000,
    });
    spacing = sampleSpacing(denseViews, opt.denseStride) || 0;
    let cloud = fused;
    if (spacing > 0) {
      cloud = voxelDownsample(cloud.positions, cloud.colors, spacing * 0.9);
      progress('dense', 0.94, 'Cleaning ' + (cloud.positions.length / 3).toLocaleString() + ' points');
      cloud = removeOutliers(cloud.positions, cloud.colors, spacing * 3, 5);
    }
    dense = cloud;
  }

  /* 6 — point cloud in world units, then the surface grid */
  checkCancel();
  let positions = dense ? dense.positions : Float32Array.from(rec.points.flatMap((p) => p.X));
  let colors = dense ? dense.colors : new Uint8Array((positions.length / 3) * 3).fill(190);
  if (!dense) {
    // colour the sparse cloud from the first photo that saw each point
    const cache = makeCache(3, Math.min(900, opt.maxDim));
    const byCam = new Map();
    rec.points.forEach((p, pi) => {
      const ob = p.obs[0];
      let a = byCam.get(ob.cam); if (!a) { a = []; byCam.set(ob.cam, a); }
      a.push([pi, ob]);
    });
    for (const [ci, list] of byCam) {
      checkCancel();
      const im = await cache.get(photos[ci]);
      for (const [pi, ob] of list) {
        const px = Math.round(ob.x * images[ci].f + images[ci].cx), py = Math.round(ob.y * images[ci].f + images[ci].cy);
        if (px < 0 || py < 0 || px >= im.w || py >= im.h) continue;
        const o = (py * im.w + px) * 4;
        colors[pi * 3] = im.rgba[o]; colors[pi * 3 + 1] = im.rgba[o + 1]; colors[pi * 3 + 2] = im.rgba[o + 2];
      }
    }
    cache.clear();
  }

  const camList = registered.map((i) => ({
    index: i, id: meta[i].id, name: meta[i].name,
    R: Array.from(rec.cams[i].R), t: rec.cams[i].t.slice(),
    C: cameraCentre(rec.cams[i].R, rec.cams[i].t),
    f: images[i].f, w: meta[i].w, h: meta[i].h,
  }));

  /* apply the georeferencing similarity to everything */
  let units = 'model units (no scale reference)';
  if (geo && geo.fit && geo.fit.R) {
    const { s, R, t } = geo.fit;
    for (let i = 0; i < positions.length; i += 3) {
      const q = mat3Vec(R, [positions[i], positions[i + 1], positions[i + 2]]);
      positions[i] = q[0] * s + t[0]; positions[i + 1] = q[1] * s + t[1]; positions[i + 2] = q[2] * s + t[2];
    }
    for (const c of camList) {
      const q = mat3Vec(R, c.C);
      c.C = [q[0] * s + t[0], q[1] * s + t[1], q[2] * s + t[2]];
    }
    spacing *= s;
    units = 'metres (east / north / up)';
  }

  let mesh = null, ortho = null;
  if (job.mesh !== false && positions.length / 3 > 500) {
    checkCancel();
    progress('mesh', 0.96, 'Building the surface model');
    const viewpoint = [0, 1, 2].map((k) => camList.reduce((a, c) => a + c.C[k], 0) / camList.length);
    const surf = buildSurfaceGrid(positions, colors, {
      viewpoint: viewpoint,
      up: geo && geo.fit && geo.fit.R ? [0, 0, 1] : null,      // georeferenced clouds already have gravity
      density: job.meshDensity || 1.4,
      maxCells: opt.maxDim >= 2000 ? 1800 : 1200,
    });
    if (surf && surf.triangles > 0) {
      mesh = { positions: surf.positions, colors: surf.colors, indices: surf.indices, triangles: surf.triangles };
      ortho = { rgba: surf.grid.rgba, w: surf.grid.w, h: surf.grid.h, cell: surf.grid.cell };
    }
  }

  const result = {
    positions: positions,
    colors: colors,
    mesh: mesh,
    ortho: ortho,
    cameras: camList,
    stats: {
      photos: N,
      registered: registered.length,
      tiePoints: rec.points.length,
      densePoints: positions.length / 3,
      triangles: mesh ? mesh.triangles : 0,
      reprojPx: rec.stats.reprojPx,
      focalPx: images[0].f,
      focalSource: meta[0].focalSource,
      focalRefined: rec.stats.focalScale !== 1 ? rec.stats.focalScale : null,
      spacing: spacing,
      units: units,
      georeferenced: !!(geo && geo.fit && geo.fit.R),
      geoRms: geo && geo.rms != null ? geo.rms : null,
      geoRef: geo && geo.ref ? geo.ref : null,
      quality: job.quality || 'balanced',
      unregistered: meta.filter((m, i) => !rec.cams[i]).map((m) => m.name),
    },
  };

  const transfer = [result.positions.buffer, result.colors.buffer];
  if (mesh) transfer.push(mesh.positions.buffer, mesh.colors.buffer, mesh.indices.buffer);
  if (ortho) transfer.push(ortho.rgba.buffer);
  progress('done', 1, 'Model complete');
  post({ type: 'done', result: result }, transfer);
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type === 'cancel') { cancelled = true; return; }
  if (msg.type !== 'build') return;
  cancelled = false;
  try {
    await build(msg);
  } catch (err) {
    if (String(err && err.message) === '__cancelled__') post({ type: 'cancelled' });
    else post({ type: 'error', message: String((err && err.message) || err) });
  }
};
