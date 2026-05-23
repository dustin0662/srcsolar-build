/* ------------------------------------------------------------------ */
/*  Task Tracker — import & auto-detect (dots + gap-based sections)     */
/* ------------------------------------------------------------------ */

let _pdfjsLib = null;
async function ensurePdfJs() {
  if (_pdfjsLib) return _pdfjsLib;
  if (window.pdfjsLib) { _pdfjsLib = window.pdfjsLib; _pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js'; return _pdfjsLib; }
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/pdf.min.js'; s.onload = resolve; s.onerror = () => reject(new Error('Failed to load /pdf.min.js'));
    document.head.appendChild(s);
  });
  _pdfjsLib = window.pdfjsLib;
  if (!_pdfjsLib) throw new Error('pdfjsLib not found');
  _pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
  return _pdfjsLib;
}

async function fileToCanvas(file, pdfScale = 2) {
  const MAX_EDGE = 4000;
  if (file.type === 'application/pdf') {
    const pdfjsLib = await ensurePdfJs();
    const buf = await file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: buf }).promise;
    const page = await doc.getPage(1);
    let vp = page.getViewport({ scale: pdfScale });
    const longEdge = Math.max(vp.width, vp.height);
    if (longEdge > MAX_EDGE) vp = page.getViewport({ scale: pdfScale * (MAX_EDGE / longEdge) });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width; canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    return canvas;
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const longEdge = Math.max(img.width, img.height);
      let w = img.width, h = img.height;
      if (longEdge > MAX_EDGE) { const s = MAX_EDGE / longEdge; w = Math.round(w * s); h = Math.round(h * s); }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/* detect dot-like blobs: light regions enclosed by darker outlines, OR solid marks */
function detectBlobs(canvas, opts = {}) {
  const { darkV = 0.45, minBlob = 24, maxBlob = 4000 } = opts;
  const ctx = canvas.getContext('2d');
  const { width: W, height: H } = canvas;
  const d = ctx.getImageData(0, 0, W, H).data;
  const N = W * H;
  const bright = new Float32Array(N);
  for (let i = 0; i < N; i++) { const o = i * 4; bright[i] = (0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) / 255; }
  const DARK = 1, BG = 2, MARKER = 3;
  const label = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (bright[i] < darkV) label[i] = DARK;
  const queue = [];
  for (let x = 0; x < W; x++) { if (label[x] !== DARK) { label[x] = BG; queue.push(x); } const b = (H - 1) * W + x; if (label[b] !== DARK) { label[b] = BG; queue.push(b); } }
  for (let y = 1; y < H - 1; y++) { const l = y * W; if (label[l] !== DARK) { label[l] = BG; queue.push(l); } const r = y * W + W - 1; if (label[r] !== DARK) { label[r] = BG; queue.push(r); } }
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++]; const px = idx % W, py = (idx - px) / W;
    if (px > 0 && label[idx - 1] === 0) { label[idx - 1] = BG; queue.push(idx - 1); }
    if (px < W - 1 && label[idx + 1] === 0) { label[idx + 1] = BG; queue.push(idx + 1); }
    if (py > 0 && label[idx - W] === 0) { label[idx - W] = BG; queue.push(idx - W); }
    if (py < H - 1 && label[idx + W] === 0) { label[idx + W] = BG; queue.push(idx + W); }
  }
  for (let i = 0; i < N; i++) if (label[i] === 0) label[i] = MARKER;
  const ccId = new Int32Array(N);
  const blobs = [];
  for (let i = 0; i < N; i++) {
    if (label[i] !== MARKER || ccId[i] !== 0) continue;
    const stack = [i]; let minX = W, minY = H, maxX = 0, maxY = 0, cnt = 0;
    while (stack.length) {
      const ci = stack.pop(); if (ccId[ci] !== 0) continue; ccId[ci] = 1; cnt++;
      const cx = ci % W, cy = (ci - cx) / W;
      if (cx < minX) minX = cx; if (cx > maxX) maxX = cx; if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
      if (cx > 0 && label[ci - 1] === MARKER && ccId[ci - 1] === 0) stack.push(ci - 1);
      if (cx < W - 1 && label[ci + 1] === MARKER && ccId[ci + 1] === 0) stack.push(ci + 1);
      if (cy > 0 && label[ci - W] === MARKER && ccId[ci - W] === 0) stack.push(ci - W);
      if (cy < H - 1 && label[ci + W] === MARKER && ccId[ci + W] === 0) stack.push(ci + W);
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const ar = bw / bh;
    if (cnt >= minBlob && cnt <= maxBlob && ar > 0.35 && ar < 2.8) blobs.push({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, size: cnt });
  }
  return blobs;
}

