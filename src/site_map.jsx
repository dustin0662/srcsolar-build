import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

/* ------------------------------------------------------------------ */
/*  Storage shim                                                       */
/* ------------------------------------------------------------------ */
const storage = window.storage || {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { localStorage.setItem(k, JSON.stringify(v)); }
};

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */
const STAGE_COLORS = {
  1: '#dc2626', // bores
  2: '#e86a10', // piles
  3: '#eab308', // postCaps
  4: '#0891b2', // torqueTube
  5: '#16a34a', // modules
};
const STAGE_LABELS = {
  1: 'Bores',
  2: 'Piles',
  3: 'Post Caps',
  4: 'Torque Tube',
  5: 'Modules',
};
const EMPTY_COLOR = '#374151';
const BRAND_ORANGE = '#F97316';
const CANVAS_BG = '#1e293b';

const FONT_HEADING = "'Bebas Neue', sans-serif";
const FONT_BODY = "'Barlow Condensed', sans-serif";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
let _nextSectionId = 1;
function uid() { return `s${_nextSectionId++}_${Date.now()}`; }

function cellColor(level) {
  if (level >= 1 && level <= 5) return STAGE_COLORS[level];
  return EMPTY_COLOR;
}

function totalCells(section) {
  return section.rl.reduce((s, v) => s + v, 0);
}

function cellIndex(section, row, col) {
  let idx = 0;
  for (let r = 0; r < row; r++) idx += section.rl[r];
  return idx + col;
}

function makeSection(id, label, x, y, rows, cols) {
  const rl = new Array(rows).fill(cols);
  const offsets = new Array(rows).fill(0);
  const total = rows * cols;
  const levels = new Array(total).fill(0);
  return { id, label, x, y, angle: 0, colGap: 28, rowGap: 28, rl, offsets, levels };
}

function migrateSections(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => {
    const sec = { ...s };
    if (!sec.id) sec.id = uid();
    if (!sec.label) sec.label = 'Section';
    if (typeof sec.x !== 'number') sec.x = 100;
    if (typeof sec.y !== 'number') sec.y = 100;
    if (typeof sec.angle !== 'number') sec.angle = 0;
    if (typeof sec.colGap !== 'number') sec.colGap = 28;
    if (typeof sec.rowGap !== 'number') sec.rowGap = 28;
    if (!Array.isArray(sec.rl)) sec.rl = [5];
    if (!Array.isArray(sec.offsets)) sec.offsets = new Array(sec.rl.length).fill(0);
    const total = sec.rl.reduce((a, b) => a + b, 0);
    if (!Array.isArray(sec.levels) || sec.levels.length !== total) {
      sec.levels = new Array(total).fill(0);
    }
    return sec;
  });
}

/* ------------------------------------------------------------------ */
/*  PDF.js loader                                                      */
/* ------------------------------------------------------------------ */
let _pdfjsLib = null;
async function ensurePdfJs() {
  if (_pdfjsLib) return _pdfjsLib;
  if (window.pdfjsLib) {
    _pdfjsLib = window.pdfjsLib;
    _pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
    return _pdfjsLib;
  }
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/pdf.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load /pdf.min.js'));
    document.head.appendChild(s);
  });
  _pdfjsLib = window.pdfjsLib;
  if (!_pdfjsLib) throw new Error('pdfjsLib not found after loading script');
  _pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
  return _pdfjsLib;
}

