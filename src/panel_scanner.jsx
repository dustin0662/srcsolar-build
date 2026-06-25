import React, { useState, useEffect, useRef, useCallback } from "react"
import { BrowserMultiFormatReader } from "@zxing/browser"
import { DecodeHintType, BarcodeFormat } from "@zxing/library"

// ─────────────────────────────────────────────────────────────────────────────
// Panel Scanner — mobile-first field tool (Android + iOS)
// Photograph a solar panel, decode its barcode/serial, and log it against a
// project → section → row → panel hierarchy. Built for ~20k scans per project:
// row data is sharded server-side so only the open row's panels load. No login
// required — an operator name is captured locally and tied to every entry, and
// multiple people can work the same project at once (writes are conflict-safe,
// the view polls so everyone sees each other's panels live). Each section syncs
// to its own tab in a Google Sheet via an Apps Script webhook.
// ─────────────────────────────────────────────────────────────────────────────

const API = "/.netlify/functions/scanner"
const A = "#F97316", INK = "#1a1a2e"
const BB = { fontFamily: "'Bebas Neue',sans-serif" }
const NB = { fontFamily: "'Barlow Condensed',sans-serif" }
const PROJ_COLORS = ["#F97316", "#EAB308", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#14b8a6", "#ef4444"]
const IS_IOS = typeof navigator !== "undefined" && (/iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1))

// Restrict to 1D (linear) barcodes only — panel serial labels are always linear.
// All 2D/matrix codes (QR, Data Matrix, Aztec, PDF417) are intentionally excluded
// so a stray QR code in frame is never decoded or logged. ITF/Codabar/RSS are
// also excluded — they produce false positives (e.g. random lines as "2222222222").
const ZX_FORMATS = [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]
const ND_FORMATS = ["code_128", "code_39", "code_93", "ean_13", "ean_8", "upc_a", "upc_e"]
function zxHints() { const h = new Map(); h.set(DecodeHintType.TRY_HARDER, true); h.set(DecodeHintType.POSSIBLE_FORMATS, ZX_FORMATS); return h }
function makeDetector() { try { return new window.BarcodeDetector({ formats: ND_FORMATS }) } catch (e) { return new window.BarcodeDetector() } }
const POLL_MS = 8000
const OP_KEY = "scanner_operator"

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
const fmtTime = (d) => { if (!d) return ""; const t = new Date(d); return t.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) }

const IST = { width: "100%", background: "#f9f7f5", border: "1px solid rgba(0,0,0,.16)", color: INK, padding: "14px 14px", fontFamily: "'Barlow',sans-serif", fontSize: 16, outline: "none", borderRadius: 8, WebkitAppearance: "none" }
const BTN = { background: A, color: "#1a1206", border: "none", padding: "15px 22px", ...NB, fontWeight: 700, fontSize: 15, letterSpacing: "1.5px", textTransform: "uppercase", cursor: "pointer", borderRadius: 8, minHeight: 50 }
const BTN_GHOST = { background: "#fff", color: "#555", border: "1px solid rgba(0,0,0,.18)", padding: "14px 18px", ...NB, fontSize: 14, letterSpacing: "1.5px", textTransform: "uppercase", cursor: "pointer", borderRadius: 8, minHeight: 48 }

// Load a File into an <img>.
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

// Draw an image onto a canvas scaled to a max edge (Safari/Chrome auto-apply EXIF).
function canvasFrom(img, maxEdge) {
  let { width: w, height: h } = img
  const scale = Math.min(1, maxEdge / Math.max(w, h))
  w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale))
  const cv = document.createElement("canvas")
  cv.width = w; cv.height = h
  cv.getContext("2d").drawImage(img, 0, 0, w, h)
  return cv
}

// Rotate src by 90/180/270 degrees into the provided dst canvas (reused across
// rotations to avoid allocating a new full-size canvas each time — important on
// low-RAM devices).
function rotateInto(src, deg, dst) {
  const swap = deg === 90 || deg === 270
  dst.width = swap ? src.height : src.width
  dst.height = swap ? src.width : src.height
  const ctx = dst.getContext("2d")
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, dst.width, dst.height)
  ctx.translate(dst.width / 2, dst.height / 2)
  ctx.rotate(deg * Math.PI / 180)
  ctx.drawImage(src, -src.width / 2, -src.height / 2)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  return dst
}

// Decode a barcode/QR from a canvas.
// Android: native BarcodeDetector (fast, robust) — primary path, unchanged.
// iOS Safari / desktop (no BarcodeDetector): ZXing with TRY_HARDER, retried at
// several rotations to handle EXIF-rotated iPhone photos and vertical barcodes.
async function decodeBarcode(canvas) {
  let scratch = null
  // Rotate into a single reused scratch canvas (deg 0 uses the original).
  const rot = (deg) => { if (!deg) return canvas; if (!scratch) scratch = document.createElement("canvas"); return rotateInto(canvas, deg, scratch) }
  const done = (r) => { freeCanvas(scratch); return r }
  try {
    if (typeof window !== "undefined" && "BarcodeDetector" in window) {
      const det = makeDetector()
      for (const deg of [0, 90, 270]) {
        const codes = await det.detect(rot(deg))
        if (codes && codes.length) {
          const b = deg === 0 && codes[0].boundingBox
          const box = b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null // crop only at 0° (un-rotated coords)
          return done({ serial: String(codes[0].rawValue || "").trim(), format: codes[0].format || "native", box })
        }
      }
    }
  } catch (e) { /* fall through to zxing */ }
  const reader = new BrowserMultiFormatReader(zxHints()) // one reader, reused across rotations
  for (const deg of [0, 90, 270, 180]) {
    try {
      const res = await reader.decodeFromCanvas(rot(deg))
      if (res) {
        let fmt = ""; try { fmt = String(res.getBarcodeFormat()) } catch (e) {}
        let box = null
        if (deg === 0) { try { const pts = res.getResultPoints && res.getResultPoints(); if (pts && pts.length) { const xs = pts.map((p) => p.getX()), ys = pts.map((p) => p.getY()); box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) } } } catch (e) {} }
        return done({ serial: String(res.getText() || "").trim(), format: fmt, box })
      }
    } catch (e) { /* not found at this rotation — try next */ }
  }
  return done(null)
}

// Decode resolution. Kept modest so low-RAM phones don't OOM building canvases
// from a full-res camera photo. Lower still on devices reporting low RAM.
const DECODE_EDGE = (() => {
  const m = typeof navigator !== "undefined" ? navigator.deviceMemory : undefined
  if (m && m <= 2) return 900
  if (m && m <= 4) return 1100
  return 1280
})()

// Read image pixel dimensions from the file header WITHOUT decoding the pixels
// (reads only the first 64 KB). Avoids allocating a full-res bitmap just to learn
// the size — critical on ~2 GB phones. Returns {w,h} or null.
async function readImageSize(file) {
  try {
    const dv = new DataView(await file.slice(0, 65536).arrayBuffer())
    if (dv.byteLength > 24 && dv.getUint16(0) === 0xFFD8) { // JPEG
      let off = 2
      while (off + 9 < dv.byteLength) {
        if (dv.getUint8(off) !== 0xFF) { off++; continue }
        const marker = dv.getUint8(off + 1)
        if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
          return { w: dv.getUint16(off + 7), h: dv.getUint16(off + 5) }
        }
        off += 2 + dv.getUint16(off + 2)
      }
    } else if (dv.byteLength > 24 && dv.getUint32(0) === 0x89504E47) { // PNG
      return { w: dv.getUint32(16), h: dv.getUint32(20) }
    }
  } catch (e) {}
  return null
}

// Load a File into a downscaled canvas for decoding, without ever holding the
// full-resolution image in memory: parse the size from the header, then ask
// createImageBitmap to decode + downscale in one step. Falls back to <img>.
async function decodeCanvasFromFile(file, maxEdge) {
  try {
    const size = await readImageSize(file)
    let opts
    if (size && size.w && size.h) {
      const scale = Math.min(1, maxEdge / Math.max(size.w, size.h))
      if (scale < 1) opts = { resizeWidth: Math.max(1, Math.round(size.w * scale)), resizeHeight: Math.max(1, Math.round(size.h * scale)), resizeQuality: "medium" }
    }
    const bmp = await createImageBitmap(file, opts || {})
    // Guard: if resize wasn't applied (no opts / unsupported), downscale on draw.
    const s2 = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * s2)), h = Math.max(1, Math.round(bmp.height * s2))
    const cv = document.createElement("canvas")
    cv.width = w; cv.height = h
    cv.getContext("2d").drawImage(bmp, 0, 0, w, h)
    try { bmp.close && bmp.close() } catch (e) {}
    return cv
  } catch (e) {
    // Fallback: object-URL <img> path (higher peak memory, but rarely reached).
    const img = await loadImage(file)
    const cv = canvasFrom(img, maxEdge)
    try { URL.revokeObjectURL(img.src) } catch (er) {}
    return cv
  }
}

// Free a canvas's backing store promptly (helps low-RAM devices).
function freeCanvas(cv) { try { if (cv) { cv.width = 0; cv.height = 0 } } catch (e) {} }


// stored audit photo is tiny. Returns null when the box is too small/unreliable.
function cropToLabel(src, box) {
  if (!box || box.w <= 0) return null
  let { x, y, w, h } = box
  if (h < w * 0.15) { const nh = w * 0.5; y -= (nh - h) / 2; h = nh } // 1D line has ~0 height — synthesize
  const padX = w * 0.18, padY = h * 0.35
  x -= padX; y -= padY; w += padX * 2; h += padY * 2
  x = Math.max(0, x); y = Math.max(0, y)
  w = Math.min(src.width - x, w); h = Math.min(src.height - y, h)
  if (w < src.width * 0.12 || h < src.height * 0.04) return null
  const cv = document.createElement("canvas")
  cv.width = Math.round(w); cv.height = Math.round(h)
  cv.getContext("2d").drawImage(src, x, y, w, h, 0, 0, cv.width, cv.height)
  return cv
}

