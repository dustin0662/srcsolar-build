import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { jsPDF } from 'jspdf';

/* ── design tokens ─────────────────────────────────────────────────── */
const ORANGE = '#F97316', GOLD = '#EAB308', GREEN = '#16a34a', RED = '#dc2626';
const BG = '#f5f2ee', CARD = '#ffffff', TEXT = '#1a1a2e', MID = '#666', DIM = '#999', BORDER = 'rgba(0,0,0,.1)';
const BB = { fontFamily: "'Bebas Neue', sans-serif" };
const NB = { fontFamily: "'Barlow Condensed', sans-serif" };
const CLIP = 'polygon(10px 0%,100% 0%,calc(100% - 10px) 100%,0% 100%)';

const ENDPOINT = '/.netlify/functions/documents';
const SIG_ENDPOINT = '/.netlify/functions/signatures';
const PORTAL_USERS_ENDPOINT = null; // accessed via prop instead
const CHUNK_BYTES = 3 * 1024 * 1024;

/* signer color palette */
const SIG_COLORS = ['#F97316', '#2563eb', '#16a34a', '#a855f7', '#ea580c', '#db2777'];

/* ── pdf.js loader (reuses /pdf.min.js) ─────────────────────────────── */
let _pdfjs = null;
async function ensurePdfJs() {
  if (_pdfjs) return _pdfjs;
  if (window.pdfjsLib) { _pdfjs = window.pdfjsLib; _pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js'; return _pdfjs; }
  await new Promise((res, rej) => { const s = document.createElement('script'); s.src = '/pdf.min.js'; s.onload = res; s.onerror = () => rej(new Error('pdf.js failed')); document.head.appendChild(s); });
  _pdfjs = window.pdfjsLib; if (!_pdfjs) throw new Error('pdfjsLib missing');
  _pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
  return _pdfjs;
}

/* ── helpers ───────────────────────────────────────────────────────── */
const uid = (p) => (p || 'd') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fmtDT = (ts) => ts ? new Date(ts).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const fmtSize = (b) => { if (!b) return ''; if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'; return (b / 1048576).toFixed(1) + ' MB'; };
const safeName = (s) => (s || 'doc').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
function blobToB64(blob) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = rej; fr.readAsDataURL(blob); }); }
function b64ToBytes(b64) { const bin = atob(b64 || ''); const len = bin.length; const out = new Uint8Array(len); for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i); return out; }

async function uploadChunks(docId, file, kind, onProgress) {
  const total = Math.max(1, Math.ceil(file.size / CHUNK_BYTES));
  for (let i = 0; i < total; i++) {
    const slice = file.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES);
    const data = await blobToB64(slice);
    const r = await fetch(ENDPOINT + '?file=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: docId, kind: kind || 'orig', index: i, data }) });
    if (!r.ok) throw new Error('chunk ' + i);
    if (onProgress) onProgress(i + 1, total);
  }
  return total;
}
async function downloadBlob(docId, chunks, mime, kind) {
  const parts = [];
  for (let i = 0; i < chunks; i++) {
    const r = await fetch(ENDPOINT + '?file=1&id=' + encodeURIComponent(docId) + '&kind=' + (kind || 'orig') + '&index=' + i, { cache: 'no-store' });
    if (!r.ok) throw new Error('chunk ' + i);
    const j = await r.json(); parts.push(b64ToBytes(j.data));
  }
  return new Blob(parts, { type: mime || 'application/octet-stream' });
}

/* ── style helpers ─────────────────────────────────────────────────── */
const cta = { background: ORANGE, color: '#1a1206', border: 'none', padding: '10px 16px', ...NB, fontWeight: 700, fontSize: 13, letterSpacing: '2px', textTransform: 'uppercase', cursor: 'pointer', clipPath: CLIP };
const ghost = { background: 'transparent', color: ORANGE, border: '1px solid ' + ORANGE, padding: '8px 14px', ...NB, fontWeight: 700, fontSize: 12, letterSpacing: '2px', textTransform: 'uppercase', cursor: 'pointer', clipPath: CLIP };
const lineBtn = { background: 'transparent', border: '1px solid ' + BORDER, color: MID, padding: '6px 12px', ...NB, fontSize: 11, letterSpacing: '1.5px', textTransform: 'uppercase', cursor: 'pointer' };
const kicker = { ...NB, fontSize: 10, letterSpacing: '2.5px', textTransform: 'uppercase', color: ORANGE };
const overlay = { position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.62)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 };
const modal = (w) => ({ background: CARD, width: '100%', maxWidth: w || 560, maxHeight: '92vh', overflowY: 'auto', padding: 24, boxShadow: '0 10px 40px rgba(0,0,0,.3)' });

