/* pg_sfm.js — structure from motion: two-view geometry, resection,
   triangulation, bundle refinement and the incremental reconstruction driver.

   Conventions
     • A camera maps a world point X to camera coords Xc = R·X + t.
     • Camera centre C = −Rᵀ·t, viewing direction = third row of R.
     • Image observations are kept in *pixels*; normalised coords are
       x = (u − cx)/f, y = (v − cy)/f, computed on the fly so the focal
       length stays refinable.
   Nothing here touches the DOM — it runs in a worker and in node tests. */

import {
  mat3, eye3, mat3Mul, mat3T, mat3Vec, mat3TVec, mat3Det, mat3Inv, svd, nullVector,
  rodrigues, skew, dot, norm, solveSym, makeRng, median, umeyama,
} from './pg_math.js';

/* ── two-view geometry ─────────────────────────────────────────────── */

/* normalised 8-point algorithm on already camera-normalised points */
export function eightPoint(x1, x2, idx) {
  const n = idx.length;
  if (n < 8) return null;
  // Hartley conditioning
  let m1x = 0, m1y = 0, m2x = 0, m2y = 0;
  for (const k of idx) { m1x += x1[k][0]; m1y += x1[k][1]; m2x += x2[k][0]; m2y += x2[k][1]; }
  m1x /= n; m1y /= n; m2x /= n; m2y /= n;
  let s1 = 0, s2 = 0;
  for (const k of idx) {
    s1 += Math.hypot(x1[k][0] - m1x, x1[k][1] - m1y);
    s2 += Math.hypot(x2[k][0] - m2x, x2[k][1] - m2y);
  }
  s1 = s1 > 1e-12 ? Math.SQRT2 * n / s1 : 1;
  s2 = s2 > 1e-12 ? Math.SQRT2 * n / s2 : 1;
  const A = new Float64Array(n * 9);
  for (let r = 0; r < n; r++) {
    const k = idx[r];
    const u1 = (x1[k][0] - m1x) * s1, v1 = (x1[k][1] - m1y) * s1;
    const u2 = (x2[k][0] - m2x) * s2, v2 = (x2[k][1] - m2y) * s2;
    const o = r * 9;
    A[o] = u2 * u1; A[o + 1] = u2 * v1; A[o + 2] = u2;
    A[o + 3] = v2 * u1; A[o + 4] = v2 * v1; A[o + 5] = v2;
    A[o + 6] = u1; A[o + 7] = v1; A[o + 8] = 1;
  }
  const f = nullVector(A, n, 9);
  let E = mat3(f[0], f[1], f[2], f[3], f[4], f[5], f[6], f[7], f[8]);
  // undo conditioning: E = T2ᵀ · Ê · T1
  const T1 = mat3(s1, 0, -s1 * m1x, 0, s1, -s1 * m1y, 0, 0, 1);
  const T2 = mat3(s2, 0, -s2 * m2x, 0, s2, -s2 * m2y, 0, 0, 1);
  E = mat3Mul(mat3T(T2), mat3Mul(E, T1));
  // enforce the essential-matrix constraint: singular values (1, 1, 0)
  const { U, V } = svd(E, 3, 3);
  const D = mat3(1, 0, 0, 0, 1, 0, 0, 0, 0);
  return mat3Mul(mat3Mul(U, D), mat3T(V));
}

/* squared Sampson distance of a correspondence under E (normalised coords) */
export function sampsonSq(E, p, q) {
  const x1 = [p[0], p[1], 1], x2 = [q[0], q[1], 1];
  const Ex1 = mat3Vec(E, x1), Etx2 = mat3TVec(E, x2);
  const d = x2[0] * Ex1[0] + x2[1] * Ex1[1] + x2[2] * Ex1[2];
  const den = Ex1[0] * Ex1[0] + Ex1[1] * Ex1[1] + Etx2[0] * Etx2[0] + Etx2[1] * Etx2[1];
  return den > 1e-18 ? (d * d) / den : Infinity;
}

/* 4-point DLT homography (used only to detect degenerate/planar pairs) */
export function homography4(x1, x2, idx) {
  const n = idx.length;
  if (n < 4) return null;
  const A = new Float64Array(2 * n * 9);
  for (let r = 0; r < n; r++) {
    const k = idx[r];
    const X = x1[k][0], Y = x1[k][1], u = x2[k][0], v = x2[k][1];
    let o = (2 * r) * 9;
    A[o] = -X; A[o + 1] = -Y; A[o + 2] = -1; A[o + 6] = u * X; A[o + 7] = u * Y; A[o + 8] = u;
    o = (2 * r + 1) * 9;
    A[o + 3] = -X; A[o + 4] = -Y; A[o + 5] = -1; A[o + 6] = v * X; A[o + 7] = v * Y; A[o + 8] = v;
  }
  const h = nullVector(A, 2 * n, 9);
  return mat3(h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], h[8]);
}
function homographyErrSq(H, p, q) {
  const w = H[6] * p[0] + H[7] * p[1] + H[8];
  if (Math.abs(w) < 1e-12) return Infinity;
  const u = (H[0] * p[0] + H[1] * p[1] + H[2]) / w, v = (H[3] * p[0] + H[4] * p[1] + H[5]) / w;
  return (u - q[0]) * (u - q[0]) + (v - q[1]) * (v - q[1]);
}

function adaptiveIters(inlierRatio, sampleSize, conf, cap) {
  const p = Math.max(inlierRatio, 1e-3);
  const num = Math.log(1 - conf), den = Math.log(1 - Math.pow(p, sampleSize));
  if (!isFinite(den) || den >= 0) return cap;
  return Math.min(cap, Math.ceil(num / den));
}

/* RANSAC essential matrix. x1/x2 are arrays of [x,y] in normalised coords;
   `thresh` is the Sampson threshold in the same units (pixels / focal). */
export function essentialRansac(x1, x2, thresh, rng, maxIters) {
  const n = x1.length;
  if (n < 8) return null;
  const t2 = thresh * thresh;
  const all = Array.from({ length: n }, (_, i) => i);
  let best = null, bestCount = 0, iters = maxIters || 900;
  const sample = new Array(8);
  for (let it = 0; it < iters; it++) {
    for (let s = 0; s < 8; s++) {
      let pick, ok;
      do { pick = (rng() * n) | 0; ok = true; for (let q = 0; q < s; q++) if (sample[q] === pick) { ok = false; break; } } while (!ok);
      sample[s] = pick;
    }
    const E = eightPoint(x1, x2, sample);
    if (!E) continue;
    let count = 0;
    for (let i = 0; i < n; i++) if (sampsonSq(E, x1[i], x2[i]) < t2) count++;
    if (count > bestCount) {
      bestCount = count; best = E;
      iters = Math.min(iters, Math.max(30, adaptiveIters(count / n, 8, 0.995, maxIters || 900)));
    }
  }
  if (!best || bestCount < 8) return null;
  // refit on all inliers, twice
  let inliers = [];
  for (let pass = 0; pass < 2; pass++) {
    inliers = [];
    for (let i = 0; i < n; i++) if (sampsonSq(best, x1[i], x2[i]) < t2) inliers.push(i);
    if (inliers.length < 8) break;
    const E2 = eightPoint(x1, x2, inliers);
    if (E2) best = E2;
  }
  inliers = [];
  for (let i = 0; i < n; i++) if (sampsonSq(best, x1[i], x2[i]) < t2) inliers.push(i);
  if (inliers.length < 8) return null;
  return { E: best, inliers: inliers };
}

/* RANSAC homography. Planar scenes (a solar field, a facade, a slab) are
   degenerate for the essential matrix, so this is both the planarity test and
   the fallback initialiser. Returns { H, inliers, count }. */