const sortScans = (scans) => (scans || []).slice().sort((a, b) => (a.panel || 0) - (b.panel || 0))

// Fallback OCR: read the human-readable digits when the barcode won't decode
// (mainly iPhone). Lazy-loaded so Tesseract only downloads when actually needed.
// Restricted to digits; returns the longest digit run as a best-effort guess.
async function ocrDigits(canvas) {
  try {
    const { createWorker } = await import("tesseract.js")
    const worker = await createWorker("eng")
    try {
      await worker.setParameters({ tessedit_char_whitelist: "0123456789" })
      const { data } = await worker.recognize(canvas)
      const runs = String((data && data.text) || "").match(/\d{5,}/g)
      if (runs && runs.length) { runs.sort((a, b) => b.length - a.length); return runs[0] }
      return null
    } finally { try { await worker.terminate() } catch (e) {} }
  } catch (e) { return null }
}

// Exact missing panel numbers within a fully-loaded row's scans.
function missingFromScans(scans, target) {
  const have = new Set((scans || []).map((s) => s.panel))
  const max = (scans || []).reduce((mx, s) => Math.max(mx, s.panel || 0), 0)
  const t = target && target > 0 ? target : max
  const miss = []
  for (let i = 1; i <= t; i++) if (!have.has(i)) miss.push(i)
  return miss
}

