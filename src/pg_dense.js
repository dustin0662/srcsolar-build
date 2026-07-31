/* pg_dense.js — everything after the sparse reconstruction:
     • multi-view plane-sweep depth maps (ZNCC over an affine-warped patch)
     • compact (quantised) depth storage so hundreds of views fit in memory
     • streaming fusion into a voxel grid with a fixed point budget
     • dominant-plane fit → 2.5D surface grid (DSM) → mesh + orthophoto raster
     • PLY / GLB / OBJ writers
   Pure typed-array code so it runs inside the worker (and in node tests). */

import { mat3Mul, mat3T, mat3Vec, mat3TVec, makeRng, median } from './pg_math.js';

/* ── view analysis ─────────────────────────────────────────────────── */

/* For every registered camera work out (a) the depth range its sparse points
   span and (b) which other views make good stereo partners: plenty of shared
   points and a baseline that gives real parallax without extreme foreshortening.
   cams: [{R,t}|null]; points: [{X, obs:[{cam}]}] */
export function analyseViews(cams, points, opts) {
  const o = opts || {};
  const k = o.neighbours || 4;
  const n = cams.length;
  const depths = Array.from({ length: n }, () => []);
  const shared = new Map();     // "i,j" → count
  const centres = cams.map((c) => (c ? (() => { const q = mat3TVec(c.R, c.t); return [-q[0], -q[1], -q[2]]; })() : null));
  const angles = new Map();     // "i,j" → [angle samples]

  for (const p of points) {
    const obs = p.obs.filter((ob) => cams[ob.cam]);
    for (const ob of obs) {
      const c = cams[ob.cam];
      const z = c.R[6] * p.X[0] + c.R[7] * p.X[1] + c.R[8] * p.X[2] + c.t[2];
      if (z > 0) depths[ob.cam].push(z);
    }
    for (let a = 0; a < obs.length; a++) for (let b = a + 1; b < obs.length; b++) {
      const i = Math.min(obs[a].cam, obs[b].cam), j = Math.max(obs[a].cam, obs[b].cam);
      const key = i + ',' + j;
      shared.set(key, (shared.get(key) || 0) + 1);
      let arr = angles.get(key);
      if (!arr) { arr = []; angles.set(key, arr); }
      if (arr.length < 60) {
        const ca = centres[i], cb = centres[j];
        const va = [p.X[0] - ca[0], p.X[1] - ca[1], p.X[2] - ca[2]];
        const vb = [p.X[0] - cb[0], p.X[1] - cb[1], p.X[2] - cb[2]];
        const na = Math.hypot(...va), nb = Math.hypot(...vb);
        if (na > 1e-9 && nb > 1e-9) {
          const cs = Math.max(-1, Math.min(1, (va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]) / (na * nb)));
          arr.push(Math.acos(cs) * 180 / Math.PI);
        }
      }
    }
  }

  const out = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (!cams[i] || depths[i].length < 12) continue;
    const d = Float64Array.from(depths[i]).sort();
    const q = (f) => d[Math.min(d.length - 1, Math.max(0, Math.floor(f * d.length)))];
    const cand = [];
    for (let j = 0; j < n; j++) {
      if (j === i || !cams[j]) continue;
      const key = Math.min(i, j) + ',' + Math.max(i, j);
      const cnt = shared.get(key) || 0;
      if (cnt < 15) continue;
      const ang = median(angles.get(key) || [0]);
      // 4°–25° of parallax is the sweet spot for patch matching
      const w = Math.exp(-Math.pow((ang - 11) / 13, 2));
      cand.push({ j: j, score: cnt * w, ang: ang, shared: cnt });
    }
    cand.sort((a, b) => b.score - a.score);
    out[i] = {
      neighbours: cand.slice(0, k).map((c) => c.j),
      dmin: Math.max(1e-6, q(0.02) * 0.75),
      dmax: q(0.98) * 1.35,
      medianDepth: q(0.5),
      support: d.length,
    };
  }
  return out;
}

/* ── depth maps ────────────────────────────────────────────────────── */

const PATCH_OFF = [-3, 0, 3];   // 3×3 samples spanning a 7×7 pixel window

function bilinear(img, w, h, x, y) {
  if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return NaN;
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
  return img[i] * (1 - fx) * (1 - fy) + img[i + 1] * fx * (1 - fy) + img[i + w] * (1 - fx) * fy + img[i + w + 1] * fx * fy;
}

/* relative pose from reference camera coords to neighbour camera coords */
function relativePose(ref, nb) {
  const R = mat3Mul(nb.R, mat3T(ref.R));
  const Rt = mat3Vec(R, ref.t);
  return { R: R, t: [nb.t[0] - Rt[0], nb.t[1] - Rt[1], nb.t[2] - Rt[2]] };
}