export function homographyRansac(x1, x2, thresh, rng, maxIters) {
  const n = x1.length;
  if (n < 4) return null;
  const t2 = thresh * thresh;
  let best = null, bestCount = 0, iters = maxIters || 400;
  const sample = new Array(4);
  for (let it = 0; it < iters; it++) {
    for (let s = 0; s < 4; s++) {
      let pick, ok;
      do { pick = (rng() * n) | 0; ok = true; for (let q = 0; q < s; q++) if (sample[q] === pick) { ok = false; break; } } while (!ok);
      sample[s] = pick;
    }
    const H = homography4(x1, x2, sample);
    if (!H) continue;
    let count = 0;
    for (let i = 0; i < n; i++) if (homographyErrSq(H, x1[i], x2[i]) < t2) count++;
    if (count > bestCount) {
      bestCount = count; best = H;
      iters = Math.min(iters, Math.max(20, adaptiveIters(count / n, 4, 0.995, maxIters || 400)));
    }
  }
  if (!best) return null;
  let inliers = [];
  for (let pass = 0; pass < 2; pass++) {
    inliers = [];
    for (let i = 0; i < n; i++) if (homographyErrSq(best, x1[i], x2[i]) < t2) inliers.push(i);
    if (inliers.length < 4) break;
    const H2 = homography4(x1, x2, inliers);
    if (H2) best = H2;
  }
  inliers = [];
  for (let i = 0; i < n; i++) if (homographyErrSq(best, x1[i], x2[i]) < t2) inliers.push(i);
  return { H: best, inliers: inliers, count: inliers.length };
}

/* Faugeras/Malis analytic decomposition of a calibrated homography into the
   eight (R, t, plane-normal) candidates, scored by cheirality, reprojection
   error and parallax. x1/x2 are normalised coords. */
export function decomposeH(H, x1, x2, inliers) {
  const { U, S, V } = svd(H, 3, 3);
  const d1 = S[0], d2 = S[1], d3 = S[2];
  if (!(d1 > 0) || d1 / d2 < 1.00001 || d2 / d3 < 1.00001) return null;
  const Vt = mat3T(V);
  const s = mat3Det(U) * mat3Det(Vt);
  const aux1 = Math.sqrt((d1 * d1 - d2 * d2) / (d1 * d1 - d3 * d3));
  const aux3 = Math.sqrt((d2 * d2 - d3 * d3) / (d1 * d1 - d3 * d3));
  const x1s = [aux1, aux1, -aux1, -aux1], x3s = [aux3, -aux3, aux3, -aux3];
  const cands = [];

  // d′ = d2 (the plane is in front)
  const auxS = Math.sqrt((d1 * d1 - d2 * d2) * (d2 * d2 - d3 * d3)) / ((d1 + d3) * d2);
  const ct = (d2 * d2 + d1 * d3) / ((d1 + d3) * d2);
  const st = [auxS, -auxS, -auxS, auxS];
  for (let i = 0; i < 4; i++) {
    const Rp = mat3(ct, 0, -st[i], 0, 1, 0, st[i], 0, ct);
    const R = mat3Mul(mat3Mul(U, Rp), Vt);
    for (let k = 0; k < 9; k++) R[k] *= s;
    const tp = [x1s[i] * (d1 - d3), 0, -x3s[i] * (d1 - d3)];
    const t = mat3Vec(U, tp);
    const tn = norm(t) || 1;
    let nrm = mat3Vec(V, [x1s[i], 0, x3s[i]]);
    if (nrm[2] < 0) nrm = [-nrm[0], -nrm[1], -nrm[2]];
    cands.push({ R: R, t: [t[0] / tn, t[1] / tn, t[2] / tn], n: nrm });
  }
  // d′ = −d2 (the plane is behind — kept for completeness, filtered by cheirality)
  const auxP = Math.sqrt((d1 * d1 - d2 * d2) * (d2 * d2 - d3 * d3)) / ((d1 - d3) * d2);
  const cp = (d1 * d3 - d2 * d2) / ((d1 - d3) * d2);
  const sp = [auxP, -auxP, -auxP, auxP];
  for (let i = 0; i < 4; i++) {
    const Rp = mat3(cp, 0, sp[i], 0, -1, 0, sp[i], 0, -cp);
    const R = mat3Mul(mat3Mul(U, Rp), Vt);
    for (let k = 0; k < 9; k++) R[k] *= s;
    const tp = [x1s[i] * (d1 + d3), 0, x3s[i] * (d1 + d3)];
    const t = mat3Vec(U, tp);
    const tn = norm(t) || 1;
    let nrm = mat3Vec(V, [x1s[i], 0, x3s[i]]);
    if (nrm[2] < 0) nrm = [-nrm[0], -nrm[1], -nrm[2]];
    cands.push({ R: R, t: [t[0] / tn, t[1] / tn, t[2] / tn], n: nrm });
  }

  const I = eye3(), zero = [0, 0, 0];
  let best = null, second = 0;
  for (const c of cands) {
    let good = 0; const pts = []; const angs = [];
    const cB = cameraCentre(c.R, c.t);
    for (const k of inliers) {
      const X = triangulate([
        { R: I, t: zero, x: x1[k][0], y: x1[k][1] },
        { R: c.R, t: c.t, x: x2[k][0], y: x2[k][1] },
      ]);
      if (!X) { pts.push(null); continue; }
      const p1 = projectNorm(I, zero, X), p2 = projectNorm(c.R, c.t, X);
      if (!p1 || !p2) { pts.push(null); continue; }
      if (Math.hypot(p1[0] - x1[k][0], p1[1] - x1[k][1]) + Math.hypot(p2[0] - x2[k][0], p2[1] - x2[k][1]) > 0.02) { pts.push(null); continue; }
      good++; pts.push(X); angs.push(parallaxAngle([0, 0, 0], cB, X) * 180 / Math.PI);
    }
    if (!best || good > best.good) { second = best ? best.good : 0; best = { R: c.R, t: c.t, n: c.n, good: good, points: pts, parallax: median(angs) }; }
    else if (good > second) second = good;
  }
  if (!best || !best.good) return null;
  best.unique = second === 0 ? 1 : best.good / second;   // >1.1 ⇒ a clear winner
  return best;
}

/* triangulate a point seen by ≥2 cameras.
   views: [{ R, t, x, y }] with x,y normalised. Returns [X,Y,Z] or null. */
export function triangulate(views) {
  const n = views.length;
  if (n < 2) return null;
  const A = new Float64Array(2 * n * 4);
  for (let i = 0; i < n; i++) {
    const v = views[i], R = v.R, t = v.t;
    // rows of P = [R|t]
    const P0 = [R[0], R[1], R[2], t[0]], P1 = [R[3], R[4], R[5], t[1]], P2 = [R[6], R[7], R[8], t[2]];
    for (let c = 0; c < 4; c++) {
      A[(2 * i) * 4 + c] = v.x * P2[c] - P0[c];
      A[(2 * i + 1) * 4 + c] = v.y * P2[c] - P1[c];
    }
  }
  const X = nullVector(A, 2 * n, 4);
  if (Math.abs(X[3]) < 1e-12) return null;
  return [X[0] / X[3], X[1] / X[3], X[2] / X[3]];
}

export function projectNorm(R, t, X) {
  const z = R[6] * X[0] + R[7] * X[1] + R[8] * X[2] + t[2];
  if (z <= 1e-9) return null;
  const x = R[0] * X[0] + R[1] * X[1] + R[2] * X[2] + t[0];
  const y = R[3] * X[0] + R[4] * X[1] + R[5] * X[2] + t[1];
  return [x / z, y / z, z];
}

