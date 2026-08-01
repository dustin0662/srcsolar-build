/* pg_worker.js — the reconstruction engine, off the main thread.
   Decodes the uploaded photos, extracts features, matches them, runs
   structure-from-motion, then multi-view stereo, then a surface grid, and
   reports progress with an estimated time remaining the whole way.

   Everything runs in the browser: no imagery is sent to a third-party service
   and no server-side compute is involved. That puts memory and time squarely
   in one tab, so the pipeline is written to stream — bounded caches for
   decoded images and depth maps, and a voxel grid that folds points in as
   they are produced rather than collecting tens of millions of them first.

   It also means closing the tab stops the work, so every expensive stage
   checkpoints to the same store the photos live in: features per photo,
   matches per block of pairs, the sparse solution once, and the dense cloud
   in blocks. Reopening the capture resumes from the last completed piece. */

import { toGray, detectAndDescribe, matchDescriptors, imageSignature, signatureScore } from './pg_features.js';
import { reconstruct, cameraCentre } from './pg_sfm.js';
import {
  analyseViews, computeDepthMap, medianFilterDepth, packDepth, fuseView, createVoxelGrid,
  buildSurfaceGrid,
} from './pg_dense.js';
import { parseExif, focalPixels, defaultFocal, gpsToEnu } from './pg_exif.js';
import { umeyama, mat3Vec, median } from './pg_math.js';
import { PRESETS, adaptSettings, pointBudget } from './pg_presets.js';
import { createProgress, priorCosts } from './pg_progress.js';
import { createCheckpoint, buildSignature } from './pg_checkpoint.js';

let cancelled = false;

const post = (msg, transfer) => self.postMessage(msg, transfer || []);
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
   holding hundreds of full-resolution buffers in memory. */
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

/* Order the views so a view's stereo partners are processed close to it. The
   dense pass then only needs a small window of depth maps in memory at once. */
function traversalOrder(usable, info) {
  const inSet = new Set(usable);
  const seen = new Set();
  const order = [];
  const remaining = usable.slice().sort((a, b) => (info[b].support || 0) - (info[a].support || 0));
  for (const seed of remaining) {
    if (seen.has(seed)) continue;
    const queue = [seed];
    seen.add(seed);
    while (queue.length) {
      const v = queue.shift();
      order.push(v);
      for (const nb of info[v].neighbours) {
        if (!inSet.has(nb) || seen.has(nb)) continue;
        seen.add(nb); queue.push(nb);
      }
    }
  }
  return order;
}

/* ── the pipeline ──────────────────────────────────────────────────── */