/* Plane-sweep depth map for one view.
   ref: { gray, w, h, R, t, f, cx, cy, dmin, dmax }
   nbs: same shape (no depth range needed)
   opts: { stride, samples, minScore } */
export function computeDepthMap(ref, nbs, opts) {
  const o = opts || {};
  const stride = Math.max(1, o.stride || 2);
  const samples = Math.max(8, o.samples || 32);
  const minScore = o.minScore == null ? 0.55 : o.minScore;
  const { gray, w, h, f, cx, cy } = ref;
  const depth = new Float32Array(w * h);
  const score = new Float32Array(w * h);
  if (!nbs.length || !(ref.dmax > ref.dmin) || ref.dmin <= 0) return { depth, score };

  const rel = nbs.map((n) => relativePose(ref, n));
  const iz0 = 1 / ref.dmax, iz1 = 1 / ref.dmin;
  const dstep = (iz1 - iz0) / (samples - 1);
  const P = PATCH_OFF.length;
  const refPatch = new Float64Array(P * P);
  const nbPatch = new Float64Array(P * P);
  const scores = new Float64Array(nbs.length);

  // start on a multiple of the stride so the sample grid lines up with the
  // packed representation and with the median filter
  const y0 = Math.ceil(4 / stride) * stride, x0 = y0;
  for (let y = y0; y < h - 3; y += stride) {
    for (let x = x0; x < w - 3; x += stride) {
      // reference patch statistics
      let sum = 0, sum2 = 0, k = 0;
      for (let a = 0; a < P; a++) for (let b = 0; b < P; b++) {
        const v = gray[(y + PATCH_OFF[a]) * w + (x + PATCH_OFF[b])];
        refPatch[k++] = v; sum += v; sum2 += v * v;
      }
      const n = P * P, mean = sum / n;
      const varr = sum2 / n - mean * mean;
      if (varr < (o.minVariance || 8)) continue;    // textureless — no reliable match
      const sd = Math.sqrt(varr);

      const xn = (x - cx) / f, yn = (y - cy) / f;
      const xnDx = 1 / f, ynDy = 1 / f;            // ray derivative per pixel
      let bestScore = -2, bestDepth = 0, secondScore = -2;

      for (let s = 0; s < samples; s++) {
        const d = 1 / (iz0 + s * dstep);
        const Xc = [xn * d, yn * d, d];
        const Xdx = [xnDx * d, 0, 0];              // ∂X/∂(ref pixel x)
        const Xdy = [0, ynDy * d, 0];
        let nGood = 0;
        for (let m = 0; m < nbs.length; m++) {
          const R = rel[m].R, t = rel[m].t, nb = nbs[m];
          const zc = R[6] * Xc[0] + R[7] * Xc[1] + R[8] * Xc[2] + t[2];
          if (zc <= 1e-6) continue;
          const xc = R[0] * Xc[0] + R[1] * Xc[1] + R[2] * Xc[2] + t[0];
          const yc = R[3] * Xc[0] + R[4] * Xc[1] + R[5] * Xc[2] + t[1];
          const px = nb.f * xc / zc + nb.cx, py = nb.f * yc / zc + nb.cy;
          if (px < 4 || py < 4 || px >= nb.w - 4 || py >= nb.h - 4) continue;
          // affine approximation of the patch warp: project the two tangents
          const zdx = R[6] * Xdx[0] + R[7] * Xdx[1] + R[8] * Xdx[2];
          const xdx = R[0] * Xdx[0] + R[1] * Xdx[1] + R[2] * Xdx[2];
          const ydx = R[3] * Xdx[0] + R[4] * Xdx[1] + R[5] * Xdx[2];
          const zdy = R[6] * Xdy[0] + R[7] * Xdy[1] + R[8] * Xdy[2];
          const xdy = R[0] * Xdy[0] + R[1] * Xdy[1] + R[2] * Xdy[2];
          const ydy = R[3] * Xdy[0] + R[4] * Xdy[1] + R[5] * Xdy[2];
          const iz = 1 / zc;
          const axx = nb.f * (xdx - xc * zdx * iz) * iz, ayx = nb.f * (ydx - yc * zdx * iz) * iz;
          const axy = nb.f * (xdy - xc * zdy * iz) * iz, ayy = nb.f * (ydy - yc * zdy * iz) * iz;
          let ns = 0, ns2 = 0, kk = 0, bad = false;
          for (let a = 0; a < P && !bad; a++) for (let b = 0; b < P; b++) {
            const dy = PATCH_OFF[a], dx = PATCH_OFF[b];
            const sxp = px + axx * dx + axy * dy, syp = py + ayx * dx + ayy * dy;
            const v = bilinear(nb.gray, nb.w, nb.h, sxp, syp);
            if (!(v === v)) { bad = true; break; }
            nbPatch[kk++] = v; ns += v; ns2 += v * v;
          }
          if (bad) continue;
          const nmean = ns / n, nvar = ns2 / n - nmean * nmean;
          if (nvar < 4) continue;
          const nsd = Math.sqrt(nvar);
          let cov = 0;
          for (let q = 0; q < n; q++) cov += (refPatch[q] - mean) * (nbPatch[q] - nmean);
          scores[nGood++] = cov / n / (sd * nsd);
        }
        if (nGood < Math.min(2, nbs.length)) continue;
        // mean of the best two views — robust to one occluded neighbour
        let b1 = -2, b2 = -2;
        for (let q = 0; q < nGood; q++) { const v = scores[q]; if (v > b1) { b2 = b1; b1 = v; } else if (v > b2) b2 = v; }
        const agg = nGood >= 2 ? (b1 + b2) / 2 : b1;
        if (agg > bestScore) { secondScore = bestScore; bestScore = agg; bestDepth = d; }
        else if (agg > secondScore) secondScore = agg;
      }
      if (bestScore >= minScore) {
        const i = y * w + x;
        depth[i] = bestDepth; score[i] = bestScore;
      }
    }
  }
  return { depth: depth, score: score };
}