export default function PanelScanner({ onExit, portalUser }) {
  const [m, setM] = useState(typeof window !== "undefined" && window.innerWidth < 768)
  useEffect(() => { const r = () => setM(window.innerWidth < 768); window.addEventListener("resize", r); window.addEventListener("orientationchange", r); return () => { window.removeEventListener("resize", r); window.removeEventListener("orientationchange", r) } }, [])

  const [op, setOp] = useState(() => {
    try { return localStorage.getItem(OP_KEY) || "" } catch (e) { return "" }
  })
  const [askName, setAskName] = useState(false)
  useEffect(() => {
    if (op) return
    const fromPortal = (portalUser && (portalUser.name || portalUser.email)) || (typeof portalUser === "string" ? portalUser : "")
    if (fromPortal) { setOp(fromPortal); try { localStorage.setItem(OP_KEY, fromPortal) } catch (e) {} }
    else setAskName(true)
  }, []) // eslint-disable-line
  function saveOp(name) { const n = (name || "").trim(); if (!n) return; setOp(n); try { localStorage.setItem(OP_KEY, n) } catch (e) {} setAskName(false) }

  const [tree, setTree] = useState({ projects: [], webhook: "" })
  const [summary, setSummary] = useState({})
  const [rowDoc, setRowDoc] = useState({ scans: [] })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [installEvt, setInstallEvt] = useState(null) // Android: captured beforeinstallprompt
  const standalone = typeof window !== "undefined" && ((window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true)

  const [projId, setProjId] = useState(null)
  const [secId, setSecId] = useState(null)
  const [rowId, setRowId] = useState(null)

  const [showSettings, setShowSettings] = useState(false)
  const [prompt, setPrompt] = useState(null)
  const [capture, setCapture] = useState(null)
  const [panelNo, setPanelNo] = useState(1)
  const [scanning, setScanning] = useState(false)
  const [camErr, setCamErr] = useState("")
  const [okFlash, setOkFlash] = useState(false)
  const [settling, setSettling] = useState(false)
  const [steady, setSteady] = useState(() => { try { return localStorage.getItem("scanner_steady") !== "0" } catch (e) { return true } })
  const [photoMode, setPhotoMode] = useState(() => { try { return localStorage.getItem("scanner_photomode") === "1" } catch (e) { return false } })
  const [editing, setEditing] = useState(null)
  const [viewScan, setViewScan] = useState(null) // tapped panel — detail viewer
  const [qcScanning, setQcScanning] = useState(false) // re-scan in progress in the carousel
  const [dlg, setDlg] = useState(null) // in-app prompt/confirm (native dialogs are blocked on mobile)

  const fileRef = useRef(null)
  const uploadRef = useRef(null)
  const rowIdRef = useRef(null); rowIdRef.current = rowId
  const restoredRef = useRef(false) // boot restore runs at most once
  const capDefaultsRef = useRef({ panel: 1 })
  const logScanRef = useRef(null) // latest logScan, so the live scanner avoids stale closures
  const audioRef = useRef(null) // WebAudio context for scan beep (created on user gesture)

  // Short confirmation beep (Web Audio) + haptic buzz. Beep needs an AudioContext
  // unlocked by a user gesture (Start Scanning); vibrate is Android-only (no-op on iOS).
  function scanFeedback() {
    try {
      const ctx = audioRef.current
      if (ctx) {
        const o = ctx.createOscillator(), g = ctx.createGain()
        o.type = "sine"; o.frequency.value = 880
        o.connect(g); g.connect(ctx.destination)
        const t = ctx.currentTime
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(0.3, t + 0.01)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
        o.start(t); o.stop(t + 0.17)
      }
    } catch (e) {}
    try { if (navigator.vibrate) navigator.vibrate(60) } catch (e) {}
  }
  function unlockAudio() {
    try {
      if (!audioRef.current) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) audioRef.current = new AC() }
      if (audioRef.current && audioRef.current.resume) audioRef.current.resume()
    } catch (e) {}
  }

  const flash = (msg, kind = "ok") => { setToast({ msg, kind }); setTimeout(() => setToast(null), 2800) }

  // Mobile-safe replacements for window.prompt / window.confirm (which Android
  // Chrome and some webviews silently suppress). Both return a Promise.
  const askForm = (title, fields, submitLabel = "Save") => new Promise((resolve) => setDlg({ type: "form", title, fields, submitLabel, resolve }))
  const askConfirm = (message, opts = {}) => new Promise((resolve) => setDlg({ type: "confirm", title: opts.title || "Please Confirm", message, danger: opts.danger, okLabel: opts.okLabel || "OK", resolve }))

  const fetchTree = useCallback(async () => { try { const r = await fetch(API, { cache: "no-store" }); const d = await r.json(); setTree({ projects: d.projects || [], webhook: d.webhook || "" }) } catch (e) {} }, [])
  const fetchSummary = useCallback(async () => { try { const r = await fetch(API + "?summary", { cache: "no-store" }); const d = await r.json(); setSummary(d.summary || {}) } catch (e) {} }, [])
  const fetchRow = useCallback(async (id) => { if (!id) return; try { const r = await fetch(API + "?row=" + id, { cache: "no-store" }); const d = await r.json(); if (rowIdRef.current === id) setRowDoc({ scans: d.scans || [] }) } catch (e) {} }, [])

  useEffect(() => { (async () => { await Promise.all([fetchTree(), fetchSummary()]); setLoading(false) })() }, [fetchTree, fetchSummary])

  // Restore the last project/section/row after boot so an OOM-induced silent
  // page reload (budget Androids in Photo mode) drops the user right back on
  // their row at the correct next panel — not the projects list. Runs once,
  // validating each level against the freshly-loaded tree (another user may have
  // removed one), and only when the user hasn't already navigated.
  useEffect(() => {
    if (loading || restoredRef.current) return
    restoredRef.current = true // also unlocks the persist effect below
    try {
      const raw = localStorage.getItem("scanner_nav")
      if (!raw || projId) return
      const nav = JSON.parse(raw) || {}
      const p = tree.projects.find((x) => x.id === nav.projId); if (!p) return
      setProjId(p.id)
      const s = (p.sections || []).find((x) => x.id === nav.secId); if (!s) return
      setSecId(s.id)
      const r = (s.rows || []).find((x) => x.id === nav.rowId); if (!r) return
      setRowId(r.id); loadRow(r.id)
    } catch (e) {}
  }, [loading, tree])

  // Persist the selection on every change (including nulls when navigating back)
  // so the restore above has something to return to. Held off until the restore
  // pass runs so the initial null selection can't clobber the stored value.
  useEffect(() => {
    if (!restoredRef.current) return
    try { localStorage.setItem("scanner_nav", JSON.stringify({ projId, secId, rowId })) } catch (e) {}
  }, [projId, secId, rowId])

  // Capture Android's install prompt so we can surface an explicit Install button.
  useEffect(() => {
    const onB = (e) => { e.preventDefault(); setInstallEvt(e) }
    const onI = () => setInstallEvt(null)
    window.addEventListener("beforeinstallprompt", onB)
    window.addEventListener("appinstalled", onI)
    return () => { window.removeEventListener("beforeinstallprompt", onB); window.removeEventListener("appinstalled", onI) }
  }, [])
  async function doInstall() { if (!installEvt) return; try { installEvt.prompt(); await installEvt.userChoice } catch (e) {} setInstallEvt(null) }

  // Live multi-user refresh — keep counts and the open row in sync with others.
  useEffect(() => {
    const t = setInterval(() => { fetchSummary(); if (rowIdRef.current) fetchRow(rowIdRef.current) }, POLL_MS)
    return () => clearInterval(t)
  }, [fetchSummary, fetchRow])

  const proj = tree.projects.find((p) => p.id === projId) || null
  const section = (proj && (proj.sections || []).find((s) => s.id === secId)) || null
  const row = (section && (section.rows || []).find((r) => r.id === rowId)) || null
  capDefaultsRef.current = { panel: panelNo } // latest defaults for live-scan hits
  logScanRef.current = (s, f, p) => logScan(s, f, p) // always call the latest logScan from the live scanner

  // ── Completeness from the lightweight summary index ─────────────────────────
  function rowStat(r) {
    const s = summary[r.id] || { c: 0, x: 0 }
    const target = r.panelTarget > 0 ? r.panelTarget : s.x
    const done = !!r.complete || (target > 0 && s.c >= target && s.x <= target)
    const missing = target > 0 ? Math.max(0, target - s.c) : 0
    return { count: s.c, max: s.x, target, done, missing }
  }
  const sectionDone = (s) => (s.rows || []).length > 0 && (s.rows || []).every((r) => rowStat(r).done)
  // QC: 10% of all logged panels should be manually reviewed.
  function projQC(p) {
    let total = 0, ver = 0
    ;(p.sections || []).forEach((s) => (s.rows || []).forEach((r) => { const su = summary[r.id] || {}; total += su.c || 0; ver += su.q || 0 }))
    const target = Math.ceil(total * 0.1)
    return { total, ver, target, done: total > 0 && ver >= target }
  }

  // ── Persistence ─────────────────────────────────────────────────────────────
  async function saveProjects(projects) {
    setTree((t) => ({ ...t, projects }))
    try { await fetch(API + "?action=projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projects }) }) } catch (e) { flash("Save failed — check connection", "err") }
  }
  const mutateTree = (fn) => { const next = JSON.parse(JSON.stringify(tree.projects)); fn(next); saveProjects(next) }

  async function addProject() {
    const r = await askForm("New Project", [
      { key: "name", label: "Project name", placeholder: "e.g. Midway" },
    ], "Create Project")
    const name = r && (r.name || "").trim(); if (!name) return
    saveProjects(tree.projects.concat([{ id: uid(), name, color: PROJ_COLORS[tree.projects.length % PROJ_COLORS.length], createdAt: Date.now(), sections: [] }]))
  }
  async function editProject(p) {
    const r = await askForm("Edit Project", [
      { key: "name", label: "Project name", value: p.name },
    ])
    const name = r && (r.name || "").trim(); if (!name) return
    mutateTree((t) => { const pp = t.find((x) => x.id === p.id); pp.name = name })
  }
  async function addSection() {
    const r = await askForm("New Section", [{ key: "name", label: "Section name", value: "Section " + ((proj.sections || []).length + 1), placeholder: "e.g. Block A" }], "Create Section")
    const name = r && (r.name || "").trim(); if (!name) return
    mutateTree((t) => { const p = t.find((x) => x.id === projId); p.sections = (p.sections || []).concat([{ id: uid(), name, createdAt: Date.now(), panelsPerRow: 0, rows: [] }]) })
  }
  async function addRow(selectAfter) {
    const r = await askForm("New Row", [
      { key: "name", label: "Row name / number", value: "Row " + ((section.rows || []).length + 1) },
      { key: "target", label: "Expected panels (0 = unknown)", type: "number", value: String(section.panelsPerRow || 0) },
    ], "Create Row")
    const name = r && (r.name || "").trim(); if (!name) return
    const panelTarget = Math.max(0, parseInt(r.target, 10) || 0)
    const id = uid()
    mutateTree((t) => { const s = t.find((x) => x.id === projId).sections.find((x) => x.id === secId); s.rows = (s.rows || []).concat([{ id, name, panelTarget, complete: false, createdAt: Date.now() }]) })
    if (selectAfter) { setRowId(id); setRowDoc({ scans: [] }); setPanelNo(1); setCapture(null) }
    return id
  }
  async function renameRow(r0) {
    const r = await askForm("Edit Row", [
      { key: "name", label: "Row name / number", value: r0.name },
      { key: "target", label: "Expected panels (0 = unknown)", type: "number", value: String(r0.panelTarget || 0) },
    ])
    const name = r && (r.name || "").trim(); if (!name) return
    const panelTarget = Math.max(0, parseInt(r.target, 10) || 0)
    mutateTree((t) => { const rr = t.find((x) => x.id === projId).sections.find((x) => x.id === secId).rows.find((x) => x.id === r0.id); rr.name = name; rr.panelTarget = panelTarget })
  }
  function setRowComplete(r, val) { mutateTree((t) => { const rr = t.find((x) => x.id === projId).sections.find((x) => x.id === secId).rows.find((x) => x.id === r.id); rr.complete = val }) }

  // ── Scanning ────────────────────────────────────────────────────────────────
  // Load a row's scans and set the next panel number from authoritative server
  // data (one past the highest logged panel). Shared by openRow and boot restore.
  async function loadRow(id) {
    try { const res = await fetch(API + "?row=" + id, { cache: "no-store" }); const d = await res.json(); const scans = d.scans || []; setRowDoc({ scans }); setPanelNo(scans.length ? Math.max(...scans.map((s) => s.panel || 0)) + 1 : 1) } catch (e) { flash("Couldn't load row", "err") }
  }
  async function openRow(r) {
    setRowId(r.id); setCapture(null); setRowDoc({ scans: [] })
    await loadRow(r.id)
  }

  // Log one panel. Used by both auto-scan hits and manual entry.
  async function logScan(serial0, format, photo, panelOverride, force) {
    const serial = (serial0 || "").trim()
    if (!serial) { flash("Enter a serial first", "err"); return }
    const panel = Math.max(1, parseInt(panelOverride != null ? panelOverride : panelNo, 10) || panelNo)
    if (!force) {
      const dupe = rowDoc.scans.find((s) => (s.serial || "").trim() === serial)
      if (dupe) { setPrompt({ kind: "dup", serial, existing: dupe.panel, pending: { serial, format, photo, panel } }); return }
    }
    if (!force && row && row.panelTarget > 0 && panel > row.panelTarget) {
      setPrompt({ kind: "over", target: row.panelTarget, pending: { serial, format, photo, panel } })
      return
    }
    const scan = { id: uid(), projectId: projId, sectionId: secId, rowId, panel, serial, raw: serial, format: format || "", ts: Date.now(), by: op, note: "", status: "ok" }
    setBusy(true)
    try {
      await fetch(API + "?action=scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scan, photo: photo || undefined }) })
      setRowDoc((d) => ({ scans: d.scans.concat([photo ? Object.assign({ photoKey: scan.id }, scan) : scan]) }))
      setSummary((sm) => { const cur = sm[rowId] || { c: 0, x: 0 }; return { ...sm, [rowId]: { c: cur.c + 1, x: Math.max(cur.x, panel) } } })
      setPanelNo(panel + 1)
      setOkFlash(true); setTimeout(() => setOkFlash(false), 900)
      scanFeedback()
      flash(`Panel ${panel} logged ✓`, "ok")
      fetchRow(rowId)
      if (row && row.panelTarget > 0 && rowDoc.scans.length + 1 >= row.panelTarget) maybePromptRowComplete(row)
    } catch (e) { flash("Save failed — check connection", "err") }
    setBusy(false)
  }

  // Photo mode: take a sharp native-camera still and decode it. Only auto-log on a
  // real barcode read; never guess. If it can't read the code, prompt the user to
  // enter it manually or retake the photo.
  async function onPickFile(e) {
    const file = e.target.files && e.target.files[0]; e.target.value = ""
    if (!file) return
    setBusy(true)
    try {
      // Decode from a downscaled canvas (low memory — avoids OOM on budget phones).
      const decodeCv = await decodeCanvasFromFile(file, DECODE_EDGE)
      const decoded = await decodeBarcode(decodeCv)
      const cropCv = decoded && decoded.box ? cropToLabel(decodeCv, decoded.box) : null
      // Encode the stored thumbnail at a modest size, then free EVERY canvas
      // (decode, crop, and the thumbnail itself) before doing anything else —
      // keeping three full-res canvases + a data-URL alive at once is what tips
      // ~2GB phones into the OOM that silently reloads the page.
      const thumbCv = canvasFrom(cropCv || decodeCv, 800)
      const photo = thumbCv.toDataURL("image/jpeg", 0.6)
      freeCanvas(thumbCv); freeCanvas(cropCv); freeCanvas(decodeCv) // release backing stores promptly
      setBusy(false)
      if (decoded && decoded.serial) { await logScan(decoded.serial, decoded.format, photo) } // confident read → auto-log + advance
      else { setPrompt({ kind: "scanfail", photo }) } // couldn't read — don't guess
      return
    } catch (err) { flash("Couldn't read that photo", "err") }
    setBusy(false)
  }

  // Manual-entry confirm (camera couldn't read or typed by hand).
  async function confirmCapture() {
    if (!capture) return
    await logScan(capture.serial, capture.format, capture.photo, capture.panel)
    setCapture(null)
  }

  // Decide row-complete vs missing-panels prompt from authoritative server data.
  async function maybePromptRowComplete(r) {
    let scans = rowDoc.scans
    try { const res = await fetch(API + "?row=" + r.id, { cache: "no-store" }); const d = await res.json(); scans = d.scans || scans } catch (e) {}
    const miss = missingFromScans(scans, r.panelTarget)
    setPrompt(miss.length ? { kind: "guardrow", missing: miss } : { kind: "row" })
  }

  async function saveCorrection() {
    if (!editing) return
    const patch = { serial: (editing.serial || "").trim(), panel: Math.max(1, parseInt(editing.panel, 10) || 1), note: editing.note || "", status: editing.status || "ok", rowId: editing.rowId, sectionId: editing.sectionId, projectId: editing.projectId }
    setBusy(true)
    try {
      await fetch(API + "?action=updateScan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: editing.id, fromRow: editing._fromRow, patch }) })
      flash("Correction saved ✓", "ok")
      setEditing(null)
      await Promise.all([fetchRow(rowId), fetchSummary()])
    } catch (e) { flash("Save failed", "err") }
    setBusy(false)
  }

  // Review carousel: step to the previous/next panel in the current row.
  function viewGo(delta) {
    if (!viewScan) return
    const list = sortScans(rowDoc.scans)
    const idx = list.findIndex((s) => s.id === viewScan.id)
    const ni = idx + delta
    if (ni < 0 || ni >= list.length) return
    const s = list[ni]
    setQcScanning(false)
    setViewScan(Object.assign({ _fromRow: s.rowId }, s))
  }

  // Push the inline edits from the review carousel; replaces the matching sheet row.
  async function saveView(advance) {
    if (!viewScan) return
    const patch = { serial: (viewScan.serial || "").trim(), panel: Math.max(1, parseInt(viewScan.panel, 10) || 1), note: viewScan.note || "", status: viewScan.status || "ok", rowId: viewScan.rowId, sectionId: viewScan.sectionId, projectId: viewScan.projectId }
    setBusy(true)
    try {
      await fetch(API + "?action=updateScan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: viewScan.id, fromRow: viewScan._fromRow, patch }) })
      const fresh = await fetch(API + "?row=" + rowId, { cache: "no-store" }).then((r) => r.json()).catch(() => null)
      if (fresh) setRowDoc({ scans: fresh.scans || [] })
      fetchSummary()
      flash("Updated ✓", "ok")
      if (advance) {
        const list = sortScans((fresh && fresh.scans) || rowDoc.scans)
        const idx = list.findIndex((s) => s.id === viewScan.id)
        if (idx >= 0 && idx < list.length - 1) { const s = list[idx + 1]; setViewScan(Object.assign({ _fromRow: s.rowId }, s)) }
      }
    } catch (e) { flash("Update failed", "err") }
    setBusy(false)
  }

  // QC: a second scan of the same barcode. Match → Pass, mismatch → Fail. Stores
  // the second scan and the result; writes both to the sheet. Pass advances.
  async function handleQcHit(serial) {
    if (!viewScan) return
    setQcScanning(false)
    const scanned = String(serial || "").trim()
    const orig = String(viewScan.serial || "").trim()
    const pass = !!scanned && !!orig && scanned === orig
    const result = pass ? "Pass" : "Fail"
    setBusy(true)
    try {
      await fetch(API + "?action=updateScan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: viewScan.id, fromRow: viewScan._fromRow, patch: { qc: true, qcSerial: scanned, qcResult: result, qcBy: op, qcAt: Date.now() } }) })
      const fresh = await fetch(API + "?row=" + rowId, { cache: "no-store" }).then((r) => r.json()).catch(() => null)
      if (fresh) setRowDoc({ scans: fresh.scans || [] })
      fetchSummary()
      if (pass) {
        scanFeedback(); flash("QC Pass ✓", "ok")
        const list = sortScans((fresh && fresh.scans) || rowDoc.scans)
        const idx = list.findIndex((s) => s.id === viewScan.id)
        if (idx >= 0 && idx < list.length - 1) { const s = list[idx + 1]; setViewScan(Object.assign({ _fromRow: s.rowId }, s)) }
        else setViewScan(null)
      } else {
        flash("QC FAIL — scan didn't match", "err")
        setViewScan((v) => v ? Object.assign({}, v, { qc: true, qcSerial: scanned, qcResult: "Fail", qcBy: op }) : v)
      }
    } catch (e) { flash("QC save failed", "err") }
    setBusy(false)
  }

  async function saveWebhook(urlVal) { setTree((t) => ({ ...t, webhook: urlVal })); try { await fetch(API + "?action=webhook", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ webhook: urlVal }) }); flash("Sheet link saved ✓", "ok") } catch (e) { flash("Save failed", "err") } }

  function requestNewSection() {
    // On the sections list there is no current section to validate — just add.
    if (!section) { addSection(); return }
    const incomplete = (section.rows || []).filter((r) => !rowStat(r).done)
    if (incomplete.length) { setPrompt({ kind: "guard", details: incomplete.map((r) => ({ row: r, missing: rowStat(r).missing })) }); return }
    addSection()
  }

  // ── UI ──────────────────────────────────────────────────────────────────────
  const wrap = { position: "fixed", inset: 0, zIndex: 2000, background: "#f5f2ee", overflowY: "auto", WebkitOverflowScrolling: "touch", color: INK, paddingBottom: "env(safe-area-inset-bottom,0)" }
  const inner = { maxWidth: 1000, margin: "0 auto", padding: m ? "14px 12px 110px" : "28px 32px 80px" }
  const card = { background: "#fff", border: "1px solid rgba(0,0,0,.08)", boxShadow: "0 1px 4px rgba(0,0,0,.06)", padding: m ? 15 : 18, cursor: "pointer", borderRadius: 10, transition: "transform .15s" }

  function TopBar({ back, backLabel }) {
    return (
      <div style={{ display: "flex", justifyContent: back ? "space-between" : "flex-end", alignItems: "center", gap: 8, marginBottom: 14, position: "sticky", top: 0, zIndex: 5, background: "#f5f2ee", padding: "6px 0", marginLeft: m ? -2 : 0 }}>
        {back && <button onClick={back} style={{ ...BTN_GHOST, padding: "10px 14px", fontSize: 13, minHeight: 44, display: "inline-flex", alignItems: "center", gap: 6 }}>← {backLabel}</button>}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => setAskName(true)} style={{ ...BTN_GHOST, padding: "10px 12px", fontSize: 12, minHeight: 44, maxWidth: m ? 120 : 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>👤 {op || "Set name"}</button>
          <button onClick={() => setShowSettings(true)} style={{ ...BTN_GHOST, padding: "10px 12px", fontSize: 13, minHeight: 44 }}>⚙</button>
        </div>
      </div>
    )
  }
  const Title = ({ t, sub }) => <div style={{ marginBottom: m ? 14 : 20 }}><div style={{ ...BB, fontSize: m ? 30 : 42, letterSpacing: 1.5, color: INK, lineHeight: 1 }}>{t}</div>{sub && <div style={{ ...NB, fontSize: 14, color: "#777", letterSpacing: 1, marginTop: 4 }}>{sub}</div>}</div>

  const AddTile = ({ label, onClick }) => (
    <div onClick={onClick} style={{ ...card, border: "1.5px dashed rgba(249,115,22,.45)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: m ? 64 : 96 }}>
      <span style={{ ...BB, fontSize: 26, color: A }}>+</span><span style={{ ...NB, fontSize: 14, letterSpacing: 1.5, textTransform: "uppercase", color: A }}>{label}</span>
    </div>
  )

  if (loading) return <div style={wrap}><div style={inner}><div style={{ ...NB, fontSize: 18, color: "#777", padding: 20 }}>Loading scanner…</div></div></div>

  let body
  if (!proj) {
    body = (<>
      <TopBar back={onExit || null} backLabel="Exit" />
      <Title t="PANEL SCANNER" sub="Pick a project to start scanning" />
      {!standalone && installEvt && (
        <div onClick={doInstall} style={{ ...card, marginBottom: 14, borderLeft: "4px solid " + A, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span style={{ ...NB, fontSize: 14, color: INK }}>📲 Install Panel Scanner as an app</span>
          <span style={{ ...NB, fontSize: 13, letterSpacing: 1, textTransform: "uppercase", color: A }}>Install</span>
        </div>
      )}
      {!standalone && !installEvt && IS_IOS && (
        <div style={{ ...card, marginBottom: 14, borderLeft: "4px solid " + A, cursor: "default" }}>
          <span style={{ ...NB, fontSize: 14, color: INK }}>📲 To install: tap <strong>Share</strong> → <strong>Add to Home Screen</strong></span>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : "repeat(3,1fr)", gap: m ? 10 : 14 }}>
        {tree.projects.map((p) => {
          const total = (p.sections || []).reduce((a, s) => a + (s.rows || []).reduce((b, r) => b + ((summary[r.id] || {}).c || 0), 0), 0)
          return (
            <div key={p.id} style={{ ...card, borderLeft: "5px solid " + p.color }} onClick={() => { setProjId(p.id); setSecId(null); setRowId(null) }}>
              <div style={{ ...BB, fontSize: 22, letterSpacing: 1, color: INK }}>{p.name.toUpperCase()}</div>
              <div style={{ ...NB, fontSize: 13, color: "#777", marginTop: 6 }}>{(p.sections || []).length} sections · {total} panels</div>
              <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
                <span onClick={(e) => { e.stopPropagation(); editProject(p) }} style={{ ...NB, fontSize: 12, color: A, letterSpacing: 1, textTransform: "uppercase" }}>Edit</span>
              </div>
            </div>
          )
        })}
        <AddTile label="New Project" onClick={addProject} />
      </div>
    </>)
  } else if (!section) {
    const qc = projQC(proj)
    body = (<>
      <TopBar back={() => setProjId(null)} backLabel="Projects" />
      <Title t={proj.name.toUpperCase()} sub="Sections" />
      {qc.total > 0 && (
        <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, background: qc.done ? "rgba(34,197,94,.1)" : "rgba(249,115,22,.08)", border: "1px solid " + (qc.done ? "rgba(34,197,94,.4)" : "rgba(249,115,22,.35)") }}>
          <div style={{ ...NB, fontSize: 15, color: qc.done ? "#15803d" : "#b45309" }}><strong>QC review:</strong> {qc.ver} / {qc.target} checked <span style={{ color: "#999" }}>(10% of {qc.total} panels){qc.done ? " · target met ✓" : ""}</span></div>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : "repeat(3,1fr)", gap: m ? 10 : 14 }}>
        {(proj.sections || []).map((s) => {
          const done = sectionDone(s); const cnt = (s.rows || []).reduce((a, r) => a + ((summary[r.id] || {}).c || 0), 0)
          return (
            <div key={s.id} style={{ ...card, borderLeft: "5px solid " + (done ? "#22c55e" : A) }} onClick={() => { setSecId(s.id); setRowId(null) }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                <div style={{ ...BB, fontSize: 22, letterSpacing: 1, color: INK }}>{s.name.toUpperCase()}</div>
                {done && <span style={{ ...NB, fontSize: 11, color: "#16a34a", letterSpacing: 1 }}>✓ DONE</span>}
              </div>
              <div style={{ ...NB, fontSize: 13, color: "#777", marginTop: 6 }}>{(s.rows || []).length} rows · {cnt} panels</div>
            </div>
          )
        })}
        <AddTile label="New Section" onClick={requestNewSection} />
      </div>
    </>)
  } else if (!row) {
    body = (<>
      <TopBar back={() => setSecId(null)} backLabel="Sections" />
      <Title t={section.name.toUpperCase()} sub={proj.name + " · rows"} />
      <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : "repeat(2,1fr)", gap: m ? 10 : 14 }}>
        {(section.rows || []).map((r) => {
          const st = rowStat(r)
          return (
            <div key={r.id} style={{ ...card, borderLeft: "5px solid " + (st.done ? "#22c55e" : (st.missing ? "#ef4444" : A)) }} onClick={() => openRow(r)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                <div style={{ ...BB, fontSize: 22, letterSpacing: 1, color: INK }}>{r.name.toUpperCase()}</div>
                {st.done ? <span style={{ ...NB, fontSize: 11, color: "#16a34a", letterSpacing: 1 }}>✓ DONE</span> : st.missing ? <span style={{ ...NB, fontSize: 11, color: "#dc2626", letterSpacing: 1 }}>⚠ {st.missing} LEFT</span> : null}
              </div>
              <div style={{ ...NB, fontSize: 13, color: "#777", marginTop: 6 }}>{st.count}{r.panelTarget ? " / " + r.panelTarget : ""} panels</div>
              <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
                <span onClick={(e) => { e.stopPropagation(); renameRow(r) }} style={{ ...NB, fontSize: 12, color: A, letterSpacing: 1, textTransform: "uppercase" }}>Edit</span>
              </div>
            </div>
          )
        })}
        <AddTile label="New Row" onClick={() => addRow(false)} />
      </div>
      {sectionDone(section) && (
        <div style={{ marginTop: 18, padding: 14, background: "rgba(34,197,94,.1)", border: "1px solid rgba(34,197,94,.4)", borderRadius: 10 }}>
          <div style={{ ...NB, fontSize: 14, color: "#15803d", marginBottom: 10 }}>✓ Every row in this section is complete.</div>
          <button onClick={() => { setSecId(null); requestNewSection() }} style={{ ...BTN, width: m ? "100%" : "auto" }}>Start a New Section</button>
        </div>
      )}
    </>)
  } else {
    const list = sortScans(rowDoc.scans)
    const miss = missingFromScans(list, row.panelTarget)
    const st = rowStat(row)
    body = (<>
      <TopBar back={() => { setRowId(null); setCapture(null); setScanning(false) }} backLabel="Rows" />
      <Title t={row.name.toUpperCase()} sub={proj.name + " · " + section.name} />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <label style={{ ...NB, fontSize: 12, color: "#777", letterSpacing: 1, flex: m ? "1 1 45%" : "0 0 auto" }}>SECTION
          <select value={secId} onChange={(e) => { setSecId(e.target.value); setRowId(null); setCapture(null) }} style={{ ...IST, marginTop: 4 }}>{(proj.sections || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </label>
        <label style={{ ...NB, fontSize: 12, color: "#777", letterSpacing: 1, flex: m ? "1 1 45%" : "0 0 auto" }}>ROW
          <select value={rowId} onChange={(e) => { const r = (section.rows || []).find((x) => x.id === e.target.value); if (r) openRow(r) }} style={{ ...IST, marginTop: 4 }}>{(section.rows || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
        </label>
      </div>

      <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.08)", boxShadow: "0 1px 4px rgba(0,0,0,.06)", padding: m ? 15 : 20, marginBottom: 18, borderRadius: 12 }}>
        <div style={{ ...NB, fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: A, marginBottom: 6 }}>Now scanning · {op}</div>
        <div style={{ ...BB, fontSize: 30, color: INK, marginBottom: 14 }}>PANEL #{panelNo}</div>

        {!scanning && !capture && (<>
          {photoMode ? (<>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPickFile} style={{ display: "none" }} />
            <input ref={uploadRef} type="file" accept="image/*" onChange={onPickFile} style={{ display: "none" }} />
            <button disabled={busy} onClick={() => fileRef.current && fileRef.current.click()} style={{ ...BTN, width: "100%", fontSize: 17, padding: "18px", opacity: busy ? .6 : 1 }}>{busy ? "Reading…" : "📷 Take Photo"}</button>
            <div style={{ ...NB, fontSize: 13, color: A, marginTop: 12, cursor: "pointer", textAlign: "center" }} onClick={() => uploadRef.current && uploadRef.current.click()}>or upload a photo</div>
          </>) : (
            <button onClick={() => { unlockAudio(); setCamErr(""); setScanning(true) }} style={{ ...BTN, width: "100%", fontSize: 17, padding: "18px" }}>📷 Start Scanning</button>
          )}
          <div style={{ ...NB, fontSize: 13, color: A, marginTop: 12, cursor: "pointer", textAlign: "center" }} onClick={() => setCapture({ serial: "", format: "", panel: panelNo, manual: true })}>or enter a serial manually</div>
          <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 14, cursor: "pointer" }}>
            <input type="checkbox" checked={photoMode} onChange={(e) => { setPhotoMode(e.target.checked); if (e.target.checked) setScanning(false); try { localStorage.setItem("scanner_photomode", e.target.checked ? "1" : "0") } catch (er) {} }} style={{ width: 20, height: 20, flexShrink: 0 }} />
            <span style={{ ...NB, fontSize: 13, color: "#555" }}>Photo mode — sharp photo each panel, auto-advances</span>
          </label>
        </>)}

        {scanning && (
          <div>
            <div style={{ position: "relative", width: "100%", height: m ? 120 : 150, borderRadius: 10, overflow: "hidden", background: "#000" }}>
              <LiveScanner paused={!!capture || !!prompt || okFlash || busy} steady={steady} onSettle={setSettling} onHit={(serial, format, photo) => { logScanRef.current && logScanRef.current(serial, format, photo) }} onError={() => { setCamErr("Camera unavailable — allow camera access, or enter serials manually."); setScanning(false) }} />
              {!okFlash && !settling && !capture && <div style={{ position: "absolute", left: "6%", right: "6%", top: "50%", height: 2, background: "rgba(249,115,22,.95)", boxShadow: "0 0 8px rgba(249,115,22,.9)" }} />}
              {settling && !okFlash && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, background: "rgba(234,179,8,.45)" }}>
                  <span style={{ ...BB, fontSize: 22, letterSpacing: 2, color: "#1a1206" }}>HOLD STEADY…</span>
                </div>
              )}
              {okFlash && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, background: "rgba(22,163,74,.6)" }}>
                  <span style={{ fontSize: 34, lineHeight: 1, color: "#fff" }}>✓</span>
                  <span style={{ ...BB, fontSize: 24, letterSpacing: 2, color: "#fff" }}>COMPLETE</span>
                </div>
              )}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={steady} onChange={(e) => { setSteady(e.target.checked); try { localStorage.setItem("scanner_steady", e.target.checked ? "1" : "0") } catch (er) {} }} style={{ width: 20, height: 20, flexShrink: 0 }} />
              <span style={{ ...NB, fontSize: 13, color: "#555" }}>Steady capture (sharper photo, brief pause)</span>
            </label>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button onClick={() => { setScanning(false); setCapture(null) }} style={{ ...BTN_GHOST, flex: 1 }}>Stop</button>
              <button onClick={() => setCapture({ serial: "", format: "", panel: panelNo, manual: true })} style={{ ...BTN_GHOST, flex: 1 }}>Enter manually</button>
            </div>
            {!capture && <div style={{ ...NB, fontSize: 12, color: "#999", marginTop: 8, textAlign: "center" }}>Center the barcode in the band — it logs automatically and moves to the next panel.</div>}
          </div>
        )}

        {camErr && <div style={{ ...NB, fontSize: 13, color: "#d97706", marginTop: 10 }}>{camErr}</div>}

        {capture && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(0,0,0,.08)" }}>
            <div style={{ ...NB, fontSize: 13, color: capture.serial ? "#16a34a" : "#d97706", letterSpacing: 1, marginBottom: 8 }}>{capture.manual ? "Enter the serial" : "✓ Scanned" + (capture.format ? " (" + capture.format + ")" : "") + " — confirm below"}</div>
            {capture.photo && <img src={capture.photo} alt="scan" style={{ width: m ? "100%" : 200, maxWidth: 260, borderRadius: 8, border: "1px solid rgba(0,0,0,.1)", marginBottom: 10 }} />}
            <label style={lbl}>SERIAL</label>
            <input value={capture.serial} onChange={(e) => setCapture({ ...capture, serial: e.target.value })} placeholder="Panel serial" style={{ ...IST, marginBottom: 12 }} autoFocus={!!capture.manual} />
            <label style={lbl}>PANEL #</label>
            <input type="number" inputMode="numeric" value={capture.panel} onChange={(e) => setCapture({ ...capture, panel: e.target.value })} style={{ ...IST, marginBottom: 12, width: 130 }} />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button disabled={busy} onClick={confirmCapture} style={{ ...BTN, flex: m ? "1 1 100%" : "0 0 auto", opacity: busy ? .6 : 1 }}>{busy ? "Saving…" : (scanning ? "✓ Confirm & Next" : "✓ Confirm")}</button>
              <button onClick={() => setCapture(null)} style={{ ...BTN_GHOST, flex: m ? 1 : "0 0 auto" }}>{scanning ? "Rescan" : "Cancel"}</button>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        <div style={{ ...NB, fontSize: 14, color: "#555", flex: m ? "1 1 100%" : "0 0 auto" }}>{list.length}{row.panelTarget ? " / " + row.panelTarget : ""} panels{miss.length ? " · missing " + miss.join(", ") : ""}</div>
        {!st.done && <button onClick={async () => { if (miss.length && !(await askConfirm(`Panels ${miss.join(", ")} are missing. Mark complete anyway?`))) return; setRowComplete(row, true); setPrompt({ kind: "row" }) }} style={{ ...BTN_GHOST, color: "#16a34a", borderColor: "rgba(34,197,94,.5)", flex: m ? 1 : "0 0 auto" }}>Mark Row Complete</button>}
        {st.done && <span style={{ ...NB, fontSize: 13, color: "#16a34a", letterSpacing: 1 }}>✓ Complete</span>}
        {st.done && <button onClick={() => setRowComplete(row, false)} style={{ ...BTN_GHOST, padding: "10px 14px", fontSize: 12 }}>Reopen</button>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : "repeat(2,1fr)", gap: 10 }}>
        {list.map((s) => (
          <div key={s.id} onClick={() => setViewScan(Object.assign({ _fromRow: s.rowId }, s))} style={{ background: "#fff", border: "1px solid rgba(0,0,0,.08)", padding: 12, display: "flex", gap: 12, alignItems: "center", borderRadius: 10, cursor: "pointer" }}>
            {s.photoKey && <img src={API + "?photo=" + s.photoKey} alt="" loading="lazy" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6, background: "#eee", flexShrink: 0 }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...BB, fontSize: 18, color: INK }}>PANEL {s.panel}</div>
              <div style={{ ...NB, fontSize: 13, color: "#444", wordBreak: "break-all" }}>{s.serial}</div>
              <div style={{ ...NB, fontSize: 11, color: "#999" }}>{fmtTime(s.ts)} · {s.by}{s.status && s.status !== "ok" ? " · " + s.status : ""}</div>
            </div>
            <span style={{ ...BB, fontSize: 24, color: "#ccc", flexShrink: 0 }}>›</span>
          </div>
        ))}
        {!list.length && <div style={{ ...NB, fontSize: 14, color: "#999", padding: 12 }}>No panels yet — capture the first one above.</div>}
      </div>
    </>)
  }

  return (
    <div style={wrap}>
      <style>{`select,input,textarea{font-size:16px !important}`}</style>
      <div style={inner}>{body}</div>

      {toast && <div style={{ position: "fixed", bottom: "calc(20px + env(safe-area-inset-bottom,0))", left: "50%", transform: "translateX(-50%)", zIndex: 6000, background: toast.kind === "err" ? "#dc2626" : toast.kind === "warn" ? "#d97706" : "#16a34a", color: "#fff", padding: "14px 22px", ...NB, fontSize: 15, letterSpacing: 1, boxShadow: "0 6px 24px rgba(0,0,0,.3)", maxWidth: "92vw", borderRadius: 10, textAlign: "center" }}>{toast.msg}</div>}

      {dlg && <Dialog dlg={dlg} m={m} onDone={(res) => { const r = dlg.resolve; setDlg(null); r(res) }} />}
      {askName && <NameModal m={m} current={op} onSave={saveOp} onClose={op ? () => setAskName(false) : null} />}
      {showSettings && <SettingsModal m={m} webhook={tree.webhook} onSave={saveWebhook} onClose={() => setShowSettings(false)} />}

      {viewScan && (() => {
        const vlist = sortScans(rowDoc.scans)
        const vidx = vlist.findIndex((s) => s.id === viewScan.id)
        return (
          <Modal m={m} title={"Verify · " + (vidx >= 0 ? vidx + 1 : "?") + " of " + vlist.length} onClose={() => { setQcScanning(false); setViewScan(null) }}>
            {/* prev / next */}
            <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
              <button disabled={vidx <= 0} onClick={() => viewGo(-1)} style={{ ...BTN_GHOST, flex: 1, opacity: vidx <= 0 ? .4 : 1 }}>← Prev</button>
              <button disabled={vidx < 0 || vidx >= vlist.length - 1} onClick={() => viewGo(1)} style={{ ...BTN_GHOST, flex: 1, opacity: (vidx < 0 || vidx >= vlist.length - 1) ? .4 : 1 }}>Next →</button>
            </div>
            {viewScan.photoKey
              ? <img src={API + "?photo=" + viewScan.photoKey} alt="panel" style={{ width: "100%", borderRadius: 10, border: "1px solid rgba(0,0,0,.1)", marginBottom: 14 }} />
              : <div style={{ ...NB, fontSize: 13, color: "#999", marginBottom: 14 }}>No photo for this panel.</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 2 }}><label style={lbl}>SERIAL</label><input value={viewScan.serial || ""} onChange={(e) => setViewScan({ ...viewScan, serial: e.target.value })} style={{ ...IST, marginBottom: 10 }} /></div>
              <div style={{ flex: 1 }}><label style={lbl}>PANEL #</label><input type="number" inputMode="numeric" value={viewScan.panel} onChange={(e) => setViewScan({ ...viewScan, panel: e.target.value })} style={{ ...IST, marginBottom: 10 }} /></div>
            </div>
            <div style={{ ...NB, fontSize: 13, color: viewScan.qcResult === "Pass" ? "#16a34a" : viewScan.qcResult === "Fail" ? "#dc2626" : "#999", margin: "2px 0 12px" }}>
              {viewScan.qcResult === "Pass" ? "✓ QC PASS" + (viewScan.qcBy ? " · " + viewScan.qcBy : "") : viewScan.qcResult === "Fail" ? "✗ QC FAIL — scanned " + (viewScan.qcSerial || "?") : "Not QC checked"} · {fmtTime(viewScan.ts)} · {viewScan.by}
            </div>
            {qcScanning ? (
              <div style={{ marginBottom: 10 }}>
                <div style={{ position: "relative", width: "100%", height: 120, borderRadius: 10, overflow: "hidden", background: "#000" }}>
                  <LiveScanner paused={busy} steady={false} onHit={(serial) => handleQcHit(serial)} onError={() => { setQcScanning(false); flash("Camera unavailable", "err") }} />
                  <div style={{ position: "absolute", left: "6%", right: "6%", top: "50%", height: 2, background: "rgba(249,115,22,.95)" }} />
                </div>
                <div style={{ ...NB, fontSize: 12, color: "#999", margin: "8px 0", textAlign: "center" }}>Scan the same barcode again to verify</div>
                <button onClick={() => setQcScanning(false)} style={{ ...BTN_GHOST, width: "100%" }}>Cancel QC Scan</button>
              </div>
            ) : (
              <button disabled={busy} onClick={() => { unlockAudio(); setQcScanning(true) }} style={{ ...BTN, width: "100%", marginBottom: 10, opacity: busy ? .6 : 1 }}>🔁 QC Scan (scan again)</button>
            )}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button disabled={busy} onClick={() => saveView(true)} style={{ ...BTN_GHOST, flex: m ? "1 1 100%" : 2 }}>{busy ? "Saving…" : "Save Edits & Next →"}</button>
              <button disabled={busy} onClick={() => saveView(false)} style={{ ...BTN_GHOST, flex: 1 }}>Save Edits</button>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button onClick={() => { setEditing(Object.assign({}, viewScan)); setViewScan(null) }} style={{ ...BTN_GHOST, flex: 1 }}>More…</button>
              <button style={{ ...BTN_GHOST, flex: 1 }} onClick={() => setViewScan(null)}>Close</button>
            </div>
          </Modal>
        )
      })()}

      {editing && (
        <Modal m={m} title="Correct Panel" onClose={() => setEditing(null)}>
          <label style={lbl}>SERIAL</label>
          <input value={editing.serial} onChange={(e) => setEditing({ ...editing, serial: e.target.value })} style={{ ...IST, marginBottom: 12 }} />
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}><label style={lbl}>PANEL #</label><input type="number" inputMode="numeric" value={editing.panel} onChange={(e) => setEditing({ ...editing, panel: e.target.value })} style={{ ...IST, marginBottom: 12 }} /></div>
            <div style={{ flex: 1 }}><label style={lbl}>STATUS</label><select value={editing.status || "ok"} onChange={(e) => setEditing({ ...editing, status: e.target.value })} style={{ ...IST, marginBottom: 12 }}><option value="ok">OK</option><option value="damaged">Damaged</option><option value="rescan">Needs re-scan</option></select></div>
          </div>
          <label style={lbl}>MOVE TO SECTION</label>
          <select value={editing.sectionId} onChange={(e) => setEditing({ ...editing, sectionId: e.target.value, rowId: ((proj.sections || []).find((x) => x.id === e.target.value)?.rows?.[0]?.id) || editing.rowId })} style={{ ...IST, marginBottom: 12 }}>{(proj.sections || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <label style={lbl}>MOVE TO ROW</label>
          <select value={editing.rowId} onChange={(e) => setEditing({ ...editing, rowId: e.target.value })} style={{ ...IST, marginBottom: 12 }}>{((proj.sections || []).find((x) => x.id === editing.sectionId)?.rows || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          <label style={lbl}>NOTE</label>
          <textarea value={editing.note || ""} onChange={(e) => setEditing({ ...editing, note: e.target.value })} style={{ ...IST, minHeight: 60, marginBottom: 16 }} />
          <div style={{ display: "flex", gap: 10 }}><button disabled={busy} onClick={saveCorrection} style={{ ...BTN, flex: 1 }}>Save</button><button onClick={() => setEditing(null)} style={BTN_GHOST}>Cancel</button></div>
        </Modal>
      )}

      {prompt && prompt.kind === "row" && (
        <Modal m={m} title="Row Complete" onClose={() => setPrompt(null)}>
          <p style={ptext}>This row is logged. Start a new row in <strong>{section && section.name}</strong>?</p>
          <div style={{ display: "flex", gap: 10, marginTop: 18, flexDirection: m ? "column" : "row", flexWrap: "wrap" }}>
            <button style={BTN} onClick={() => { setPrompt(null); addRow(true) }}>Start New Row</button>
            <button style={BTN_GHOST} onClick={() => { setPrompt(null); setRowId(null) }}>Back to Rows</button>
            <button style={BTN_GHOST} onClick={() => setPrompt(null)}>Stay Here</button>
          </div>
        </Modal>
      )}
      {prompt && prompt.kind === "guardrow" && (
        <Modal m={m} title="Row Not Complete" onClose={() => setPrompt(null)}>
          <p style={ptext}>You hit the target count but panels <strong>{prompt.missing.join(", ")}</strong> are missing. Capture them before finishing this row.</p>
          <div style={{ marginTop: 18 }}><button style={{ ...BTN, width: "100%" }} onClick={() => setPrompt(null)}>Keep Scanning</button></div>
        </Modal>
      )}
      {prompt && prompt.kind === "scanfail" && (
        <Modal m={m} title="Couldn't Read Barcode" onClose={() => setPrompt(null)}>
          {prompt.photo && <img src={prompt.photo} alt="scan" style={{ width: "100%", borderRadius: 10, border: "1px solid rgba(0,0,0,.1)", marginBottom: 12 }} />}
          <p style={ptext}>The barcode couldn't be read from that photo. Retake it, or enter the serial by hand.</p>
          <div style={{ display: "flex", gap: 10, marginTop: 18, flexDirection: m ? "column" : "row", flexWrap: "wrap" }}>
            <button style={BTN} onClick={() => { setPrompt(null); setTimeout(() => { fileRef.current && fileRef.current.click() }, 50) }}>Retake Photo</button>
            <button style={BTN_GHOST} onClick={() => { const ph = prompt.photo; setPrompt(null); setCapture({ serial: "", format: "", photo: ph, panel: panelNo, manual: true }) }}>Enter Manually</button>
            <button style={BTN_GHOST} onClick={() => setPrompt(null)}>Cancel</button>
          </div>
        </Modal>
      )}
      {prompt && prompt.kind === "dup" && (
        <Modal m={m} title="Duplicate Serial" onClose={() => setPrompt(null)}>
          <p style={ptext}>Serial <strong style={{ wordBreak: "break-all" }}>{prompt.serial}</strong> is already logged in this row as panel <strong>{prompt.existing}</strong>. Scan it again anyway?</p>
          <div style={{ display: "flex", gap: 10, marginTop: 18, flexDirection: m ? "column" : "row", flexWrap: "wrap" }}>
            <button style={BTN_GHOST} onClick={() => setPrompt(null)}>Skip (Don't Add)</button>
            <button style={{ ...BTN, background: "#dc2626", color: "#fff" }} onClick={() => { const p = prompt.pending; setPrompt(null); logScan(p.serial, p.format, p.photo, p.panel, true) }}>Add Anyway</button>
          </div>
        </Modal>
      )}
      {prompt && prompt.kind === "over" && (
        <Modal m={m} title="Row Already Full" onClose={() => setPrompt(null)}>
          <p style={ptext}>This row's target is <strong>{prompt.target}</strong> panels, but you're adding panel <strong>{prompt.pending.panel}</strong>. Add an extra panel anyway, or finish the row?</p>
          <div style={{ display: "flex", gap: 10, marginTop: 18, flexDirection: m ? "column" : "row", flexWrap: "wrap" }}>
            <button style={BTN} onClick={() => { const p = prompt.pending; setPrompt(null); logScan(p.serial, p.format, p.photo, p.panel, true) }}>Add Extra Panel</button>
            <button style={BTN_GHOST} onClick={() => { setPrompt(null); if (row) setRowComplete(row, true); setPrompt({ kind: "row" }) }}>Finish Row</button>
            <button style={BTN_GHOST} onClick={() => setPrompt(null)}>Cancel</button>
          </div>
        </Modal>
      )}
      {prompt && prompt.kind === "guard" && (
        <Modal m={m} title="Finish This Section First" onClose={() => setPrompt(null)}>
          <p style={ptext}>Don't start a new section until every row here is complete. Outstanding:</p>
          <div style={{ margin: "12px 0", display: "flex", flexDirection: "column", gap: 8 }}>
            {prompt.details.map(({ row: r, missing }) => (
              <div key={r.id} style={{ padding: 10, background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 8 }}>
                <div style={{ ...NB, fontSize: 14, color: "#b91c1c" }}><strong>{r.name}</strong> — {missing ? missing + " panel(s) missing" : "not marked complete"}</div>
                <span onClick={() => { setPrompt(null); setSecId(section.id); openRow(r) }} style={{ ...NB, fontSize: 12, color: A, cursor: "pointer", letterSpacing: 1, textTransform: "uppercase" }}>Go fix this row →</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 8, flexDirection: m ? "column" : "row" }}>
            <button style={BTN_GHOST} onClick={() => setPrompt(null)}>Cancel</button>
            <button style={{ ...BTN, background: "#dc2626", color: "#fff" }} onClick={() => { setPrompt(null); addSection() }}>New Section Anyway</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

const lbl = { ...NB, fontSize: 12, color: "#777", letterSpacing: 1, display: "block", marginBottom: 4 }
const ptext = { ...NB, fontSize: 15, color: "#444", lineHeight: 1.5 }

// Padded crop rect (in source px) around a barcode box; 1D lines get a synthesized
// height. Returns null if the result would be too small/unreliable.
function cropRect(srcW, srcH, box) {
  if (!box || box.w <= 0) return null
  let { x, y, w, h } = box
  if (h < w * 0.15) { const nh = w * 0.5; y -= (nh - h) / 2; h = nh }
  const padX = w * 0.18, padY = h * 0.35
  x -= padX; y -= padY; w += padX * 2; h += padY * 2
  x = Math.max(0, x); y = Math.max(0, y)
  w = Math.min(srcW - x, w); h = Math.min(srcH - y, h)
  if (w < srcW * 0.12 || h < srcH * 0.04) return null
  return { x, y, w, h }
}

// Grab the current video frame as a storage-saver JPEG. When a barcode box is
// supplied, crop tightly to the label (with padding) to shrink the saved photo.
function grabFrame(v, box, maxEdge = 1280, quality = 0.72) {
  try {
    const vw = v.videoWidth, vh = v.videoHeight
    if (!vw || !vh) return ""
    let sx = 0, sy = 0, sw = vw, sh = vh
    const r = box ? cropRect(vw, vh, box) : null
    if (r) { sx = r.x; sy = r.y; sw = r.w; sh = r.h }
    const scale = Math.min(1, maxEdge / Math.max(sw, sh))
    const dw = Math.max(1, Math.round(sw * scale)), dh = Math.max(1, Math.round(sh * scale))
    const cv = document.createElement("canvas")
    cv.width = dw; cv.height = dh
    cv.getContext("2d").drawImage(v, sx, sy, sw, sh, 0, 0, dw, dh)
    return cv.toDataURL("image/jpeg", quality)
  } catch (e) { return "" }
}

// Live camera barcode scanner. Native BarcodeDetector loop on Android; ZXing
// continuous decode from the video stream on iOS Safari / desktop. On a read it
// grabs the just-decoded frame (instant, sharpest moment) cropped to the label
// and calls onHit(serial, format, photo). Honours `paused` to stop while a
// capture awaits confirmation.
function LiveScanner({ paused, steady, onHit, onSettle, onError }) {
  const videoRef = useRef(null)
  const pausedRef = useRef(paused); pausedRef.current = paused
  const steadyRef = useRef(steady); steadyRef.current = steady
  const settlingRef = useRef(false)
  const lastRef = useRef({ v: "", t: 0 })
  useEffect(() => {
    let stream = null, raf = 0, reader = null, stopped = false
    // Wait briefly for the steadiest (least motion) frame, then capture it.
    async function settle(serial, format, box) {
      settlingRef.current = true; if (onSettle) onSettle(true)
      const v = videoRef.current
      const small = document.createElement("canvas"); small.width = 64; small.height = 48
      const sctx = small.getContext("2d", { willReadFrequently: true })
      let prev = null, best = grabFrame(v, box), bestDiff = Infinity
      const t0 = Date.now()
      while (!stopped && Date.now() - t0 < 900) {
        await new Promise((r) => setTimeout(r, 80))
        try {
          sctx.drawImage(v, 0, 0, 64, 48)
          const cur = sctx.getImageData(0, 0, 64, 48).data
          if (prev) {
            let sum = 0; for (let i = 0; i < cur.length; i += 4) sum += Math.abs(cur[i] - prev[i])
            const diff = sum / (cur.length / 4)
            if (diff < bestDiff) { bestDiff = diff; best = grabFrame(v, box) }
            if (diff < 2 && Date.now() - t0 > 200) break // steady enough
          }
          prev = cur
        } catch (e) { break }
      }
      settlingRef.current = false; if (onSettle) onSettle(false)
      if (stopped) return
      onHit(serial, format || "", best)
    }
    const hit = (serial, format, box) => {
      const s = String(serial || "").trim()
      if (!s || stopped || pausedRef.current || settlingRef.current) return
      const now = Date.now()
      if (s === lastRef.current.v && now - lastRef.current.t < 2500) return // debounce same code
      lastRef.current = { v: s, t: now }
      if (steadyRef.current) settle(s, format, box)
      else onHit(s, format || "", grabFrame(videoRef.current, box))
    }
    async function start() {
      const v = videoRef.current
      if (!v) return
      try {
        if (typeof window !== "undefined" && "BarcodeDetector" in window) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 }, advanced: [{ focusMode: "continuous" }] }, audio: false })
          v.srcObject = stream; v.setAttribute("playsinline", "true"); v.muted = true
          await v.play()
          const det = makeDetector()
          const loop = async () => {
            if (stopped) return
            if (!pausedRef.current && !settlingRef.current) { try { const codes = await det.detect(v); if (codes && codes.length) { const b = codes[0].boundingBox; hit(codes[0].rawValue, codes[0].format, b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null) } } catch (e) {} }
            raf = requestAnimationFrame(loop)
          }
          raf = requestAnimationFrame(loop)
        } else {
          reader = new BrowserMultiFormatReader(zxHints())
          await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }, v, (result) => {
            if (result && !pausedRef.current) {
              let box = null
              try { const pts = result.getResultPoints && result.getResultPoints(); if (pts && pts.length) { const xs = pts.map((p) => p.getX()), ys = pts.map((p) => p.getY()); box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) } } } catch (e) {}
              hit(result.getText(), "", box)
            }
          })
        }
      } catch (e) { if (onError) onError(e) }
    }
    start()
    return () => { stopped = true; try { cancelAnimationFrame(raf) } catch (e) {} try { reader && reader.reset && reader.reset() } catch (e) {} try { stream && stream.getTracks().forEach((t) => t.stop()) } catch (e) {} }
  }, []) // eslint-disable-line
  return <video ref={videoRef} playsInline muted style={{ width: "100%", height: "100%", background: "#000", objectFit: "cover", display: "block" }} />
}