/* angle (radians) between the two viewing rays of a triangulated point */
export function parallaxAngle(cA, cB, X) {
  const a = [X[0] - cA[0], X[1] - cA[1], X[2] - cA[2]];
  const b = [X[0] - cB[0], X[1] - cB[1], X[2] - cB[2]];
  const na = norm(a), nb = norm(b);
  if (na < 1e-12 || nb < 1e-12) return 0;
  const c = Math.max(-1, Math.min(1, dot(a, b) / (na * nb)));
  return Math.acos(c);
}

export function cameraCentre(R, t) {
  const c = mat3TVec(R, t);
  return [-c[0], -c[1], -c[2]];
}

/* recover (R,t) of the second camera from E — first camera is [I|0].
   Picks the solution with the most points in front of both cameras. */
export function decomposeE(E, x1, x2, inliers) {
  const { U, V } = svd(E, 3, 3);
  let Uu = Float64Array.from(U), Vv = Float64Array.from(V);
  if (mat3Det(Uu) < 0) for (let i = 0; i < 3; i++) Uu[i * 3 + 2] *= -1;
  if (mat3Det(Vv) < 0) for (let i = 0; i < 3; i++) Vv[i * 3 + 2] *= -1;
  const W = mat3(0, -1, 0, 1, 0, 0, 0, 0, 1);
  const R1 = mat3Mul(mat3Mul(Uu, W), mat3T(Vv));
  const R2 = mat3Mul(mat3Mul(Uu, mat3T(W)), mat3T(Vv));
  const u3 = [Uu[2], Uu[5], Uu[8]];
  const cands = [
    { R: R1, t: u3 }, { R: R1, t: [-u3[0], -u3[1], -u3[2]] },
    { R: R2, t: u3 }, { R: R2, t: [-u3[0], -u3[1], -u3[2]] },
  ];
  const I = eye3(), zero = [0, 0, 0];
  let best = null;
  for (const c of cands) {
    let good = 0; const pts = [];
    for (const k of inliers) {
      const X = triangulate([
        { R: I, t: zero, x: x1[k][0], y: x1[k][1] },
        { R: c.R, t: c.t, x: x2[k][0], y: x2[k][1] },
      ]);
      if (!X) { pts.push(null); continue; }
      const p1 = projectNorm(I, zero, X), p2 = projectNorm(c.R, c.t, X);
      if (!p1 || !p2) { pts.push(null); continue; }
      const e1 = Math.hypot(p1[0] - x1[k][0], p1[1] - x1[k][1]);
      const e2 = Math.hypot(p2[0] - x2[k][0], p2[1] - x2[k][1]);
      if (e1 + e2 > 0.02) { pts.push(null); continue; }
      good++; pts.push(X);
    }
    if (!best || good > best.good) best = { R: c.R, t: c.t, good: good, points: pts };
  }
  return best;
}

/* ── resection (PnP) ───────────────────────────────────────────────── */

/* real roots of x⁴ + a x³ + b x² + c x + d (Ferrari, via the resolvent cubic) */
export function solveQuartic(a, b, c, d) {
  const f = (x) => (((x + a) * x + b) * x + c) * x + d;
  const scale = 1 + Math.abs(a) + Math.abs(b) + Math.abs(c) + Math.abs(d);
  // f is quartic, so f′ is cubic: its roots split ℝ into monotone intervals
  // and every real root either brackets a sign change or sits at a turning
  // point (a double root). That makes the search exhaustive and stable, which
  // Ferrari's closed form is not when two roots nearly coincide.
  const crit = cubicRoots(3 * a / 4, b / 2, c / 4).filter((x) => isFinite(x)).sort((u, v) => u - v);
  const bound = 1 + Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
  const pts = [-bound];
  for (const x of crit) if (x > -bound && x < bound) pts.push(x);
  pts.push(bound);
  const roots = [];
  const polish = (x) => {
    for (let i = 0; i < 4; i++) {
      const df = 4 * x * x * x + 3 * a * x * x + 2 * b * x + c;
      if (Math.abs(df) < 1e-13 * scale) break;
      const nx = x - f(x) / df;
      if (!isFinite(nx)) break;
      x = nx;
    }
    return x;
  };
  for (let i = 0; i + 1 < pts.length; i++) {
    let lo = pts[i], hi = pts[i + 1];
    const flo = f(lo), fhi = f(hi);
    if (flo === 0) { roots.push(lo); continue; }
    if ((flo < 0) !== (fhi < 0)) {
      for (let k = 0; k < 90; k++) {
        const mid = (lo + hi) / 2;
        if (mid === lo || mid === hi) break;
        if ((f(mid) < 0) === (flo < 0)) lo = mid; else hi = mid;
      }
      roots.push(polish((lo + hi) / 2));
    }
  }
  // double roots: |f| ≈ 0 at a turning point, no sign change to bracket
  for (const x of crit) {
    const mag = Math.max(1, Math.abs(x));
    if (Math.abs(f(x)) < 1e-8 * scale * mag * mag * mag * mag) {
      if (!roots.some((r) => Math.abs(r - x) < 1e-6 * mag)) roots.push(polish(x));
    }
  }
  return roots;
}

function cross3(u, v) { return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; }

/* real roots of x³ + p x² + q x + r */
export function cubicRoots(p, q, r) {
  const out = [];
  const A = q - p * p / 3, B = (2 * p * p * p - 9 * p * q + 27 * r) / 27;
  const D = B * B / 4 + A * A * A / 27;
  if (D > 1e-14) {
    const sq = Math.sqrt(D);
    out.push(Math.cbrt(-B / 2 + sq) + Math.cbrt(-B / 2 - sq) - p / 3);
  } else if (D > -1e-14) {
    const u = Math.cbrt(-B / 2);
    out.push(2 * u - p / 3, -u - p / 3);
  } else {
    const rr = Math.sqrt(-A * A * A / 27);
    const phi = Math.acos(Math.max(-1, Math.min(1, -B / (2 * rr))));
    const m = 2 * Math.sqrt(-A / 3);
    for (let k = 0; k < 3; k++) out.push(m * Math.cos((phi + 2 * Math.PI * k) / 3) - p / 3);
  }
  return out;
}

/* P3P (Grunert). Three world points and three normalised image points give up
   to four poses. Unlike the DLT this stays valid when the points are coplanar
   — which they almost always are on a solar field or any flat site. */