/* 3×3 median filter over valid depths — kills isolated speckle.
   Walks every pixel (the depth grid is offset by the sweep's border margin, so
   stepping by `stride` from the origin would miss it entirely) and samples
   neighbours ±stride away, which is where the sweep put them. */
export function medianFilterDepth(depth, w, h, stride) {
  const out = new Float32Array(depth.length);
  const s = Math.max(1, stride || 1);
  const buf = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!depth[i]) continue;
    buf.length = 0;
    for (let dy = -s; dy <= s; dy += s) for (let dx = -s; dx <= s; dx += s) {
      const yy = y + dy, xx = x + dx;
      if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
      const v = depth[yy * w + xx];
      if (v) buf.push(v);
    }
    if (buf.length < 4) continue;                 // orphan pixel
    buf.sort((a, b) => a - b);
    const med = buf[buf.length >> 1];
    if (Math.abs(depth[i] - med) / med < 0.06) out[i] = depth[i];
    else if (buf.length >= 6) out[i] = med;
  }
  return out;
}

/* ── compact depth storage ─────────────────────────────────────────────
   A full-resolution Float32 depth map is ~1 MB per view; six hundred of them
   will not fit in a tab. The sweep only writes on a strided grid, so keep
   just those samples, quantised to 16-bit inverse depth inside the view's own
   range — under 200 KB per view with sub-millimetre quantisation. */
export function packDepth(depth, w, h, stride, dmin, dmax, rgba) {
  const s = Math.max(1, stride || 1);
  const gw = Math.ceil(w / s), gh = Math.ceil(h / s);
  const data = new Uint16Array(gw * gh);
  const color = rgba ? new Uint8Array(gw * gh * 3) : null;
  const iz0 = 1 / dmax, iz1 = 1 / dmin;
  const span = (iz1 - iz0) || 1;
  for (let gy = 0; gy < gh; gy++) {
    const y = gy * s;
    if (y >= h) break;
    for (let gx = 0; gx < gw; gx++) {
      const x = gx * s;
      if (x >= w) break;
      const d = depth[y * w + x];
      if (!d) continue;
      const q = Math.round(((1 / d) - iz0) / span * 65534) + 1;   // 0 stays "empty"
      const gi = gy * gw + gx;
      data[gi] = q < 1 ? 1 : q > 65535 ? 65535 : q;
      if (color) {
        const o4 = (y * w + x) * 4;
        color[gi * 3] = rgba[o4]; color[gi * 3 + 1] = rgba[o4 + 1]; color[gi * 3 + 2] = rgba[o4 + 2];
      }
    }
  }
  return { data: data, color: color, gw: gw, gh: gh, stride: s, w: w, h: h, iz0: iz0, span: span };
}

/* nearest stored depth to an image pixel, searching a small window because the
   grid is strided; returns 0 when nothing was reconstructed nearby */
export function depthNear(packed, x, y, radius) {
  if (!packed) return 0;
  const s = packed.stride;
  const gx0 = Math.round(x / s), gy0 = Math.round(y / s);
  const r = Math.max(0, Math.ceil((radius || 0) / s));
  let best = 0, bestD = Infinity;
  for (let dy = -r; dy <= r; dy++) {
    const gy = gy0 + dy;
    if (gy < 0 || gy >= packed.gh) continue;
    for (let dx = -r; dx <= r; dx++) {
      const gx = gx0 + dx;
      if (gx < 0 || gx >= packed.gw) continue;
      const q = packed.data[gy * packed.gw + gx];
      if (!q) continue;
      const dist = dx * dx + dy * dy;
      if (dist < bestD) { bestD = dist; best = 1 / (packed.iz0 + (q - 1) / 65534 * packed.span); }
    }
  }
  return best;
}