function Modal({ title, children, onClose, m }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 7000, background: "rgba(0,0,0,.55)", display: "flex", alignItems: m ? "flex-end" : "center", justifyContent: "center", padding: m ? 0 : 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", width: "100%", maxWidth: 460, maxHeight: "92vh", overflowY: "auto", WebkitOverflowScrolling: "touch", padding: m ? "20px 18px calc(24px + env(safe-area-inset-bottom,0))" : 28, boxShadow: "0 12px 48px rgba(0,0,0,.35)", borderRadius: m ? "16px 16px 0 0" : 14 }}>
        <div style={{ ...BB, fontSize: 26, letterSpacing: 1.5, color: INK, marginBottom: 14 }}>{title.toUpperCase()}</div>
        {children}
      </div>
    </div>
  )
}

function NameModal({ current, onSave, onClose, m }) {
  const [v, setV] = useState(current || "")
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 7500, background: "rgba(0,0,0,.6)", display: "flex", alignItems: m ? "flex-end" : "center", justifyContent: "center", padding: m ? 0 : 16 }} onClick={onClose || undefined}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", width: "100%", maxWidth: 420, padding: m ? "22px 18px calc(26px + env(safe-area-inset-bottom,0))" : 28, boxShadow: "0 12px 48px rgba(0,0,0,.35)", borderRadius: m ? "16px 16px 0 0" : 14 }}>
        <div style={{ ...BB, fontSize: 26, letterSpacing: 1.5, color: INK, marginBottom: 6 }}>WHO'S SCANNING?</div>
        <p style={{ ...ptext, marginBottom: 14 }}>Your name is attached to every panel you log — no login needed. Multiple people can scan the same project at once.</p>
        <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onSave(v) }} placeholder="Your name" autoFocus style={{ ...IST, marginBottom: 16 }} />
        <div style={{ display: "flex", gap: 10 }}>
          <button style={{ ...BTN, flex: 1 }} onClick={() => onSave(v)}>Start Scanning</button>
          {onClose && <button style={BTN_GHOST} onClick={onClose}>Cancel</button>}
        </div>
      </div>
    </div>
  )
}