/* ------------------------------------------------------------------ */
/*  File to canvas                                                     */
/* ------------------------------------------------------------------ */
async function fileToCanvas(file, pdfScale = 2) {
  const MAX_EDGE = 4000;
  if (file.type === 'application/pdf') {
    const pdfjsLib = await ensurePdfJs();
    const buf = await file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: buf }).promise;
    const page = await doc.getPage(1);
    let vp = page.getViewport({ scale: pdfScale });
    const longEdge = Math.max(vp.width, vp.height);
    if (longEdge > MAX_EDGE) {
      const s = MAX_EDGE / longEdge;
      vp = page.getViewport({ scale: pdfScale * s });
    }
    const canvas = document.createElement('canvas');
    canvas.width = vp.width;
    canvas.height = vp.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return canvas;
  }
  // Image
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const longEdge = Math.max(img.width, img.height);
      let w = img.width, h = img.height;
      if (longEdge > MAX_EDGE) {
        const s = MAX_EDGE / longEdge;
        w = Math.round(w * s);
        h = Math.round(h * s);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/* ------------------------------------------------------------------ */
/*  Detect points — flood-fill from border                             */
/* ------------------------------------------------------------------ */
function detectPoints(canvas, opts = {}) {
  const { darkV = 0.40, minBlob = 30, maxBlob = 2000 } = opts;
  const ctx = canvas.getContext('2d');
  const { width: W, height: H } = canvas;
  const imgData = ctx.getImageData(0, 0, W, H);
  const d = imgData.data;
  const N = W * H;

  // 1. Grayscale brightness
  const bright = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const off = i * 4;
    bright[i] = (0.299 * d[off] + 0.587 * d[off + 1] + 0.114 * d[off + 2]) / 255;
  }

  // 2. Mark dark pixels
  const DARK = 1, BG = 2, MARKER = 3;
  const label = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (bright[i] < darkV) label[i] = DARK;
  }

  // 3. Flood-fill from border — non-dark border pixels are background
  const queue = [];
  for (let x = 0; x < W; x++) {
    if (label[x] !== DARK) { label[x] = BG; queue.push(x); }
    const b = (H - 1) * W + x;
    if (label[b] !== DARK) { label[b] = BG; queue.push(b); }
  }
  for (let y = 1; y < H - 1; y++) {
    const l = y * W;
    if (label[l] !== DARK) { label[l] = BG; queue.push(l); }
    const r = y * W + W - 1;
    if (label[r] !== DARK) { label[r] = BG; queue.push(r); }
  }
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const px = idx % W, py = (idx - px) / W;
    const neighbors = [];
    if (px > 0) neighbors.push(idx - 1);
    if (px < W - 1) neighbors.push(idx + 1);
    if (py > 0) neighbors.push(idx - W);
    if (py < H - 1) neighbors.push(idx + W);
    for (const ni of neighbors) {
      if (label[ni] === 0) { label[ni] = BG; queue.push(ni); }
    }
  }

  // 4. Remaining light pixels (label === 0) are markers
  for (let i = 0; i < N; i++) {
    if (label[i] === 0) label[i] = MARKER;
  }

  // 5. Connected-component labeling on marker pixels
  const ccId = new Int32Array(N);
  let nextCc = 1;
  const blobs = [];
  for (let i = 0; i < N; i++) {
    if (label[i] !== MARKER || ccId[i] !== 0) continue;
    const id = nextCc++;
    const stack = [i];
    let minX = W, minY = H, maxX = 0, maxY = 0, cnt = 0;
    while (stack.length) {
      const ci = stack.pop();
      if (ccId[ci] !== 0) continue;
      ccId[ci] = id;
      cnt++;
      const cx = ci % W, cy = (ci - cx) / W;
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;
      if (cx > 0 && label[ci - 1] === MARKER && ccId[ci - 1] === 0) stack.push(ci - 1);
      if (cx < W - 1 && label[ci + 1] === MARKER && ccId[ci + 1] === 0) stack.push(ci + 1);
      if (cy > 0 && label[ci - W] === MARKER && ccId[ci - W] === 0) stack.push(ci - W);
      if (cy < H - 1 && label[ci + W] === MARKER && ccId[ci + W] === 0) stack.push(ci + W);
    }
    blobs.push({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, w: maxX - minX + 1, h: maxY - minY + 1, size: cnt });
  }

  // 6. Filter by blob size
  return blobs.filter(b => b.size >= minBlob && b.size <= maxBlob);
}

/* ------------------------------------------------------------------ */
/*  Estimate grid from points                                          */
/* ------------------------------------------------------------------ */
function estimateGrid(points) {
  if (points.length < 2) return { colGap: 30, rowGap: 30, angle: 0 };
  // Nearest-neighbor distances
  const dists = [];
  for (const p of points) {
    let best = Infinity;
    for (const q of points) {
      if (p === q) continue;
      const dx = p.x - q.x, dy = p.y - q.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < best) best = d;
    }
    dists.push(best);
  }
  dists.sort((a, b) => a - b);
  const medianSpacing = dists[Math.floor(dists.length / 2)];

  // Angle histogram from nearest-neighbor pairs
  const angleBins = new Float64Array(180);
  for (const p of points) {
    let best = Infinity, bq = null;
    for (const q of points) {
      if (p === q) continue;
      const dx = p.x - q.x, dy = p.y - q.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < best) { best = d; bq = q; }
    }
    if (bq) {
      let ang = Math.atan2(bq.y - p.y, bq.x - p.x) * (180 / Math.PI);
      ang = ((ang % 180) + 180) % 180;
      angleBins[Math.floor(ang)]++;
    }
  }
  let peakAngle = 0, peakVal = 0;
  for (let i = 0; i < 180; i++) {
    if (angleBins[i] > peakVal) { peakVal = angleBins[i]; peakAngle = i; }
  }
  const angle = peakAngle > 90 ? peakAngle - 180 : peakAngle;

  return { colGap: Math.round(medianSpacing), rowGap: Math.round(medianSpacing), angle };
}