/* ── streaming voxel accumulator ───────────────────────────────────────
   Fusing six hundred depth maps produces tens of millions of samples. Rather
   than collect them and downsample afterwards (which needs the whole set in
   memory at once), fold every sample straight into a voxel grid held in an
   open-addressed hash table of typed arrays. When the table fills, the voxel
   size doubles and the contents are rehashed — so the memory ceiling is set
   by the point budget, not by the capture size. */
export function createVoxelGrid(opts) {
  const o = opts || {};
  let voxel = o.voxel > 0 ? o.voxel : 0.05;
  const budget = Math.max(50000, o.budget || 3000000);
  let cap = 1;
  while (cap < budget * 2) cap *= 2;
  const LIMIT = 1 << 17;                    // cells per axis in the packed key

  let keys = new Float64Array(cap).fill(-1);
  let px = new Float32Array(cap), py = new Float32Array(cap), pz = new Float32Array(cap);
  let cr = new Float32Array(cap), cg = new Float32Array(cap), cb = new Float32Array(cap);
  let cnt = new Uint16Array(cap);
  let used = 0;

  const keyOf = (x, y, z) => {
    const ix = Math.floor(x / voxel) & (LIMIT - 1);
    const iy = Math.floor(y / voxel) & (LIMIT - 1);
    const iz = Math.floor(z / voxel) & (LIMIT - 1);
    return ix * 17179869184 + iy * 131072 + iz;     // 2^34, 2^17 — exact in a double
  };
  const slotOf = (key) => {
    // mix both halves of the key: it exceeds 32 bits, and a plain multiply
    // would throw away the low bits that distinguish adjacent voxels
    const lo = key % 4294967296, hi = (key - lo) / 4294967296;
    let h = Math.imul(lo ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(hi ^ 0xc2b2ae35, 0x27d4eb2f);
    h ^= h >>> 15;
    let i = (h >>> 0) & (cap - 1);
    while (keys[i] !== -1 && keys[i] !== key) i = (i + 1) & (cap - 1);
    return i;
  };

  function insert(key, x, y, z, r, g, b, weight) {
    const i = slotOf(key);
    if (keys[i] === -1) {
      keys[i] = key; px[i] = x; py[i] = y; pz[i] = z; cr[i] = r; cg[i] = g; cb[i] = b;
      cnt[i] = Math.min(65535, weight || 1);
      used++;
      return true;
    }
    const n = cnt[i], w = weight || 1, tot = n + w;
    px[i] += (x - px[i]) * w / tot; py[i] += (y - py[i]) * w / tot; pz[i] += (z - pz[i]) * w / tot;
    cr[i] += (r - cr[i]) * w / tot; cg[i] += (g - cg[i]) * w / tot; cb[i] += (b - cb[i]) * w / tot;
    cnt[i] = Math.min(65535, tot);
    return false;
  }

  function grow() {
    // coarser voxels, same table: merge what collapses together
    voxel *= 2;
    const ok = keys, ox = px, oy = py, oz = pz, orr = cr, og = cg, ob = cb, on = cnt;
    keys = new Float64Array(cap).fill(-1);
    px = new Float32Array(cap); py = new Float32Array(cap); pz = new Float32Array(cap);
    cr = new Float32Array(cap); cg = new Float32Array(cap); cb = new Float32Array(cap);
    cnt = new Uint16Array(cap);
    used = 0;
    for (let i = 0; i < ok.length; i++) {
      if (ok[i] === -1) continue;
      insert(keyOf(ox[i], oy[i], oz[i]), ox[i], oy[i], oz[i], orr[i], og[i], ob[i], on[i]);
    }
  }

  return {
    add(x, y, z, r, g, b) {
      if (used >= budget) grow();
      insert(keyOf(x, y, z), x, y, z, r, g, b, 1);
    },
    get size() { return used; },
    get voxel() { return voxel; },
    /* minCount drops voxels seen only once — the cheap outlier filter that
       replaces a neighbour search at this scale */
    finish(minCount) {
      const need = Math.max(1, minCount || 1);
      let n = 0;
      for (let i = 0; i < cap; i++) if (keys[i] !== -1 && cnt[i] >= need) n++;
      const positions = new Float32Array(n * 3), colors = new Uint8Array(n * 3);
      let k = 0;
      for (let i = 0; i < cap; i++) {
        if (keys[i] === -1 || cnt[i] < need) continue;
        positions[k * 3] = px[i]; positions[k * 3 + 1] = py[i]; positions[k * 3 + 2] = pz[i];
        colors[k * 3] = cr[i]; colors[k * 3 + 1] = cg[i]; colors[k * 3 + 2] = cb[i];
        k++;
      }
      return { positions: positions, colors: colors, voxel: voxel, dropped: used - n };
    },
  };
}

/* Fuse one view's depth map into the accumulator, checking it against the
   neighbour depth maps that are currently in memory.
   view: { packed, w, h, R, t, f, cx, cy, rgb }
   nbs:  same shape (only those already computed) */
export function fuseView(view, nbs, grid, opts) {
  const o = opts || {};
  const needAgree = o.consistency === false ? 0 : Math.max(0, o.consistency == null ? 1 : o.consistency);
  const tol = o.tolerance || 0.02;
  const radius = o.searchRadius || (view.packed ? view.packed.stride : 2);
  const p = view.packed;
  if (!p) return 0;
  let added = 0;
  for (let gy = 0; gy < p.gh; gy++) {
    const y = gy * p.stride;
    if (y >= view.h) break;
    for (let gx = 0; gx < p.gw; gx++) {
      const q = p.data[gy * p.gw + gx];
      if (!q) continue;
      const x = gx * p.stride;
      if (x >= view.w) continue;
      const d = 1 / (p.iz0 + (q - 1) / 65534 * p.span);
      const Xc = [(x - view.cx) / view.f * d, (y - view.cy) / view.f * d, d];
      const q3 = mat3TVec(view.R, [Xc[0] - view.t[0], Xc[1] - view.t[1], Xc[2] - view.t[2]]);
      if (needAgree) {
        let agree = 0, checked = 0;
        for (let m = 0; m < nbs.length && agree < needAgree; m++) {
          const n = nbs[m];
          if (!n || !n.packed) continue;
          const Xn = mat3Vec(n.R, q3);
          const zc = Xn[2] + n.t[2];
          if (zc <= 1e-6) continue;
          const nx = n.f * (Xn[0] + n.t[0]) / zc + n.cx;
          const ny = n.f * (Xn[1] + n.t[1]) / zc + n.cy;
          if (nx < 0 || ny < 0 || nx >= n.w || ny >= n.h) continue;
          const dn = depthNear(n.packed, nx, ny, radius);
          if (!dn) continue;
          checked++;
          if (Math.abs(dn - zc) / zc < tol) agree++;
        }
        if (checked && agree < needAgree) continue;
      }
      const gi = gy * p.gw + gx;
      let r = 190, g = 190, b = 190;
      if (p.color) { r = p.color[gi * 3]; g = p.color[gi * 3 + 1]; b = p.color[gi * 3 + 2]; }
      else if (view.rgb) { const o4 = (y * view.w + x) * 4; r = view.rgb[o4]; g = view.rgb[o4 + 1]; b = view.rgb[o4 + 2]; }
      grid.add(q3[0], q3[1], q3[2], r, g, b);
      added++;
    }
  }
  return added;
}

/* ── surface grid (2.5D DSM) ───────────────────────────────────────── */

/* RANSAC plane fit — returns the unit normal and offset of the dominant plane */
export function fitDominantPlane(positions, seed) {
  const n = positions.length / 3;
  if (n < 30) return null;
  const rng = makeRng(seed || 7);
  let best = null, bestCount = 0;
  // scale-aware inlier band: 1.5% of the cloud's extent
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const band = extent * 0.015;
  const step = Math.max(1, Math.floor(n / 20000));
  for (let it = 0; it < 200; it++) {
    const i0 = (rng() * n) | 0, i1 = (rng() * n) | 0, i2 = (rng() * n) | 0;
    if (i0 === i1 || i1 === i2 || i0 === i2) continue;
    const a = [positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]];
    const b = [positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]];
    const c = [positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) continue;
    nx /= len; ny /= len; nz /= len;
    const d = -(nx * a[0] + ny * a[1] + nz * a[2]);
    let cnt = 0;
    for (let i = 0; i < n; i += step) {
      const dist = Math.abs(nx * positions[i * 3] + ny * positions[i * 3 + 1] + nz * positions[i * 3 + 2] + d);
      if (dist < band) cnt++;
    }
    if (cnt > bestCount) { bestCount = cnt; best = { n: [nx, ny, nz], d: d }; }
  }
  if (!best) return null;
  best.inlierRatio = bestCount / Math.ceil(n / step);
  best.extent = extent;
  return best;
}

