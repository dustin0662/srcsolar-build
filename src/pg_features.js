/* pg_features.js — multi-scale FAST keypoints with rotated BRIEF descriptors
   (an ORB-style detector) plus binary matching. Pure typed-array code: it
   runs in the reconstruction worker and in node tests. */

import { makeRng } from './pg_math.js';

/* ── image helpers ─────────────────────────────────────────────────── */

/* RGBA bytes → luminance Float32Array (0..255) */
export function toGray(rgba, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  return g;
}

/* bilinear resample to an arbitrary size */
export function resample(src, sw, sh, dw, dh) {
  const out = new Float32Array(dw * dh);
  const rx = sw / dw, ry = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1.001, (y + 0.5) * ry - 0.5);
    const y0 = Math.max(0, Math.floor(sy)), fy = sy - y0, y1 = Math.min(sh - 1, y0 + 1);
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1.001, (x + 0.5) * rx - 0.5);
      const x0 = Math.max(0, Math.floor(sx)), fx = sx - x0, x1 = Math.min(sw - 1, x0 + 1);
      const a = src[y0 * sw + x0], b = src[y0 * sw + x1], c = src[y1 * sw + x0], d = src[y1 * sw + x1];
      out[y * dw + x] = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
    }
  }
  return out;
}

/* area-average downsample — used where the ratio is large enough that
   point-sampling would alias (thumbnails, signatures, ortho rasters) */
export function boxDownsample(src, sw, sh, dw, dh) {
  const out = new Float32Array(dw * dh);
  const rx = sw / dw, ry = sh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * ry), y1 = Math.max(y0 + 1, Math.floor((y + 1) * ry));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * rx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * rx));
      let s = 0, n = 0;
      for (let yy = y0; yy < y1 && yy < sh; yy++) for (let xx = x0; xx < x1 && xx < sw; xx++) { s += src[yy * sw + xx]; n++; }
      out[y * dw + x] = n ? s / n : 0;
    }
  }
  return out;
}

/* separable 5-tap Gaussian (σ ≈ 1) */
export function blur5(src, w, h) {
  const k = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -2; i <= 2; i++) { const xx = Math.min(w - 1, Math.max(0, x + i)); s += src[y * w + xx] * k[i + 2]; }
    tmp[y * w + x] = s;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -2; i <= 2; i++) { const yy = Math.min(h - 1, Math.max(0, y + i)); s += tmp[yy * w + x] * k[i + 2]; }
    out[y * w + x] = s;
  }
  return out;
}

/* ── FAST-9 corner detection ───────────────────────────────────────── */

const CIRCLE = [ // 16-point Bresenham circle, clockwise from top
  [0, -3], [1, -3], [2, -2], [3, -1], [3, 0], [3, 1], [2, 2], [1, 3],
  [0, 3], [-1, 3], [-2, 2], [-3, 1], [-3, 0], [-3, -1], [-2, -2], [-1, -3],
];

function fastCorners(img, w, h, thresh, out) {
  const off = CIRCLE.map(([dx, dy]) => dy * w + dx);
  const b = 4;
  for (let y = b; y < h - b; y++) {
    for (let x = b; x < w - b; x++) {
      const i = y * w + x, p = img[i];
      const hi = p + thresh, lo = p - thresh;
      // quick reject on the four compass points
      const p0 = img[i + off[0]], p8 = img[i + off[8]], p4 = img[i + off[4]], p12 = img[i + off[12]];
      let cntHi = (p0 > hi ? 1 : 0) + (p8 > hi ? 1 : 0) + (p4 > hi ? 1 : 0) + (p12 > hi ? 1 : 0);
      let cntLo = (p0 < lo ? 1 : 0) + (p8 < lo ? 1 : 0) + (p4 < lo ? 1 : 0) + (p12 < lo ? 1 : 0);
      if (cntHi < 3 && cntLo < 3) continue;
      // full test: 9 contiguous of 16
      let runHi = 0, runLo = 0, bestHi = 0, bestLo = 0;
      for (let k = 0; k < 24; k++) {
        const v = img[i + off[k & 15]];
        if (v > hi) { runHi++; if (runHi > bestHi) bestHi = runHi; } else runHi = 0;
        if (v < lo) { runLo++; if (runLo > bestLo) bestLo = runLo; } else runLo = 0;
        if (bestHi >= 9 || bestLo >= 9) break;
      }
      if (bestHi < 9 && bestLo < 9) continue;
      out.push(i);
    }
  }
  return out;
}

/* Shi-Tomasi (min eigenvalue) response over a 7×7 window — used to rank
   and non-max-suppress the raw FAST detections */
function shiTomasi(img, w, h, idx) {
  const x0 = idx % w, y0 = (idx / w) | 0;
  if (x0 < 4 || y0 < 4 || x0 >= w - 4 || y0 >= h - 4) return 0;
  let a = 0, bb = 0, c = 0;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const i = (y0 + dy) * w + (x0 + dx);
    const gx = (img[i + 1] - img[i - 1]) * 0.5, gy = (img[i + w] - img[i - w]) * 0.5;
    a += gx * gx; bb += gy * gy; c += gx * gy;
  }
  const tr = a + bb, det = a * bb - c * c;
  const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  return tr / 2 - disc;
}

