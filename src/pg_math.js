/* pg_math.js — small dense linear algebra for the photogrammetry pipeline.
   No DOM access: everything here is plain arrays so it can run in a worker
   (and be unit-tested in node). Matrices are row-major Float64Array. */

export function mat3(a, b, c, d, e, f, g, h, i) { return Float64Array.from([a, b, c, d, e, f, g, h, i]); }
export function eye3() { return mat3(1, 0, 0, 0, 1, 0, 0, 0, 1); }

export function matMul(A, B, m, k, n) {
  const C = new Float64Array(m * n);
  for (let i = 0; i < m; i++) for (let p = 0; p < k; p++) {
    const a = A[i * k + p]; if (a === 0) continue;
    for (let j = 0; j < n; j++) C[i * n + j] += a * B[p * n + j];
  }
  return C;
}
export function mat3Mul(A, B) { return matMul(A, B, 3, 3, 3); }
export function matT(A, m, n) {
  const T = new Float64Array(m * n);
  for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) T[j * m + i] = A[i * n + j];
  return T;
}
export function mat3T(A) { return matT(A, 3, 3); }
export function mat3Vec(A, v) {
  return [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
}
export function mat3TVec(A, v) {
  return [A[0] * v[0] + A[3] * v[1] + A[6] * v[2], A[1] * v[0] + A[4] * v[1] + A[7] * v[2], A[2] * v[0] + A[5] * v[1] + A[8] * v[2]];
}
export function mat3Det(A) {
  return A[0] * (A[4] * A[8] - A[5] * A[7]) - A[1] * (A[3] * A[8] - A[5] * A[6]) + A[2] * (A[3] * A[7] - A[4] * A[6]);
}
export function mat3Inv(A) {
  const d = mat3Det(A); if (!isFinite(d) || Math.abs(d) < 1e-300) return null;
  const s = 1 / d;
  return mat3(
    (A[4] * A[8] - A[5] * A[7]) * s, (A[2] * A[7] - A[1] * A[8]) * s, (A[1] * A[5] - A[2] * A[4]) * s,
    (A[5] * A[6] - A[3] * A[8]) * s, (A[0] * A[8] - A[2] * A[6]) * s, (A[2] * A[3] - A[0] * A[5]) * s,
    (A[3] * A[7] - A[4] * A[6]) * s, (A[1] * A[6] - A[0] * A[7]) * s, (A[0] * A[4] - A[1] * A[3]) * s
  );
}
export function skew(v) { return mat3(0, -v[2], v[1], v[2], 0, -v[0], -v[1], v[0], 0); }
export function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
export function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
export function norm(a) { return Math.sqrt(dot(a, a)); }
export function normalize(a) { const n = norm(a) || 1; return a.map((x) => x / n); }
export function sub(a, b) { return a.map((x, i) => x - b[i]); }
export function add(a, b) { return a.map((x, i) => x + b[i]); }
export function scale(a, s) { return a.map((x) => x * s); }

/* ── one-sided Jacobi SVD ──────────────────────────────────────────────
   A is m×n row-major. Returns { U (m×n), S (n), V (n×n) } with A = U diag(S) Vᵀ,
   singular values sorted descending. Accurate and stable for the small
   systems used here (3×3 up to n×9). */
export function svd(Ain, m, n) {
  if (m < n) { // work on the transpose, then swap U/V back
    const r = svd(matT(Ain, m, n), n, m);
    return { U: r.V, S: r.S.slice(0, m), V: r.U, m: m, n: n, swapped: true };
  }
  const A = Float64Array.from(Ain);
  const V = new Float64Array(n * n);
  for (let i = 0; i < n; i++) V[i * n + i] = 1;
  const EPS = 1e-15;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
      let alpha = 0, beta = 0, gamma = 0;
      for (let i = 0; i < m; i++) { const ap = A[i * n + p], aq = A[i * n + q]; alpha += ap * ap; beta += aq * aq; gamma += ap * aq; }
      if (gamma === 0) continue;
      const denom = Math.sqrt(alpha * beta);
      if (denom === 0 || Math.abs(gamma) / denom < EPS) continue;
      off += Math.abs(gamma) / denom;
      const zeta = (beta - alpha) / (2 * gamma);
      const t = Math.sign(zeta || 1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
      const c = 1 / Math.sqrt(1 + t * t), s = c * t;
      for (let i = 0; i < m; i++) {
        const ap = A[i * n + p], aq = A[i * n + q];
        A[i * n + p] = c * ap - s * aq; A[i * n + q] = s * ap + c * aq;
      }
      for (let i = 0; i < n; i++) {
        const vp = V[i * n + p], vq = V[i * n + q];
        V[i * n + p] = c * vp - s * vq; V[i * n + q] = s * vp + c * vq;
      }
    }
    if (off < 1e-14) break;
  }
  const S = new Float64Array(n);
  for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < m; i++) s += A[i * n + j] * A[i * n + j]; S[j] = Math.sqrt(s); }
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => S[b] - S[a]);
  const U = new Float64Array(m * n), S2 = new Float64Array(n), V2 = new Float64Array(n * n);
  for (let k = 0; k < n; k++) {
    const j = order[k]; S2[k] = S[j];
    const inv = S[j] > 1e-300 ? 1 / S[j] : 0;
    for (let i = 0; i < m; i++) U[i * n + k] = A[i * n + j] * inv;
    for (let i = 0; i < n; i++) V2[i * n + k] = V[i * n + j];
  }
  return { U: U, S: S2, V: V2, m: m, n: n };
}