// In-app prompt/confirm. Resolves with a values object (form) / boolean (confirm),
// or null/false on cancel. Replaces window.prompt & window.confirm for mobile.
function Dialog({ dlg, m, onDone }) {
  const [vals, setVals] = useState(() => dlg.type === "form" ? Object.fromEntries((dlg.fields || []).map((f) => [f.key, f.value != null ? String(f.value) : ""])) : {})
  const firstRef = useRef(null)
  useEffect(() => { const t = setTimeout(() => { try { firstRef.current && firstRef.current.focus() } catch (e) {} }, 80); return () => clearTimeout(t) }, [])
  const close = (res) => onDone(res)
  if (dlg.type === "confirm") {
    return (
      <Modal m={m} title={dlg.title} onClose={() => close(false)}>
        <p style={ptext}>{dlg.message}</p>
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button style={{ ...BTN, flex: 1, ...(dlg.danger ? { background: "#dc2626", color: "#fff" } : {}) }} onClick={() => close(true)}>{dlg.okLabel}</button>
          <button style={BTN_GHOST} onClick={() => close(false)}>Cancel</button>
        </div>
      </Modal>
    )
  }
  const submit = () => close(vals)
  return (
    <Modal m={m} title={dlg.title} onClose={() => close(null)}>
      {(dlg.fields || []).map((f, i) => (
        <div key={f.key} style={{ marginBottom: 12 }}>
          <label style={lbl}>{f.label}</label>
          <input
            ref={i === 0 ? firstRef : null}
            type={f.type === "number" ? "number" : "text"}
            inputMode={f.type === "number" ? "numeric" : undefined}
            value={vals[f.key]}
            placeholder={f.placeholder || ""}
            onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter" && (dlg.fields || []).length === 1) submit() }}
            style={IST}
          />
        </div>
      ))}
      <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
        <button style={{ ...BTN, flex: 1 }} onClick={submit}>{dlg.submitLabel || "Save"}</button>
        <button style={BTN_GHOST} onClick={() => close(null)}>Cancel</button>
      </div>
    </Modal>
  )
}