/* ── BRIEF pattern ─────────────────────────────────────────────────── */

const PATCH = 31, HALF = 15, NBITS = 256;
const PATTERN = (function () {
  // deterministic Gaussian pairs inside the patch (BRIEF-II sampling)
  const rng = makeRng(0x5eed1);
  const p = new Int8Array(NBITS * 4);
  const gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  for (let i = 0; i < NBITS; i++) {
    const clamp = (x) => Math.max(-HALF + 1, Math.min(HALF - 1, Math.round(x)));
    p[i * 4] = clamp(gauss() * PATCH / 5);
    p[i * 4 + 1] = clamp(gauss() * PATCH / 5);
    p[i * 4 + 2] = clamp(gauss() * PATCH / 5);
    p[i * 4 + 3] = clamp(gauss() * PATCH / 5);
  }
  return p;
})();

/* intensity-centroid orientation over a circular patch of radius 15 */
function orientation(img, w, h, x, y) {
  let m01 = 0, m10 = 0;
  for (let dy = -HALF; dy <= HALF; dy++) {
    const yy = y + dy; if (yy < 0 || yy >= h) continue;
    const span = Math.floor(Math.sqrt(HALF * HALF - dy * dy));
    for (let dx = -span; dx <= span; dx++) {
      const xx = x + dx; if (xx < 0 || xx >= w) continue;
      const v = img[yy * w + xx];
      m10 += dx * v; m01 += dy * v;
    }
  }
  return Math.atan2(m01, m10);
}

function describe(img, w, h, x, y, angle, desc, o) {
  const c = Math.cos(angle), s = Math.sin(angle);
  for (let bit = 0; bit < NBITS; bit++) {
    const ax = PATTERN[bit * 4], ay = PATTERN[bit * 4 + 1], bx = PATTERN[bit * 4 + 2], by = PATTERN[bit * 4 + 3];
    let x1 = Math.round(x + c * ax - s * ay), y1 = Math.round(y + s * ax + c * ay);
    let x2 = Math.round(x + c * bx - s * by), y2 = Math.round(y + s * bx + c * by);
    x1 = x1 < 0 ? 0 : x1 >= w ? w - 1 : x1; y1 = y1 < 0 ? 0 : y1 >= h ? h - 1 : y1;
    x2 = x2 < 0 ? 0 : x2 >= w ? w - 1 : x2; y2 = y2 < 0 ? 0 : y2 >= h ? h - 1 : y2;
    if (img[y1 * w + x1] < img[y2 * w + x2]) desc[o + (bit >> 5)] |= (1 << (bit & 31));
  }
}

/* ── detector ──────────────────────────────────────────────────────── */

/* gray: Float32Array luminance, w×h.
   Returns { kps: Float32Array [x,y,…] in level-0 pixels, desc: Uint32Array
   (8 words per keypoint), scales, angles, count } */
export function detectAndDescribe(gray, w, h, opts) {
  const o = opts || {};
  const maxFeatures = o.maxFeatures || 2000;
  const levels = o.levels || 5;
  const factor = o.scaleFactor || 1.25;
  const thresh = o.fastThreshold || 16;
  const gridCols = o.gridCols || 8, gridRows = o.gridRows || 6;

  // per-level feature quota, geometric like ORB
  const weights = [];
  let wsum = 0;
  for (let l = 0; l < levels; l++) { const wt = Math.pow(1 / factor, l * 2); weights.push(wt); wsum += wt; }

  const kpList = [];
  let img = gray, lw = w, lh = h;
  for (let l = 0; l < levels; l++) {
    if (lw < 40 || lh < 40) break;
    const scale = w / lw;                       // level pixel → level-0 pixel
    const quota = Math.max(30, Math.round(maxFeatures * weights[l] / wsum));
    const raw = fastCorners(img, lw, lh, thresh, []);
    if (raw.length) {
      // score + 3×3 non-max suppression
      const scoreMap = new Float32Array(lw * lh);
      const scored = [];
      for (const idx of raw) { const s = shiTomasi(img, lw, lh, idx); scoreMap[idx] = s; scored.push([idx, s]); }
      const kept = [];
      for (const [idx, s] of scored) {
        if (s <= 0) continue;
        const x = idx % lw, y = (idx / lw) | 0;
        let isMax = true;
        for (let dy = -1; dy <= 1 && isMax; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          if (scoreMap[(y + dy) * lw + (x + dx)] > s) { isMax = false; break; }
        }
        if (isMax) kept.push([idx, s]);
      }
      // spatial spread: best-N per grid cell, then global top-up
      const cellW = Math.ceil(lw / gridCols), cellH = Math.ceil(lh / gridRows);
      const cells = new Map();
      for (const k of kept) {
        const x = k[0] % lw, y = (k[0] / lw) | 0;
        const c = ((y / cellH) | 0) * gridCols + ((x / cellW) | 0);
        let arr = cells.get(c); if (!arr) { arr = []; cells.set(c, arr); }
        arr.push(k);
      }
      const perCell = Math.max(3, Math.ceil(quota / (gridCols * gridRows)));
      let picked = [];
      for (const arr of cells.values()) {
        arr.sort((a, b) => b[1] - a[1]);
        picked = picked.concat(arr.slice(0, perCell));
      }
      if (picked.length > quota) { picked.sort((a, b) => b[1] - a[1]); picked = picked.slice(0, quota); }
      const smooth = blur5(img, lw, lh);
      for (const [idx, s] of picked) {
        const x = idx % lw, y = (idx / lw) | 0;
        if (x < HALF + 1 || y < HALF + 1 || x >= lw - HALF - 1 || y >= lh - HALF - 1) continue;
        const ang = orientation(smooth, lw, lh, x, y);
        kpList.push({
          X: (x + 0.5) * scale - 0.5, Y: (y + 0.5) * scale - 0.5,
          ang: ang, scale: scale, score: s,
          lx: x, ly: y, img: smooth, lw: lw, lh: lh,
        });
      }
    }
    const nw = Math.round(lw / factor), nh = Math.round(lh / factor);
    if (nw < 40 || nh < 40) break;
    img = resample(blur5(img, lw, lh), lw, lh, nw, nh);   // pre-blur: anti-alias the pyramid
    lw = nw; lh = nh;
  }

  const n = kpList.length;
  const desc = new Uint32Array(n * 8);
  const kps = new Float32Array(n * 2);
  const angles = new Float32Array(n), scales = new Float32Array(n), scores = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = kpList[i];
    describe(k.img, k.lw, k.lh, k.lx, k.ly, k.ang, desc, i * 8);
    kps[i * 2] = k.X; kps[i * 2 + 1] = k.Y;
    angles[i] = k.ang; scales[i] = k.scale; scores[i] = k.score;
  }
  return { kps: kps, desc: desc, count: n, angles: angles, scales: scales, scores: scores };
}