export function p3p(P, x) {
  const j = x.map((p) => { const n = Math.hypot(p[0], p[1], 1); return [p[0] / n, p[1] / n, 1 / n]; });
  const cosA = dot(j[1], j[2]), cosB = dot(j[0], j[2]), cosG = dot(j[0], j[1]);
  const d = (u, v) => Math.hypot(P[u][0] - P[v][0], P[u][1] - P[v][1], P[u][2] - P[v][2]);
  const a = d(1, 2), b = d(0, 2), c = d(0, 1);
  if (a < 1e-9 || b < 1e-9 || c < 1e-9) return [];
  // near-collinear triples are degenerate for P3P — skip rather than emit a
  // pose that only looks plausible
  const e1 = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]];
  const e2 = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
  const area = norm(cross3(e1, e2));
  if (area < 0.02 * b * c) return [];
  const ap = (a * a) / (b * b), cp = (c * c) / (b * b);
  const cosA2 = cosA * cosA, cosB2 = cosB * cosB, cosG2 = cosG * cosG;
  const A4 = Math.pow(ap - cp - 1, 2) - 4 * cp * cosA2;
  if (Math.abs(A4) < 1e-14) return [];
  const A3 = 4 * ((ap - cp) * (1 - ap + cp) * cosB - (1 - ap - cp) * cosA * cosG + 2 * cp * cosA2 * cosB);
  const A2 = 2 * (Math.pow(ap - cp, 2) - 1 + 2 * Math.pow(ap - cp, 2) * cosB2 + 2 * (1 - cp) * cosA2
    - 4 * (ap + cp) * cosA * cosB * cosG + 2 * (1 - ap) * cosG2);
  const A1 = 4 * (-(ap - cp) * (1 + ap - cp) * cosB + 2 * ap * cosG2 * cosB - (1 - ap - cp) * cosA * cosG);
  const A0 = Math.pow(1 + ap - cp, 2) - 4 * ap * cosG2;
  const vs = solveQuartic(A3 / A4, A2 / A4, A1 / A4, A0 / A4);
  const out = [];
  const seen = [];
  for (const v of vs) {
    if (!isFinite(v) || v <= 0) continue;
    // u from the closed form, plus both branches of the c-equation. The closed
    // form loses all precision when (cosγ − v·cosα) → 0, which happens in
    // exactly the near-nadir geometry a drone flight produces.
    const K = 1 + v * v - 2 * v * cosB;
    const cand = [];
    const den = 2 * (cosG - v * cosA);
    if (Math.abs(den) > 1e-9) cand.push(((-1 + ap - cp) * v * v + 2 * (cp - ap) * cosB * v + 1 + ap - cp) / den);
    const disc = cosG2 - 1 + cp * K;
    if (disc >= 0) { const sq = Math.sqrt(disc); cand.push(cosG + sq, cosG - sq); }
    for (const u of cand) {
      if (!isFinite(u) || u <= 0) continue;
      // must also satisfy the a-equation
      if (Math.abs(u * u + v * v - 2 * u * v * cosA - ap * K) > 1e-4 * Math.max(1, ap * K)) continue;
      if (seen.some((s) => Math.abs(s[0] - u) < 1e-7 && Math.abs(s[1] - v) < 1e-7)) continue;
      seen.push([u, v]);
      emit(u, v);
    }
  }
  return out;

  function emit(u, v) {
    const s1sq = (b * b) / (1 + v * v - 2 * v * cosB);
    if (!(s1sq > 0)) return;
    const s1 = Math.sqrt(s1sq), s2 = u * s1, s3 = v * s1;
    const Xc = [
      [j[0][0] * s1, j[0][1] * s1, j[0][2] * s1],
      [j[1][0] * s2, j[1][1] * s2, j[1][2] * s2],
      [j[2][0] * s3, j[2][1] * s3, j[2][2] * s3],
    ];
    const fit = umeyama(P, Xc, false);      // rigid: world → camera
    if (!fit) return;
    out.push({ R: fit.R, t: fit.t });
  }
}

/* Gauss-Newton refinement of a pose against 3D–2D matches (Huber robust) */
export function refinePose(R0, t0, X3, x2, idx, huber, iters) {
  let R = Float64Array.from(R0), t = t0.slice();
  const hub = huber || 0.004;
  for (let it = 0; it < (iters || 12); it++) {
    const H = new Float64Array(36), g = new Float64Array(6);
    let used = 0;
    for (const k of idx) {
      const X = X3[k];
      const Xc = [
        R[0] * X[0] + R[1] * X[1] + R[2] * X[2] + t[0],
        R[3] * X[0] + R[4] * X[1] + R[5] * X[2] + t[1],
        R[6] * X[0] + R[7] * X[1] + R[8] * X[2] + t[2],
      ];
      if (Xc[2] < 1e-6) continue;
      const iz = 1 / Xc[2], px = Xc[0] * iz, py = Xc[1] * iz;
      const rx = px - x2[k][0], ry = py - x2[k][1];
      const rn = Math.hypot(rx, ry);
      const w = rn > hub ? hub / rn : 1;
      // d(px,py)/dXc
      const j0 = [iz, 0, -px * iz], j1 = [0, iz, -py * iz];
      // dXc/d(w) = −[Xc]×  , dXc/d(t) = I   (left increment)
      const Jx = new Float64Array(6), Jy = new Float64Array(6);
      const sx = skew(Xc); // [Xc]×
      for (let c = 0; c < 3; c++) {
        Jx[c] = -(j0[0] * sx[0 * 3 + c] + j0[1] * sx[1 * 3 + c] + j0[2] * sx[2 * 3 + c]);
        Jy[c] = -(j1[0] * sx[0 * 3 + c] + j1[1] * sx[1 * 3 + c] + j1[2] * sx[2 * 3 + c]);
        Jx[3 + c] = j0[c]; Jy[3 + c] = j1[c];
      }
      for (let a = 0; a < 6; a++) {
        g[a] -= w * (Jx[a] * rx + Jy[a] * ry);
        for (let b = 0; b < 6; b++) H[a * 6 + b] += w * (Jx[a] * Jx[b] + Jy[a] * Jy[b]);
      }
      used++;
    }
    if (used < 4) break;
    const d = solveSym(H, g, 6, 1e-6);
    if (!d) break;
    const dR = rodrigues([d[0], d[1], d[2]]);
    R = mat3Mul(dR, R);
    const tn = mat3Vec(dR, t);
    t = [tn[0] + d[3], tn[1] + d[4], tn[2] + d[5]];
    if (Math.hypot(d[0], d[1], d[2], d[3], d[4], d[5]) < 1e-10) break;
  }
  return { R: R, t: t };
}

export function pnpRansac(X3, x2, thresh, rng, maxIters) {
  const n = X3.length;
  if (n < 4) return null;
  const t2 = thresh * thresh;
  let best = null, bestCount = 0, iters = maxIters || 500;
  const sample = new Array(3);
  for (let it = 0; it < iters; it++) {
    for (let s = 0; s < 3; s++) {
      let pick, ok;
      do { pick = (rng() * n) | 0; ok = true; for (let q = 0; q < s; q++) if (sample[q] === pick) { ok = false; break; } } while (!ok);
      sample[s] = pick;
    }
    const poses = p3p([X3[sample[0]], X3[sample[1]], X3[sample[2]]], [x2[sample[0]], x2[sample[1]], x2[sample[2]]]);
    for (const pose of poses) {
      let count = 0;
      for (let i = 0; i < n; i++) {
        const p = projectNorm(pose.R, pose.t, X3[i]);
        if (!p) continue;
        const dx = p[0] - x2[i][0], dy = p[1] - x2[i][1];
        if (dx * dx + dy * dy < t2) count++;
      }
      if (count > bestCount) {
        bestCount = count; best = pose;
        iters = Math.min(iters, Math.max(30, adaptiveIters(count / n, 3, 0.995, maxIters || 500)));
      }
    }
  }
  if (!best || bestCount < 5) return null;
  let inliers = [];
  for (let pass = 0; pass < 3; pass++) {
    inliers = [];
    for (let i = 0; i < n; i++) {
      const p = projectNorm(best.R, best.t, X3[i]);
      if (!p) continue;
      const dx = p[0] - x2[i][0], dy = p[1] - x2[i][1];
      if (dx * dx + dy * dy < t2) inliers.push(i);
    }
    if (inliers.length < 5) return null;
    best = refinePose(best.R, best.t, X3, x2, inliers, thresh, 8);
  }
  return { R: best.R, t: best.t, inliers: inliers };
}

/* ── bundle refinement (alternating cameras / points / focal) ───────── */