/* Build a 2.5D height/colour grid along `up`, then a triangle mesh.
   opts: { up, cells (target grid size), fillPasses, maxHeightJump } */
export function buildSurfaceGrid(positions, colors, opts) {
  const o = opts || {};
  const n = positions.length / 3;
  if (n < 100) return null;
  let up = o.up;
  if (!up) {
    const plane = fitDominantPlane(positions, 11);
    up = plane ? plane.n : [0, 0, 1];
  }
  let [ux, uy, uz] = up;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  // a plane fit gives ±n; "up" is whichever side the cameras were on, otherwise
  // the height field comes out inverted and every roof reads as a pit
  if (o.viewpoint) {
    let cxm = 0, cym = 0, czm = 0;
    for (let i = 0; i < n; i++) { cxm += positions[i * 3] / n; cym += positions[i * 3 + 1] / n; czm += positions[i * 3 + 2] / n; }
    const d = (o.viewpoint[0] - cxm) * ux + (o.viewpoint[1] - cym) * uy + (o.viewpoint[2] - czm) * uz;
    if (d < 0) { ux = -ux; uy = -uy; uz = -uz; }
  }
  // in-plane basis
  let ref = Math.abs(uz) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let ex = [uy * ref[2] - uz * ref[1], uz * ref[0] - ux * ref[2], ux * ref[1] - uy * ref[0]];
  const el = Math.hypot(...ex) || 1; ex = ex.map((v) => v / el);
  const ey = [uy * ex[2] - uz * ex[1], uz * ex[0] - ux * ex[2], ux * ex[1] - uy * ex[0]];

  const U = new Float32Array(n), V = new Float32Array(n), Hh = new Float32Array(n);
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const u = x * ex[0] + y * ex[1] + z * ex[2];
    const v = x * ey[0] + y * ey[1] + z * ey[2];
    U[i] = u; V[i] = v; Hh[i] = x * ux + y * uy + z * uz;
    if (u < minU) minU = u; if (u > maxU) maxU = u;
    if (v < minV) minV = v; if (v > maxV) maxV = v;
  }
  const spanU = maxU - minU || 1, spanV = maxV - minV || 1;
  // size the cell from the actual point density — a finer grid than the cloud
  // supports just produces a moiré of empty cells
  const maxCells = o.maxCells || 1400;
  let cell = o.cell || Math.sqrt((spanU * spanV) / n) * (o.density || 1.4);
  cell = Math.max(cell, Math.max(spanU, spanV) / maxCells);
  const gw = Math.max(2, Math.min(2048, Math.ceil(spanU / cell) + 1));
  const gh = Math.max(2, Math.min(2048, Math.ceil(spanV / cell) + 1));

  // accumulate: height samples per cell (median), colour mean
  const buckets = new Array(gw * gh);
  const cr = new Float64Array(gw * gh), cg = new Float64Array(gw * gh), cb = new Float64Array(gw * gh), cc = new Float64Array(gw * gh);
  for (let i = 0; i < n; i++) {
    const gx = Math.min(gw - 1, Math.max(0, Math.round((U[i] - minU) / cell)));
    const gy = Math.min(gh - 1, Math.max(0, Math.round((V[i] - minV) / cell)));
    const k = gy * gw + gx;
    let b = buckets[k]; if (!b) { b = []; buckets[k] = b; }
    b.push(Hh[i]);
    cr[k] += colors[i * 3]; cg[k] += colors[i * 3 + 1]; cb[k] += colors[i * 3 + 2]; cc[k]++;
  }
  const height = new Float32Array(gw * gh);
  const filled = new Uint8Array(gw * gh);
  const rgb = new Uint8ClampedArray(gw * gh * 4);
  for (let k = 0; k < gw * gh; k++) {
    const b = buckets[k];
    if (!b || !b.length) continue;
    b.sort((a, c) => a - c);
    // a high percentile, not the median: a cell straddling a roof edge holds
    // both roof and ground samples, and the surface is the upper one
    height[k] = b[Math.min(b.length - 1, Math.floor(b.length * (o.percentile == null ? 0.8 : o.percentile)))];
    filled[k] = 1;
    rgb[k * 4] = cr[k] / cc[k]; rgb[k * 4 + 1] = cg[k] / cc[k]; rgb[k * 4 + 2] = cb[k] / cc[k]; rgb[k * 4 + 3] = 255;
  }
  // hole filling from neighbours, limited passes so large gaps stay holes
  const passes = o.fillPasses == null ? 3 : o.fillPasses;
  const solid = Uint8Array.from(filled);
  for (let p = 0; p < passes; p++) {
    const add = [];
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const k = y * gw + x;
      if (filled[k]) continue;
      let hs = 0, r = 0, g = 0, b = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || xx < 0 || yy >= gh || xx >= gw) continue;
        const kk = yy * gw + xx;
        if (!filled[kk]) continue;
        hs += height[kk]; r += rgb[kk * 4]; g += rgb[kk * 4 + 1]; b += rgb[kk * 4 + 2]; c++;
      }
      // never interpolate across a step: that is what produces the skirt of
      // triangles hanging off a roof edge
      if (c >= 3) {
        let spread = 0, mn = Infinity, mx = -Infinity;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || xx < 0 || yy >= gh || xx >= gw) continue;
          const kk = yy * gw + xx;
          if (!filled[kk]) continue;
          mn = Math.min(mn, height[kk]); mx = Math.max(mx, height[kk]);
        }
        spread = mx - mn;
        if (spread < cell * 6) add.push([k, hs / c, r / c, g / c, b / c]);
      }
    }
    if (!add.length) break;
    for (const [k, hv, r, g, b] of add) {
      height[k] = hv; filled[k] = 1;
      rgb[k * 4] = r; rgb[k * 4 + 1] = g; rgb[k * 4 + 2] = b; rgb[k * 4 + 3] = 200;
    }
  }

  // mesh: one quad per grid cell where all four corners exist
  const index = new Int32Array(gw * gh).fill(-1);
  let nv = 0;
  for (let k = 0; k < gw * gh; k++) if (filled[k]) index[k] = nv++;
  const vpos = new Float32Array(nv * 3), vcol = new Uint8Array(nv * 3);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const k = y * gw + x, vi = index[k];
    if (vi < 0) continue;
    const u = minU + x * cell, v = minV + y * cell, hgt = height[k];
    vpos[vi * 3] = ex[0] * u + ey[0] * v + ux * hgt;
    vpos[vi * 3 + 1] = ex[1] * u + ey[1] * v + uy * hgt;
    vpos[vi * 3 + 2] = ex[2] * u + ey[2] * v + uz * hgt;
    vcol[vi * 3] = rgb[k * 4]; vcol[vi * 3 + 1] = rgb[k * 4 + 1]; vcol[vi * 3 + 2] = rgb[k * 4 + 2];
  }
  const maxJump = o.maxHeightJump || cell * 6;
  const tris = [];
  for (let y = 0; y < gh - 1; y++) for (let x = 0; x < gw - 1; x++) {
    const a = index[y * gw + x], b = index[y * gw + x + 1], c = index[(y + 1) * gw + x], d = index[(y + 1) * gw + x + 1];
    if (a < 0 || b < 0 || c < 0 || d < 0) continue;
    const ha = height[y * gw + x], hb = height[y * gw + x + 1], hc = height[(y + 1) * gw + x], hd = height[(y + 1) * gw + x + 1];
    const span = Math.max(ha, hb, hc, hd) - Math.min(ha, hb, hc, hd);
    if (span > maxJump) continue;                 // cliff between unrelated surfaces
    tris.push(a, c, b, b, c, d);
  }
  const indices = tris.length > 65000 ? Uint32Array.from(tris) : Uint32Array.from(tris);
  return {
    positions: vpos, colors: vcol, indices: indices,
    grid: { w: gw, h: gh, cell: cell, minU: minU, minV: minV, height: height, filled: filled, solid: solid, rgba: rgb },
    basis: { ex: ex, ey: ey, up: [ux, uy, uz] },
    triangles: tris.length / 3,
  };
}