/* ── matching ──────────────────────────────────────────────────────── */

function popcount(v) {
  v = v - ((v >> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >> 2) & 0x33333333);
  return (((v + (v >> 4)) & 0x0F0F0F0F) * 0x01010101) >> 24;
}

/* brute-force Hamming matching with Lowe ratio test and cross-check.
   Returns Int32Array [iA, iB, iA, iB, …] */
export function matchDescriptors(dA, nA, dB, nB, opts) {
  const o = opts || {};
  const ratio = o.ratio || 0.8;
  const maxDist = o.maxDist || 72;
  const bestB = new Int32Array(nA).fill(-1), bestD = new Int32Array(nA).fill(999);
  const secondD = new Int32Array(nA).fill(999);
  const revBest = new Int32Array(nB).fill(-1), revD = new Int32Array(nB).fill(999);
  for (let i = 0; i < nA; i++) {
    const ai = i * 8;
    const a0 = dA[ai], a1 = dA[ai + 1], a2 = dA[ai + 2], a3 = dA[ai + 3];
    const a4 = dA[ai + 4], a5 = dA[ai + 5], a6 = dA[ai + 6], a7 = dA[ai + 7];
    let b1 = 999, b2 = 999, bi = -1;
    for (let j = 0; j < nB; j++) {
      const bj = j * 8;
      let d = popcount(a0 ^ dB[bj]) + popcount(a1 ^ dB[bj + 1]) + popcount(a2 ^ dB[bj + 2]) + popcount(a3 ^ dB[bj + 3]);
      if (d >= b2) continue;
      d += popcount(a4 ^ dB[bj + 4]) + popcount(a5 ^ dB[bj + 5]) + popcount(a6 ^ dB[bj + 6]) + popcount(a7 ^ dB[bj + 7]);
      if (d < b1) { b2 = b1; b1 = d; bi = j; }
      else if (d < b2) b2 = d;
      if (d < revD[j]) { revD[j] = d; revBest[j] = i; }
    }
    bestB[i] = bi; bestD[i] = b1; secondD[i] = b2;
  }
  const out = [];
  for (let i = 0; i < nA; i++) {
    const j = bestB[i];
    if (j < 0 || bestD[i] > maxDist) continue;
    if (secondD[i] < 999 && bestD[i] > ratio * secondD[i]) continue;
    if (revBest[j] !== i) continue;                   // cross-check
    out.push(i, j);
  }
  return Int32Array.from(out);
}

/* small global signature used to pick which image pairs are worth matching */
export function imageSignature(gray, w, h, size) {
  const s = size || 16;
  const small = boxDownsample(gray, w, h, s, s);
  let mean = 0;
  for (let i = 0; i < small.length; i++) mean += small[i];
  mean /= small.length;
  let sd = 0;
  for (let i = 0; i < small.length; i++) sd += (small[i] - mean) ** 2;
  sd = Math.sqrt(sd / small.length) || 1;
  const sig = new Float32Array(small.length);
  for (let i = 0; i < small.length; i++) sig[i] = (small[i] - mean) / sd;
  return sig;
}

export function signatureScore(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s / a.length;
}