/* ── signature pad component (draw OR type) ────────────────────────── */
function SignaturePad({ onCommit, defaultType }) {
  const [mode, setMode] = useState(defaultType || 'draw'); // draw | type
  const [typed, setTyped] = useState('');
  const [font, setFont] = useState('Brush Script MT, cursive');
  const canvasRef = useRef(null); const drawingRef = useRef(false); const lastRef = useRef(null);

  useEffect(() => {
    if (mode !== 'draw') return;
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.parentElement.clientWidth || 400; const h = 140;
    c.width = w * dpr; c.height = h * dpr; c.style.width = w + 'px'; c.style.height = h + 'px';
    ctx.scale(dpr, dpr); ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = '#0a0a14';
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  }, [mode]);

  function pt(e) { const c = canvasRef.current; const r = c.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; return { x: t.clientX - r.left, y: t.clientY - r.top }; }
  function start(e) { e.preventDefault(); drawingRef.current = true; lastRef.current = pt(e); }
  function move(e) { if (!drawingRef.current) return; e.preventDefault(); const p = pt(e); const ctx = canvasRef.current.getContext('2d'); ctx.beginPath(); ctx.moveTo(lastRef.current.x, lastRef.current.y); ctx.lineTo(p.x, p.y); ctx.stroke(); lastRef.current = p; }
  function end() { drawingRef.current = false; }
  function clear() { const c = canvasRef.current; if (!c) return; const ctx = c.getContext('2d'); const dpr = window.devicePixelRatio || 1; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width / dpr, c.height / dpr); }
  function isBlank() { const c = canvasRef.current; if (!c) return true; const ctx = c.getContext('2d'); const d = ctx.getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) { if (d[i] !== 255 || d[i + 1] !== 255 || d[i + 2] !== 255) return false; } return true; }

  function commit() {
    if (mode === 'draw') {
      if (isBlank()) { window.alert('Please draw your signature.'); return; }
      const url = canvasRef.current.toDataURL('image/png');
      onCommit({ kind: 'draw', data: url, label: 'Drawn signature' });
    } else {
      if (!typed.trim()) { window.alert('Please type your name.'); return; }
      // render typed text to canvas → png data url
      const c = document.createElement('canvas'); c.width = 600; c.height = 160;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#0a0a14'; ctx.font = '64px ' + font; ctx.textBaseline = 'middle';
      ctx.fillText(typed, 20, c.height / 2);
      onCommit({ kind: 'type', data: c.toDataURL('image/png'), label: typed, font });
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button onClick={() => setMode('draw')} style={{ ...lineBtn, background: mode === 'draw' ? ORANGE : 'transparent', color: mode === 'draw' ? '#fff' : MID, borderColor: mode === 'draw' ? ORANGE : BORDER }}>Draw</button>
        <button onClick={() => setMode('type')} style={{ ...lineBtn, background: mode === 'type' ? ORANGE : 'transparent', color: mode === 'type' ? '#fff' : MID, borderColor: mode === 'type' ? ORANGE : BORDER }}>Type</button>
      </div>
      {mode === 'draw' ? (
        <div>
          <div style={{ border: '1px dashed ' + BORDER, background: '#fff' }}>
            <canvas ref={canvasRef} onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end} onTouchStart={start} onTouchMove={move} onTouchEnd={end} style={{ display: 'block', width: '100%', height: 140, cursor: 'crosshair', touchAction: 'none' }} />
          </div>
          <div onClick={clear} style={{ display: 'inline-block', marginTop: 6, cursor: 'pointer', ...NB, fontSize: 11, color: MID, letterSpacing: '1.5px', textTransform: 'uppercase', borderBottom: '1px solid ' + BORDER }}>Clear</div>
        </div>
      ) : (
        <div>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your full legal name" style={{ width: '100%', ...NB, fontSize: 18, padding: '10px 12px', border: '1px solid ' + BORDER, outline: 'none', marginBottom: 8 }} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {['Brush Script MT, cursive', 'Snell Roundhand, cursive', 'Lucida Handwriting, cursive', 'Apple Chancery, cursive'].map((f) => (
              <button key={f} onClick={() => setFont(f)} style={{ ...lineBtn, fontFamily: f, fontSize: 16, padding: '6px 14px', background: font === f ? 'rgba(249,115,22,.1)' : 'transparent', borderColor: font === f ? ORANGE : BORDER, color: font === f ? ORANGE : TEXT }}>{typed || 'Your Name'}</button>
            ))}
          </div>
          <div style={{ border: '1px solid ' + BORDER, padding: 12, background: '#fff', fontFamily: font, fontSize: 38, minHeight: 60, color: '#0a0a14' }}>{typed || <span style={{ color: '#bbb', fontSize: 14, fontFamily: 'inherit' }}>Preview will appear here</span>}</div>
        </div>
      )}
      <button onClick={commit} style={{ ...cta, width: '100%', marginTop: 14, padding: '12px 0' }}>Apply Signature →</button>
    </div>
  );
}