async function build(job) {
  const photos = job.photos || [];
  const N = photos.length;
  const preset = PRESETS[job.quality] || PRESETS.balanced;
  if (N < 3) throw new Error('at least 3 photos are needed — 20 to 600 with plenty of overlap is the useful range');
  if (N > 900) throw new Error(N + ' photos is beyond what a browser tab can hold; split the site into two captures');

  const adapted = adaptSettings(preset, N);
  const opt = Object.assign({}, adapted.opt, job.overrides || {});
  const costs = priorCosts(opt, N);
  const estPairs = Math.min(N * (N - 1) / 2, N * (opt.candidates + 2));

  const progress = createProgress([
    { key: 'features', label: 'Reading photos', units: N, cost: costs.features },
    { key: 'matching', label: 'Matching photos', units: estPairs, cost: costs.matching },
    { key: 'verify', label: 'Checking geometry', units: estPairs, cost: costs.verify },
    { key: 'register', label: 'Placing cameras', units: N, cost: costs.register },
    { key: 'bundle', label: 'Refining the solution', units: 10, cost: costs.bundle },
    { key: 'dense', label: 'Building depth maps', units: opt.dense ? N : 0, cost: costs.dense },
    { key: 'fuse', label: 'Fusing the point cloud', units: opt.dense ? N : 0, cost: costs.fuse },
    { key: 'mesh', label: 'Building the surface', units: job.mesh === false ? 0 : 1, cost: costs.mesh },
  ]);

  /* ── checkpointing ── */
  const ckpt = job.buildId && job.endpoint && job.projectId
    ? createCheckpoint(job.endpoint, job.projectId, job.buildId, {
      onError: (e) => post({ type: 'note', message: 'Could not write a checkpoint (' + e.message + ') — the build continues, but a reopen would restart this stage.' }),
    })
    : null;
  const signature = buildSignature(photos.map((p) => p.id), {
    quality: job.quality, mesh: job.mesh !== false, geo: job.georeference !== false,
    maxDim: opt.maxDim, features: opt.features, stride: opt.denseStride, dense: !!opt.dense,
    candidates: opt.candidates, neighbours: opt.neighbours,
  });
  let state = null;
  if (ckpt && job.resume) {
    const prior = await ckpt.readIndex();
    // a checkpoint from a different photo set or different settings describes a
    // different reconstruction; splicing them together would be nonsense
    if (prior && prior.signature === signature && !prior.done) state = prior;
    else if (prior) post({ type: 'note', message: 'The saved progress was for different settings, so this build starts fresh.' });
  }
  const resuming = !!state;
  if (!state) {
    state = {
      createdAt: Date.now(), signature: signature, photoCount: N, quality: job.quality,
      stage: 'features', pairsBlocks: 0, pairsDone: 0, sparse: 0, denseBlocks: 0, denseFused: 0, pct: 0,
    };
  }
  let lastPct = state.pct || 0;
  let lastIndexAt = 0;
  /* The index is what a reopened capture reads, so it should not lag far
     behind the work. Written on every stage boundary and otherwise on a
     timer — often enough to be honest, rarely enough not to chatter. */
  const saveIndex = async (patch, force) => {
    if (!ckpt) return;
    Object.assign(state, patch || {}, { pct: lastPct });
    const now = Date.now();
    if (!force && now - lastIndexAt < 8000) return;
    lastIndexAt = now;
    const okWrite = await ckpt.writeIndex(state);
    if (okWrite) post({ type: 'checkpoint', at: Date.now(), stage: state.stage });
  };

  let lastPost = 0;
  const say = (key, msg, force) => {
    const now = Date.now();
    if (!force && now - lastPost < 350) return;
    lastPost = now;
    const snap = progress.snapshot(key);
    lastPct = snap.pct;
    post({ type: 'progress', msg: msg, stage: snap.stage, stageLabel: snap.stageLabel, pct: snap.pct,
      etaMs: snap.etaMs, elapsedMs: snap.elapsedMs, done: snap.done, units: snap.units, resumed: resuming });
  };

  if (adapted.notes.length) {
    post({ type: 'note', message: N + ' photos: ' + adapted.notes.join(', ') + ' so the build fits in browser memory.' });
  }

  /* 1 — decode + features, one checkpoint per photo */
  progress.begin('features');
  const feats = new Array(N), meta = new Array(N);
  let totalFeatures = 0;
  const featStored = ckpt ? new Set((await ckpt.list('feat:')).map((n) => n.slice(5))) : new Set();
  if (resuming && featStored.size) post({ type: 'note', message: 'Resuming: ' + featStored.size + ' of ' + N + ' photos were already read.' });

  for (let i = 0; i < N; i++) {
    checkCancel();
    const id = photos[i].id;
    let restored = null;
    if (featStored.has(id)) {
      say('features', 'Restoring ' + photos[i].name + ' (' + (i + 1) + '/' + N + ')');
      const c = await ckpt.load('feat:' + id);
      if (c && c.meta && c.meta.count >= 0) {
        restored = {
          kps: c.at(0, Float32Array, c.meta.count * 2),
          desc: c.at(1, Uint32Array, c.meta.count * 8),
          sig: c.at(2, Float32Array, c.meta.sigLen),
          count: c.meta.count, m: c.meta.photo,
        };
      }
    }
    if (restored) {
      feats[i] = { kps: restored.kps, desc: restored.desc, count: restored.count, sig: restored.sig };
      meta[i] = restored.m;
      totalFeatures += restored.count;
    } else {
      say('features', 'Reading ' + photos[i].name + ' (' + (i + 1) + '/' + N + ')');
      const buf = await fetchPhoto(photos[i]);
      // stored working copies are re-encoded and carry no EXIF, so fall back to
      // the values captured at upload time
      const embedded = parseExif(buf);
      const exif = (embedded && (embedded.focal35 || embedded.focalMm || embedded.lat != null))
        ? embedded : Object.assign({}, photos[i].exif || {}, embedded || {});
      const img = await decode(buf, opt.maxDim);
      const gray = toGray(img.rgba, img.w, img.h);
      const f = detectAndDescribe(gray, img.w, img.h, { maxFeatures: opt.features, fastThreshold: opt.fastThreshold });
      const fp = focalPixels(exif, img.w, img.h);
      const sig = imageSignature(gray, img.w, img.h);
      const m = {
        id: id, name: photos[i].name, w: img.w, h: img.h, exif: exif,
        focal: fp ? fp.f : defaultFocal(img.w, img.h), focalSource: fp ? fp.source : 'assumed 62° field of view',
        hasExifFocal: !!fp,
      };
      feats[i] = { kps: f.kps, desc: f.desc, count: f.count, sig: sig };
      meta[i] = m;
      totalFeatures += f.count;
      if (ckpt) await ckpt.save('feat:' + id, { count: f.count, sigLen: sig.length, photo: m }, [f.kps, f.desc, sig]);
    }
    progress.tick('features', i + 1);
    if (ckpt) await saveIndex({ stage: 'features', featuresDone: i + 1 }, i === N - 1);
  }
  progress.finish('features');
  // the photos just told us how fast this machine actually is
  progress.calibrate('features');
  const noExifFocal = meta.filter((m) => !m.hasExifFocal).length;
  say('features', 'Found ' + totalFeatures.toLocaleString() + ' features across ' + N + ' photos', true);

  /* 2 — decide which pairs to match.
     Where the photos carry GPS — every drone survey — the flight geometry says
     exactly which frames overlap, which beats guessing from thumbnails and is
     the difference between a well-connected network and a drifting one on a
     large site. Thumbnail similarity is the fallback for handheld sets, and
     capture order is always included. */
  checkCancel();
  const gpsRef = meta.find((m) => m.exif && m.exif.lat != null);
  const enu = meta.map((m) => (m.exif && m.exif.lat != null && gpsRef
    ? gpsToEnu(m.exif.lat, m.exif.lon, m.exif.alt || 0, { lat: gpsRef.exif.lat, lon: gpsRef.exif.lon, alt: gpsRef.exif.alt || 0 })
    : null));
  const withGps = enu.filter(Boolean).length;
  const useGps = withGps >= N * 0.6 && withGps >= 3;
  const kCand = useGps ? Math.max(opt.candidates, 8) : opt.candidates;
  const wanted = new Map();
  const ranked = new Array(N - 1);
  for (let i = 0; i < N; i++) {
    let r = 0;
    if (useGps && enu[i]) {
      for (let j = 0; j < N; j++) {
        if (j === i || !enu[j]) continue;
        const d = Math.hypot(enu[i][0] - enu[j][0], enu[i][1] - enu[j][1], (enu[i][2] - enu[j][2]) * 0.5);
        ranked[r++] = [j, -d];                       // nearest first
      }
    } else {
      for (let j = 0; j < N; j++) if (j !== i) ranked[r++] = [j, signatureScore(feats[i].sig, feats[j].sig)];
    }
    const slice = ranked.slice(0, r).sort((a, b) => b[1] - a[1]);
    const cand = new Set();
    for (let k = 0; k < Math.min(kCand, slice.length); k++) cand.add(slice[k][0]);
    for (let d = 1; d <= 2; d++) { if (i + d < N) cand.add(i + d); if (i - d >= 0) cand.add(i - d); }
    for (const j of cand) {
      const key = Math.min(i, j) * 100000 + Math.max(i, j);
      if (!wanted.has(key)) wanted.set(key, [Math.min(i, j), Math.max(i, j)]);
    }
  }
  const pairList = [...wanted.values()];
  post({ type: 'note', message: (useGps
    ? 'Photo pairs chosen from GPS positions (' + withGps + ' tagged photos)'
    : 'Photo pairs chosen from image similarity and capture order') + ': ' + pairList.length.toLocaleString() + ' to check.' });
  progress.setUnits('matching', pairList.length);
  progress.setUnits('verify', pairList.length);
  progress.begin('matching');
  const pairs = [];
  const PAIR_BLOCK = 250;
  let startPair = 0;
  if (resuming && state.pairsBlocks) {
    // matches are cheap to store and expensive to redo: restore whole blocks
    for (let b = 0; b < state.pairsBlocks; b++) {
      const c = await ckpt.load('pairs:' + b);
      if (!c) break;
      const data = c.at(0, Int32Array, c.meta.total);
      let off = 0;
      for (const [i, j, len] of c.meta.pairs) {
        pairs.push({ i: i, j: j, matches: data.subarray(off, off + len) });
        off += len;
      }
      startPair = c.meta.until;
    }
    if (startPair) {
      progress.tick('matching', startPair);
      post({ type: 'note', message: 'Resuming: ' + startPair.toLocaleString() + ' photo pairs were already matched.' });
    }
  }
  let blockPairs = [];
  let lastPairFlush = Date.now();
  const flushPairs = async (until, blockIndex) => {
    if (!ckpt || !blockPairs.length) return false;
    let total = 0;
    for (const p of blockPairs) total += p.matches.length;
    const data = new Int32Array(total);
    let off = 0;
    for (const p of blockPairs) { data.set(p.matches, off); off += p.matches.length; }
    await ckpt.save('pairs:' + blockIndex, {
      pairs: blockPairs.map((p) => [p.i, p.j, p.matches.length]), total: total, until: until,
    }, [data]);
    blockPairs = [];
    return true;
  };
  for (let k = startPair; k < pairList.length; k++) {
    checkCancel();
    const [a, b] = pairList[k];
    const m = matchDescriptors(feats[a].desc, feats[a].count, feats[b].desc, feats[b].count, {});
    if (m.length >= 40) { pairs.push({ i: a, j: b, matches: m }); blockPairs.push({ i: a, j: b, matches: m }); }
    progress.tick('matching', k + 1);
    say('matching', 'Matching photo pairs ' + (k + 1) + '/' + pairList.length + ' — ' + pairs.length + ' usable');
    const lastPair = k === pairList.length - 1;
    if ((k + 1) % PAIR_BLOCK === 0 || lastPair || Date.now() - lastPairFlush > 20000) {
      lastPairFlush = Date.now();
      const wrote = await flushPairs(k + 1, state.pairsBlocks);
      if (wrote) await saveIndex({ stage: 'matching', pairsBlocks: state.pairsBlocks + 1, pairsDone: k + 1 }, true);
      else await saveIndex({ stage: 'matching', pairsDone: k + 1 }, lastPair);
    }
  }
  progress.finish('matching');
  if (pairs.length < 2) throw new Error('the photos do not overlap enough to match — aim for 60-80% overlap between consecutive shots');
  // descriptors are the biggest thing held so far; the geometry stage only
  // needs keypoints from here on
  for (const f of feats) { f.desc = null; f.sig = null; }

  /* 3 — structure from motion */
  checkCancel();
  progress.begin('verify');
  const phase = {};                       // stages already entered, so timing windows are not restarted
  const images = meta.map((m, i) => ({ w: m.w, h: m.h, f: m.focal, cx: m.w / 2, cy: m.h / 2, kps: feats[i].kps }));

  /* the sparse solution is one artefact: it either exists in full or is redone.
     Restoring it also restores the focal lengths, which self-calibration may
     have changed. */
  let rec = null;
  if (resuming && state.sparse) {
    say('verify', 'Restoring the camera solution', true);
    const c = await ckpt.load('sparse', state.sparse);
    if (c && c.meta && c.meta.nPoints >= 0) {
      const X = c.at(0, Float32Array, c.meta.nPoints * 3);
      const obsCam = c.at(1, Int32Array, c.meta.nObs);
      const obsXY = c.at(2, Float32Array, c.meta.nObs * 2);
      const start = c.at(3, Int32Array, c.meta.nPoints + 1);
      const points = new Array(c.meta.nPoints);
      for (let p = 0; p < c.meta.nPoints; p++) {
        const obs = [];
        for (let k = start[p]; k < start[p + 1]; k++) obs.push({ cam: obsCam[k], x: obsXY[k * 2], y: obsXY[k * 2 + 1] });
        points[p] = { X: [X[p * 3], X[p * 3 + 1], X[p * 3 + 2]], obs: obs };
      }
      rec = {
        cams: c.meta.cams.map((cam) => (cam ? { R: Float64Array.from(cam.R), t: cam.t.slice(), fixed: !!cam.fixed } : null)),
        points: points, stats: c.meta.stats,
      };
      for (let i = 0; i < N; i++) if (c.meta.focals[i]) images[i].f = c.meta.focals[i];
      progress.tick('verify', pairList.length);
      progress.finish('verify');
      progress.tick('register', N);
      post({ type: 'note', message: 'Resuming: the camera solution was already computed (' + rec.stats.registered + ' cameras).' });
    }
  }
  if (!rec) rec = reconstruct(images, pairs, {
    seed: 20240611,
    thresholdPx: 3,
    maxTracks: N > 200 ? 600000 : 400000,
    refineFocal: job.refineFocal != null ? job.refineFocal : noExifFocal > N / 2,
    shouldStop: () => cancelled,
    onProgress: (stage, pct, msg) => {
      if (stage === 'verify') { progress.tick('verify', Math.round(pct * pairList.length)); say('verify', msg); }
      else if (stage === 'register') {
        if (!phase.register) { progress.finish('verify'); progress.begin('register'); phase.register = 1; }
        progress.tick('register', Math.round(pct * N)); say('register', msg);
      } else if (stage === 'bundle') {
        if (!phase.bundle) { progress.finish('register'); progress.begin('bundle'); phase.bundle = 1; }
        progress.tick('bundle', Math.round(pct * 10)); say('bundle', msg);
      } else say(phase.register ? 'register' : 'verify', msg);
    },
  });
  progress.finish('bundle');
  if (rec.stats.error) throw new Error(rec.stats.error);
  if (ckpt && !state.sparse) {
    say('bundle', 'Saving the camera solution', true);
    let nObs = 0;
    for (const p of rec.points) nObs += p.obs.length;
    const X = new Float32Array(rec.points.length * 3);
    const obsCam = new Int32Array(nObs), obsXY = new Float32Array(nObs * 2);
    const start = new Int32Array(rec.points.length + 1);
    let at = 0;
    for (let p = 0; p < rec.points.length; p++) {
      const pt = rec.points[p];
      X[p * 3] = pt.X[0]; X[p * 3 + 1] = pt.X[1]; X[p * 3 + 2] = pt.X[2];
      start[p] = at;
      for (const ob of pt.obs) { obsCam[at] = ob.cam; obsXY[at * 2] = ob.x; obsXY[at * 2 + 1] = ob.y; at++; }
    }
    start[rec.points.length] = at;
    const parts = await ckpt.save('sparse', {
      nPoints: rec.points.length, nObs: nObs, stats: rec.stats, focals: images.map((im) => im.f),
      cams: rec.cams.map((c) => (c ? { R: Array.from(c.R), t: c.t.slice(), fixed: !!c.fixed } : null)),
    }, [X, obsCam, obsXY, start]);
    await saveIndex({ stage: 'sparse', sparse: parts || 1 }, true);
  }
  const registered = rec.cams.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
  if (registered.length < 3) throw new Error('only ' + registered.length + ' photos could be placed — try more overlap or a slower pass over the subject');
  say('bundle', 'Placed ' + registered.length + '/' + N + ' cameras · ' + rec.points.length.toLocaleString() + ' tie points', true);

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
      say('bundle', 'Georeferenced from ' + gpsCams.length + ' GPS tags (±' + geo.rms.toFixed(1) + ' m on camera positions)', true);
    }
  }

  /* 5 — dense stereo, streamed straight into a voxel grid */
  const info = analyseViews(rec.cams, rec.points, { neighbours: opt.neighbours });
  let cloud = null, spacing = 0, voxelUsed = 0;
  if (opt.dense) {
    const usable = registered.filter((i) => info[i] && info[i].neighbours.length >= 2);
    if (!usable.length) throw new Error('no view has enough stereo partners for a dense model — try the Draft preset');
    progress.setUnits('dense', usable.length);
    progress.setUnits('fuse', usable.length);
    progress.begin('dense');

    const order = traversalOrder(usable, info);
    const imgCache = makeCache(Math.max(5, opt.neighbours + 4), opt.maxDim);
    const depthCache = new Map();                     // view index → packed view
    const lag = Math.min(10, Math.max(3, opt.neighbours + 2));
    const depthCap = lag * 4 + 8;
    // enough blocks that an interrupted run loses little, few enough that a
    // long capture is not writing constantly
    const BLOCK_VIEWS = Math.max(4, Math.min(25, Math.ceil(usable.length / 8)));

    const spacings = [];
    for (const i of usable) spacings.push(opt.denseStride * info[i].medianDepth / images[i].f);
    spacing = median(spacings) || 0;
    const voxel = Math.max(spacing, 1e-9);
    // one voxel per sample step: fusion already requires two views to agree on
    // the surface geometrically, so there is nothing to gain from merging more
    // aggressively, and coarser voxels only cost detail. The grid coarsens
    // itself if the point budget is reached.
    const makeGrid = () => createVoxelGrid({ voxel: voxel, budget: pointBudget(N) });

    /* Fused points are written out in blocks. A block is a finished piece of
       cloud, so a reopened build reloads them and carries on from the view it
       had reached rather than sweeping the whole set again. */
    const blocks = [];
    let startFuse = 0;
    if (resuming && state.denseBlocks) {
      for (let b = 0; b < state.denseBlocks; b++) {
        const c = await ckpt.load('dense:' + b, state.denseParts ? state.denseParts[b] : 1);
        if (!c) break;
        blocks.push({
          positions: c.at(0, Float32Array, c.meta.count * 3),
          colors: c.at(1, Uint8Array, c.meta.count * 3),
        });
        startFuse = c.meta.fusedUntil;
      }
      if (startFuse) {
        const have = blocks.reduce((a2, b2) => a2 + b2.positions.length / 3, 0);
        post({ type: 'note', message: 'Resuming: ' + startFuse + ' of ' + order.length + ' depth maps were already fused (' + have.toLocaleString() + ' points).' });
        progress.tick('dense', startFuse);
        progress.tick('fuse', startFuse);
      }
    }

    let blockGrid = makeGrid();
    let lastBlockAt = Date.now();
    const denseParts = (state.denseParts || []).slice();

    const ensureDepth = async (k) => {
      if (k < 0 || k >= order.length) return;
      const i = order[k];
      if (depthCache.has(i)) return;
      const refImg = await imgCache.get(photos[i]);
      const ref = {
        gray: refImg.gray, w: refImg.w, h: refImg.h,
        f: images[i].f, cx: images[i].cx, cy: images[i].cy,
        R: rec.cams[i].R, t: rec.cams[i].t, dmin: info[i].dmin, dmax: info[i].dmax,
      };
      const nbs = [];
      for (const j of info[i].neighbours) {
        const im = await imgCache.get(photos[j]);
        nbs.push({ gray: im.gray, w: im.w, h: im.h, f: images[j].f, cx: images[j].cx, cy: images[j].cy, R: rec.cams[j].R, t: rec.cams[j].t });
      }
      const dm = computeDepthMap(ref, nbs, { stride: opt.denseStride, samples: opt.denseSamples, minScore: opt.minScore });
      const filtered = medianFilterDepth(dm.depth, ref.w, ref.h, opt.denseStride);
      depthCache.set(i, {
        packed: packDepth(filtered, ref.w, ref.h, opt.denseStride, ref.dmin, ref.dmax, refImg.rgba),
        w: ref.w, h: ref.h, f: ref.f, cx: ref.cx, cy: ref.cy, R: ref.R, t: ref.t,
      });
      while (depthCache.size > depthCap) {
        const oldest = depthCache.keys().next().value;
        if (oldest === undefined || oldest === i) break;
        depthCache.delete(oldest);
      }
    };

    const fuseAt = (idx) => {
      const v = depthCache.get(idx);
      if (!v || !v.packed || v.fused) return;
      // check against the view's own stereo partners first, then anything else
      // still in the cache: a surface point is often confirmed by a view that
      // is not in this view's top-k list, and dropping those costs coverage
      const seenIds = new Set([idx]);
      const nbs = [];
      for (const j of info[idx].neighbours) {
        const d = depthCache.get(j);
        if (d && d.packed && !seenIds.has(j)) { nbs.push(d); seenIds.add(j); }
      }
      for (const [j, d] of depthCache) {
        if (seenIds.has(j) || !d.packed) continue;
        nbs.push(d); seenIds.add(j);
      }
      fuseView(v, nbs, blockGrid, {
        consistency: opt.denseStride <= 2 ? 2 : 1,
        searchRadius: opt.denseStride * 2,
      });
      // keep the samples until this view is evicted: a depth map that has been
      // fused is still the evidence that confirms its neighbours
      v.fused = true;
    };

    const flushBlock = async (fusedUntil) => {
      const b = blockGrid.finish(1);
      blockGrid = makeGrid();
      if (!b.positions.length) return;
      blocks.push(b);
      if (!ckpt) return;
      const parts = await ckpt.save('dense:' + state.denseBlocks, {
        count: b.positions.length / 3, fusedUntil: fusedUntil, voxel: b.voxel,
      }, [b.positions, b.colors]);
      denseParts[state.denseBlocks] = parts || 1;
      await saveIndex({ stage: 'dense', denseBlocks: state.denseBlocks + 1, denseFused: fusedUntil, denseParts: denseParts }, true);
    };

    // on resume the depth maps behind the restart point are gone; recompute a
    // window of them so the next views still have something to check against
    if (startFuse > 0) {
      for (let k = Math.max(0, startFuse - lag); k < startFuse; k++) {
        checkCancel();
        say('dense', 'Reloading the working window ' + (k - Math.max(0, startFuse - lag) + 1) + '/' + Math.min(lag, startFuse));
        await ensureDepth(k);
      }
    }

    for (let k = startFuse; k < order.length; k++) {
      checkCancel();
      say('dense', 'Depth map ' + (k + 1) + '/' + order.length + ' — ' + meta[order[k]].name);
      for (let a2 = k; a2 <= Math.min(order.length - 1, k + lag); a2++) await ensureDepth(a2);
      fuseAt(order[k]);
      progress.tick('dense', k + 1);
      progress.tick('fuse', k + 1);
      if ((k + 1 - startFuse) % BLOCK_VIEWS === 0 || k === order.length - 1 || Date.now() - lastBlockAt > 30000) {
        lastBlockAt = Date.now();
        await flushBlock(k + 1);
      }
    }
    progress.finish('dense');
    progress.begin('fuse');
    imgCache.clear(); depthCache.clear();

    /* merge the blocks into one cloud — points that fall in the same voxel
       across blocks come back together here */
    say('fuse', 'Merging ' + blocks.length + ' block' + (blocks.length === 1 ? '' : 's') + ' of points', true);
    const grid = makeGrid();
    for (const b of blocks) {
      const n = b.positions.length / 3;
      for (let i = 0; i < n; i++) {
        grid.add(b.positions[i * 3], b.positions[i * 3 + 1], b.positions[i * 3 + 2],
          b.colors[i * 3], b.colors[i * 3 + 1], b.colors[i * 3 + 2]);
      }
    }
    blocks.length = 0;
    say('fuse', 'Cleaning ' + grid.size.toLocaleString() + ' points', true);
    cloud = grid.finish(1);
    voxelUsed = cloud.voxel;
    progress.finish('fuse');
  }

  /* 6 — point cloud in world units */
  checkCancel();
  let positions, colors;
  if (cloud) {
    positions = cloud.positions; colors = cloud.colors;
  } else {
    positions = new Float32Array(rec.points.length * 3);
    colors = new Uint8Array(rec.points.length * 3).fill(190);
    for (let i = 0; i < rec.points.length; i++) {
      positions[i * 3] = rec.points[i].X[0]; positions[i * 3 + 1] = rec.points[i].X[1]; positions[i * 3 + 2] = rec.points[i].X[2];
    }
    // colour the sparse cloud from the first photo that saw each point
    const cache = makeCache(3, Math.min(900, opt.maxDim));
    const byCam = new Map();
    rec.points.forEach((p, pi) => {
      const ob = p.obs[0];
      let a = byCam.get(ob.cam); if (!a) { a = []; byCam.set(ob.cam, a); }
      a.push([pi, ob]);
    });
    let done = 0;
    for (const [ci, list] of byCam) {
      checkCancel();
      say('fuse', 'Colouring points ' + (++done) + '/' + byCam.size);
      const im = await cache.get(photos[ci]);
      const sx = im.w / images[ci].w, sy = im.h / images[ci].h;
      for (const [pi, ob] of list) {
        const px = Math.round((ob.x * images[ci].f + images[ci].cx) * sx);
        const py = Math.round((ob.y * images[ci].f + images[ci].cy) * sy);
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
    spacing *= s; voxelUsed *= s;
    units = 'metres (east / north / up)';
  }

  let mesh = null, ortho = null;
  if (job.mesh !== false && positions.length / 3 > 500) {
    checkCancel();
    progress.begin('mesh');
    say('mesh', 'Building the surface model', true);
    const viewpoint = [0, 1, 2].map((k) => camList.reduce((a, c) => a + c.C[k], 0) / camList.length);
    const surf = buildSurfaceGrid(positions, colors, {
      viewpoint: viewpoint,
      up: geo && geo.fit && geo.fit.R ? [0, 0, 1] : null,      // georeferenced clouds already have gravity
      // size the cell from the sampling interval rather than the average point
      // density: points cluster on texture and leave gaps on flat colour, and a
      // density-derived cell punches those gaps straight through the surface
      cell: spacing > 0 ? spacing * 2 : null,
      density: job.meshDensity || 1.4,
      maxCells: N > 200 ? 1800 : opt.maxDim >= 2000 ? 1800 : 1200,
    });
    if (surf && surf.triangles > 0) {
      mesh = { positions: surf.positions, colors: surf.colors, indices: surf.indices, triangles: surf.triangles };
      ortho = { rgba: surf.grid.rgba, w: surf.grid.w, h: surf.grid.h, cell: surf.grid.cell };
    }
    progress.finish('mesh');
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
      spacing: voxelUsed || spacing,
      units: units,
      georeferenced: !!(geo && geo.fit && geo.fit.R),
      geoRms: geo && geo.rms != null ? geo.rms : null,
      geoRef: geo && geo.ref ? geo.ref : null,
      quality: job.quality || 'balanced',
      adapted: adapted.notes,
      bundle: rec.stats.globalBundle,
      buildMs: progress.snapshot().elapsedMs,
      unregistered: meta.filter((m, i) => !rec.cams[i]).map((m) => m.name),
    },
  };

  if (ckpt) await saveIndex({ stage: 'done', done: true, finishedAt: Date.now() }, true);

  const transfer = [result.positions.buffer, result.colors.buffer];
  if (mesh) transfer.push(mesh.positions.buffer, mesh.colors.buffer, mesh.indices.buffer);
  if (ortho) transfer.push(ortho.rgba.buffer);
  say('mesh', 'Model complete', true);
  post({ type: 'done', result: result, buildId: job.buildId || null, resumed: resuming }, transfer);
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type === 'cancel') { cancelled = true; return; }
  if (msg.type !== 'build') return;
  cancelled = false;
  try {
    await build(msg);
  } catch (err) {
    if (String(err && err.message) === '__cancelled__') post({ type: 'cancelled', buildId: msg.buildId || null });
    else post({ type: 'error', message: String((err && err.message) || err) });
  }
};