/* Refine one 3D point against its observations. obs: [{R,t,x,y}] */
export function refinePoint(X0, obs, huber, iters) {
  let X = X0.slice();
  const hub = huber || 0.004;
  for (let it = 0; it < (iters || 6); it++) {
    const H = new Float64Array(9), g = new Float64Array(3);
    let used = 0;
    for (const o of obs) {
      const R = o.R, t = o.t;
      const Xc = [
        R[0] * X[0] + R[1] * X[1] + R[2] * X[2] + t[0],
        R[3] * X[0] + R[4] * X[1] + R[5] * X[2] + t[1],
        R[6] * X[0] + R[7] * X[1] + R[8] * X[2] + t[2],
      ];
      if (Xc[2] < 1e-6) continue;
      const iz = 1 / Xc[2], px = Xc[0] * iz, py = Xc[1] * iz;
      const rx = px - o.x, ry = py - o.y;
      const rn = Math.hypot(rx, ry);
      const w = rn > hub ? hub / rn : 1;
      const j0 = [iz, 0, -px * iz], j1 = [0, iz, -py * iz];
      const Jx = new Float64Array(3), Jy = new Float64Array(3);
      for (let c = 0; c < 3; c++) {
        Jx[c] = j0[0] * R[0 * 3 + c] + j0[1] * R[1 * 3 + c] + j0[2] * R[2 * 3 + c];
        Jy[c] = j1[0] * R[0 * 3 + c] + j1[1] * R[1 * 3 + c] + j1[2] * R[2 * 3 + c];
      }
      for (let a = 0; a < 3; a++) {
        g[a] -= w * (Jx[a] * rx + Jy[a] * ry);
        for (let b = 0; b < 3; b++) H[a * 3 + b] += w * (Jx[a] * Jx[b] + Jy[a] * Jy[b]);
      }
      used++;
    }
    if (used < 2) break;
    const d = solveSym(H, g, 3, 1e-8);
    if (!d) break;
    X = [X[0] + d[0], X[1] + d[1], X[2] + d[2]];
    if (Math.hypot(d[0], d[1], d[2]) < 1e-12) break;
  }
  return X;
}

/* Block-coordinate bundle adjustment.
   cams:   [{R,t,fixed?}]
   points: [{X, obs:[{cam, x, y}]}]   (x,y normalised)
   Returns mean reprojection error in normalised units. */
export function bundleAdjust(cams, points, opts) {
  const o = opts || {};
  const rounds = o.rounds || 3;
  const huber = o.huber || 0.004;
  for (let r = 0; r < rounds; r++) {
    // points
    for (const p of points) {
      if (p.obs.length < 2) continue;
      const obs = p.obs.map((ob) => ({ R: cams[ob.cam].R, t: cams[ob.cam].t, x: ob.x, y: ob.y }));
      p.X = refinePoint(p.X, obs, huber, 4);
    }
    // cameras
    const byCam = new Map();
    for (let pi = 0; pi < points.length; pi++) for (const ob of points[pi].obs) {
      let a = byCam.get(ob.cam); if (!a) { a = []; byCam.set(ob.cam, a); }
      a.push({ X: points[pi].X, x: ob.x, y: ob.y });
    }
    for (const [ci, list] of byCam) {
      if (cams[ci].fixed || list.length < 6) continue;
      const X3 = list.map((l) => l.X), x2 = list.map((l) => [l.x, l.y]);
      const idx = Array.from({ length: list.length }, (_, i) => i);
      const res = refinePose(cams[ci].R, cams[ci].t, X3, x2, idx, huber, 6);
      cams[ci].R = res.R; cams[ci].t = res.t;
    }
  }
  return meanReprojError(cams, points);
}

/* Levenberg–Marquardt bundle adjustment with the Schur complement.
   Optimises all free camera poses, all 3D points and (optionally) a single
   shared scale on the focal lengths. Residuals are in pixels so the Huber
   threshold is meaningful and the focal derivative is well conditioned.

   cams:   [{R,t,fixed}] (null entries are skipped)
   points: [{X, obs:[{cam,x,y}]}] with x,y in normalised coords
   opts:   { focals: number[] per camera (px), refineFocal, huberPx, iters }
   Returns { k, reprojPx, iters } — k is the focal scale that was found. */