function SettingsModal({ webhook, onSave, onClose, m }) {
  const [val, setVal] = useState(webhook || "")
  const [copied, setCopied] = useState(false)
  async function copyScript() {
    try { await navigator.clipboard.writeText(APPS_SCRIPT); setCopied(true); setTimeout(() => setCopied(false), 2500) }
    catch (e) { setCopied("Select the code box below and copy manually") ; setTimeout(() => setCopied(false), 3500) }
  }
  return (
    <Modal m={m} title="Google Sheets Sync" onClose={onClose}>
      <p style={ptext}>One-time setup. Paste a single Apps Script Web App URL and the scanner will <strong>auto-create a new spreadsheet per project in your Google Drive</strong> (inside a "Panel Scanner" folder), one tab per section. Every person's scans route here into your Drive — no per-sheet setup ever again.</p>
      <label style={{ ...lbl, marginTop: 14 }}>APPS SCRIPT WEB APP URL</label>
      <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" style={{ ...IST, marginBottom: 14 }} />
      <details style={{ marginBottom: 16 }}>
        <summary style={{ ...NB, fontSize: 13, color: A, cursor: "pointer", letterSpacing: 1 }}>How to set this up (once)</summary>
        <ol style={{ ...NB, fontSize: 13, color: "#555", lineHeight: 1.6, paddingLeft: 18, marginTop: 8 }}>
          <li>Go to <strong>script.google.com</strong> → New project.</li>
          <li>Delete the sample, paste the script below, Save.</li>
          <li>Deploy → New deployment → <strong>Web app</strong>. Execute as <strong>Me</strong>, Who has access <strong>Anyone</strong>.</li>
          <li>Authorize when prompted (it needs Drive/Sheets access to create the sheets in your Drive).</li>
          <li>Copy the Web app URL (ends in <strong>/exec</strong>) and paste it above → Save.</li>
        </ol>
        <p style={{ ...NB, fontSize: 12, color: "#999", marginTop: 6 }}>No spreadsheet needed up front — the script makes them automatically, one per project, in your Drive.</p>
        <button type="button" onClick={copyScript} style={{ ...BTN, width: "100%", marginTop: 10, background: copied === true ? "#16a34a" : A, color: copied === true ? "#fff" : "#1a1206" }}>{copied === true ? "✓ Script copied" : (typeof copied === "string" ? copied : "📋 Copy script")}</button>
        <p style={{ ...NB, fontSize: 11, color: "#999", marginTop: 6 }}>Paste this into an empty Apps Script editor — don't copy anything else.</p>
        <pre style={{ background: "#0f0f17", color: "#d6e2ff", fontSize: 11, padding: 12, overflow: "auto", marginTop: 8, lineHeight: 1.4 }}>{APPS_SCRIPT}</pre>
      </details>
      <div style={{ display: "flex", gap: 10 }}><button style={{ ...BTN, flex: 1 }} onClick={() => { onSave(val.trim()); onClose() }}>Save</button><button style={BTN_GHOST} onClick={onClose}>Close</button></div>
    </Modal>
  )
}