/* right singular vector for the smallest singular value — the least-squares
   solution of A x = 0 with |x| = 1. Under-determined systems (m < n) are
   zero-padded to n×n so the full right basis, including the true null space,
   is available. */
export function nullVector(A, m, n) {
  let M = A, rows = m;
  if (m < n) {
    M = new Float64Array(n * n);
    M.set(A.subarray ? A.subarray(0, m * n) : A.slice(0, m * n));
    rows = n;
  }
  const { V } = svd(M, rows, n);
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = V[i * n + (n - 1)];
  return v;
}

/* nearest rotation matrix (orthogonal, det +1) to A */
export function nearestRotation(A) {
  const { U, V } = svd(A, 3, 3);
  let R = mat3Mul(U, mat3T(V));
  if (mat3Det(R) < 0) {
    const V2 = Float64Array.from(V);
    for (let i = 0; i < 3; i++) V2[i * 3 + 2] = -V2[i * 3 + 2];
    R = mat3Mul(U, mat3T(V2));
  }
  return R;
}

/* Rodrigues: axis-angle vector → rotation matrix */
export function rodrigues(w) {
  const th = norm(w);
  if (th < 1e-12) {
    const K = skew(w); const R = eye3();
    for (let i = 0; i < 9; i++) R[i] += K[i];
    return nearestRotation(R);
  }
  const k = [w[0] / th, w[1] / th, w[2] / th];
  const K = skew(k), c = Math.cos(th), s = Math.sin(th);
  const R = eye3(), K2 = mat3Mul(K, K);
  for (let i = 0; i < 9; i++) R[i] += s * K[i] + (1 - c) * K2[i];
  return R;
}

/* rotation matrix → axis-angle vector */
export function rotLog(R) {
  const tr = R[0] + R[4] + R[8];
  const c = Math.max(-1, Math.min(1, (tr - 1) / 2));
  const th = Math.acos(c);
  if (th < 1e-9) return [0, 0, 0];
  const s = Math.sin(th), f = th / (2 * s);
  return [(R[7] - R[5]) * f, (R[2] - R[6]) * f, (R[3] - R[1]) * f];
}

/* solve a small symmetric positive system (A + λI) x = b by Cholesky with
   fallback to Gaussian elimination; A is n×n row-major */
export function solveSym(Ain, b, n, lambda) {
  const A = Float64Array.from(Ain);
  for (let i = 0; i < n; i++) A[i * n + i] += (lambda || 0) * (1 + Math.abs(A[i * n + i]));
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i * n + j];
      for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
      if (i === j) { if (s <= 1e-300) return null; L[i * n + i] = Math.sqrt(s); }
      else L[i * n + j] = s / L[j * n + j];
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k]; y[i] = s / L[i * n + i]; }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k]; x[i] = s / L[i * n + i]; }
  return x;
}

/* Umeyama similarity fit: find s, R, t minimising |s·R·src + t − dst|².
   src/dst are arrays of [x,y,z]. Returns null when degenerate. */
export function umeyama(src, dst, allowScale) {
  const n = src.length;
  if (n < 3 || dst.length !== n) return null;
  const mu = [0, 0, 0], mv = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { mu[k] += src[i][k] / n; mv[k] += dst[i][k] / n; }
  const C = new Float64Array(9); let varSrc = 0;
  for (let i = 0; i < n; i++) {
    const a = [src[i][0] - mu[0], src[i][1] - mu[1], src[i][2] - mu[2]];
    const b = [dst[i][0] - mv[0], dst[i][1] - mv[1], dst[i][2] - mv[2]];
    varSrc += dot(a, a) / n;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r * 3 + c] += b[r] * a[c] / n;
  }
  if (varSrc < 1e-18) return null;
  const { U, S, V } = svd(C, 3, 3);
  let D = eye3();
  const detU = mat3Det(U), detV = mat3Det(V);
  if (detU * detV < 0) D[8] = -1;
  const R = mat3Mul(mat3Mul(U, D), mat3T(V));
  let s = 1;
  if (allowScale !== false) s = (S[0] * D[0] + S[1] * D[4] + S[2] * D[8]) / varSrc;
  if (!isFinite(s) || s <= 0) return null;
  const Rm = mat3Vec(R, mu);
  const t = [mv[0] - s * Rm[0], mv[1] - s * Rm[1], mv[2] - s * Rm[2]];
  return { s: s, R: R, t: t };
}

/* median of a numeric array (copies) */
export function median(arr) {
  if (!arr.length) return 0;
  const a = Float64Array.from(arr).sort();
  const h = a.length >> 1;
  return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
}

/* deterministic RNG so a rebuild of the same photo set is reproducible */
export function makeRng(seed) {
  let s = (seed >>> 0) || 0x2f6e2b1;
  return function () {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