export function bundleAdjustLM(cams, points, opts) {
  const o = opts || {};
  const focals = o.focals;
  const refineF = !!o.refineFocal;
  const hub = o.huberPx || 2.5;
  const maxIters = o.iters || 12;

  const camIndex = new Int32Array(cams.length).fill(-1);
  let nFree = 0;
  for (let i = 0; i < cams.length; i++) if (cams[i] && !cams[i].fixed) camIndex[i] = nFree++;
  const m = 6 * nFree + (refineF ? 1 : 0);
  if (m === 0 || !points.length) return { k: 1, reprojPx: meanReprojError(cams, points) * (focals ? focals[0] : 1), iters: 0 };
  const fIdx = 6 * nFree;
  let k = 1;

  // per-observation scratch, sized once
  let nObs = 0;
  for (const p of points) nObs += p.obs.length;
  const Wbuf = new Float64Array(nObs * 18);       // 6×3 camera↔point blocks
  const WFbuf = new Float64Array(nObs * 3);       // 1×3 focal↔point blocks

  function cost(camsIn, ptsIn, kIn) {
    let c = 0;
    for (const p of ptsIn) for (const ob of p.obs) {
      const cam = camsIn[ob.cam]; if (!cam) continue;
      const pr = projectNorm(cam.R, cam.t, p.X);
      const f = focals ? focals[ob.cam] : 1;
      if (!pr) { c += hub * hub; continue; }
      const rx = f * (kIn * pr[0] - ob.x), ry = f * (kIn * pr[1] - ob.y);
      const rn = Math.hypot(rx, ry);
      c += rn <= hub ? rn * rn : hub * (2 * rn - hub);
    }
    return c;
  }

  let lambda = 1e-3;
  let cur = cost(cams, points, k);
  let done = 0;
  for (let iter = 0; iter < maxIters; iter++) {
    Wbuf.fill(0); WFbuf.fill(0);
    const A = new Float64Array(m * m), g = new Float64Array(m);
    const Vs = new Float64Array(points.length * 9), gPs = new Float64Array(points.length * 3);
    let obPtr = 0;
    const obsStart = new Int32Array(points.length + 1);

    for (let pi = 0; pi < points.length; pi++) {
      const p = points[pi];
      obsStart[pi] = obPtr;
      for (let oi = 0; oi < p.obs.length; oi++) {
        const ob = p.obs[oi], cam = cams[ob.cam];
        const wOff = obPtr * 18, wfOff = obPtr * 3;
        obPtr++;
        if (!cam) continue;
        const R = cam.R, t = cam.t, X = p.X;
        const Xc = [
          R[0] * X[0] + R[1] * X[1] + R[2] * X[2] + t[0],
          R[3] * X[0] + R[4] * X[1] + R[5] * X[2] + t[1],
          R[6] * X[0] + R[7] * X[1] + R[8] * X[2] + t[2],
        ];
        if (Xc[2] < 1e-7) continue;
        const iz = 1 / Xc[2], px = Xc[0] * iz, py = Xc[1] * iz;
        const f = focals ? focals[ob.cam] : 1, F = f * k;
        const rx = F * px - f * ob.x, ry = F * py - f * ob.y;
        const rn = Math.hypot(rx, ry);
        const w = rn > hub ? hub / rn : 1;
        // d(px,py)/dXc
        const a0 = [iz, 0, -px * iz], a1 = [0, iz, -py * iz];
        // point jacobian (2×3): F · d(px,py)/dXc · R
        const JPx = new Float64Array(3), JPy = new Float64Array(3);
        for (let c = 0; c < 3; c++) {
          JPx[c] = F * (a0[0] * R[c] + a0[1] * R[3 + c] + a0[2] * R[6 + c]);
          JPy[c] = F * (a1[0] * R[c] + a1[1] * R[3 + c] + a1[2] * R[6 + c]);
        }
        // point normal equations
        const vOff = pi * 9, gOff = pi * 3;
        for (let a = 0; a < 3; a++) {
          gPs[gOff + a] -= w * (JPx[a] * rx + JPy[a] * ry);
          for (let b = 0; b < 3; b++) Vs[vOff + a * 3 + b] += w * (JPx[a] * JPx[b] + JPy[a] * JPy[b]);
        }
        // camera jacobian (2×6)
        const ci = camIndex[ob.cam];
        let JCx = null, JCy = null;
        if (ci >= 0) {
          JCx = new Float64Array(6); JCy = new Float64Array(6);
          const sx = skew(Xc);
          for (let c = 0; c < 3; c++) {
            JCx[c] = -F * (a0[0] * sx[c] + a0[1] * sx[3 + c] + a0[2] * sx[6 + c]);
            JCy[c] = -F * (a1[0] * sx[c] + a1[1] * sx[3 + c] + a1[2] * sx[6 + c]);
            JCx[3 + c] = F * a0[c]; JCy[3 + c] = F * a1[c];
          }
          const base = ci * 6;
          for (let a = 0; a < 6; a++) {
            g[base + a] -= w * (JCx[a] * rx + JCy[a] * ry);
            for (let b = 0; b < 6; b++) A[(base + a) * m + base + b] += w * (JCx[a] * JCx[b] + JCy[a] * JCy[b]);
            for (let b = 0; b < 3; b++) Wbuf[wOff + a * 3 + b] += w * (JCx[a] * JPx[b] + JCy[a] * JPy[b]);
          }
        }
        // focal jacobian (2×1): d r/d k = f · (px, py)
        if (refineF) {
          const JFx = f * px, JFy = f * py;
          g[fIdx] -= w * (JFx * rx + JFy * ry);
          A[fIdx * m + fIdx] += w * (JFx * JFx + JFy * JFy);
          for (let b = 0; b < 3; b++) WFbuf[wfOff + b] += w * (JFx * JPx[b] + JFy * JPy[b]);
          if (ci >= 0) {
            const base = ci * 6;
            for (let a = 0; a < 6; a++) {
              const v = w * (JCx[a] * JFx + JCy[a] * JFy);
              A[(base + a) * m + fIdx] += v; A[fIdx * m + base + a] += v;
            }
          }
        }
      }
    }
    obsStart[points.length] = obPtr;

    /* damped Schur complement */
    let stepTaken = false;
    for (let attempt = 0; attempt < 6 && !stepTaken; attempt++) {
      const S = Float64Array.from(A), gs = Float64Array.from(g);
      for (let i = 0; i < m; i++) S[i * m + i] += lambda * (1 + S[i * m + i]);
      const Vinv = new Float64Array(points.length * 9);
      const ok = new Uint8Array(points.length);
      for (let pi = 0; pi < points.length; pi++) {
        const vOff = pi * 9;
        const Vd = mat3(
          Vs[vOff] * (1 + lambda), Vs[vOff + 1], Vs[vOff + 2],
          Vs[vOff + 3], Vs[vOff + 4] * (1 + lambda), Vs[vOff + 5],
          Vs[vOff + 6], Vs[vOff + 7], Vs[vOff + 8] * (1 + lambda)
        );
        for (let d = 0; d < 3; d++) Vd[d * 4] += 1e-9;
        const inv = mat3Inv(Vd);
        if (!inv) continue;
        ok[pi] = 1; Vinv.set(inv, vOff);
      }
      // S ← S − Σ_p B_p V⁻¹ B_pᵀ ,  gs ← gs − Σ_p B_p V⁻¹ g_p
      const rows = [];   // reused per point: [{start, len, blockOffset}]
      for (let pi = 0; pi < points.length; pi++) {
        if (!ok[pi]) continue;
        const p = points[pi], vOff = pi * 9, gOff = pi * 3;
        rows.length = 0;
        for (let oi = 0; oi < p.obs.length; oi++) {
          const ob = p.obs[oi];
          const ci = cams[ob.cam] ? camIndex[ob.cam] : -1;
          if (ci >= 0) rows.push({ start: ci * 6, len: 6, off: (obsStart[pi] + oi) * 18, focal: false });
          if (refineF) rows.push({ start: fIdx, len: 1, off: (obsStart[pi] + oi) * 3, focal: true });
        }
        if (!rows.length) continue;
        // Y_r = B_r · V⁻¹   (len×3)
        const Ys = rows.map((r) => {
          const Y = new Float64Array(r.len * 3);
          const src = r.focal ? WFbuf : Wbuf;
          for (let a = 0; a < r.len; a++) for (let b = 0; b < 3; b++) {
            let s = 0;
            for (let c = 0; c < 3; c++) s += src[r.off + a * 3 + c] * Vinv[vOff + c * 3 + b];
            Y[a * 3 + b] = s;
          }
          return Y;
        });
        for (let ri = 0; ri < rows.length; ri++) {
          const r = rows[ri], Y = Ys[ri];
          for (let a = 0; a < r.len; a++) {
            let s = 0;
            for (let c = 0; c < 3; c++) s += Y[a * 3 + c] * gPs[gOff + c];
            gs[r.start + a] -= s;
          }
          for (let rj = 0; rj < rows.length; rj++) {
            const q = rows[rj], src = q.focal ? WFbuf : Wbuf;
            for (let a = 0; a < r.len; a++) for (let b = 0; b < q.len; b++) {
              let s = 0;
              for (let c = 0; c < 3; c++) s += Y[a * 3 + c] * src[q.off + b * 3 + c];
              S[(r.start + a) * m + q.start + b] -= s;
            }
          }
        }
      }
      const dCam = solveSym(S, gs, m, 0);
      if (!dCam) { lambda *= 10; continue; }
      // back-substitute the point updates
      const newCams = cams.map((c) => (c ? { R: Float64Array.from(c.R), t: c.t.slice(), fixed: c.fixed } : null));
      const kNew = refineF ? k + dCam[fIdx] : k;
      for (let i = 0; i < cams.length; i++) {
        const ci = camIndex[i]; if (ci < 0) continue;
        const b = ci * 6;
        const dR = rodrigues([dCam[b], dCam[b + 1], dCam[b + 2]]);
        newCams[i].R = mat3Mul(dR, cams[i].R);
        const tn = mat3Vec(dR, cams[i].t);
        newCams[i].t = [tn[0] + dCam[b + 3], tn[1] + dCam[b + 4], tn[2] + dCam[b + 5]];
      }
      const newPts = new Array(points.length);
      for (let pi = 0; pi < points.length; pi++) {
        const p = points[pi];
        if (!ok[pi]) { newPts[pi] = { X: p.X.slice(), obs: p.obs }; continue; }
        const vOff = pi * 9, gOff = pi * 3;
        const rhs = [gPs[gOff], gPs[gOff + 1], gPs[gOff + 2]];
        for (let oi = 0; oi < p.obs.length; oi++) {
          const ob = p.obs[oi];
          const ci = cams[ob.cam] ? camIndex[ob.cam] : -1;
          const off = (obsStart[pi] + oi) * 18;
          if (ci >= 0) for (let b = 0; b < 3; b++) {
            let s = 0;
            for (let a = 0; a < 6; a++) s += Wbuf[off + a * 3 + b] * dCam[ci * 6 + a];
            rhs[b] -= s;
          }
          if (refineF) for (let b = 0; b < 3; b++) rhs[b] -= WFbuf[(obsStart[pi] + oi) * 3 + b] * dCam[fIdx];
        }
        const dX = [
          Vinv[vOff] * rhs[0] + Vinv[vOff + 1] * rhs[1] + Vinv[vOff + 2] * rhs[2],
          Vinv[vOff + 3] * rhs[0] + Vinv[vOff + 4] * rhs[1] + Vinv[vOff + 5] * rhs[2],
          Vinv[vOff + 6] * rhs[0] + Vinv[vOff + 7] * rhs[1] + Vinv[vOff + 8] * rhs[2],
        ];
        newPts[pi] = { X: [p.X[0] + dX[0], p.X[1] + dX[1], p.X[2] + dX[2]], obs: p.obs };
      }
      const nc = cost(newCams, newPts, kNew);
      if (nc < cur && isFinite(nc)) {
        for (let i = 0; i < cams.length; i++) if (cams[i] && newCams[i]) { cams[i].R = newCams[i].R; cams[i].t = newCams[i].t; }
        for (let pi = 0; pi < points.length; pi++) points[pi].X = newPts[pi].X;
        const improve = (cur - nc) / Math.max(cur, 1e-12);
        cur = nc; k = kNew; lambda = Math.max(1e-9, lambda * 0.35); stepTaken = true; done = iter + 1;
        if (improve < 1e-5) iter = maxIters;   // converged
      } else lambda *= 10;
      if (lambda > 1e9) { iter = maxIters; break; }
    }
    if (!stepTaken) break;
  }
  return { k: k, reprojPx: meanReprojError(cams, points) * (focals ? focals[0] * k : 1), iters: done };
}