function medianSpacing(pts) {
  if (pts.length < 2) return 1;
  const ds = [];
  const step = Math.max(1, Math.floor(pts.length / 400)); // sample for speed
  for (let i = 0; i < pts.length; i += step) {
    let best = Infinity;
    for (let j = 0; j < pts.length; j++) {
      if (j === i) continue;
      const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y; const dd = dx * dx + dy * dy;
      if (dd < best) best = dd;
    }
    if (best < Infinity) ds.push(Math.sqrt(best));
  }
  ds.sort((a, b) => a - b);
  return ds[Math.floor(ds.length / 2)] || 1;
}

/* connected components by gap → sections. If one component, no division. */
function autoSection(points, spacing) {
  const n = points.length;
  const sec = new Int32Array(n).fill(-1);
  const th = spacing * 1.9, th2 = th * th;
  // spatial hash
  const cell = th;
  const grid = new Map();
  const key = (gx, gy) => gx + ',' + gy;
  for (let i = 0; i < n; i++) { const gx = Math.floor(points[i][0] / cell), gy = Math.floor(points[i][1] / cell); const k = key(gx, gy); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
  let cur = 0;
  for (let i = 0; i < n; i++) {
    if (sec[i] !== -1) continue;
    const stack = [i]; sec[i] = cur;
    while (stack.length) {
      const a = stack.pop(); const ax = points[a][0], ay = points[a][1];
      const gx = Math.floor(ax / cell), gy = Math.floor(ay / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const arr = grid.get(key(gx + dx, gy + dy)); if (!arr) continue;
        for (const b of arr) { if (sec[b] !== -1) continue; const ddx = ax - points[b][0], ddy = ay - points[b][1]; if (ddx * ddx + ddy * ddy <= th2) { sec[b] = cur; stack.push(b); } }
      }
    }
    cur++;
  }
  return { sec: Array.from(sec), count: cur };
}

const TARGET_SPACING = 13; // normalize so dot radius ~4 looks right (matches Dwyer)

export async function processImport(file, sensitivity = 5) {
  const canvas = await fileToCanvas(file);
  const darkV = 0.30 + sensitivity * 0.03;            // 1→0.33 .. 10→0.60
  const minBlob = Math.max(6, Math.round(46 - sensitivity * 4)); // higher sens → smaller blobs allowed
  const blobs = detectBlobs(canvas, { darkV, minBlob });
  if (!blobs.length) return { points: [], w: 0, h: 0, sections: [], sectionCount: 0, count: 0 };
  const sp = medianSpacing(blobs);
  const scale = TARGET_SPACING / (sp || 1);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of blobs) { if (b.x < minX) minX = b.x; if (b.y < minY) minY = b.y; if (b.x > maxX) maxX = b.x; if (b.y > maxY) maxY = b.y; }
  const points = blobs.map((b) => [Math.round((b.x - minX) * scale * 10) / 10, Math.round((b.y - minY) * scale * 10) / 10]);
  const w = Math.round((maxX - minX) * scale * 10) / 10;
  const h = Math.round((maxY - minY) * scale * 10) / 10;
  const { sec, count } = autoSection(points, TARGET_SPACING);
  return { points, w, h, sections: sec, sectionCount: count, count: points.length };
}