/* ------------------------------------------------------------------ */
/*  Build section from rect                                            */
/* ------------------------------------------------------------------ */
function buildSectionFromRect(allPoints, rect) {
  const pts = allPoints.filter(
    p => p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h
  );
  if (pts.length === 0) return null;

  const grid = estimateGrid(pts);
  const halfRow = grid.rowGap * 0.45;

  // Sort by y, cluster into rows
  const sorted = [...pts].sort((a, b) => a.y - b.y);
  const rows = [];
  let currentRow = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].y - currentRow[0].y > halfRow) {
      rows.push(currentRow);
      currentRow = [sorted[i]];
    } else {
      currentRow.push(sorted[i]);
    }
  }
  rows.push(currentRow);

  // Sort each row by x
  for (const row of rows) row.sort((a, b) => a.x - b.x);

  // Compute global leftmost x
  let globalMinX = Infinity;
  for (const row of rows) {
    if (row[0].x < globalMinX) globalMinX = row[0].x;
  }

  const colGap = grid.colGap || 28;
  const rl = [];
  const offsets = [];
  for (const row of rows) {
    rl.push(row.length);
    const offsetCols = Math.round((row[0].x - globalMinX) / colGap);
    offsets.push(offsetCols);
  }

  const total = rl.reduce((a, b) => a + b, 0);
  const levels = new Array(total).fill(0);
  const centerX = rect.x + rect.w / 2;
  const centerY = rect.y + rect.h / 2;

  return {
    id: uid(),
    label: 'Section',
    x: Math.round(centerX),
    y: Math.round(centerY),
    angle: grid.angle,
    colGap,
    rowGap: grid.rowGap || 28,
    rl,
    offsets,
    levels,
  };
}

/* ------------------------------------------------------------------ */
/*  Print styles                                                       */
/* ------------------------------------------------------------------ */
const PRINT_STYLES = `@media print { .no-print { display:none !important } @page { size:landscape; margin:8mm } }`;

/* ------------------------------------------------------------------ */
/*  Section2D renderer                                                 */
/* ------------------------------------------------------------------ */
function Section2D({
  section, selected, mode, activeStage, paintLevel,
  onSelect, onPaintCell, onDragStart,
}) {
  const paintingRef = useRef(false);
  const lastCellRef = useRef(null);

  const rows = section.rl.length;

  const handlePointerDown = (e, r, c) => {
    e.stopPropagation();
    e.preventDefault();
    if (mode === 'paint') {
      paintingRef.current = true;
      lastCellRef.current = `${r}-${c}`;
      onPaintCell(section.id, r, c);
      e.target.setPointerCapture(e.pointerId);
    } else if (mode === 'move') {
      onDragStart(e, section.id);
    } else {
      onSelect(section.id);
    }
  };

  const handlePointerMove = (e, r, c) => {
    if (paintingRef.current && mode === 'paint') {
      const key = `${r}-${c}`;
      if (key !== lastCellRef.current) {
        lastCellRef.current = key;
        onPaintCell(section.id, r, c);
      }
    }
  };

  const handlePointerUp = () => {
    paintingRef.current = false;
    lastCellRef.current = null;
  };

  // Compute max width and height for the section wrapper
  let maxCol = 0;
  for (let r = 0; r < rows; r++) {
    const end = section.offsets[r] + section.rl[r];
    if (end > maxCol) maxCol = end;
  }
  const wrapW = maxCol * section.colGap;
  const wrapH = rows * section.rowGap;

  const cells = [];
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < section.rl[r]; c++) {
      const level = section.levels[idx];
      let visible = true;
      if (activeStage !== null && activeStage !== 'all') {
        // In view/edit mode for a specific stage, show that stage's color or grey
        visible = true; // always show cells
      }
      const color = (activeStage !== null && activeStage !== 'all')
        ? (level >= activeStage ? cellColor(level) : EMPTY_COLOR)
        : cellColor(level);

      const left = (section.offsets[r] + c) * section.colGap;
      const top = r * section.rowGap;
      const ri = r, ci = c; // capture for closures
      cells.push(
        <div
          key={idx}
          onPointerDown={(e) => handlePointerDown(e, ri, ci)}
          onPointerMove={(e) => handlePointerMove(e, ri, ci)}
          onPointerUp={handlePointerUp}
          style={{
            position: 'absolute',
            left, top,
            width: section.colGap - 2,
            height: section.rowGap - 2,
            backgroundColor: color,
            borderRadius: 3,
            cursor: mode === 'paint' ? 'crosshair' : mode === 'move' ? 'grab' : 'pointer',
            transition: 'background-color 0.1s',
          }}
        />
      );
      idx++;
    }
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: section.x,
        top: section.y,
        transform: `rotate(${section.angle}deg)`,
        transformOrigin: '0 0',
      }}
      onPointerDown={(e) => {
        if (mode === 'move') onDragStart(e, section.id);
        else onSelect(section.id);
      }}
    >
      {/* Label */}
      <div style={{
        position: 'absolute',
        top: -22,
        left: 0,
        fontFamily: FONT_HEADING,
        fontSize: 16,
        color: '#e2e8f0',
        whiteSpace: 'nowrap',
        userSelect: 'none',
        letterSpacing: '0.05em',
      }}>
        {section.label}
      </div>
      {/* Cell container */}
      <div style={{
        position: 'relative',
        width: wrapW,
        height: wrapH,
        border: selected ? `2px solid ${BRAND_ORANGE}` : '2px solid transparent',
        borderRadius: 4,
        boxSizing: 'content-box',
      }}>
        {cells}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Import Modal                                                       */