export function meanReprojError(cams, points) {
  let s = 0, n = 0;
  for (const p of points) for (const ob of p.obs) {
    const pr = projectNorm(cams[ob.cam].R, cams[ob.cam].t, p.X);
    if (!pr) continue;
    s += Math.hypot(pr[0] - ob.x, pr[1] - ob.y); n++;
  }
  return n ? s / n : 0;
}

/* ── track building ────────────────────────────────────────────────── */

/* Union–find over (image, feature) nodes; verified pairwise matches are
   merged into multi-view tracks. Tracks with two features in one image are
   dropped as inconsistent. */
export function buildTracks(featCounts, pairs) {
  const offsets = new Int32Array(featCounts.length + 1);
  for (let i = 0; i < featCounts.length; i++) offsets[i + 1] = offsets[i] + featCounts[i];
  const total = offsets[featCounts.length];
  const parent = new Int32Array(total);
  for (let i = 0; i < total; i++) parent[i] = i;
  function find(a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
  function union(a, b) { a = find(a); b = find(b); if (a !== b) parent[b] = a; }
  for (const pr of pairs) {
    const m = pr.matches;
    for (let k = 0; k < m.length; k += 2) union(offsets[pr.i] + m[k], offsets[pr.j] + m[k + 1]);
  }
  const groups = new Map();
  for (let i = 0; i < total; i++) {
    const r = find(i);
    let g = groups.get(r); if (!g) { g = []; groups.set(r, g); }
    g.push(i);
  }
  const tracks = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const seen = new Set(); let bad = false;
    const members = [];
    for (const node of g) {
      // binary search for the image owning this node
      let lo = 0, hi = featCounts.length - 1, img = 0;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (offsets[mid] <= node) { img = mid; lo = mid + 1; } else hi = mid - 1; }
      if (seen.has(img)) { bad = true; break; }
      seen.add(img);
      members.push([img, node - offsets[img]]);
    }
    if (bad || members.length < 2) continue;
    tracks.push(members);
  }
  return tracks;
}

/* ── incremental reconstruction ────────────────────────────────────── */

/* images: [{ w, h, f, cx, cy, kps: Float32Array [x,y,...] }]
   pairs:  [{ i, j, matches: Int32Array }]  (raw putative matches)
   opts:   { onProgress, thresholdPx, minTrack, seed, refineFocal }
   Returns { cams, points, tracks, stats } — cams[i] is null when an image
   could not be registered. */
