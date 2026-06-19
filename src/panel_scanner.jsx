import React, { useState, useEffect, useRef, useCallback } from "react"
import { BrowserMultiFormatReader } from "@zxing/browser"

// ─────────────────────────────────────────────────────────────────────────────
// Panel Scanner
// Photograph a solar panel, decode its barcode/serial, and log it against a
// project → section → row → panel hierarchy. Scans persist to a Netlify
// function (Netlify Blobs) and are forwarded to a Google Sheet via an Apps
// Script webhook the user configures in Settings.
// ─────────────────────────────────────────────────────────────────────────────

const API = "/.netlify/functions/scanner"
const A = "#F97316", G = "#EAB308", INK = "#1a1a2e"
const BB = { fontFamily: "'Bebas Neue',sans-serif" }
const NB = { fontFamily: "'Barlow Condensed',sans-serif" }
const PROJ_COLORS = ["#F97316", "#EAB308", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#14b8a6", "#ef4444"]

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
const fmtTime = (d) => { if (!d) return ""; const t = new Date(d); return t.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) }

const IST = { width: "100%", background: "#f9f7f5", border: "1px solid rgba(0,0,0,.14)", color: INK, padding: "12px 14px", fontFamily: "'Barlow',sans-serif", fontSize: 16, outline: "none", borderRadius: 0, WebkitAppearance: "none" }
const BTN = { background: A, color: "#1a1206", border: "none", padding: "13px 22px", ...NB, fontWeight: 700, fontSize: 14, letterSpacing: "2px", textTransform: "uppercase", cursor: "pointer" }
const BTN_GHOST = { background: "transparent", color: "#555", border: "1px solid rgba(0,0,0,.18)", padding: "13px 22px", ...NB, fontSize: 14, letterSpacing: "2px", textTransform: "uppercase", cursor: "pointer" }

// Resize + compress an image File into a jpeg data URL (max edge 1280px).
function compress(file, maxEdge = 1280, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      let { width: w, height: h } = img
      const scale = Math.min(1, maxEdge / Math.max(w, h))
      w = Math.round(w * scale); h = Math.round(h * scale)
      const cv = document.createElement("canvas")
      cv.width = w; cv.height = h
      cv.getContext("2d").drawImage(img, 0, 0, w, h)
      resolve({ dataUrl: cv.toDataURL("image/jpeg", quality), canvas: cv })
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

// Decode a barcode/QR from a canvas: native BarcodeDetector first, ZXing fallback.
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
    if (res) {
      let fmt = ""
      try { fmt = String(res.getBarcodeFormat()) } catch (e) {}
      return { serial: String(res.getText() || "").trim(), format: fmt }
    }
  } catch (e) { /* not found */ }
  return null
}

// Panels scanned for a given row, sorted by panel number.
const rowScans = (scans, rowId) => (scans || []).filter((s) => s && s.rowId === rowId).sort((a, b) => (a.panel || 0) - (b.panel || 0))

// Missing panel numbers for a row given its target (or its max scanned panel).
function missingPanels(scans, row) {
  const list = rowScans(scans, row.id)
  const have = new Set(list.map((s) => s.panel))
  const max = list.length ? Math.max(...list.map((s) => s.panel || 0)) : 0
  const target = row.panelTarget && row.panelTarget > 0 ? row.panelTarget : max
  const miss = []
  for (let i = 1; i <= target; i++) if (!have.has(i)) miss.push(i)
  return miss
}

// A row is complete when explicitly marked, or it has a target met with no gaps.
function rowComplete(scans, row) {
  if (row.complete) return true
  const list = rowScans(scans, row.id)
  if (!row.panelTarget || row.panelTarget <= 0) return false
  return list.length >= row.panelTarget && missingPanels(scans, row).length === 0
}

const sectionComplete = (scans, section) =>
  (section.rows || []).length > 0 && (section.rows || []).every((r) => rowComplete(scans, r))