// Auto-creates one spreadsheet per project in the owner's Drive (organized in a
// "Panel Scanner" folder), with one tab per section. Every scanner's entries
// route here and land in the owner's Drive. One-time setup, no per-sheet work.
const APPS_SCRIPT = `function doPost(e){
  var d = JSON.parse(e.postData.contents);
  var props = PropertiesService.getScriptProperties();
  var key = 'ss_' + (d.projectId || d.project || 'default');
  var ss = null, id = props.getProperty(key);
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (err) { ss = null; } }
  if (!ss) {
    // Only the first scan of a project contends here, to create its spreadsheet.
    var clock = LockService.getScriptLock();
    try { clock.waitLock(30000); } catch (err) { return ContentService.createTextOutput('busy'); }
    try {
      id = props.getProperty(key);
      if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e2) { ss = null; } }
      if (!ss) {
        ss = SpreadsheetApp.create('Panel Scanner — ' + (d.project || 'Project'));
        props.setProperty(key, ss.getId());
        try {
          var it = DriveApp.getFoldersByName('Panel Scanner');
          var folder = it.hasNext() ? it.next() : DriveApp.createFolder('Panel Scanner');
          var file = DriveApp.getFileById(ss.getId());
          folder.addFile(file); DriveApp.getRootFolder().removeFile(file);
        } catch (err) {}
      }
    } finally { clock.releaseLock(); }
  }
  var tab = String(d.section || 'Scans').replace(/[\\\\\\/?*\\[\\]:]/g,' ').substring(0,99).trim() || 'Scans';
  var row = [d.section,d.row,d.panel,d.serial,d.by,d.project,d.timestamp,d.qcSerial,d.qc,d.id];
  // Hold the lock only for the actual write, so appends run with minimal contention.
  var wlock = LockService.getScriptLock();
  try { wlock.waitLock(45000); } catch (err) { return ContentService.createTextOutput('busy'); }
  try {
    var sh = ss.getSheetByName(tab) || ss.insertSheet(tab);
    var def = ss.getSheetByName('Sheet1');
    if (def && def.getName() !== tab && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);
    if (sh.getLastRow() === 0) { sh.appendRow(['Section','Row','Panel','Serial','By','Project','Timestamp','QC Scan','QC Verified','ID']); try { sh.hideColumns(10); sh.setFrozenRows(1); sh.getRange('1:1').setFontWeight('bold'); } catch (err) {} }
    if (d.mode === 'update' || d.mode === 'delete') {
      var n = Math.max(sh.getLastRow() - 1, 0);
      if (n > 0) {
        var ids = sh.getRange(2,10,n,1).getValues();
        for (var i = 0; i < ids.length; i++) {
          if (String(ids[i][0]) === String(d.id)) {
            if (d.mode === 'delete') sh.deleteRow(i + 2);
            else sh.getRange(i+2,1,1,10).setValues([row]);
            return ContentService.createTextOutput('ok');
          }
        }
      }
      if (d.mode === 'delete') return ContentService.createTextOutput('ok');
    }
    sh.appendRow(row);
    return ContentService.createTextOutput('ok');
  } finally { wlock.releaseLock(); }
}`