export function reconstruct(images, pairs, opts) {
  const o = opts || {};
  const rng = makeRng(o.seed || 12345);
  const report = o.onProgress || function () { };
  const thPx = o.thresholdPx || 3.0;
  const nImg = images.length;

  const focal = (i) => images[i].f;
  const normPt = (i, fi) => {
    const im = images[i];
    return [(im.kps[fi * 2] - im.cx) / im.f, (im.kps[fi * 2 + 1] - im.cy) / im.f];
  };

  /* 1 — geometric verification of every candidate pair */
  const verified = [];
  for (let pi = 0; pi < pairs.length; pi++) {
    const pr = pairs[pi];
    const m = pr.matches;
    const nM = m.length / 2;
    if (nM < 20) continue;
    const x1 = new Array(nM), x2 = new Array(nM);
    for (let k = 0; k < nM; k++) { x1[k] = normPt(pr.i, m[2 * k]); x2[k] = normPt(pr.j, m[2 * k + 1]); }
    const th = thPx / ((focal(pr.i) + focal(pr.j)) / 2);
    const res = essentialRansac(x1, x2, th, rng, 700);
    const hom = homographyRansac(x1, x2, th, rng, 350);
    report('verify', (pi + 1) / pairs.length, 'Verifying pair ' + (pi + 1) + '/' + pairs.length);
    const nE = res ? res.inliers.length : 0, nH = hom ? hom.count : 0;
    if (nE < 25 && nH < 25) continue;
    // Planar scenes — a solar field, a slab, a facade — are degenerate for the
    // essential matrix, so let the homography take over when it explains as
    // much of the data (the ORB-SLAM R_H criterion).
    const planarity = nH / Math.max(1, nE + nH);
    const usesH = planarity > 0.5 || nE < 25;
    let pose = null, inlierIdx = null;
    if (usesH && hom) { pose = decomposeH(hom.H, x1, x2, hom.inliers); inlierIdx = hom.inliers; }
    if (!pose && res) { pose = decomposeE(res.E, x1, x2, res.inliers); inlierIdx = res.inliers; }
    if (!pose || pose.good < 20 || !inlierIdx) continue;
    // median parallax of the reconstructed inliers — a proxy for baseline
    const angles = [];
    const cB = cameraCentre(pose.R, pose.t);
    for (const X of pose.points) if (X) angles.push(parallaxAngle([0, 0, 0], cB, X) * 180 / Math.PI);
    const medAng = median(angles);
    const inl = new Int32Array(inlierIdx.length * 2);
    for (let k = 0; k < inlierIdx.length; k++) { inl[2 * k] = m[2 * inlierIdx[k]]; inl[2 * k + 1] = m[2 * inlierIdx[k] + 1]; }
    verified.push({
      i: pr.i, j: pr.j, matches: inl, count: inlierIdx.length, planarity: planarity,
      parallax: medAng, R: pose.R, t: pose.t, planar: !!usesH,
    });
  }
  if (!verified.length) return { cams: [], points: [], tracks: [], stats: { error: 'no geometrically consistent image pairs' } };

  /* 2 — tracks */
  const featCounts = images.map((im) => im.kps.length / 2);
  const rawTracks = buildTracks(featCounts, verified);
  const minTrack = o.minTrack || 2;
  const tracks = rawTracks.filter((t) => t.length >= minTrack);
  report('tracks', 1, tracks.length + ' feature tracks');

  // index: image → [trackId, featIdx]
  const byImage = Array.from({ length: nImg }, () => new Map());
  for (let ti = 0; ti < tracks.length; ti++) for (const [img, fi] of tracks[ti]) byImage[img].set(fi, ti);

  /* 3 — seed pair: many inliers, healthy parallax, not degenerate/planar */
  const scored = verified.map((v) => {
    let s = v.count;
    if (v.parallax < 2) s *= 0.05;              // pure rotation / tiny baseline
    else if (v.parallax > 25) s *= 0.7;         // very wide → risky triangulation
    if (!v.planar) s *= 1.25;                   // a mild preference, not a veto:
    return { v: v, s: s };                      // planar pairs init from H fine
  }).sort((a, b) => b.s - a.s);
  const seed = scored[0].v;

  const cams = new Array(nImg).fill(null);
  cams[seed.i] = { R: eye3(), t: [0, 0, 0], fixed: true };
  cams[seed.j] = { R: seed.R, t: seed.t, fixed: false };

  const pointOf = new Map();  // trackId → {X, obs:[{cam,x,y}]}
  function obsFor(trackId) {
    const out = [];
    for (const [img, fi] of tracks[trackId]) {
      if (!cams[img]) continue;
      const p = normPt(img, fi);
      out.push({ cam: img, x: p[0], y: p[1] });
    }
    return out;
  }
  function tryTriangulate(trackId, minAngleDeg) {
    const obs = obsFor(trackId);
    if (obs.length < 2) return false;
    const views = obs.map((ob) => ({ R: cams[ob.cam].R, t: cams[ob.cam].t, x: ob.x, y: ob.y }));
    const X = triangulate(views);
    if (!X || !isFinite(X[0] + X[1] + X[2])) return false;
    // parallax between the two most separated observing cameras
    let maxAng = 0;
    for (let a = 0; a < obs.length; a++) for (let b = a + 1; b < obs.length; b++) {
      const ca = cameraCentre(cams[obs[a].cam].R, cams[obs[a].cam].t);
      const cb = cameraCentre(cams[obs[b].cam].R, cams[obs[b].cam].t);
      maxAng = Math.max(maxAng, parallaxAngle(ca, cb, X) * 180 / Math.PI);
    }
    if (maxAng < (minAngleDeg == null ? 1.5 : minAngleDeg)) return false;
    for (const ob of obs) {
      const pr = projectNorm(cams[ob.cam].R, cams[ob.cam].t, X);
      if (!pr) return false;
      const th = thPx * 2 / focal(ob.cam);
      if (Math.hypot(pr[0] - ob.x, pr[1] - ob.y) > th) return false;
    }
    pointOf.set(trackId, { X: X, obs: obs });
    return true;
  }

  // every track seen by the seed pair (tryTriangulate ignores tracks whose
  // other observations belong to cameras that are not placed yet)
  for (const ti of new Set(byImage[seed.i].values())) tryTriangulate(ti, 1.0);
  report('init', 1, 'Seed pair ' + seed.i + '↔' + seed.j + ': ' + pointOf.size + ' points');
  if (pointOf.size < 30) return { cams: [], points: [], tracks: tracks, stats: { error: 'seed pair produced too few 3D points' } };

  /* 4 — grow: repeatedly register the image with the most 3D matches */
  const registered = new Set([seed.i, seed.j]);
  const attempts = new Map();   // image → failed resection attempts (max 2)
  let guard = 0;
  while (registered.size < nImg && guard++ < nImg * 4) {
    let bestImg = -1, bestList = null;
    for (let i = 0; i < nImg; i++) {
      if (registered.has(i) || (attempts.get(i) || 0) >= 2) continue;
      const list = [];
      for (const [fi, ti] of byImage[i]) { const p = pointOf.get(ti); if (p) list.push([p, fi, ti]); }
      if (list.length > (bestList ? bestList.length : 0)) { bestList = list; bestImg = i; }
    }
    if (bestImg < 0 || !bestList || bestList.length < 12) break;
    const X3 = bestList.map((l) => l[0].X);
    const x2 = bestList.map((l) => normPt(bestImg, l[1]));
    const pose = pnpRansac(X3, x2, thPx * 1.5 / focal(bestImg), rng, 400);
    if (!pose || pose.inliers.length < 10) {
      // retry later — more points may make it resectable on a second pass
      attempts.set(bestImg, (attempts.get(bestImg) || 0) + 1);
      report('register', registered.size / nImg, 'Image ' + (bestImg + 1) + ' not placed yet');
      continue;
    }
    cams[bestImg] = { R: pose.R, t: pose.t, fixed: false };
    registered.add(bestImg);
    // extend existing points with the new observation, then triangulate new ones
    for (const [fi, ti] of byImage[bestImg]) {
      const p = pointOf.get(ti);
      if (p) {
        const np = normPt(bestImg, fi);
        const pr = projectNorm(pose.R, pose.t, p.X);
        if (pr && Math.hypot(pr[0] - np[0], pr[1] - np[1]) < thPx * 2 / focal(bestImg)) p.obs.push({ cam: bestImg, x: np[0], y: np[1] });
      } else tryTriangulate(ti, 1.5);
    }
    // local refinement every few images
    if (registered.size % 3 === 0) {
      const pts = [...pointOf.values()];
      bundleAdjust(cams, pts, { rounds: 1, huber: thPx / 600 });
    }
    report('register', registered.size / nImg, 'Placed ' + registered.size + '/' + nImg + ' images, ' + pointOf.size + ' points');
  }

  /* 5 — retriangulate everything now that all poses exist, then global BA */
  for (let ti = 0; ti < tracks.length; ti++) if (!pointOf.has(ti)) tryTriangulate(ti, 1.5);
  let pts = [...pointOf.values()].filter((p) => p.obs.length >= 2);
  report('bundle', 0.2, 'Bundle adjustment on ' + pts.length + ' points');
  const nFree = cams.filter((c) => c && !c.fixed).length;
  const useLM = nFree > 0 && nFree <= (o.maxLMCameras || 200);
  if (useLM) {
    bundleAdjustLM(cams, pts, { focals: images.map((im) => im.f), huberPx: thPx, iters: o.baRounds || 12 });
  } else {
    bundleAdjust(cams, pts, { rounds: o.baRounds || 4, huber: thPx / 600 });
  }

  /* optional shared-focal self-calibration: the focal scale joins the bundle
     as one extra parameter, jointly with every pose and point. (A block
     update on f alone cannot move — a wrong focal still admits a
     self-consistent, merely distorted, reconstruction.) */
  let fScale = 1;
  if (o.refineFocal && useLM && pts.length >= 50) {
    report('focal', 0.3, 'Self-calibrating focal length');
    const lm = bundleAdjustLM(cams, pts, { focals: images.map((im) => im.f), refineFocal: true, huberPx: thPx, iters: 25 });
    if (isFinite(lm.k) && lm.k > 0.3 && lm.k < 3 && Math.abs(lm.k - 1) > 0.002) {
      fScale = lm.k;
      // keep the normalised observations consistent with the new focal
      for (const p of pts) for (const ob of p.obs) { ob.x /= lm.k; ob.y /= lm.k; }
      for (let i = 0; i < nImg; i++) images[i].f *= lm.k;
      report('focal', 1, 'Focal length refined to ' + images[0].f.toFixed(0) + 'px');
    }
  }

  /* 6 — outlier filtering */
  const kept = [];
  for (const p of pts) {
    const obs = [];
    for (const ob of p.obs) {
      const pr = projectNorm(cams[ob.cam].R, cams[ob.cam].t, p.X);
      if (!pr) continue;
      if (Math.hypot(pr[0] - ob.x, pr[1] - ob.y) * focal(ob.cam) < thPx * 2) obs.push(ob);
    }
    if (obs.length >= 2) { p.obs = obs; kept.push(p); }
  }
  pts = kept;
  if (useLM) bundleAdjustLM(cams, pts, { focals: images.map((im) => im.f), huberPx: thPx, iters: 6 });
  else bundleAdjust(cams, pts, { rounds: 2, huber: thPx / 600 });
  const err = meanReprojError(cams, pts);

  const nReg = cams.filter(Boolean).length;
  report('bundle', 1, 'Done: ' + nReg + ' cameras, ' + pts.length + ' points');
  return {
    cams: cams,
    points: pts,
    tracks: tracks,
    stats: {
      registered: nReg,
      total: nImg,
      points: pts.length,
      reprojPx: err * (images[0] ? images[0].f : 1),
      focalScale: fScale,
      verifiedPairs: verified.length,
    },
  };
}