/* ── writers ───────────────────────────────────────────────────────── */

/* binary little-endian PLY; pass indices for a mesh, omit for a point cloud */
export function exportPLY(positions, colors, indices, comment) {
  const nv = positions.length / 3;
  const nf = indices ? indices.length / 3 : 0;
  let header = 'ply\nformat binary_little_endian 1.0\n';
  header += 'comment ' + (comment || 'Sunrise Construction photogrammetry') + '\n';
  header += 'element vertex ' + nv + '\nproperty float x\nproperty float y\nproperty float z\n';
  header += 'property uchar red\nproperty uchar green\nproperty uchar blue\n';
  if (nf) header += 'element face ' + nf + '\nproperty list uchar uint vertex_indices\n';
  header += 'end_header\n';
  const headerBytes = new TextEncoder().encode(header);
  const vertBytes = nv * 15;                       // 3 float32 + 3 uint8
  const faceBytes = nf * 13;                       // uchar count + 3 uint32
  const buf = new ArrayBuffer(headerBytes.length + vertBytes + faceBytes);
  const u8 = new Uint8Array(buf);
  u8.set(headerBytes, 0);
  const dv = new DataView(buf);
  let p = headerBytes.length;
  for (let i = 0; i < nv; i++) {
    dv.setFloat32(p, positions[i * 3], true);
    dv.setFloat32(p + 4, positions[i * 3 + 1], true);
    dv.setFloat32(p + 8, positions[i * 3 + 2], true);
    u8[p + 12] = colors ? colors[i * 3] : 200;
    u8[p + 13] = colors ? colors[i * 3 + 1] : 200;
    u8[p + 14] = colors ? colors[i * 3 + 2] : 200;
    p += 15;
  }
  for (let i = 0; i < nf; i++) {
    u8[p] = 3;
    dv.setUint32(p + 1, indices[i * 3], true);
    dv.setUint32(p + 5, indices[i * 3 + 1], true);
    dv.setUint32(p + 9, indices[i * 3 + 2], true);
    p += 13;
  }
  return buf;
}