/* ── adopt signature modal (legal acknowledgement + draw/type + save) ─ */
function AdoptSignatureModal({ user, savedSigs, onClose, onAdopted, onSaveForFuture }) {
  const [step, setStep] = useState(savedSigs && savedSigs.length ? 'pick' : 'create');
  const [agreed, setAgreed] = useState(false);
  const [pending, setPending] = useState(null);
  function adopt(sig) { onAdopted(sig); onClose(); }
  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={modal(560)}>
        <div style={{ ...BB, fontSize: 24, letterSpacing: 1.5, color: TEXT }}>ADOPT YOUR ELECTRONIC SIGNATURE</div>
        <div style={{ ...NB, fontSize: 13, color: MID, marginTop: 4, marginBottom: 16, lineHeight: 1.6 }}>By adopting a signature below, you consent to use electronic records and electronic signatures, and you agree the signature is your legally binding signature equivalent to a handwritten one (ESIGN Act / UETA).</div>
        {step === 'pick' && (<>
          <div style={{ ...kicker, marginBottom: 8 }}>Use a saved signature</div>
          {(savedSigs || []).map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid ' + BORDER, marginBottom: 8, background: '#fff' }}>
              <img src={s.data} alt="sig" style={{ height: 44, maxWidth: 220, objectFit: 'contain', background: '#fff' }} />
              <div style={{ flex: 1, ...NB, fontSize: 13, color: MID }}>{s.label || s.kind}<br /><span style={{ fontSize: 10, color: DIM }}>Saved {fmtDT(s.savedAt)}</span></div>
              <button onClick={() => setPending(s)} style={{ ...lineBtn, color: ORANGE, borderColor: ORANGE }}>Use</button>
            </div>
          ))}
          <div onClick={() => setStep('create')} style={{ display: 'inline-block', marginTop: 6, cursor: 'pointer', ...NB, fontSize: 12, color: ORANGE, letterSpacing: '1.5px', textTransform: 'uppercase', borderBottom: '1px solid ' + ORANGE }}>+ Create a new signature</div>
        </>)}
        {step === 'create' && !pending && (
          <SignaturePad onCommit={(sig) => setPending(Object.assign({ id: uid('sig'), savedAt: Date.now(), userId: user.id }, sig))} />
        )}
        {pending && (
          <div style={{ marginTop: 14, padding: '14px 16px', border: '1px solid ' + ORANGE, background: 'rgba(249,115,22,.05)' }}>
            <img src={pending.data} alt="preview" style={{ height: 56, maxWidth: '100%', objectFit: 'contain', background: '#fff', border: '1px solid ' + BORDER, marginBottom: 10 }} />
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', marginBottom: 10 }}>
              <input type="checkbox" checked={agreed} onChange={() => setAgreed(!agreed)} style={{ accentColor: ORANGE, marginTop: 4 }} />
              <span style={{ ...NB, fontSize: 13, color: TEXT, lineHeight: 1.5 }}>I, <strong>{user.name || user.email}</strong>, adopt the signature above as my <strong>legally binding electronic signature</strong>. I agree it has the same legal effect as a handwritten signature on this and any document I sign with it.</span>
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button disabled={!agreed} onClick={() => { if (typeof onSaveForFuture === 'function') onSaveForFuture(pending); adopt(pending); }} style={{ ...cta, opacity: agreed ? 1 : .5, padding: '11px 16px', cursor: agreed ? 'pointer' : 'default' }}>Adopt & Save for future →</button>
              <button disabled={!agreed} onClick={() => adopt(pending)} style={{ ...ghost, opacity: agreed ? 1 : .5, padding: '10px 16px', cursor: agreed ? 'pointer' : 'default' }}>Adopt for this document only</button>
              <button onClick={() => { setPending(null); if (step === 'pick' && savedSigs && savedSigs.length === 0) setStep('create'); }} style={{ ...lineBtn }}>Back</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── PDF page renderer (returns a render result with canvas + viewport) ── */
async function renderPdfPages(arrayBuffer, scale) {
  const pdfjs = await ensurePdfJs();
  const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: scale || 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width; canvas.height = vp.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    pages.push({ index: i - 1, width: vp.width, height: vp.height, dataUrl: canvas.toDataURL('image/jpeg', 0.85) });
  }
  return pages;
}

/* ── markup modal: admin places signature fields per signer ─────────── */
function MarkupModal({ doc, allUsers, currentUser, onClose, onSent }) {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [signers, setSigners] = useState(doc.workflow && doc.workflow.signers ? doc.workflow.signers.slice() : []);
  const [activeSignerIdx, setActiveSignerIdx] = useState(0);
  const [fields, setFields] = useState((doc.workflow && doc.workflow.fields) || []);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const blob = await downloadBlob(doc.id, doc.chunks || 0, 'application/pdf', 'orig');
        const ab = await blob.arrayBuffer();
        const ps = await renderPdfPages(ab, 1.4);
        if (alive) { setPages(ps); setLoading(false); }
      } catch (e) { if (alive) { setLoading(false); window.alert('Could not load PDF: ' + e.message); } }
    })();
    return () => { alive = false; };
  }, [doc.id]);

  function addSigner() {
    const choices = (allUsers || []).filter((u) => !signers.some((s) => s.email === u.email));
    if (!choices.length) { window.alert('No more portal members to add.'); return; }
    const list = choices.map((u, i) => (i + 1) + '. ' + u.name + ' <' + u.email + '>').join('\n');
    const pick = window.prompt('Add signer — enter the number:\n\n' + list);
    if (!pick) return; const idx = parseInt(pick, 10) - 1;
    if (idx < 0 || idx >= choices.length) { window.alert('Invalid selection.'); return; }
    const u = choices[idx];
    setSigners(signers.concat([{ id: uid('s'), name: u.name, email: u.email, color: SIG_COLORS[signers.length % SIG_COLORS.length] }]));
    setActiveSignerIdx(signers.length);
  }
  function removeSigner(i) {
    if (!window.confirm('Remove this signer and any fields assigned to them?')) return;
    const s = signers[i];
    setFields(fields.filter((f) => f.signerEmail !== s.email));
    setSigners(signers.filter((_, j) => j !== i));
    if (activeSignerIdx >= signers.length - 1) setActiveSignerIdx(Math.max(0, signers.length - 2));
  }

  function placeField(pageIdx, e) {
    if (!signers.length) { window.alert('Add at least one signer first.'); return; }
    const s = signers[activeSignerIdx]; if (!s) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xN = (e.clientX - rect.left) / rect.width;
    const yN = (e.clientY - rect.top) / rect.height;
    const wN = 220 / rect.width; const hN = 60 / rect.height;
    setFields(fields.concat([{ id: uid('f'), page: pageIdx, x: xN, y: yN, w: wN, h: hN, signerEmail: s.email, kind: 'signature' }]));
  }
  function removeField(id) { setFields(fields.filter((f) => f.id !== id)); }

  async function send() {
    if (!signers.length) { window.alert('Add at least one signer.'); return; }
    if (!fields.length) { window.alert('Place at least one signature field on the document.'); return; }
    for (const s of signers) if (!fields.some((f) => f.signerEmail === s.email)) { window.alert('Each signer needs at least one signature field — missing for ' + s.name); return; }
    setBusy(true);
    const sentAt = Date.now();
    const nextDoc = Object.assign({}, doc, {
      workflow: Object.assign({}, doc.workflow || {}, {
        status: 'sent', sentAt, sentBy: (currentUser && currentUser.name) || '',
        signers: signers.map((s) => Object.assign({}, s, { sentAt, openedAt: null, signedAt: null })),
        fields: fields,
      }),
    });
    try {
      const r = await fetch(ENDPOINT + '?upsert=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doc: nextDoc }) });
      if (!r.ok) throw new Error('save failed');
      onSent(nextDoc); onClose();
    } catch (e) { window.alert('Could not save: ' + e.message); }
    setBusy(false);
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={Object.assign({}, modal(1100), { padding: 0 })}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid ' + BORDER }}>
          <div>
            <div style={{ ...BB, fontSize: 22, color: TEXT }}>PREPARE FOR SIGNATURE</div>
            <div style={{ ...NB, fontSize: 12, color: MID }}>{doc.name}</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={lineBtn}>Cancel</button>
            <button onClick={send} disabled={busy} style={cta}>{busy ? 'Sending…' : 'Send for Signature →'}</button>
          </div>
        </div>
        <div style={{ display: 'flex', minHeight: 0, maxHeight: 'calc(92vh - 60px)' }}>
          {/* signer panel */}
          <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid ' + BORDER, padding: 14, overflowY: 'auto' }}>
            <div style={{ ...kicker, marginBottom: 6 }}>Signers</div>
            {signers.map((s, i) => (
              <div key={s.id} onClick={() => setActiveSignerIdx(i)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'pointer', border: '1px solid ' + (i === activeSignerIdx ? s.color : BORDER), background: i === activeSignerIdx ? s.color + '15' : '#fff', marginBottom: 6 }}>
                <span style={{ width: 12, height: 12, background: s.color, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ ...NB, fontSize: 13, color: TEXT, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                  <div style={{ ...NB, fontSize: 11, color: MID, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.email}</div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); removeSigner(i); }} style={{ background: 'transparent', border: 'none', color: MID, fontSize: 18, cursor: 'pointer', padding: 0 }}>×</button>
              </div>
            ))}
            <button onClick={addSigner} style={Object.assign({}, ghost, { width: '100%', padding: '8px 0', marginTop: 4 })}>+ Add Signer</button>
            <div style={{ ...NB, fontSize: 11, color: MID, marginTop: 14, lineHeight: 1.5 }}>Click on a page to place a signature box for the highlighted signer. Each signer must have at least one field.</div>
            <div style={{ ...kicker, marginTop: 16, marginBottom: 6 }}>Fields placed</div>
            {fields.length === 0 && <div style={{ ...NB, fontSize: 12, color: DIM }}>None yet.</div>}
            {fields.map((f) => { const s = signers.find((x) => x.email === f.signerEmail); return (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, ...NB, padding: '4px 0', borderBottom: '1px solid ' + BORDER, color: MID }}>
                <span style={{ width: 8, height: 8, background: (s && s.color) || DIM }} />
                <span>Page {f.page + 1} · {s ? s.name.split(' ')[0] : '—'}</span>
                <button onClick={() => removeField(f.id)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: MID, cursor: 'pointer' }}>×</button>
              </div>
            ); })}
          </div>
          {/* pages */}
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: 16, background: '#eee' }}>
            {loading && <div style={{ textAlign: 'center', color: MID, ...NB, padding: 40 }}>Loading PDF…</div>}
            {pages.map((p) => (
              <div key={p.index} style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', marginBottom: 14, boxShadow: '0 1px 8px rgba(0,0,0,.2)', background: '#fff' }}>
                <img src={p.dataUrl} style={{ display: 'block', maxWidth: '100%', height: 'auto', cursor: signers.length ? 'crosshair' : 'not-allowed' }} draggable={false} onClick={(e) => placeField(p.index, e)} />
                {fields.filter((f) => f.page === p.index).map((f) => { const s = signers.find((x) => x.email === f.signerEmail); return (
                  <div key={f.id} title={'Signature box for ' + (s ? s.name : '?')} style={{ position: 'absolute', left: (f.x * 100) + '%', top: (f.y * 100) + '%', width: (f.w * 100) + '%', height: (f.h * 100) + '%', border: '2px solid ' + ((s && s.color) || ORANGE), background: ((s && s.color) || ORANGE) + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', ...NB, fontSize: 10, letterSpacing: '1px', textTransform: 'uppercase', color: (s && s.color) || ORANGE, cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); if (window.confirm('Remove this signature field?')) removeField(f.id); }}>
                    Sign · {s ? s.name.split(' ')[0] : '?'}
                  </div>
                ); })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── signer experience modal ────────────────────────────────────────── */
function SignModal({ doc, currentUser, savedSigs, onClose, onSigned, onSaveSig }) {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adopted, setAdopted] = useState(null);
  const [showAdopt, setShowAdopt] = useState(false);
  const [busy, setBusy] = useState(false);
  const myEmail = (currentUser.email || '').toLowerCase();
  const myFields = (doc.workflow && doc.workflow.fields || []).filter((f) => (f.signerEmail || '').toLowerCase() === myEmail);
  const [signedMap, setSignedMap] = useState({}); // fieldId → {sig, signedAt}

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const blob = await downloadBlob(doc.id, doc.chunks || 0, 'application/pdf', 'orig');
        const ab = await blob.arrayBuffer();
        const ps = await renderPdfPages(ab, 1.3);
        if (alive) { setPages(ps); setLoading(false); }
      } catch (e) { if (alive) { setLoading(false); window.alert('Could not load PDF: ' + e.message); } }
    })();
    return () => { alive = false; };
  }, [doc.id]);

  function clickField(f) {
    if (signedMap[f.id]) return;
    if (!adopted) { setShowAdopt(true); return; }
    setSignedMap(Object.assign({}, signedMap, { [f.id]: { sig: adopted, signedAt: Date.now() } }));
  }
  const allSigned = myFields.length > 0 && myFields.every((f) => signedMap[f.id]);

  async function submit() {
    if (!allSigned) { window.alert('Please sign every field assigned to you.'); return; }
    setBusy(true);
    const now = Date.now();
    const wf = Object.assign({}, doc.workflow);
    wf.fields = wf.fields.map((f) => signedMap[f.id] ? Object.assign({}, f, { value: signedMap[f.id].sig.data, signedAt: signedMap[f.id].signedAt, signedBy: currentUser.name, signedByEmail: currentUser.email }) : f);
    wf.signers = wf.signers.map((s) => (s.email || '').toLowerCase() === myEmail ? Object.assign({}, s, { signedAt: now, signatureLabel: adopted.label, signatureKind: adopted.kind }) : s);
    const allDone = wf.signers.every((s) => s.signedAt);
    if (allDone) wf.status = 'completed', wf.completedAt = now;
    const nextDoc = Object.assign({}, doc, { workflow: wf });
    try {
      const r = await fetch(ENDPOINT + '?upsert=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doc: nextDoc }) });
      if (!r.ok) throw new Error('save failed');
      onSigned(nextDoc); onClose();
    } catch (e) { window.alert('Could not save: ' + e.message); }
    setBusy(false);
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={Object.assign({}, modal(1100), { padding: 0 })}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid ' + BORDER, gap: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...BB, fontSize: 22, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>SIGN: {doc.name}</div>
            <div style={{ ...NB, fontSize: 12, color: MID }}>{myFields.length} field{myFields.length !== 1 ? 's' : ''} for you · {Object.keys(signedMap).length} signed</div>
          </div>
          {adopted && <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', border: '1px solid ' + GREEN, background: 'rgba(22,163,74,.08)' }}>
            <img src={adopted.data} alt="adopted" style={{ height: 24, maxWidth: 100, objectFit: 'contain' }} />
            <span style={{ ...NB, fontSize: 11, color: GREEN, letterSpacing: '1px', textTransform: 'uppercase' }}>Adopted</span>
          </div>}
          {!adopted && <button onClick={() => setShowAdopt(true)} style={cta}>Adopt Signature</button>}
          <button onClick={submit} disabled={!allSigned || busy} style={Object.assign({}, cta, { background: allSigned ? GREEN : 'rgba(22,163,74,.3)', color: '#fff', cursor: allSigned ? 'pointer' : 'default' })}>{busy ? 'Submitting…' : 'Submit Signature →'}</button>
          <button onClick={onClose} style={lineBtn}>Close</button>
        </div>
        <div style={{ overflowY: 'auto', padding: 16, background: '#eee', maxHeight: 'calc(92vh - 60px)' }}>
          {loading && <div style={{ textAlign: 'center', color: MID, ...NB, padding: 40 }}>Loading PDF…</div>}
          {pages.map((p) => (
            <div key={p.index} style={{ position: 'relative', display: 'block', maxWidth: 900, margin: '0 auto 14px', boxShadow: '0 1px 8px rgba(0,0,0,.2)', background: '#fff' }}>
              <img src={p.dataUrl} style={{ display: 'block', width: '100%', height: 'auto' }} draggable={false} />
              {(doc.workflow.fields || []).filter((f) => f.page === p.index).map((f) => {
                const isMine = (f.signerEmail || '').toLowerCase() === myEmail;
                const signed = signedMap[f.id];
                const previouslySigned = !!f.value;
                const sig = signed ? signed.sig : null;
                return (
                  <div key={f.id} onClick={() => isMine && !previouslySigned && clickField(f)} style={{ position: 'absolute', left: (f.x * 100) + '%', top: (f.y * 100) + '%', width: (f.w * 100) + '%', height: (f.h * 100) + '%', border: '2px solid ' + (signed || previouslySigned ? GREEN : isMine ? ORANGE : DIM), background: (signed || previouslySigned ? 'rgba(22,163,74,.08)' : isMine ? 'rgba(249,115,22,.08)' : 'rgba(0,0,0,.04)'), display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: isMine && !previouslySigned ? 'pointer' : 'default', overflow: 'hidden' }}>
                    {sig ? <img src={sig.data} alt="sig" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                      : previouslySigned ? <img src={f.value} alt="sig" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                      : <span style={{ ...NB, fontSize: 11, letterSpacing: '1px', textTransform: 'uppercase', color: isMine ? ORANGE : DIM }}>{isMine ? 'Click to sign' : 'For other signer'}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {showAdopt && <AdoptSignatureModal user={currentUser} savedSigs={savedSigs} onClose={() => setShowAdopt(false)} onAdopted={(s) => setAdopted(s)} onSaveForFuture={onSaveSig} />}
    </div>
  );
}

/* ── generate the signed PDF (with watermark + audit page) ──────────── */
async function buildSignedPDF(doc, origAB) {
  const pages = await renderPdfPages(origAB, 2.0);
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const PW = pdf.internal.pageSize.getWidth(); const PH = pdf.internal.pageSize.getHeight();
  for (let i = 0; i < pages.length; i++) {
    if (i > 0) pdf.addPage();
    const p = pages[i];
    // fit page image with letter aspect
    const ratio = p.height / p.width;
    let iw = PW, ih = PW * ratio;
    if (ih > PH) { ih = PH; iw = PH / ratio; }
    const ox = (PW - iw) / 2, oy = (PH - ih) / 2;
    pdf.addImage(p.dataUrl, 'JPEG', ox, oy, iw, ih);
    // overlay signatures positioned by normalized coords
    const fields = (doc.workflow.fields || []).filter((f) => f.page === i && f.value);
    fields.forEach((f) => {
      const sx = ox + f.x * iw, sy = oy + f.y * ih, sw = f.w * iw, sh = f.h * ih;
      try { pdf.addImage(f.value, 'PNG', sx, sy, sw, sh); } catch (e) {}
      // outline + tiny signed-by label
      pdf.setDrawColor(22, 163, 74); pdf.setLineWidth(0.6); pdf.rect(sx, sy, sw, sh);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6); pdf.setTextColor(22, 163, 74);
      pdf.text((f.signedBy || '') + ' · ' + (f.signedAt ? new Date(f.signedAt).toLocaleString() : ''), sx + 2, sy + sh + 7);
    });
    // diagonal verified watermark
    pdf.saveGraphicsState(); pdf.setGState(pdf.GState({ opacity: 0.08 }));
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(46); pdf.setTextColor(22, 163, 74);
    pdf.text('VERIFIED · E-SIGNED VIA SUNRISE CONSTRUCTION & DEVELOPMENT', PW / 2, PH / 2, { angle: 30, align: 'center' });
    pdf.restoreGraphicsState();
    // bottom footer
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(120, 120, 120);
    pdf.text('Verified e-signed copy · doc ' + doc.id + ' · page ' + (i + 1) + ' / ' + pages.length, 30, PH - 14);
  }
  // audit page
  pdf.addPage();
  const M = 44;
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(20); pdf.setTextColor(20, 20, 28);
  pdf.text('SIGNATURE AUDIT TRAIL', M, M + 6);
  pdf.setDrawColor(249, 115, 22); pdf.setLineWidth(2.5); pdf.line(M, M + 14, M + 240, M + 14);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(120, 120, 120);
  pdf.text('Document: ' + doc.name + '  ·  ID: ' + doc.id, M, M + 30);
  pdf.text('Sent: ' + (doc.workflow.sentAt ? new Date(doc.workflow.sentAt).toLocaleString() : '—') + '  ·  Completed: ' + (doc.workflow.completedAt ? new Date(doc.workflow.completedAt).toLocaleString() : '—'), M, M + 44);
  let y = M + 70;
  (doc.workflow.signers || []).forEach((s, idx) => {
    if (y > PH - 80) { pdf.addPage(); y = M; }
    pdf.setFillColor(249, 115, 22); pdf.rect(M, y, 3, 56, 'F');
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); pdf.setTextColor(20, 20, 28);
    pdf.text((idx + 1) + '. ' + (s.name || s.email), M + 10, y + 12);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(80, 80, 80);
    pdf.text(s.email, M + 10, y + 26);
    pdf.text('Assigned:  ' + (s.sentAt ? new Date(s.sentAt).toLocaleString() : '—'), M + 10, y + 38);
    pdf.text('Signed:    ' + (s.signedAt ? new Date(s.signedAt).toLocaleString() : '— (pending)'), M + 10, y + 50);
    if (s.signedAt) {
      // find this signer's first signature image to thumbnail
      const f = (doc.workflow.fields || []).find((fx) => (fx.signerEmail || '').toLowerCase() === (s.email || '').toLowerCase() && fx.value);
      if (f) { try { pdf.addImage(f.value, 'PNG', PW - M - 130, y + 6, 110, 46); } catch (e) {} }
      pdf.setFontSize(7); pdf.setTextColor(120, 120, 120);
      pdf.text('Signature type: ' + (s.signatureKind || '—') + (s.signatureLabel ? '  ·  ' + s.signatureLabel : ''), M + 10, y + 60);
    }
    y += 76;
  });
  return pdf.output('blob');
}

/* ── main DocumentPortal component ─────────────────────────────────── */
export default function DocumentPortal({ user, allUsers, onExit }) {
  const [index, setIndex] = useState({ folders: [], docs: [], rev: 0 });
  const [loading, setLoading] = useState(true);
  const [currentFolder, setCurrentFolder] = useState(null); // folder id or null=root
  const [uploadOpen, setUploadOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [markupDoc, setMarkupDoc] = useState(null);
  const [signingDoc, setSigningDoc] = useState(null);
  const [auditDoc, setAuditDoc] = useState(null);
  const [savedSigs, setSavedSigs] = useState([]);
  const [mob, setMob] = useState(typeof window !== 'undefined' && window.innerWidth < 768);
  const [filter, setFilter] = useState(''); // '' | 'forme'
  const isAdmin = !!(user && user.role === 'admin');

  useEffect(() => { const h = () => setMob(window.innerWidth < 768); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); }, []);

  const refresh = useCallback(async () => {
    try { const r = await fetch(ENDPOINT, { cache: 'no-store' }); if (r.ok) setIndex(await r.json()); } catch (e) {}
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    let alive = true;
    fetch(SIG_ENDPOINT + '?userId=' + encodeURIComponent(user.id), { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).then((j) => { if (alive && j && Array.isArray(j.signatures)) setSavedSigs(j.signatures); }).catch(() => {});
    return () => { alive = false; };
  }, [user.id]);

  async function saveSignature(sig) {
    setSavedSigs([sig].concat(savedSigs).slice(0, 20));
    try { await fetch(SIG_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: user.id, signature: sig }) }); } catch (e) {}
  }
  async function deleteSignature(id) {
    setSavedSigs(savedSigs.filter((s) => s.id !== id));
    try { await fetch(SIG_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: user.id, deleteId: id }) }); } catch (e) {}
  }

  async function createFolder(name) {
    if (!name || !name.trim()) return;
    const f = { id: uid('f'), name: name.trim(), parentId: currentFolder, createdAt: Date.now(), createdBy: user.name || '' };
    try { const r = await fetch(ENDPOINT + '?folder=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folder: f }) }); if (r.ok) setIndex(await r.json()); } catch (e) {}
  }
  async function deleteFolder(id) {
    if (!window.confirm('Delete this folder? Files inside it will be moved to the root.')) return;
    try { const r = await fetch(ENDPOINT + '?delete=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'folder', id }) }); if (r.ok) setIndex(await r.json()); } catch (e) {}
  }
  async function deleteDoc(id, name) {
    if (!window.confirm('Delete "' + name + '"? This cannot be undone.')) return;
    try { const r = await fetch(ENDPOINT + '?delete=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'doc', id }) }); if (r.ok) setIndex(await r.json()); } catch (e) {}
  }
  async function uploadFile(file) {
    const id = uid('d'); const isPdf = (file.type || '').indexOf('pdf') >= 0 || /\.pdf$/i.test(file.name);
    const doc = { id, type: isPdf ? 'pdf' : 'file', name: file.name, folderId: currentFolder, uploadedBy: user.name || '', uploadedAt: Date.now(), mime: file.type || 'application/octet-stream', size: file.size, chunks: 0 };
    try {
      const chunks = await uploadChunks(id, file, 'orig');
      doc.chunks = chunks;
      const r = await fetch(ENDPOINT + '?upsert=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doc }) });
      if (!r.ok) throw new Error('save');
      await refresh();
    } catch (e) { window.alert('Upload failed: ' + e.message); }
  }
  async function downloadDoc(d, kind) {
    try {
      const k = kind || 'orig';
      const chunks = k === 'signed' ? (d.workflow && d.workflow.signedChunks) || 0 : (d.chunks || 0);
      const blob = await downloadBlob(d.id, chunks, d.mime || 'application/octet-stream', k);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = (k === 'signed' ? 'SIGNED_' : '') + d.name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { window.alert('Download failed: ' + e.message); }
  }
  async function viewDoc(d) {
    try {
      const blob = await downloadBlob(d.id, d.chunks || 0, d.mime || 'application/pdf', 'orig');
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { window.alert('Open failed: ' + e.message); }
  }
  async function generateSignedAndStore(d) {
    try {
      const origBlob = await downloadBlob(d.id, d.chunks || 0, 'application/pdf', 'orig');
      const origAB = await origBlob.arrayBuffer();
      const signedBlob = await buildSignedPDF(d, origAB);
      const file = new File([signedBlob], 'signed.pdf', { type: 'application/pdf' });
      const chunks = await uploadChunks(d.id, file, 'signed');
      const next = Object.assign({}, d, { workflow: Object.assign({}, d.workflow, { signedChunks: chunks }) });
      await fetch(ENDPOINT + '?upsert=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doc: next }) });
      await refresh();
      // immediately download
      const url = URL.createObjectURL(signedBlob);
      const a = document.createElement('a'); a.href = url; a.download = 'SIGNED_' + d.name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { window.alert('Signed PDF generation failed: ' + (e.message || e)); }
  }

  /* derive lists */
  const folderTree = useMemo(() => {
    const byParent = {};
    (index.folders || []).forEach((f) => { const p = f.parentId || '__root__'; (byParent[p] = byParent[p] || []).push(f); });
    return byParent;
  }, [index.folders]);

  const breadcrumb = useMemo(() => {
    const out = [{ id: null, name: 'All Documents' }];
    let cur = currentFolder ? (index.folders || []).find((f) => f.id === currentFolder) : null;
    const trail = [];
    while (cur) { trail.unshift(cur); cur = cur.parentId ? (index.folders || []).find((f) => f.id === cur.parentId) : null; }
    trail.forEach((f) => out.push(f));
    return out;
  }, [currentFolder, index.folders]);

  const myEmail = (user.email || '').toLowerCase();
  const visibleDocs = (index.docs || []).filter((d) => {
    if (!d) return false;
    if (filter === 'forme') {
      const wf = d.workflow; if (!wf || wf.status !== 'sent') return false;
      const me = (wf.signers || []).find((s) => (s.email || '').toLowerCase() === myEmail);
      return !!me && !me.signedAt;
    }
    if (currentFolder == null) return !d.folderId;
    return d.folderId === currentFolder;
  });

  const pendingForMe = (index.docs || []).filter((d) => {
    const wf = d && d.workflow; if (!wf || wf.status !== 'sent') return false;
    const me = (wf.signers || []).find((s) => (s.email || '').toLowerCase() === myEmail);
    return !!me && !me.signedAt;
  }).length;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, overflowY: 'auto', background: BG, color: TEXT, padding: mob ? '20px 14px' : '40px 48px' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <div style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, ...NB, fontSize: 12, letterSpacing: '2px', textTransform: 'uppercase', color: ORANGE, marginBottom: 16 }} onClick={onExit}>← Back to Dashboard</div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 4 }}>
          <div style={{ ...BB, fontSize: mob ? 'clamp(30px,8vw,46px)' : 'clamp(36px,5vw,56px)', letterSpacing: 2 }}>DOCUMENT PORTAL</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {pendingForMe > 0 && (
              <button onClick={() => { setCurrentFolder(null); setFilter(filter === 'forme' ? '' : 'forme'); }} style={{ ...ghost, color: filter === 'forme' ? '#fff' : ORANGE, background: filter === 'forme' ? ORANGE : 'transparent' }}>📝 For My Signature ({pendingForMe})</button>
            )}
            {isAdmin && <button onClick={() => setNewFolderOpen(true)} style={ghost}>+ Folder</button>}
            <label style={Object.assign({}, cta, { cursor: 'pointer', display: 'inline-block' })}>+ Upload File<input type="file" hidden onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) uploadFile(f); e.target.value = ''; }} /></label>
          </div>
        </div>
        <div style={{ ...NB, fontSize: 13, color: MID, marginBottom: 18 }}>Cloud-stored agreements, board minutes, and signed PDFs · Send for e-signature with audit trail and verified-signature watermark.</div>

        {/* Breadcrumb */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
          {breadcrumb.map((b, i) => (
            <span key={b.id || 'root'} onClick={() => { setCurrentFolder(b.id); setFilter(''); }} style={{ ...NB, fontSize: 13, color: i === breadcrumb.length - 1 ? TEXT : ORANGE, cursor: i === breadcrumb.length - 1 ? 'default' : 'pointer', fontWeight: i === breadcrumb.length - 1 ? 700 : 500 }}>
              {b.name}{i < breadcrumb.length - 1 && <span style={{ color: DIM, margin: '0 6px' }}>›</span>}
            </span>
          ))}
        </div>

        {loading && <div style={{ textAlign: 'center', padding: 40, color: DIM }}>Loading documents…</div>}

        {!loading && (
          <div style={{ display: 'grid', gridTemplateColumns: mob ? '1fr' : 'minmax(180px,260px) 1fr', gap: 18 }}>
            {/* Folder rail */}
            <div style={{ background: CARD, border: '1px solid ' + BORDER, padding: 12 }}>
              <div style={{ ...kicker, marginBottom: 8 }}>Folders</div>
              <div onClick={() => { setCurrentFolder(null); setFilter(''); }} style={{ padding: '6px 8px', cursor: 'pointer', background: !currentFolder && filter !== 'forme' ? 'rgba(249,115,22,.1)' : 'transparent', color: !currentFolder && filter !== 'forme' ? ORANGE : TEXT, ...NB, fontSize: 13 }}>📁 All Documents ({(index.docs || []).filter((d) => !d.folderId).length})</div>
              <FolderTreeRail folders={index.folders || []} docs={index.docs || []} byParent={folderTree} parentId="__root__" depth={0} current={currentFolder} onPick={(id) => { setCurrentFolder(id); setFilter(''); }} onDelete={isAdmin ? deleteFolder : null} />
              {isAdmin && (
                <div style={{ borderTop: '1px solid ' + BORDER, marginTop: 10, paddingTop: 10 }}>
                  <button onClick={() => setUploadOpen(true)} style={Object.assign({}, lineBtn, { width: '100%', textAlign: 'left' })}>+ Saved Signatures ({savedSigs.length})</button>
                </div>
              )}
            </div>

            {/* File list */}
            <div>
              {filter === 'forme' && <div style={{ background: 'rgba(249,115,22,.08)', border: '1px solid ' + ORANGE, padding: '10px 14px', marginBottom: 12, ...NB, fontSize: 13, color: ORANGE }}>Showing only documents pending <strong>your</strong> signature.</div>}
              {visibleDocs.length === 0 ? (
                <div style={{ background: CARD, border: '1px solid ' + BORDER, padding: 40, textAlign: 'center' }}>
                  <div style={{ ...BB, fontSize: 22, color: DIM, marginBottom: 6 }}>NO DOCUMENTS HERE</div>
                  <div style={{ ...NB, fontSize: 13, color: MID }}>Click <strong>+ Upload File</strong> above to add an agreement, PDF, spreadsheet, or note.</div>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  {visibleDocs.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0)).map((d) => {
                    const wf = d.workflow; const status = (wf && wf.status) || 'none';
                    const myField = wf && (wf.signers || []).find((s) => (s.email || '').toLowerCase() === myEmail);
                    const allDone = status === 'completed';
                    const statusBadge = status === 'none' ? null : { label: status === 'sent' ? 'AWAITING SIGNATURES' : 'COMPLETED', color: status === 'completed' ? GREEN : ORANGE };
                    const numSigners = (wf && (wf.signers || []).length) || 0;
                    const numSigned = (wf && (wf.signers || []).filter((s) => s.signedAt).length) || 0;
                    return (
                      <div key={d.id} style={{ background: CARD, border: '1px solid ' + BORDER, padding: '14px 18px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                          <div style={{ flex: 1, minWidth: 220 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <div style={{ ...BB, fontSize: 18, letterSpacing: 1, color: TEXT }}>{d.type === 'pdf' ? '📄' : '📎'} {d.name}</div>
                              {statusBadge && <span style={{ ...NB, fontSize: 10, letterSpacing: '1.5px', padding: '3px 8px', background: statusBadge.color + '1f', color: statusBadge.color, fontWeight: 700 }}>{statusBadge.label}{status === 'sent' ? ' (' + numSigned + '/' + numSigners + ')' : ''}</span>}
                            </div>
                            <div style={{ ...NB, fontSize: 12, color: MID, marginTop: 2 }}>{fmtSize(d.size)} · uploaded {fmtDT(d.uploadedAt)}{d.uploadedBy ? ' by ' + d.uploadedBy : ''}</div>
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {myField && !myField.signedAt && status === 'sent' && <button onClick={() => setSigningDoc(d)} style={Object.assign({}, cta, { background: ORANGE })}>Sign Now →</button>}
                            {d.type === 'pdf' && <button onClick={() => viewDoc(d)} style={lineBtn}>View</button>}
                            <button onClick={() => downloadDoc(d, 'orig')} style={lineBtn}>Download</button>
                            {isAdmin && d.type === 'pdf' && status !== 'completed' && <button onClick={() => setMarkupDoc(d)} style={ghost}>{status === 'sent' ? 'Edit Workflow' : 'Send for Signature →'}</button>}
                            {allDone && <button onClick={() => (wf.signedChunks ? downloadDoc(d, 'signed') : generateSignedAndStore(d))} style={Object.assign({}, cta, { background: GREEN, color: '#fff' })}>Download Signed</button>}
                            {wf && wf.status && wf.status !== 'none' && <button onClick={() => setAuditDoc(d)} style={lineBtn}>Audit</button>}
                            {isAdmin && <button onClick={() => deleteDoc(d.id, d.name)} style={Object.assign({}, lineBtn, { color: RED, borderColor: 'rgba(220,38,38,.3)' })}>Delete</button>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Saved signatures inline (for any user) */}
        {savedSigs.length > 0 && (
          <div style={{ marginTop: 22, background: CARD, border: '1px solid ' + BORDER, padding: 14 }}>
            <div style={{ ...kicker, marginBottom: 8 }}>Your Saved Signatures</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {savedSigs.map((s) => (
                <div key={s.id} style={{ border: '1px solid ' + BORDER, padding: 8, background: '#fff' }}>
                  <img src={s.data} alt="sig" style={{ height: 40, maxWidth: 180, objectFit: 'contain' }} />
                  <div style={{ ...NB, fontSize: 10, color: MID, marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span>{fmtDT(s.savedAt)}</span>
                    <span onClick={() => deleteSignature(s.id)} style={{ cursor: 'pointer', color: RED }}>delete</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {newFolderOpen && <NewFolderModal onClose={() => setNewFolderOpen(false)} onCreate={(n) => { createFolder(n); setNewFolderOpen(false); }} />}
      {markupDoc && <MarkupModal doc={markupDoc} allUsers={allUsers} currentUser={user} onClose={() => setMarkupDoc(null)} onSent={() => refresh()} />}
      {signingDoc && <SignModal doc={signingDoc} currentUser={user} savedSigs={savedSigs} onClose={() => setSigningDoc(null)} onSigned={(nd) => { refresh(); if (nd.workflow && nd.workflow.status === 'completed') { setTimeout(() => generateSignedAndStore(nd), 300); } }} onSaveSig={saveSignature} />}
      {auditDoc && <AuditModal doc={auditDoc} onClose={() => setAuditDoc(null)} />}
    </div>
  );
}

function FolderTreeRail({ folders, docs, byParent, parentId, depth, current, onPick, onDelete }) {
  const list = byParent[parentId] || [];
  if (!list.length) return null;
  return (
    <div style={{ marginLeft: depth ? 14 : 0 }}>
      {list.sort((a, b) => (a.name || '').localeCompare(b.name || '')).map((f) => {
        const sub = byParent[f.id] || [];
        const docCount = (docs || []).filter((d) => d.folderId === f.id).length;
        return (
          <div key={f.id}>
            <div onClick={() => onPick(f.id)} style={{ padding: '6px 8px', cursor: 'pointer', background: current === f.id ? 'rgba(249,115,22,.1)' : 'transparent', color: current === f.id ? ORANGE : TEXT, ...NB, fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
              📁 <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
              <span style={{ color: DIM, fontSize: 11 }}>({docCount})</span>
              {onDelete && <span onClick={(e) => { e.stopPropagation(); onDelete(f.id); }} style={{ color: DIM, cursor: 'pointer', padding: '0 4px' }}>×</span>}
            </div>
            <FolderTreeRail folders={folders} docs={docs} byParent={byParent} parentId={f.id} depth={depth + 1} current={current} onPick={onPick} onDelete={onDelete} />
          </div>
        );
      })}
    </div>
  );
}

function NewFolderModal({ onClose, onCreate }) {
  const [n, setN] = useState('');
  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={modal(420)}>
        <div style={{ ...BB, fontSize: 22, letterSpacing: 1.5, color: TEXT, marginBottom: 14 }}>NEW FOLDER</div>
        <input autoFocus value={n} onChange={(e) => setN(e.target.value)} placeholder="e.g. Q3 Board Meeting" onKeyDown={(e) => { if (e.key === 'Enter') onCreate(n); }} style={{ width: '100%', ...NB, fontSize: 15, padding: '10px 12px', border: '1px solid ' + BORDER, outline: 'none', marginBottom: 12 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => onCreate(n)} disabled={!n.trim()} style={Object.assign({}, cta, { flex: 1, padding: '11px 0', opacity: n.trim() ? 1 : .5 })}>Create</button>
          <button onClick={onClose} style={Object.assign({}, lineBtn, { padding: '11px 16px' })}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function AuditModal({ doc, onClose }) {
  const wf = doc.workflow || {};
  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={modal(640)}>
        <div style={{ ...BB, fontSize: 24, letterSpacing: 1.5, color: TEXT }}>SIGNATURE AUDIT TRAIL</div>
        <div style={{ ...NB, fontSize: 13, color: MID, marginTop: 4, marginBottom: 14 }}>{doc.name}</div>
        <div style={{ ...NB, fontSize: 12, color: MID, marginBottom: 14, padding: '10px 12px', background: '#fafafa', border: '1px solid ' + BORDER }}>
          <div>Status: <strong style={{ color: wf.status === 'completed' ? GREEN : ORANGE }}>{(wf.status || 'none').toUpperCase()}</strong></div>
          <div>Sent: {fmtDT(wf.sentAt)} {wf.sentBy ? '· by ' + wf.sentBy : ''}</div>
          <div>Completed: {wf.completedAt ? fmtDT(wf.completedAt) : '— (in progress)'}</div>
        </div>
        <div style={{ ...kicker, marginBottom: 8 }}>Signers</div>
        {(wf.signers || []).map((s, i) => (
          <div key={s.id || i} style={{ padding: '10px 12px', border: '1px solid ' + BORDER, marginBottom: 8, background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {s.color && <span style={{ width: 12, height: 12, background: s.color }} />}
              <div style={{ flex: 1 }}>
                <div style={{ ...NB, fontSize: 14, color: TEXT, fontWeight: 600 }}>{s.name}</div>
                <div style={{ ...NB, fontSize: 11, color: MID }}>{s.email}</div>
              </div>
              <span style={{ ...NB, fontSize: 10, letterSpacing: '1.5px', padding: '3px 8px', background: (s.signedAt ? GREEN : ORANGE) + '1f', color: s.signedAt ? GREEN : ORANGE, fontWeight: 700 }}>{s.signedAt ? 'SIGNED' : 'PENDING'}</span>
            </div>
            <div style={{ ...NB, fontSize: 11, color: MID, marginTop: 6 }}>Assigned {fmtDT(s.sentAt)}{s.signedAt ? ' · Signed ' + fmtDT(s.signedAt) : ''}</div>
          </div>
        ))}
        <button onClick={onClose} style={Object.assign({}, ghost, { width: '100%', marginTop: 8, padding: '10px 0' })}>Close</button>
      </div>
    </div>
  );
}