export default function PanelScanner({ onExit, portalUser }) {
  const m = typeof window !== "undefined" && window.innerWidth < 768
  const by = (portalUser && (portalUser.name || portalUser.email)) || (typeof portalUser === "string" ? portalUser : "") || "Operator"

  const [state, setState] = useState({ projects: [], scans: [], webhook: "" })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)

  const [projId, setProjId] = useState(null)
  const [secId, setSecId] = useState(null)
  const [rowId, setRowId] = useState(null)

  const [showSettings, setShowSettings] = useState(false)
  const [prompt, setPrompt] = useState(null) // {kind:'row'|'section'|'guard', ...}
  const [capture, setCapture] = useState(null) // staged scan awaiting confirmation
  const [panelNo, setPanelNo] = useState(1)
  const [editing, setEditing] = useState(null) // scan being corrected

  const fileRef = useRef(null)

  const flash = (msg, kind = "ok") => { setToast({ msg, kind }); setTimeout(() => setToast(null), 2600) }

  const load = useCallback(async () => {
    try {
      const r = await fetch(API, { cache: "no-store" })
      const d = await r.json()
      setState({ projects: d.projects || [], scans: d.scans || [], webhook: d.webhook || "" })
    } catch (e) { flash("Could not reach server", "err") }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const proj = state.projects.find((p) => p.id === projId) || null
  const section = proj && (proj.sections || []).find((s) => s.id === secId) || null
  const row = section && (section.rows || []).find((r) => r.id === rowId) || null

  // ── Persistence helpers ────────────────────────────────────────────────────
  async function saveProjects(projects) {
    setState((s) => ({ ...s, projects }))
    try {
      await fetch(API + "?action=projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projects }) })
    } catch (e) { flash("Save failed — will retry on reload", "err") }
  }

  const mutateTree = (fn) => { const next = JSON.parse(JSON.stringify(state.projects)); fn(next); saveProjects(next) }

  // ── Project / section / row CRUD ────────────────────────────────────────────
  function addProject() {
    const name = (window.prompt("Project name") || "").trim(); if (!name) return
    const p = { id: uid(), name, color: PROJ_COLORS[state.projects.length % PROJ_COLORS.length], createdAt: Date.now(), sections: [] }
    saveProjects(state.projects.concat([p]))
  }
  function addSection() {
    const name = (window.prompt("Section name (e.g. Section 1, Block A)", "Section " + ((proj.sections || []).length + 1)) || "").trim(); if (!name) return
    mutateTree((t) => { const p = t.find((x) => x.id === projId); p.sections = (p.sections || []).concat([{ id: uid(), name, createdAt: Date.now(), panelsPerRow: 0, rows: [] }]) })
  }
  function addRow(selectAfter) {
    const def = "Row " + ((section.rows || []).length + 1)
    const name = (window.prompt("Row name / number", def) || "").trim(); if (!name) return
    const targetStr = window.prompt("Expected panels in this row (for completeness checks, 0 = unknown)", String(section.panelsPerRow || 0))
    const panelTarget = Math.max(0, parseInt(targetStr, 10) || 0)
    const id = uid()
    mutateTree((t) => { const p = t.find((x) => x.id === projId); const s = p.sections.find((x) => x.id === secId); s.rows = (s.rows || []).concat([{ id, name, panelTarget, complete: false, createdAt: Date.now() }]) })
    if (selectAfter) { setRowId(id); setPanelNo(1) }
    return id
  }
  function renameRow(r) {
    const name = (window.prompt("Row name / number", r.name) || "").trim(); if (!name) return
    const targetStr = window.prompt("Expected panels in this row (0 = unknown)", String(r.panelTarget || 0))
    const panelTarget = Math.max(0, parseInt(targetStr, 10) || 0)
    mutateTree((t) => { const p = t.find((x) => x.id === projId); const s = p.sections.find((x) => x.id === secId); const rr = s.rows.find((x) => x.id === r.id); rr.name = name; rr.panelTarget = panelTarget })
  }
  function deleteProject(p) { if (!window.confirm(`Delete project "${p.name}" and its layout? Scans are kept but orphaned.`)) return; saveProjects(state.projects.filter((x) => x.id !== p.id)) }
  function deleteSection(s) { if (!window.confirm(`Delete "${s.name}"?`)) return; mutateTree((t) => { const p = t.find((x) => x.id === projId); p.sections = p.sections.filter((x) => x.id !== s.id) }) }
  function deleteRow(r) { if (!window.confirm(`Delete "${r.name}"?`)) return; mutateTree((t) => { const p = t.find((x) => x.id === projId); const s = p.sections.find((x) => x.id === secId); s.rows = s.rows.filter((x) => x.id !== r.id) }) }

  function setRowComplete(r, val) {
    mutateTree((t) => { const p = t.find((x) => x.id === projId); const s = p.sections.find((x) => x.id === secId); const rr = s.rows.find((x) => x.id === r.id); rr.complete = val })
  }

  // ── Scanning ────────────────────────────────────────────────────────────────
  function openRow(r) {
    setRowId(r.id)
    const existing = rowScans(state.scans, r.id)
    setPanelNo(existing.length ? Math.max(...existing.map((s) => s.panel || 0)) + 1 : 1)
    setCapture(null)
  }

  async function onPickFile(e) {
    const file = e.target.files && e.target.files[0]
    e.target.value = ""
    if (!file) return
    setBusy(true)
    try {
      const { dataUrl, canvas } = await compress(file)
      const decoded = await decodeBarcode(canvas)
      setCapture({ photo: dataUrl, serial: decoded ? decoded.serial : "", format: decoded ? decoded.format : "", decoded: !!decoded, panel: panelNo })
      if (!decoded) flash("No barcode detected — enter the serial by hand", "warn")
    } catch (err) { flash("Could not read that image", "err") }
    setBusy(false)
  }

  async function confirmCapture() {
    if (!capture) return
    const serial = (capture.serial || "").trim()
    if (!serial) { flash("Enter a serial before uploading", "err"); return }
    const panel = Math.max(1, parseInt(capture.panel, 10) || panelNo)
    const dup = rowScans(state.scans, rowId).find((s) => s.panel === panel)
    if (dup && !window.confirm(`Panel ${panel} already exists in this row. Add another anyway?`)) return
    const scan = { id: uid(), projectId: projId, sectionId: secId, rowId, panel, serial, raw: capture.serial, format: capture.format || "", ts: Date.now(), by, note: "", status: "ok" }
    setBusy(true)
    try {
      await fetch(API + "?action=scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scan, photo: capture.photo }) })
      const next = state.scans.concat([Object.assign({ photoKey: scan.id }, scan)])
      setState((s) => ({ ...s, scans: next }))
      setCapture(null)
      flash(`Panel ${panel} uploaded ✓ — ${serial}`, "ok")
      // auto-advance, retain row + section
      const newPanel = panel + 1
      setPanelNo(newPanel)
      // completeness prompt
      if (row && row.panelTarget > 0) {
        const cnt = next.filter((s) => s.rowId === rowId).length
        if (cnt >= row.panelTarget) setTimeout(() => maybePromptRowComplete(next), 400)
      }
    } catch (e) { flash("Upload failed — check connection", "err") }
    setBusy(false)
  }

  function maybePromptRowComplete(scans) {
    const miss = missingPanels(scans, row)
    if (miss.length) { setPrompt({ kind: "guardrow", missing: miss }); return }
    setPrompt({ kind: "row" })
  }

  async function saveCorrection() {
    if (!editing) return
    const patch = { serial: (editing.serial || "").trim(), panel: Math.max(1, parseInt(editing.panel, 10) || 1), note: editing.note || "", status: editing.status || "ok", rowId: editing.rowId, sectionId: editing.sectionId, projectId: editing.projectId }
    setBusy(true)
    try {
      await fetch(API + "?action=updateScan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: editing.id, patch, photo: editing.newPhoto || undefined }) })
      setState((s) => ({ ...s, scans: s.scans.map((x) => x.id === editing.id ? Object.assign({}, x, patch) : x) }))
      setEditing(null)
      flash("Correction saved ✓", "ok")
    } catch (e) { flash("Save failed", "err") }
    setBusy(false)
  }

  async function deleteScan(s) {
    if (!window.confirm(`Delete panel ${s.panel} (${s.serial})?`)) return
    setBusy(true)
    try {
      await fetch(API + "?action=deleteScan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: s.id }) })
      setState((st) => ({ ...st, scans: st.scans.filter((x) => x.id !== s.id) }))
      flash("Deleted", "ok")
    } catch (e) { flash("Delete failed", "err") }
    setBusy(false)
  }

  async function saveWebhook(urlVal) {
    setState((s) => ({ ...s, webhook: urlVal }))
    try { await fetch(API + "?action=webhook", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ webhook: urlVal }) }); flash("Sheet link saved ✓", "ok") } catch (e) { flash("Save failed", "err") }
  }

  // Guard: starting a new section while the current one has incomplete rows.
  function requestNewSection() {
    const incomplete = (section.rows || []).filter((r) => !rowComplete(state.scans, r))
    if (incomplete.length) {
      const details = incomplete.map((r) => { const miss = missingPanels(state.scans, r); return { row: r, missing: miss } })
      setPrompt({ kind: "guard", details })
      return
    }
    addSection()
  }

  // ── UI ──────────────────────────────────────────────────────────────────────
  const wrap = { position: "fixed", inset: 0, zIndex: 2000, background: "#f5f2ee", overflow: "auto", color: INK }
  const inner = { maxWidth: 1100, margin: "0 auto", padding: m ? "70px 14px 90px" : "92px 40px 60px" }

  function Header({ title, sub, back }) {
    return (
      <div style={{ marginBottom: m ? 18 : 26 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8, ...NB, fontSize: 12, letterSpacing: "2px", textTransform: "uppercase", color: A }} onClick={back}>← {back === onExit ? "Dashboard" : "Back"}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowSettings(true)} style={{ ...BTN_GHOST, padding: "8px 14px", fontSize: 12 }}>⚙ Settings</button>
          </div>
        </div>
        <div style={{ ...BB, fontSize: m ? 34 : 46, letterSpacing: 2, color: INK, marginTop: 12 }}>{title}</div>
        {sub && <div style={{ ...NB, fontSize: 14, color: "#777", letterSpacing: 1, marginTop: 2 }}>{sub}</div>}
      </div>
    )
  }

  const card = { background: "#fff", border: "1px solid rgba(0,0,0,.08)", boxShadow: "0 1px 4px rgba(0,0,0,.06)", padding: m ? 16 : 20, cursor: "pointer", transition: "all .2s" }

  function Tile({ children, onClick, accent }) {
    return <div onClick={onClick} style={{ ...card, borderLeft: accent ? "4px solid " + accent : card.border }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.borderColor = "rgba(249,115,22,.5)" }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.borderColor = "rgba(0,0,0,.08)" }}>{children}</div>
  }

  if (loading) return <div style={wrap}><div style={inner}><div style={{ ...NB, fontSize: 18, color: "#777" }}>Loading scanner…</div></div></div>

  // ===== PROJECTS =====
  let bodyContent
  if (!proj) {
    bodyContent = (
      <>
        <Header title="PANEL SCANNER" sub="Select or create a project to begin" back={onExit} />
        <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : "repeat(3,1fr)", gap: m ? 12 : 16 }}>
          {state.projects.map((p) => {
            const cnt = state.scans.filter((s) => s.projectId === p.id).length
            return (
              <Tile key={p.id} accent={p.color} onClick={() => { setProjId(p.id); setSecId(null); setRowId(null) }}>
                <div style={{ ...BB, fontSize: 22, letterSpacing: 1, color: INK }}>{p.name.toUpperCase()}</div>
                <div style={{ ...NB, fontSize: 13, color: "#777", marginTop: 6 }}>{(p.sections || []).length} sections · {cnt} panels logged</div>
                <div onClick={(e) => { e.stopPropagation(); deleteProject(p) }} style={{ ...NB, fontSize: 11, color: "#c00", marginTop: 10, letterSpacing: 1, textTransform: "uppercase" }}>Delete</div>
              </Tile>
            )
          })}
          <div onClick={addProject} style={{ ...card, borderStyle: "dashed", borderColor: "rgba(249,115,22,.4)", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", minHeight: 110 }}>
            <div style={{ ...BB, fontSize: 30, color: A }}>+</div>
            <div style={{ ...NB, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", color: A }}>New Project</div>
          </div>
        </div>
      </>
    )
  }
  // ===== SECTIONS =====
  else if (!section) {
    bodyContent = (
      <>
        <Header title={proj.name.toUpperCase()} sub="Sections — select one to open its rows" back={() => setProjId(null)} />
        <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : "repeat(3,1fr)", gap: m ? 12 : 16 }}>
          {(proj.sections || []).map((s) => {
            const done = sectionComplete(state.scans, s)
            const cnt = state.scans.filter((x) => x.sectionId === s.id).length
            return (
              <Tile key={s.id} accent={done ? "#22c55e" : A} onClick={() => { setSecId(s.id); setRowId(null) }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ ...BB, fontSize: 22, letterSpacing: 1, color: INK }}>{s.name.toUpperCase()}</div>
                  {done && <span style={{ ...NB, fontSize: 11, color: "#16a34a", letterSpacing: 1, textTransform: "uppercase" }}>✓ Complete</span>}
                </div>
                <div style={{ ...NB, fontSize: 13, color: "#777", marginTop: 6 }}>{(s.rows || []).length} rows · {cnt} panels</div>
                <div onClick={(e) => { e.stopPropagation(); deleteSection(s) }} style={{ ...NB, fontSize: 11, color: "#c00", marginTop: 10, letterSpacing: 1, textTransform: "uppercase" }}>Delete</div>
              </Tile>
            )
          })}
          <div onClick={requestNewSection} style={{ ...card, borderStyle: "dashed", borderColor: "rgba(249,115,22,.4)", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", minHeight: 110 }}>
            <div style={{ ...BB, fontSize: 30, color: A }}>+</div>
            <div style={{ ...NB, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", color: A }}>New Section</div>
          </div>
        </div>
      </>
    )
  }
  // ===== ROWS =====
  else if (!row) {
    bodyContent = (
      <>
        <Header title={section.name.toUpperCase()} sub={proj.name + " — rows"} back={() => setSecId(null)} />
        <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : "repeat(2,1fr)", gap: m ? 12 : 16 }}>
          {(section.rows || []).map((r) => {
            const list = rowScans(state.scans, r.id)
            const done = rowComplete(state.scans, r)
            const miss = missingPanels(state.scans, r)
            return (
              <Tile key={r.id} accent={done ? "#22c55e" : (miss.length ? "#ef4444" : A)} onClick={() => openRow(r)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ ...BB, fontSize: 22, letterSpacing: 1, color: INK }}>{r.name.toUpperCase()}</div>
                  {done ? <span style={{ ...NB, fontSize: 11, color: "#16a34a", letterSpacing: 1 }}>✓ COMPLETE</span>
                    : miss.length ? <span style={{ ...NB, fontSize: 11, color: "#dc2626", letterSpacing: 1 }}>⚠ {miss.length} MISSING</span> : null}
                </div>
                <div style={{ ...NB, fontSize: 13, color: "#777", marginTop: 6 }}>{list.length}{r.panelTarget ? " / " + r.panelTarget : ""} panels{miss.length ? " · missing " + miss.join(", ") : ""}</div>
                <div style={{ display: "flex", gap: 14, marginTop: 10 }}>
                  <span onClick={(e) => { e.stopPropagation(); renameRow(r) }} style={{ ...NB, fontSize: 11, color: A, letterSpacing: 1, textTransform: "uppercase" }}>Edit</span>
                  <span onClick={(e) => { e.stopPropagation(); deleteRow(r) }} style={{ ...NB, fontSize: 11, color: "#c00", letterSpacing: 1, textTransform: "uppercase" }}>Delete</span>
                </div>
              </Tile>
            )
          })}
          <div onClick={() => addRow(false)} style={{ ...card, borderStyle: "dashed", borderColor: "rgba(249,115,22,.4)", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", minHeight: 100 }}>
            <div style={{ ...BB, fontSize: 30, color: A }}>+</div>
            <div style={{ ...NB, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", color: A }}>New Row</div>
          </div>
        </div>
        {sectionComplete(state.scans, section) && (
          <div style={{ marginTop: 22, padding: 16, background: "rgba(34,197,94,.1)", border: "1px solid rgba(34,197,94,.4)" }}>
            <div style={{ ...NB, fontSize: 14, color: "#15803d", marginBottom: 10 }}>✓ Every row in this section is complete.</div>
            <button onClick={() => { setSecId(null); requestNewSection() }} style={BTN}>Start a New Section</button>
          </div>
        )}
      </>
    )
  }
  // ===== ROW / SCANNING =====
  else {
    const list = rowScans(state.scans, row.id)
    const miss = missingPanels(state.scans, row)
    const done = rowComplete(state.scans, row)
    bodyContent = (
      <>
        <Header title={row.name.toUpperCase()} sub={proj.name + " · " + section.name} back={() => { setRowId(null); setCapture(null) }} />

        {/* quick change row / section */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          <label style={{ ...NB, fontSize: 12, color: "#777", letterSpacing: 1 }}>SECTION
            <select value={secId} onChange={(e) => { setSecId(e.target.value); setRowId(null); setCapture(null) }} style={{ ...IST, marginTop: 4 }}>
              {(proj.sections || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label style={{ ...NB, fontSize: 12, color: "#777", letterSpacing: 1 }}>ROW
            <select value={rowId} onChange={(e) => { const r = (section.rows || []).find((x) => x.id === e.target.value); if (r) openRow(r) }} style={{ ...IST, marginTop: 4 }}>
              {(section.rows || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
        </div>

        {/* capture panel */}
        <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.08)", boxShadow: "0 1px 4px rgba(0,0,0,.06)", padding: m ? 16 : 22, marginBottom: 22 }}>
          <div style={{ ...NB, fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: A, marginBottom: 8 }}>Now capturing</div>
          <div style={{ ...BB, fontSize: 30, color: INK, marginBottom: 14 }}>PANEL #{panelNo}</div>
          {!capture && (
            <>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPickFile} style={{ display: "none" }} />
              <button disabled={busy} onClick={() => fileRef.current && fileRef.current.click()} style={{ ...BTN, fontSize: 16, padding: "16px 28px", opacity: busy ? .6 : 1 }}>{busy ? "Reading…" : "📷 Take / Upload Photo"}</button>
              <div style={{ ...NB, fontSize: 12, color: "#999", marginTop: 10 }}>Snap the panel's barcode label. We'll decode the serial automatically.</div>
            </>
          )}
          {capture && (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
              <img src={capture.photo} alt="panel" style={{ width: m ? "100%" : 220, maxWidth: 300, borderRadius: 4, border: "1px solid rgba(0,0,0,.1)" }} />
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ ...NB, fontSize: 12, color: capture.decoded ? "#16a34a" : "#d97706", letterSpacing: 1, marginBottom: 6 }}>{capture.decoded ? "✓ Barcode decoded" + (capture.format ? " (" + capture.format + ")" : "") : "⚠ No barcode found — type the serial"}</div>
                <label style={{ ...NB, fontSize: 12, color: "#777", letterSpacing: 1 }}>SERIAL</label>
                <input value={capture.serial} onChange={(e) => setCapture({ ...capture, serial: e.target.value })} placeholder="Panel serial" style={{ ...IST, marginTop: 4, marginBottom: 12 }} autoFocus={!capture.decoded} />
                <label style={{ ...NB, fontSize: 12, color: "#777", letterSpacing: 1 }}>PANEL #</label>
                <input type="number" value={capture.panel} onChange={(e) => setCapture({ ...capture, panel: e.target.value })} style={{ ...IST, marginTop: 4, marginBottom: 14, width: 120 }} />
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button disabled={busy} onClick={confirmCapture} style={{ ...BTN, opacity: busy ? .6 : 1 }}>{busy ? "Uploading…" : "✓ Confirm & Upload"}</button>
                  <button onClick={() => fileRef.current && fileRef.current.click()} style={BTN_GHOST}>Retake</button>
                  <button onClick={() => setCapture(null)} style={BTN_GHOST}>Cancel</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* row status + actions */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
          <div style={{ ...NB, fontSize: 14, color: "#555" }}>{list.length}{row.panelTarget ? " / " + row.panelTarget : ""} panels logged{miss.length ? " · missing " + miss.join(", ") : ""}</div>
          {!done && <button onClick={() => { const mm = missingPanels(state.scans, row); if (mm.length && !window.confirm(`Panels ${mm.join(", ")} are missing. Mark the row complete anyway?`)) return; setRowComplete(row, true); setPrompt({ kind: "row" }) }} style={{ ...BTN_GHOST, color: "#16a34a", borderColor: "rgba(34,197,94,.5)" }}>Mark Row Complete</button>}
          {done && <span style={{ ...NB, fontSize: 13, color: "#16a34a", letterSpacing: 1 }}>✓ Row complete</span>}
          {done && <button onClick={() => setRowComplete(row, false)} style={{ ...BTN_GHOST, padding: "8px 14px", fontSize: 12 }}>Reopen</button>}
        </div>

        {/* logged panels */}
        <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : "repeat(2,1fr)", gap: 10 }}>
          {list.map((s) => (
            <div key={s.id} style={{ background: "#fff", border: "1px solid rgba(0,0,0,.08)", padding: 12, display: "flex", gap: 12, alignItems: "center" }}>
              {s.photoKey && <img src={API + "?photo=" + s.photoKey} alt="" style={{ width: 54, height: 54, objectFit: "cover", borderRadius: 4, background: "#eee" }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...BB, fontSize: 18, color: INK }}>PANEL {s.panel}</div>
                <div style={{ ...NB, fontSize: 13, color: "#444", wordBreak: "break-all" }}>{s.serial}</div>
                <div style={{ ...NB, fontSize: 11, color: "#999" }}>{fmtTime(s.ts)} · {s.by}{s.status && s.status !== "ok" ? " · " + s.status : ""}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span onClick={() => setEditing(Object.assign({}, s))} style={{ ...NB, fontSize: 11, color: A, cursor: "pointer", letterSpacing: 1, textTransform: "uppercase" }}>Edit</span>
                <span onClick={() => deleteScan(s)} style={{ ...NB, fontSize: 11, color: "#c00", cursor: "pointer", letterSpacing: 1, textTransform: "uppercase" }}>Del</span>
              </div>
            </div>
          ))}
          {!list.length && <div style={{ ...NB, fontSize: 14, color: "#999", padding: 12 }}>No panels logged yet — capture the first one above.</div>}
        </div>
      </>
    )
  }

  return (
    <div style={wrap}>
      <style>{`select{font-size:16px}`}</style>
      <div style={inner}>{bodyContent}</div>

      {/* toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 4000, background: toast.kind === "err" ? "#dc2626" : toast.kind === "warn" ? "#d97706" : "#16a34a", color: "#fff", padding: "12px 22px", ...NB, fontSize: 15, letterSpacing: 1, boxShadow: "0 6px 24px rgba(0,0,0,.3)", maxWidth: "90vw" }}>{toast.msg}</div>
      )}

      {/* settings modal */}
      {showSettings && <SettingsModal m={m} webhook={state.webhook} onSave={saveWebhook} onClose={() => setShowSettings(false)} />}

      {/* correction modal */}
      {editing && (
        <Modal m={m} title="Correct Panel" onClose={() => setEditing(null)}>
          <label style={lbl}>SERIAL</label>
          <input value={editing.serial} onChange={(e) => setEditing({ ...editing, serial: e.target.value })} style={{ ...IST, marginBottom: 12 }} />
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={lbl}>PANEL #</label>
              <input type="number" value={editing.panel} onChange={(e) => setEditing({ ...editing, panel: e.target.value })} style={{ ...IST, marginBottom: 12 }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={lbl}>STATUS</label>
              <select value={editing.status || "ok"} onChange={(e) => setEditing({ ...editing, status: e.target.value })} style={{ ...IST, marginBottom: 12 }}>
                <option value="ok">OK</option><option value="damaged">Damaged</option><option value="rescan">Needs re-scan</option>
              </select>
            </div>
          </div>
          <label style={lbl}>MOVE TO SECTION</label>
          <select value={editing.sectionId} onChange={(e) => setEditing({ ...editing, sectionId: e.target.value, rowId: ((proj.sections || []).find((x) => x.id === e.target.value)?.rows?.[0]?.id) || editing.rowId })} style={{ ...IST, marginBottom: 12 }}>
            {(proj.sections || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <label style={lbl}>MOVE TO ROW</label>
          <select value={editing.rowId} onChange={(e) => setEditing({ ...editing, rowId: e.target.value })} style={{ ...IST, marginBottom: 12 }}>
            {((proj.sections || []).find((x) => x.id === editing.sectionId)?.rows || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <label style={lbl}>NOTE</label>
          <textarea value={editing.note || ""} onChange={(e) => setEditing({ ...editing, note: e.target.value })} style={{ ...IST, minHeight: 60, marginBottom: 16 }} />
          <div style={{ display: "flex", gap: 10 }}>
            <button disabled={busy} onClick={saveCorrection} style={{ ...BTN, flex: 1 }}>Save Correction</button>
            <button onClick={() => setEditing(null)} style={BTN_GHOST}>Cancel</button>
          </div>
        </Modal>
      )}

      {/* prompts */}
      {prompt && prompt.kind === "row" && (
        <Modal m={m} title="Row Complete" onClose={() => setPrompt(null)}>
          <p style={ptext}>This row is logged. Would you like to start a new row in <strong>{section && section.name}</strong>?</p>
          <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
            <button style={BTN} onClick={() => { setPrompt(null); const id = addRow(true); if (id) { } }}>Start New Row</button>
            <button style={BTN_GHOST} onClick={() => { setPrompt(null); setRowId(null) }}>Back to Rows</button>
            <button style={BTN_GHOST} onClick={() => setPrompt(null)}>Stay Here</button>
          </div>
        </Modal>
      )}
      {prompt && prompt.kind === "guardrow" && (
        <Modal m={m} title="Row Not Complete" onClose={() => setPrompt(null)}>
          <p style={ptext}>You've reached the target count but panels <strong>{prompt.missing.join(", ")}</strong> are missing. Capture them before finishing this row.</p>
          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button style={BTN} onClick={() => setPrompt(null)}>Keep Scanning</button>
          </div>
        </Modal>
      )}
      {prompt && prompt.kind === "guard" && (
        <Modal m={m} title="Finish This Section First" onClose={() => setPrompt(null)}>
          <p style={ptext}>You shouldn't start a new section until every row here is complete. Outstanding:</p>
          <div style={{ margin: "12px 0", display: "flex", flexDirection: "column", gap: 8 }}>
            {prompt.details.map(({ row: r, missing }) => (
              <div key={r.id} style={{ padding: 10, background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.3)" }}>
                <div style={{ ...NB, fontSize: 14, color: "#b91c1c" }}><strong>{r.name}</strong> — {missing.length ? "missing panels " + missing.join(", ") : "not yet marked complete"}</div>
                <span onClick={() => { setPrompt(null); setSecId(section.id); openRow(r) }} style={{ ...NB, fontSize: 12, color: A, cursor: "pointer", letterSpacing: 1, textTransform: "uppercase" }}>Go fix this row →</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
            <button style={BTN_GHOST} onClick={() => setPrompt(null)}>Cancel</button>
            <button style={{ ...BTN, background: "#dc2626", color: "#fff" }} onClick={() => { setPrompt(null); addSection() }}>Start New Section Anyway</button>
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
    <div style={{ position: "fixed", inset: 0, zIndex: 5000, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", width: "100%", maxWidth: 460, maxHeight: "90vh", overflow: "auto", padding: m ? 20 : 28, boxShadow: "0 12px 48px rgba(0,0,0,.35)" }}>
        <div style={{ ...BB, fontSize: 26, letterSpacing: 1.5, color: INK, marginBottom: 14 }}>{title.toUpperCase()}</div>
        {children}
      </div>
    </div>
  )
}

function SettingsModal({ webhook, onSave, onClose, m }) {
  const [val, setVal] = useState(webhook || "")
  return (
    <Modal m={m} title="Google Sheets Sync" onClose={onClose}>
      <p style={ptext}>Paste your Google Apps Script Web App URL. Every scan (and correction) is sent there to append a timestamped row with serial, project, section, row and panel.</p>
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
      <div style={{ display: "flex", gap: 10 }}>
        <button style={{ ...BTN, flex: 1 }} onClick={() => { onSave(val.trim()); onClose() }}>Save</button>
        <button style={BTN_GHOST} onClick={onClose}>Close</button>
      </div>
    </Modal>
  )
}

const APPS_SCRIPT = `function doPost(e){
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Scans')
        || SpreadsheetApp.getActiveSpreadsheet().insertSheet('Scans');
  if (sh.getLastRow() === 0) {
    sh.appendRow(['Timestamp','Serial','Project','Section','Row','Panel','By','Status','Note','Mode','ID']);
  }
  var d = JSON.parse(e.postData.contents);
  if (d.mode === 'update') {
    var ids = sh.getRange(2,11,Math.max(sh.getLastRow()-1,1),1).getValues();
    for (var i=0;i<ids.length;i++){ if(ids[i][0]==d.id){
      sh.getRange(i+2,1,1,11).setValues([[d.timestamp,d.serial,d.project,d.section,d.row,d.panel,d.by,d.status,d.note,'update',d.id]]);
      return ContentService.createTextOutput('ok');
    }}
  }
  sh.appendRow([d.timestamp,d.serial,d.project,d.section,d.row,d.panel,d.by,d.status,d.note,d.mode,d.id]);
  return ContentService.createTextOutput('ok');
}`