/* glTF 2.0 binary. Vertex colours as normalised ubyte VEC4 (4-byte aligned as
   the spec requires); points use KHR_materials_unlit so they render flat. */
export function exportGLB(positions, colors, indices, meta) {
  const nv = positions.length / 3;
  const isMesh = !!(indices && indices.length);
  const pad4 = (x) => (x + 3) & ~3;

  const posBytes = nv * 12;
  const colBytes = nv * 4;
  const idxBytes = isMesh ? indices.length * 4 : 0;
  const binLen = pad4(posBytes) + pad4(colBytes) + pad4(idxBytes);
  const bin = new ArrayBuffer(binLen);
  const binF32 = new Float32Array(bin, 0, nv * 3);
  binF32.set(positions);
  const colOff = pad4(posBytes);
  const binU8 = new Uint8Array(bin);
  for (let i = 0; i < nv; i++) {
    binU8[colOff + i * 4] = colors ? colors[i * 3] : 200;
    binU8[colOff + i * 4 + 1] = colors ? colors[i * 3 + 1] : 200;
    binU8[colOff + i * 4 + 2] = colors ? colors[i * 3 + 2] : 200;
    binU8[colOff + i * 4 + 3] = 255;
  }
  const idxOff = colOff + pad4(colBytes);
  if (isMesh) new Uint32Array(bin, idxOff, indices.length).set(indices);

  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < nv; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const bufferViews = [
    { buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962 },
    { buffer: 0, byteOffset: colOff, byteLength: colBytes, target: 34962 },
  ];
  const accessors = [
    { bufferView: 0, componentType: 5126, count: nv, type: 'VEC3', min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    { bufferView: 1, componentType: 5121, normalized: true, count: nv, type: 'VEC4' },
  ];
  const attributes = { POSITION: 0, COLOR_0: 1 };
  const primitive = { attributes: attributes, mode: isMesh ? 4 : 0, material: 0 };
  if (isMesh) {
    bufferViews.push({ buffer: 0, byteOffset: idxOff, byteLength: idxBytes, target: 34963 });
    accessors.push({ bufferView: 2, componentType: 5125, count: indices.length, type: 'SCALAR' });
    primitive.indices = 2;
  }
  const gltf = {
    asset: { version: '2.0', generator: 'Sunrise Photogrammetry', ...(meta ? { extras: meta } : {}) },
    extensionsUsed: ['KHR_materials_unlit'],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [primitive] }],
    materials: [{
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 },
      doubleSided: true,
      ...(isMesh ? {} : { extensions: { KHR_materials_unlit: {} } }),
    }],
    bufferViews: bufferViews,
    accessors: accessors,
    buffers: [{ byteLength: binLen }],
  };
  let json = JSON.stringify(gltf);
  while (json.length % 4 !== 0) json += ' ';
  const jsonBytes = new TextEncoder().encode(json);
  const total = 12 + 8 + jsonBytes.length + 8 + binLen;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out), u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546c67, true);              // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true);             // 'JSON'
  u8.set(jsonBytes, 20);
  dv.setUint32(20 + jsonBytes.length, binLen, true);
  dv.setUint32(24 + jsonBytes.length, 0x004e4942, true);  // 'BIN'
  u8.set(new Uint8Array(bin), 28 + jsonBytes.length);
  return out;
}

/* Wavefront OBJ with per-vertex colours (an extension most tools read) */
export function exportOBJ(positions, colors, indices, name) {
  const nv = positions.length / 3;
  const lines = ['# ' + (name || 'Sunrise Construction photogrammetry'), '# ' + nv + ' vertices'];
  for (let i = 0; i < nv; i++) {
    const c = colors ? [colors[i * 3] / 255, colors[i * 3 + 1] / 255, colors[i * 3 + 2] / 255] : [0.8, 0.8, 0.8];
    lines.push('v ' + positions[i * 3].toFixed(4) + ' ' + positions[i * 3 + 1].toFixed(4) + ' ' + positions[i * 3 + 2].toFixed(4)
      + ' ' + c[0].toFixed(3) + ' ' + c[1].toFixed(3) + ' ' + c[2].toFixed(3));
  }
  if (indices) for (let i = 0; i < indices.length; i += 3) {
    lines.push('f ' + (indices[i] + 1) + ' ' + (indices[i + 1] + 1) + ' ' + (indices[i + 2] + 1));
  }
  return lines.join('\n') + '\n';
}
