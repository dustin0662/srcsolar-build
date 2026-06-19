import React, { useState, useEffect, useRef, useCallback } from "react"
import { BrowserMultiFormatReader } from "@zxing/browser"

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
const POLL_MS = 8000
const OP_KEY = "scanner_operator"

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
const fmtTime = (d) => { if (!d) return ""; const t = new Date(d); return t.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) }

const IST = { width: "100%", background: "#f9f7f5", border: "1px solid rgba(0,0,0,.16)", color: INK, padding: "14px 14px", fontFamily: "'Barlow',sans-serif", fontSize: 16, outline: "none", borderRadius: 8, WebkitAppearance: "none" }
const BTN = { background: A, color: "#1a1206", border: "none", padding: "15px 22px", ...NB, fontWeight: 700, fontSize: 15, letterSpacing: "1.5px", textTransform: "uppercase", cursor: "pointer", borderRadius: 8, minHeight: 50 }
const BTN_GHOST = { background: "#fff", color: "#555", border: "1px solid rgba(0,0,0,.18)", padding: "14px 18px", ...NB, fontSize: 14, letterSpacing: "1.5px", textTransform: "uppercase", cursor: "pointer", borderRadius: 8, minHeight: 48 }

// Resize + compress an image File into a jpeg data URL (max edge 1400px).
function compress(file, maxEdge = 1400, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      let { width: w, height: h } = img
      const scale = Math.min(1, maxEdge / Math.max(w, h))
      w = Math.round(w * scale); h = Math.round(h * scale)
      const cv = document.createElement("canvas")
      cv.width = w; cv.height = h
      const ctx = cv.getContext("2d")
      ctx.drawImage(img, 0, 0, w, h) // modern Safari/Chrome auto-apply EXIF orientation
      try { URL.revokeObjectURL(img.src) } catch (e) {}
      resolve({ dataUrl: cv.toDataURL("image/jpeg", quality), canvas: cv })
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

// Decode a barcode/QR from a canvas: native BarcodeDetector first (Android),
// ZXing fallback (iOS Safari + desktop, where BarcodeDetector is unavailable).
async function decodeBarcode(canvas) {
  try {
    if (typeof window !== "undefined" && "BarcodeDetector" in window) {
      const det = new window.BarcodeDetector()
      const codes = await det.detect(canvas)
      if (codes && codes.length) return { serial: String(codes[0].rawValue || "").trim(), format: codes[0].format || "native" }
    }
  } catch (e) { /* fall through to zxing */ }
  try {
    const reader = new BrowserMultiFormatReader()
    const res = await reader.decodeFromCanvas(canvas)
    if (res) { let fmt = ""; try { fmt = String(res.getBarcodeFormat()) } catch (e) {} return { serial: String(res.getText() || "").trim(), format: fmt } }
  } catch (e) { /* not found */ }
  return null
}

const sortScans = (scans) => (scans || []).slice().sort((a, b) => (a.panel || 0) - (b.panel || 0))

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

  const [projId, setProjId] = useState(null)
  const [secId, setSecId] = useState(null)
  const [rowId, setRowId] = useState(null)

  const [showSettings, setShowSettings] = useState(false)
  const [prompt, setPrompt] = useState(null)
  const [capture, setCapture] = useState(null)
  const [panelNo, setPanelNo] = useState(1)
  const [editing, setEditing] = useState(null)
  const [viewScan, setViewScan] = useState(null) // tapped panel — detail/photo viewer
  const [dlg, setDlg] = useState(null) // in-app prompt/confirm (native dialogs are blocked on mobile)

  const fileRef = useRef(null)
  const rowIdRef = useRef(null); rowIdRef.current = rowId

  const flash = (msg, kind = "ok") => { setToast({ msg, kind }); setTimeout(() => setToast(null), 2800) }

  // Mobile-safe replacements for window.prompt / window.confirm (which Android
  // Chrome and some webviews silently suppress). Both return a Promise.
  const askForm = (title, fields, submitLabel = "Save") => new Promise((resolve) => setDlg({ type: "form", title, fields, submitLabel, resolve }))
  const askConfirm = (message, opts = {}) => new Promise((resolve) => setDlg({ type: "confirm", title: opts.title || "Please Confirm", message, danger: opts.danger, okLabel: opts.okLabel || "OK", resolve }))

  const fetchTree = useCallback(async () => { try { const r = await fetch(API, { cache: "no-store" }); const d = await r.json(); setTree({ projects: d.projects || [], webhook: d.webhook || "" }) } catch (e) {} }, [])
  const fetchSummary = useCallback(async () => { try { const r = await fetch(API + "?summary", { cache: "no-store" }); const d = await r.json(); setSummary(d.summary || {}) } catch (e) {} }, [])
  const fetchRow = useCallback(async (id) => { if (!id) return; try { const r = await fetch(API + "?row=" + id, { cache: "no-store" }); const d = await r.json(); if (rowIdRef.current === id) setRowDoc({ scans: d.scans || [] }) } catch (e) {} }, [])

  useEffect(() => { (async () => { await Promise.all([fetchTree(), fetchSummary()]); setLoading(false) })() }, [fetchTree, fetchSummary])

  // Live multi-user refresh — keep counts and the open row in sync with others.
  useEffect(() => {
    const t = setInterval(() => { fetchSummary(); if (rowIdRef.current) fetchRow(rowIdRef.current) }, POLL_MS)
    return () => clearInterval(t)
  }, [fetchSummary, fetchRow])

  const proj = tree.projects.find((p) => p.id === projId) || null
  const section = (proj && (proj.sections || []).find((s) => s.id === secId)) || null
  const row = (section && (section.rows || []).find((r) => r.id === rowId)) || null

  // ── Completeness from the lightweight summary index ─────────────────────────
  function rowStat(r) {
    const s = summary[r.id] || { c: 0, x: 0 }
    const target = r.panelTarget > 0 ? r.panelTarget : s.x
    const done = !!r.complete || (target > 0 && s.c >= target && s.x <= target)
    const missing = target > 0 ? Math.max(0, target - s.c) : 0
    return { count: s.c, max: s.x, target, done, missing }
  }
  const sectionDone = (s) => (s.rows || []).length > 0 && (s.rows || []).every((r) => rowStat(r).done)

  // ── Persistence ─────────────────────────────────────────────────────────────
  async function saveProjects(projects) {
    setTree((t) => ({ ...t, projects }))
    try { await fetch(API + "?action=projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projects }) }) } catch (e) { flash("Save failed — check connection", "err") }
  }
  const mutateTree = (fn) => { const next = JSON.parse(JSON.stringify(tree.projects)); fn(next); saveProjects(next) }

  async function addProject() {
    const r = await askForm("New Project", [
      { key: "name", label: "Project name", placeholder: "e.g. Midway" },
      { key: "brand", label: "Panel brand", value: "Q CELLS" },
      { key: "watt", label: "Wattage (W)", type: "number", placeholder: "e.g. 400" },
    ], "Create Project")
    const name = r && (r.name || "").trim(); if (!name) return
    saveProjects(tree.projects.concat([{ id: uid(), name, brand: (r.brand || "").trim(), watt: (r.watt || "").trim(), color: PROJ_COLORS[tree.projects.length % PROJ_COLORS.length], createdAt: Date.now(), sections: [] }]))
  }
  async function editProject(p) {
    const r = await askForm("Edit Project", [
      { key: "name", label: "Project name", value: p.name },
      { key: "brand", label: "Panel brand", value: p.brand || "Q CELLS" },
      { key: "watt", label: "Wattage (W)", type: "number", value: p.watt || "" },
    ])
    const name = r && (r.name || "").trim(); if (!name) return
    mutateTree((t) => { const pp = t.find((x) => x.id === p.id); pp.name = name; pp.brand = (r.brand || "").trim(); pp.watt = (r.watt || "").trim() })
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
  async function deleteProject(p) { if (!await askConfirm(`Delete project "${p.name}" and its layout? (Logged scans stay in the sheet.)`, { danger: true, okLabel: "Delete" })) return; saveProjects(tree.projects.filter((x) => x.id !== p.id)) }
  async function deleteSection(s) { if (!await askConfirm(`Delete "${s.name}"?`, { danger: true, okLabel: "Delete" })) return; mutateTree((t) => { const p = t.find((x) => x.id === projId); p.sections = p.sections.filter((x) => x.id !== s.id) }) }
  async function deleteRow(r) { if (!await askConfirm(`Delete "${r.name}"?`, { danger: true, okLabel: "Delete" })) return; mutateTree((t) => { const s = t.find((x) => x.id === projId).sections.find((x) => x.id === secId); s.rows = s.rows.filter((x) => x.id !== r.id) }) }
  function setRowComplete(r, val) { mutateTree((t) => { const rr = t.find((x) => x.id === projId).sections.find((x) => x.id === secId).rows.find((x) => x.id === r.id); rr.complete = val }) }

  // ── Scanning ────────────────────────────────────────────────────────────────
  async function openRow(r) {
    setRowId(r.id); setCapture(null); setRowDoc({ scans: [] })
    try { const res = await fetch(API + "?row=" + r.id, { cache: "no-store" }); const d = await res.json(); const scans = d.scans || []; setRowDoc({ scans }); setPanelNo(scans.length ? Math.max(...scans.map((s) => s.panel || 0)) + 1 : 1) } catch (e) { flash("Couldn't load row", "err") }
  }

  async function onPickFile(e) {
    const file = e.target.files && e.target.files[0]; e.target.value = ""
    if (!file) return
    setBusy(true)
    try {
      const { dataUrl, canvas } = await compress(file)
      const decoded = await decodeBarcode(canvas)
      setCapture({ photo: dataUrl, serial: decoded ? decoded.serial : "", format: decoded ? decoded.format : "", decoded: !!decoded, panel: panelNo, brand: (proj && proj.brand) || "", watt: (proj && proj.watt) || "" })
      if (!decoded) flash("No barcode detected — type the serial", "warn")
    } catch (err) { flash("Couldn't read that image", "err") }
    setBusy(false)
  }

  async function confirmCapture() {
    if (!capture) return
    const serial = (capture.serial || "").trim()
    if (!serial) { flash("Enter a serial before uploading", "err"); return }
    const panel = Math.max(1, parseInt(capture.panel, 10) || panelNo)
    if (rowDoc.scans.some((s) => s.panel === panel) && !(await askConfirm(`Panel ${panel} already exists in this row. Add another anyway?`))) return
    const scan = { id: uid(), projectId: projId, sectionId: secId, rowId, panel, serial, raw: capture.serial, format: capture.format || "", brand: (capture.brand || "").trim(), watt: (capture.watt || "").toString().trim(), ts: Date.now(), by: op, note: "", status: "ok" }
    setBusy(true)
    try {
      await fetch(API + "?action=scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scan, photo: capture.photo }) })
      setRowDoc((d) => ({ scans: d.scans.concat([Object.assign({ photoKey: scan.id }, scan)]) }))
      setSummary((sm) => { const cur = sm[rowId] || { c: 0, x: 0 }; return { ...sm, [rowId]: { c: cur.c + 1, x: Math.max(cur.x, panel) } } })
      setCapture(null); setPanelNo(panel + 1)
      flash(`Panel ${panel} uploaded ✓`, "ok")
      fetchRow(rowId) // pull authoritative list (also surfaces others' scans)
      if (row && row.panelTarget > 0 && rowDoc.scans.length + 1 >= row.panelTarget) maybePromptRowComplete(row)
    } catch (e) { flash("Upload failed — check connection", "err") }
    setBusy(false)
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
    const patch = { serial: (editing.serial || "").trim(), brand: (editing.brand || "").trim(), watt: (editing.watt || "").toString().trim(), panel: Math.max(1, parseInt(editing.panel, 10) || 1), note: editing.note || "", status: editing.status || "ok", rowId: editing.rowId, sectionId: editing.sectionId, projectId: editing.projectId }
    setBusy(true)
    try {
      await fetch(API + "?action=updateScan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: editing.id, fromRow: editing._fromRow, patch }) })
      flash("Correction saved ✓", "ok")
      setEditing(null)
      await Promise.all([fetchRow(rowId), fetchSummary()])
    } catch (e) { flash("Save failed", "err") }
    setBusy(false)
  }

  async function deleteScan(s) {
    if (!await askConfirm(`Delete panel ${s.panel} (${s.serial})?`, { danger: true, okLabel: "Delete" })) return
    setBusy(true)
    try {
      await fetch(API + "?action=deleteScan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: s.id, fromRow: s.rowId }) })
      setRowDoc((d) => ({ scans: d.scans.filter((x) => x.id !== s.id) }))
      fetchSummary(); flash("Deleted", "ok")
    } catch (e) { flash("Delete failed", "err") }
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
      <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : "repeat(3,1fr)", gap: m ? 10 : 14 }}>
        {tree.projects.map((p) => {
          const total = (p.sections || []).reduce((a, s) => a + (s.rows || []).reduce((b, r) => b + ((summary[r.id] || {}).c || 0), 0), 0)
          return (
            <div key={p.id} style={{ ...card, borderLeft: "5px solid " + p.color }} onClick={() => { setProjId(p.id); setSecId(null); setRowId(null) }}>
              <div style={{ ...BB, fontSize: 22, letterSpacing: 1, color: INK }}>{p.name.toUpperCase()}</div>
              <div style={{ ...NB, fontSize: 13, color: "#777", marginTop: 6 }}>{(p.sections || []).length} sections · {total} panels</div>
              {(p.brand || p.watt) && <div style={{ ...NB, fontSize: 12, color: "#999", marginTop: 2 }}>{[p.brand, p.watt ? p.watt + "W" : ""].filter(Boolean).join(" · ")}</div>}
              <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
                <span onClick={(e) => { e.stopPropagation(); editProject(p) }} style={{ ...NB, fontSize: 12, color: A, letterSpacing: 1, textTransform: "uppercase" }}>Edit</span>
                <span onClick={(e) => { e.stopPropagation(); deleteProject(p) }} style={{ ...NB, fontSize: 12, color: "#c00", letterSpacing: 1, textTransform: "uppercase" }}>Delete</span>
              </div>
            </div>
          )
        })}
        <AddTile label="New Project" onClick={addProject} />
      </div>
    </>)
  } else if (!section) {
    body = (<>
      <TopBar back={() => setProjId(null)} backLabel="Projects" />
      <Title t={proj.name.toUpperCase()} sub="Sections" />
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
              <div onClick={(e) => { e.stopPropagation(); deleteSection(s) }} style={{ ...NB, fontSize: 12, color: "#c00", marginTop: 10, letterSpacing: 1, textTransform: "uppercase" }}>Delete</div>
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
                <span onClick={(e) => { e.stopPropagation(); deleteRow(r) }} style={{ ...NB, fontSize: 12, color: "#c00", letterSpacing: 1, textTransform: "uppercase" }}>Delete</span>
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
      <TopBar back={() => { setRowId(null); setCapture(null) }} backLabel="Rows" />
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
        <div style={{ ...NB, fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: A, marginBottom: 6 }}>Now capturing · {op}</div>
        <div style={{ ...BB, fontSize: 30, color: INK, marginBottom: 14 }}>PANEL #{panelNo}</div>
        {!capture && (<>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPickFile} style={{ display: "none" }} />
          <button disabled={busy} onClick={() => fileRef.current && fileRef.current.click()} style={{ ...BTN, width: "100%", fontSize: 17, padding: "18px", opacity: busy ? .6 : 1 }}>{busy ? "Reading…" : "📷 Take / Upload Photo"}</button>
          <div style={{ ...NB, fontSize: 12, color: "#999", marginTop: 10 }}>Snap the panel's barcode label — we decode the serial automatically.</div>
        </>)}
        {capture && (
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
            <img src={capture.photo} alt="panel" style={{ width: m ? "100%" : 220, maxWidth: 320, borderRadius: 8, border: "1px solid rgba(0,0,0,.1)" }} />
            <div style={{ flex: 1, minWidth: m ? "100%" : 220 }}>
              <div style={{ ...NB, fontSize: 13, color: capture.decoded ? "#16a34a" : "#d97706", letterSpacing: 1, marginBottom: 8 }}>{capture.decoded ? "✓ Barcode decoded" + (capture.format ? " (" + capture.format + ")" : "") : "⚠ No barcode — type the serial"}</div>
              <label style={lbl}>SERIAL</label>
              <input value={capture.serial} onChange={(e) => setCapture({ ...capture, serial: e.target.value })} placeholder="Panel serial" style={{ ...IST, marginBottom: 12 }} autoFocus={!capture.decoded} />
              <label style={lbl}>PANEL #</label>
              <input type="number" inputMode="numeric" value={capture.panel} onChange={(e) => setCapture({ ...capture, panel: e.target.value })} style={{ ...IST, marginBottom: 12, width: 130 }} />
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 2 }}><label style={lbl}>BRAND</label><input value={capture.brand} onChange={(e) => setCapture({ ...capture, brand: e.target.value })} placeholder="Q CELLS" style={{ ...IST, marginBottom: 14 }} /></div>
                <div style={{ flex: 1 }}><label style={lbl}>WATT</label><input type="number" inputMode="numeric" value={capture.watt} onChange={(e) => setCapture({ ...capture, watt: e.target.value })} placeholder="400" style={{ ...IST, marginBottom: 14 }} /></div>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button disabled={busy} onClick={confirmCapture} style={{ ...BTN, flex: m ? "1 1 100%" : "0 0 auto", opacity: busy ? .6 : 1 }}>{busy ? "Uploading…" : "✓ Confirm & Upload"}</button>
                <button onClick={() => fileRef.current && fileRef.current.click()} style={{ ...BTN_GHOST, flex: m ? 1 : "0 0 auto" }}>Retake</button>
                <button onClick={() => setCapture(null)} style={{ ...BTN_GHOST, flex: m ? 1 : "0 0 auto" }}>Cancel</button>
              </div>
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
              {(s.brand || s.watt) && <div style={{ ...NB, fontSize: 12, color: "#777" }}>{[s.brand, s.watt ? s.watt + "W" : ""].filter(Boolean).join(" · ")}</div>}
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

      {viewScan && (
        <Modal m={m} title={"Panel " + viewScan.panel} onClose={() => setViewScan(null)}>
          {viewScan.photoKey
            ? <img src={API + "?photo=" + viewScan.photoKey} alt="panel" style={{ width: "100%", borderRadius: 10, border: "1px solid rgba(0,0,0,.1)", marginBottom: 14 }} />
            : <div style={{ ...NB, fontSize: 13, color: "#999", marginBottom: 14 }}>No photo for this panel.</div>}
          <div style={{ ...NB, fontSize: 12, color: "#777", letterSpacing: 1 }}>SERIAL</div>
          <div style={{ ...NB, fontSize: 18, color: INK, wordBreak: "break-all", marginBottom: 10 }}>{viewScan.serial}</div>
          {(viewScan.brand || viewScan.watt) && <div style={{ ...NB, fontSize: 15, color: "#444", marginBottom: 8 }}>{[viewScan.brand, viewScan.watt ? viewScan.watt + "W" : ""].filter(Boolean).join(" · ")}</div>}
          <div style={{ ...NB, fontSize: 13, color: "#666", marginBottom: 16 }}>{fmtTime(viewScan.ts)} · {viewScan.by}{viewScan.status && viewScan.status !== "ok" ? " · " + viewScan.status : ""}{viewScan.note ? " · " + viewScan.note : ""}</div>
          <div style={{ display: "flex", gap: 10 }}>
            <button style={{ ...BTN, flex: 1 }} onClick={() => { setEditing(viewScan); setViewScan(null) }}>Edit</button>
            <button style={{ ...BTN_GHOST, color: "#c00", borderColor: "rgba(204,0,0,.4)" }} onClick={async () => { const s = viewScan; setViewScan(null); await deleteScan(s) }}>Delete</button>
            <button style={BTN_GHOST} onClick={() => setViewScan(null)}>Close</button>
          </div>
        </Modal>
      )}

      {editing && (
        <Modal m={m} title="Correct Panel" onClose={() => setEditing(null)}>
          <label style={lbl}>SERIAL</label>
          <input value={editing.serial} onChange={(e) => setEditing({ ...editing, serial: e.target.value })} style={{ ...IST, marginBottom: 12 }} />
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 2 }}><label style={lbl}>BRAND</label><input value={editing.brand || ""} onChange={(e) => setEditing({ ...editing, brand: e.target.value })} style={{ ...IST, marginBottom: 12 }} /></div>
            <div style={{ flex: 1 }}><label style={lbl}>WATT</label><input type="number" inputMode="numeric" value={editing.watt || ""} onChange={(e) => setEditing({ ...editing, watt: e.target.value })} style={{ ...IST, marginBottom: 12 }} /></div>
          </div>
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
  return (
    <Modal m={m} title="Google Sheets Sync" onClose={onClose}>
      <p style={ptext}>Paste your Google Apps Script Web App URL. Every scan (and correction) is sent there and appended to a tab named after its <strong>section</strong> — each section becomes its own tab.</p>
      <label style={{ ...lbl, marginTop: 14 }}>APPS SCRIPT WEB APP URL</label>
      <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" style={{ ...IST, marginBottom: 14 }} />
      <details style={{ marginBottom: 16 }}>
        <summary style={{ ...NB, fontSize: 13, color: A, cursor: "pointer", letterSpacing: 1 }}>How to set this up</summary>
        <ol style={{ ...NB, fontSize: 13, color: "#555", lineHeight: 1.6, paddingLeft: 18, marginTop: 8 }}>
          <li>In your Google Sheet: Extensions → Apps Script.</li>
          <li>Paste the script below, then Deploy → New deployment → Web app, "Who has access: Anyone".</li>
          <li>Copy the Web app URL and paste it above.</li>
        </ol>
        <pre style={{ background: "#0f0f17", color: "#d6e2ff", fontSize: 11, padding: 12, overflow: "auto", marginTop: 8, lineHeight: 1.4 }}>{APPS_SCRIPT}</pre>
      </details>
      <div style={{ display: "flex", gap: 10 }}><button style={{ ...BTN, flex: 1 }} onClick={() => { onSave(val.trim()); onClose() }}>Save</button><button style={BTN_GHOST} onClick={onClose}>Close</button></div>
    </Modal>
  )
}

// One tab per section. Header row auto-added; updates/deletes match on the ID column.
const APPS_SCRIPT = `function doPost(e){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var d = JSON.parse(e.postData.contents);
  var tab = String(d.section || 'Scans').replace(/[\\\\\\/?*\\[\\]:]/g,' ').substring(0,99).trim() || 'Scans';
  var sh = ss.getSheetByName(tab) || ss.insertSheet(tab);
  if (sh.getLastRow() === 0) sh.appendRow(['Timestamp','Serial','Brand','Watt','Project','Section','Row','Panel','By','Status','Note','Mode','ID']);
  var row = [d.timestamp,d.serial,d.brand,d.watt,d.project,d.section,d.row,d.panel,d.by,d.status,d.note,d.mode,d.id];
  if (d.mode === 'update' || d.mode === 'delete') {
    var n = Math.max(sh.getLastRow() - 1, 0);
    if (n > 0) {
      var ids = sh.getRange(2,13,n,1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === String(d.id)) {
          if (d.mode === 'delete') sh.deleteRow(i + 2);
          else { row[11] = 'update'; sh.getRange(i+2,1,1,13).setValues([row]); }
          return ContentService.createTextOutput('ok');
        }
      }
    }
    if (d.mode === 'delete') return ContentService.createTextOutput('ok');
  }
  sh.appendRow(row);
  return ContentService.createTextOutput('ok');
}`