/* ------------------------------------------------------------------ */
function SmImportModal({ onClose, onAccept }) {
  const [file, setFile] = useState(null);
  const [srcCanvas, setSrcCanvas] = useState(null);
  const [points, setPoints] = useState([]);
  const [rects, setRects] = useState([]);
  const [drawing, setDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState(null);
  const [drawCurrent, setDrawCurrent] = useState(null);
  const [loading, setLoading] = useState(false);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  const handleFile = async (f) => {
    setFile(f);
    setLoading(true);
    setRects([]);
    try {
      const cv = await fileToCanvas(f);
      setSrcCanvas(cv);
      const pts = detectPoints(cv);
      setPoints(pts);
    } catch (err) {
      console.error('Import error:', err);
    }
    setLoading(false);
  };

  // Draw preview
  useEffect(() => {
    if (!srcCanvas || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const maxW = container.clientWidth - 20;
    const maxH = container.clientHeight - 20;
    const scale = Math.min(maxW / srcCanvas.width, maxH / srcCanvas.height, 1);
    canvas.width = srcCanvas.width * scale;
    canvas.height = srcCanvas.height * scale;
    canvas._scale = scale;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(srcCanvas, 0, 0, canvas.width, canvas.height);
    // Draw detected points as blue dots
    ctx.fillStyle = '#3b82f6';
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(p.x * scale, p.y * scale, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Draw existing rects
    ctx.strokeStyle = BRAND_ORANGE;
    ctx.lineWidth = 2;
    for (const r of rects) {
      ctx.strokeRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale);
    }
    // Draw current rect
    if (drawing && drawStart && drawCurrent) {
      ctx.setLineDash([6, 3]);
      ctx.strokeStyle = '#60a5fa';
      const rx = Math.min(drawStart.x, drawCurrent.x) * scale;
      const ry = Math.min(drawStart.y, drawCurrent.y) * scale;
      const rw = Math.abs(drawCurrent.x - drawStart.x) * scale;
      const rh = Math.abs(drawCurrent.y - drawStart.y) * scale;
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
    }
  }, [srcCanvas, points, rects, drawing, drawStart, drawCurrent]);

  const canvasCoords = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scale = canvas._scale || 1;
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
    };
  };

  const handleCanvasDown = (e) => {
    if (!srcCanvas) return;
    setDrawing(true);
    const p = canvasCoords(e);
    setDrawStart(p);
    setDrawCurrent(p);
  };

  const handleCanvasMove = (e) => {
    if (!drawing) return;
    setDrawCurrent(canvasCoords(e));
  };

  const handleCanvasUp = () => {
    if (!drawing || !drawStart || !drawCurrent) { setDrawing(false); return; }
    setDrawing(false);
    const x = Math.min(drawStart.x, drawCurrent.x);
    const y = Math.min(drawStart.y, drawCurrent.y);
    const w = Math.abs(drawCurrent.x - drawStart.x);
    const h = Math.abs(drawCurrent.y - drawStart.y);
    if (w > 10 && h > 10) {
      setRects(prev => [...prev, { x, y, w, h, label: `Section ${prev.length + 1}` }]);
    }
    setDrawStart(null);
    setDrawCurrent(null);
  };

  const updateRectLabel = (idx, label) => {
    setRects(prev => prev.map((r, i) => i === idx ? { ...r, label } : r));
  };

  // previewSections with useMemo — DO NOT REMOVE THIS MEMO
  const previewSections = useMemo(() => {
    if (!points.length || !rects.length) return [];
    return rects.map(rect => {
      const sec = buildSectionFromRect(points, rect);
      if (sec) sec.label = rect.label;
      return sec;
    }).filter(Boolean);
  }, [points, rects]);

  const handleAccept = () => {
    onAccept(previewSections);
    onClose();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      backgroundColor: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: FONT_BODY,
    }}>
      <div style={{
        width: '90vw', height: '85vh',
        backgroundColor: '#0f172a',
        borderRadius: 12, display: 'flex', flexDirection: 'column',
        border: `1px solid ${BRAND_ORANGE}`,
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '12px 20px',
          borderBottom: '1px solid #334155',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontFamily: FONT_HEADING,
        }}>
          <span style={{ fontSize: 22, color: '#f1f5f9', letterSpacing: '0.05em' }}>
            Import Site Map
          </span>
          <button onClick={onClose} style={btnStyle('#475569')}>Close</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Left: canvas area */}
          <div ref={containerRef} style={{
            flex: 1, position: 'relative', overflow: 'auto',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: '#1e293b',
          }}>
            {!srcCanvas && !loading && (
              <label style={{
                padding: '40px 60px', border: `2px dashed #475569`,
                borderRadius: 12, cursor: 'pointer', color: '#94a3b8',
                fontFamily: FONT_BODY, fontSize: 18,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
              }}>
                <span style={{ fontSize: 36 }}>+</span>
                Upload PDF or Image
                <input type="file" accept=".pdf,image/*" hidden onChange={e => {
                  if (e.target.files[0]) handleFile(e.target.files[0]);
                }} />
              </label>
            )}
            {loading && <span style={{ color: '#94a3b8', fontSize: 18 }}>Processing...</span>}
            {srcCanvas && (
              <canvas
                ref={canvasRef}
                onPointerDown={handleCanvasDown}
                onPointerMove={handleCanvasMove}
                onPointerUp={handleCanvasUp}
                style={{ cursor: 'crosshair' }}
              />
            )}
          </div>

          {/* Right sidebar */}
          <div style={{
            width: 280, borderLeft: '1px solid #334155',
            padding: 16, overflowY: 'auto',
            display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <div style={{ color: '#94a3b8', fontSize: 14 }}>
              Draw rectangles around sections on the map
            </div>
            {rects.map((r, i) => {
              const sec = previewSections[i];
              return (
                <div key={i} style={{
                  background: '#1e293b', padding: 10, borderRadius: 8,
                  border: '1px solid #334155',
                }}>
                  <input
                    value={r.label}
                    onChange={e => updateRectLabel(i, e.target.value)}
                    style={{
                      width: '100%', background: '#0f172a', border: '1px solid #475569',
                      borderRadius: 4, color: '#f1f5f9', padding: '4px 8px',
                      fontFamily: FONT_BODY, fontSize: 14, marginBottom: 6,
                    }}
                  />
                  <div style={{ color: '#94a3b8', fontSize: 13 }}>
                    {sec ? `${sec.rl.length} rows, ${totalCells(sec)} cells` : 'No points detected'}
                  </div>
                </div>
              );
            })}

            <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button onClick={() => setRects([])} style={btnStyle('#475569')}>
                Clear All
              </button>
              <button
                onClick={handleAccept}
                disabled={previewSections.length === 0}
                style={btnStyle(previewSections.length > 0 ? BRAND_ORANGE : '#475569')}
              >
                Accept ({previewSections.length} section{previewSections.length !== 1 ? 's' : ''})
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Grid Edit Panel                                                    */
/* ------------------------------------------------------------------ */
function GridEditPanel({ section, onUpdate, onClose }) {
  if (!section) return null;
  const update = (field, val) => {
    onUpdate(section.id, { [field]: val });
  };

  const addRow = () => {
    const lastLen = section.rl[section.rl.length - 1] || 5;
    const newRl = [...section.rl, lastLen];
    const newOffsets = [...section.offsets, 0];
    const newLevels = [...section.levels, ...new Array(lastLen).fill(0)];
    onUpdate(section.id, { rl: newRl, offsets: newOffsets, levels: newLevels });
  };

  const removeRow = () => {
    if (section.rl.length <= 1) return;
    const removedCols = section.rl[section.rl.length - 1];
    const newRl = section.rl.slice(0, -1);
    const newOffsets = section.offsets.slice(0, -1);
    const newLevels = section.levels.slice(0, section.levels.length - removedCols);
    onUpdate(section.id, { rl: newRl, offsets: newOffsets, levels: newLevels });
  };

  const setRowLength = (r, newLen) => {
    if (newLen < 1) return;
    const oldLen = section.rl[r];
    const newRl = [...section.rl];
    newRl[r] = newLen;
    // Adjust levels
    const startIdx = section.rl.slice(0, r).reduce((a, b) => a + b, 0);
    const newLevels = [...section.levels];
    if (newLen > oldLen) {
      const extra = new Array(newLen - oldLen).fill(0);
      newLevels.splice(startIdx + oldLen, 0, ...extra);
    } else {
      newLevels.splice(startIdx + newLen, oldLen - newLen);
    }
    onUpdate(section.id, { rl: newRl, levels: newLevels });
  };

  const setOffset = (r, off) => {
    const newOffsets = [...section.offsets];
    newOffsets[r] = Math.max(0, off);
    onUpdate(section.id, { offsets: newOffsets });
  };

  return (
    <div className="no-print" style={{
      position: 'absolute', right: 8, top: 60, width: 260,
      background: '#0f172a', borderRadius: 8, padding: 14,
      border: '1px solid #334155', zIndex: 100,
      fontFamily: FONT_BODY, color: '#e2e8f0', fontSize: 14,
      maxHeight: '70vh', overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontFamily: FONT_HEADING, fontSize: 18, letterSpacing: '0.05em' }}>
          Edit Grid: {section.label}
        </span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18 }}>x</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <label style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>Col Gap</div>
          <input type="number" value={section.colGap}
            onChange={e => update('colGap', Math.max(8, +e.target.value))}
            style={inputStyle()} />
        </label>
        <label style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>Row Gap</div>
          <input type="number" value={section.rowGap}
            onChange={e => update('rowGap', Math.max(8, +e.target.value))}
            style={inputStyle()} />
        </label>
      </div>

      <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>
        Rows ({section.rl.length})
      </div>
      {section.rl.map((len, r) => (
        <div key={r} style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center' }}>
          <span style={{ width: 24, fontSize: 12, color: '#64748b' }}>R{r}</span>
          <input type="number" value={len}
            onChange={e => setRowLength(r, +e.target.value)}
            style={{ ...inputStyle(), width: 50 }} title="Columns" />
          <input type="number" value={section.offsets[r]}
            onChange={e => setOffset(r, +e.target.value)}
            style={{ ...inputStyle(), width: 50 }} title="Offset" />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button onClick={addRow} style={btnStyle('#334155')}>+ Row</button>
        <button onClick={removeRow} style={btnStyle('#334155')}>- Row</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared styles                                                      */
/* ------------------------------------------------------------------ */
function btnStyle(bg, small = false) {
  return {
    background: bg,
    border: 'none',
    color: '#fff',
    padding: small ? '4px 10px' : '8px 16px',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: FONT_BODY,
    fontSize: small ? 12 : 14,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    letterSpacing: '0.02em',
  };
}

function inputStyle() {
  return {
    background: '#1e293b',
    border: '1px solid #475569',
    borderRadius: 4,
    color: '#f1f5f9',
    padding: '4px 6px',
    fontFamily: FONT_BODY,
    fontSize: 13,
    width: '100%',
  };
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */
export default function SiteMap({ onExit }) {
  const [sections, setSections] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [mode, setMode] = useState('all'); // 'all' | 'view-N' | 'edit-N' | 'move' | 'editgrid' | 'import'
  const [zoom, setZoom] = useState(1);
  const [backdrop, setBackdrop] = useState(null);
  const [backdropOpacity, setBdOpacity] = useState(0.3);
  const [showImport, setShowImport] = useState(false);
  const [showGridEdit, setShowGridEdit] = useState(false);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const saveTimerRef = useRef(null);

  // Load on mount
  useEffect(() => {
    const raw = storage.get('site-map-v4');
    if (raw) {
      const migrated = migrateSections(raw);
      setSections(migrated);
      if (migrated.length) {
        _nextSectionId = Math.max(...migrated.map(s => {
          const m = s.id.match(/^s(\d+)/);
          return m ? +m[1] + 1 : 1;
        }));
      }
    }
    const bd = storage.get('site-map-backdrop');
    if (bd) setBackdrop(bd);
  }, []);

  // Save with 600ms debounce
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      storage.set('site-map-v4', sections);
    }, 600);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [sections]);

  const selectedSection = sections.find(s => s.id === selectedId) || null;

  // Compute active stage from mode
  const activeStage = useMemo(() => {
    if (mode === 'all') return 'all';
    const m = mode.match(/^(view|edit)-(\d)$/);
    if (m) return +m[2];
    return 'all';
  }, [mode]);

  const isPaintMode = mode.startsWith('edit-');
  const paintLevel = isPaintMode ? +mode.split('-')[1] : 0;

  // Update section helper
  const updateSection = useCallback((id, patch) => {
    setSections(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  }, []);

  // Paint cell
  const handlePaintCell = useCallback((sectionId, row, col) => {
    setSections(prev => prev.map(s => {
      if (s.id !== sectionId) return s;
      const idx = cellIndex(s, row, col);
      const newLevels = [...s.levels];
      newLevels[idx] = newLevels[idx] === paintLevel ? 0 : paintLevel;
      return { ...s, levels: newLevels };
    }));
  }, [paintLevel]);

  // Drag section
  const handleDragStart = useCallback((e, sectionId) => {
    if (mode !== 'move') return;
    e.preventDefault();
    const sec = sections.find(s => s.id === sectionId);
    if (!sec) return;
    dragRef.current = {
      id: sectionId,
      startX: e.clientX,
      startY: e.clientY,
      origX: sec.x,
      origY: sec.y,
    };
    const onMove = (me) => {
      if (!dragRef.current) return;
      const dx = (me.clientX - dragRef.current.startX) / zoom;
      const dy = (me.clientY - dragRef.current.startY) / zoom;
      updateSection(dragRef.current.id, {
        x: dragRef.current.origX + dx,
        y: dragRef.current.origY + dy,
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [mode, sections, zoom, updateSection]);

  // Delete section
  const deleteSection = useCallback(() => {
    if (!selectedId) return;
    setSections(prev => prev.filter(s => s.id !== selectedId));
    setSelectedId(null);
  }, [selectedId]);

  // Rotate section
  const rotateSection = useCallback((deg) => {
    if (!selectedId) return;
    setSections(prev => prev.map(s =>
      s.id === selectedId ? { ...s, angle: s.angle + deg } : s
    ));
  }, [selectedId]);

  // Add new section
  const addSection = useCallback(() => {
    const id = uid();
    const sec = makeSection(id, `Section ${sections.length + 1}`, 200 + sections.length * 40, 200, 10, 5);
    setSections(prev => [...prev, sec]);
    setSelectedId(id);
  }, [sections.length]);

  // Import accept
  const handleImportAccept = useCallback((newSections) => {
    setSections(prev => [...prev, ...newSections]);
    setShowImport(false);
    setMode('all');
  }, []);

  // Backdrop upload
  const handleBackdropUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setBackdrop(reader.result);
      storage.set('site-map-backdrop', reader.result);
    };
    reader.readAsDataURL(file);
  };

  // Zoom helpers
  const zoomIn = () => setZoom(z => Math.min(z * 1.2, 5));
  const zoomOut = () => setZoom(z => Math.max(z / 1.2, 0.1));
  const zoomReset = () => setZoom(1);

  // Export PDF
  const handleExport = () => window.print();

  // Toolbar button
  const TB = ({ label, active, onClick, bg, small }) => (
    <button
      onClick={onClick}
      style={{
        ...btnStyle(active ? (bg || BRAND_ORANGE) : '#334155', small),
        outline: active ? `2px solid ${BRAND_ORANGE}` : 'none',
        outlineOffset: 2,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{
      width: '100%', height: '100vh',
      display: 'flex', flexDirection: 'column',
      backgroundColor: CANVAS_BG,
      fontFamily: FONT_BODY,
      overflow: 'hidden',
    }}>
      {/* Print styles */}
      <style>{PRINT_STYLES}</style>

      {/* Toolbar */}
      <div className="no-print" style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '8px 12px',
        backgroundColor: '#0f172a',
        borderBottom: '1px solid #334155',
        flexWrap: 'wrap',
        zIndex: 50,
      }}>
        {/* Back button */}
        {onExit && (
          <button onClick={onExit} style={btnStyle('#475569', true)} title="Back to dashboard">
            Back
          </button>
        )}
        <div style={{ width: 1, height: 28, background: '#334155', margin: '0 4px' }} />

        {/* ALL */}
        <TB label="ALL" active={mode === 'all'} onClick={() => setMode('all')} />

        <div style={{ width: 1, height: 28, background: '#334155', margin: '0 2px' }} />

        {/* Per-stage view+edit pairs */}
        {[1, 2, 3, 4, 5].map(stage => (
          <React.Fragment key={stage}>
            <TB
              label={STAGE_LABELS[stage]}
              active={mode === `view-${stage}`}
              onClick={() => setMode(`view-${stage}`)}
              bg={STAGE_COLORS[stage]}
              small
            />
            <TB
              label={`Edit`}
              active={mode === `edit-${stage}`}
              onClick={() => setMode(`edit-${stage}`)}
              bg={STAGE_COLORS[stage]}
              small
            />
          </React.Fragment>
        ))}

        <div style={{ width: 1, height: 28, background: '#334155', margin: '0 4px' }} />

        {/* IMPORT */}
        <TB label="IMPORT" active={showImport} onClick={() => { setShowImport(true); }} />

        {/* MOVE */}
        <TB label="MOVE" active={mode === 'move'} onClick={() => setMode(mode === 'move' ? 'all' : 'move')} />

        {/* EDIT GRID */}
        <TB label="EDIT GRID" active={showGridEdit}
          onClick={() => {
            if (selectedSection) setShowGridEdit(!showGridEdit);
          }} />

        {/* + ADD */}
        <TB label="+ ADD" active={false} onClick={addSection} />

        <div style={{ width: 1, height: 28, background: '#334155', margin: '0 4px' }} />

        {/* BG opacity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <label htmlFor="bd-upload" style={{
            ...btnStyle('#334155', true),
            display: 'inline-flex', alignItems: 'center', cursor: 'pointer',
          }}>
            BG
            <input id="bd-upload" type="file" accept="image/*" hidden onChange={handleBackdropUpload} />
          </label>
          <input
            type="range" min="0" max="1" step="0.05"
            value={backdropOpacity}
            onChange={e => setBdOpacity(+e.target.value)}
            style={{ width: 70 }}
            title={`Backdrop opacity: ${Math.round(backdropOpacity * 100)}%`}
          />
        </div>

        <div style={{ width: 1, height: 28, background: '#334155', margin: '0 4px' }} />

        {/* Zoom controls */}
        <button onClick={zoomOut} style={btnStyle('#334155', true)}>-</button>
        <span style={{ color: '#94a3b8', fontSize: 13, minWidth: 42, textAlign: 'center' }}>
          {Math.round(zoom * 100)}%
        </span>
        <button onClick={zoomIn} style={btnStyle('#334155', true)}>+</button>
        <button onClick={zoomReset} style={btnStyle('#334155', true)}>1:1</button>

        <div style={{ width: 1, height: 28, background: '#334155', margin: '0 4px' }} />

        {/* EXPORT PDF */}
        <TB label="EXPORT PDF" active={false} onClick={handleExport} />
      </div>

      {/* Selected section controls */}
      {selectedSection && (
        <div className="no-print" style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 12px',
          backgroundColor: '#0f172a',
          borderBottom: '1px solid #334155',
        }}>
          <span style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>
            {selectedSection.label}
          </span>
          <input
            value={selectedSection.label}
            onChange={e => updateSection(selectedId, { label: e.target.value })}
            style={{
              background: '#1e293b', border: '1px solid #475569', borderRadius: 4,
              color: '#f1f5f9', padding: '3px 8px', fontFamily: FONT_BODY, fontSize: 13, width: 140,
            }}
          />
          <button onClick={() => rotateSection(-1)} style={btnStyle('#334155', true)} title="Rotate -1 deg">
            -1&deg;
          </button>
          <span style={{ color: '#94a3b8', fontSize: 12 }}>{selectedSection.angle}&deg;</span>
          <button onClick={() => rotateSection(1)} style={btnStyle('#334155', true)} title="Rotate +1 deg">
            +1&deg;
          </button>
          <button onClick={deleteSection} style={btnStyle('#dc2626', true)}>Delete</button>
          <button onClick={() => setSelectedId(null)} style={btnStyle('#475569', true)}>Deselect</button>
        </div>
      )}

      {/* Canvas area */}
      <div
        ref={canvasRef}
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'auto',
          backgroundColor: CANVAS_BG,
        }}
        onClick={(e) => {
          if (e.target === canvasRef.current || e.target === canvasRef.current.firstChild) {
            setSelectedId(null);
          }
        }}
      >
        <div style={{
          transform: `scale(${zoom})`,
          transformOrigin: '0 0',
          position: 'relative',
          minWidth: 3000,
          minHeight: 2000,
        }}>
          {/* Backdrop */}
          {backdrop && (
            <img
              src={backdrop}
              alt=""
              style={{
                position: 'absolute',
                top: 0, left: 0,
                maxWidth: '100%',
                opacity: backdropOpacity,
                pointerEvents: 'none',
                userSelect: 'none',
              }}
            />
          )}

          {/* Sections */}
          {sections.map(sec => (
            <Section2D
              key={sec.id}
              section={sec}
              selected={sec.id === selectedId}
              mode={isPaintMode ? 'paint' : mode === 'move' ? 'move' : 'select'}
              activeStage={activeStage}
              paintLevel={paintLevel}
              onSelect={setSelectedId}
              onPaintCell={handlePaintCell}
              onDragStart={handleDragStart}
            />
          ))}
        </div>
      </div>

      {/* Progress legend */}
      <div className="no-print" style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '6px 12px',
        backgroundColor: '#0f172a',
        borderTop: '1px solid #334155',
      }}>
        <span style={{ color: '#64748b', fontSize: 12 }}>Legend:</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: EMPTY_COLOR }} />
          <span style={{ color: '#94a3b8', fontSize: 12 }}>Not started</span>
        </div>
        {[1, 2, 3, 4, 5].map(stage => (
          <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: STAGE_COLORS[stage] }} />
            <span style={{ color: '#94a3b8', fontSize: 12 }}>{STAGE_LABELS[stage]}</span>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ color: '#64748b', fontSize: 12 }}>
          {sections.length} section{sections.length !== 1 ? 's' : ''}
          {' | '}
          {sections.reduce((a, s) => a + totalCells(s), 0)} total cells
        </span>
      </div>

      {/* Grid Edit Panel */}
      {showGridEdit && selectedSection && (
        <GridEditPanel
          section={selectedSection}
          onUpdate={updateSection}
          onClose={() => setShowGridEdit(false)}
        />
      )}

      {/* Import Modal */}
      {showImport && (
        <SmImportModal
          onClose={() => setShowImport(false)}
          onAccept={handleImportAccept}
        />
      )}
    </div>
  );
}
