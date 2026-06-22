import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { jsPDF } from 'jspdf'
import { seedDoc } from './cashflow_seed.js'

/* ── access PINs ───────────────────────────────────────────────────────
   1998 → read-only (can view + export PDF)
   0662 → editor (full edit) */
const PIN_VIEW = '1998'
const PIN_EDIT = '0662'

/* ── design tokens ─────────────────────────────────────────────────── */
const ORANGE = '#F97316', GOLD = '#B8860B', NAVY = '#1e3a5f', GREEN = '#16a34a', RED = '#c0392b'
const BG = '#f5f2ee', CARD = '#ffffff', TEXT = '#1a1a2e', MID = '#5a5a5a', DIM = '#999', BORDER = 'rgba(0,0,0,.12)'
const BB = { fontFamily: "'Bebas Neue', sans-serif" }
const NB = { fontFamily: "'Barlow Condensed', sans-serif" }
const LOGO = '/src-logo.png'

const STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@300;400;600&family=Barlow+Condensed:wght@400;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
html,body,#root{height:100%}
body{background:${BG};color:${TEXT};font-family:'Barlow Condensed',sans-serif;-webkit-text-size-adjust:100%}
.cf-input{font-family:'Barlow Condensed',sans-serif;border:1px solid transparent;background:transparent;color:${TEXT};width:100%;padding:3px 4px;border-radius:3px}
.cf-input:hover{border-color:${BORDER}}
.cf-input:focus{outline:none;border-color:${ORANGE};background:#fffdf8}
.cf-num{text-align:right;font-variant-numeric:tabular-nums}
.cf-btn{font-family:'Barlow Condensed',sans-serif;cursor:pointer;border:none;letter-spacing:1px;text-transform:uppercase;font-weight:700;transition:all .18s}
.cf-row:hover .cf-rowdel{opacity:1}
::placeholder{color:${DIM}}
@media print{.cf-noprint{display:none!important}}
`

/* ── helpers ───────────────────────────────────────────────────────── */
const clone = (o) => JSON.parse(JSON.stringify(o))
const uid = (p) => (p || 'x') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
const isIncome = (sec) => sec && sec.kind === 'income'
// ensure older saved docs (no `kind`) still work — default sections to expense
const normalize = (d) => { if (d && Array.isArray(d.sections)) d.sections.forEach((s) => { if (s.kind !== 'income') s.kind = 'expense' }); return d }
const sum = (a) => (a || []).reduce((s, v) => s + (Number(v) || 0), 0)
const colSum = (rows, i) => rows.reduce((s, r) => s + (Number(r.values[i]) || 0), 0)

function fmtMoney(v, dash = '–') {
  const n = Number(v) || 0
  if (n === 0) return dash
  const neg = n < 0
  const s = '$' + Math.round(Math.abs(n)).toLocaleString('en-US')
  return neg ? '(' + s + ')' : s
}

/* ── PDF export ────────────────────────────────────────────────────── */
function exportPdf(doc, calc) {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a3' })
  const PW = pdf.internal.pageSize.getWidth(), PH = pdf.internal.pageSize.getHeight()
  const M = 28
  const months = doc.months
  // column layout: name | notes | months… | total
  const nameW = 150, notesW = 110, totalW = 64
  const monW = (PW - 2 * M - nameW - notesW - totalW) / months.length
  const cols = [
    { x: M, w: nameW, align: 'left' },
    { x: M + nameW, w: notesW, align: 'left' },
    ...months.map((_, i) => ({ x: M + nameW + notesW + i * monW, w: monW, align: 'right' })),
    { x: M + nameW + notesW + months.length * monW, w: totalW, align: 'right' },
  ]
  let y = M

  const txt = (s, c, opt = {}) => {
    pdf.setFont('helvetica', opt.bold ? 'bold' : (opt.italic ? 'italic' : 'normal'))
    pdf.setFontSize(opt.size || 7)
    pdf.setTextColor(opt.color || '#1a1a2e')
    const pad = 3
    const x = c.align === 'right' ? c.x + c.w - pad : c.x + pad
    pdf.text(String(s == null ? '' : s), x, y + 8, { align: c.align === 'right' ? 'right' : 'left', maxWidth: c.w - 2 * pad })
  }
  const newPageIf = (h) => { if (y + h > PH - M) { pdf.addPage(); y = M } }
  const fillRow = (color, h = 13) => { pdf.setFillColor(color); pdf.rect(M, y, PW - 2 * M, h, 'F') }

  // ── title block ──
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.setTextColor(NAVY)
  pdf.text(doc.title || 'Cash Flow Projection', M, y + 12); y += 22
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor('#5a5a5a')
  pdf.text(doc.subtitle || '', M, y + 6); y += 14
  pdf.setFontSize(8); pdf.setTextColor('#777')
  pdf.text(doc.meta || '', M, y + 6); y += 16

  // ── month header ──
  const header = (label) => {
    fillRow(NAVY, 15)
    txt(label, cols[0], { bold: true, color: '#fff', size: 7.5 })
    months.forEach((mo, i) => txt(mo, cols[2 + i], { bold: true, color: '#fff', size: 7 }))
    txt('Total', cols[cols.length - 1], { bold: true, color: '#fff', size: 7 })
    y += 15
  }

  // ── summary table ──
  header('SUMMARY')
  const summaryRow = (label, vals, total, opt = {}) => {
    newPageIf(13)
    if (opt.fill) fillRow(opt.fill)
    txt(label, cols[0], { bold: opt.bold, size: 7, color: opt.color })
    vals.forEach((v, i) => txt(opt.raw ? v : fmtMoney(v), cols[2 + i], { size: 7, color: opt.cellColor ? opt.cellColor(v) : opt.color }))
    if (total !== undefined) txt(opt.raw ? total : fmtMoney(total), cols[cols.length - 1], { bold: true, size: 7, color: opt.color })
    pdf.setDrawColor('#e2ddd5'); pdf.line(M, y + 13, PW - M, y + 13)
    y += 13
  }
  summaryRow('Deposit Date', doc.depositDates, '', { raw: true, color: '#777' })
  summaryRow('Expected Cash In', calc.monthIn, calc.totalIn, { bold: true, color: '#15803d' })
  summaryRow('Cash Out (Spend)', calc.monthOut, calc.totalOut, { bold: true })
  summaryRow('Net Cash Flow', calc.net, calc.totalIn - calc.totalOut, { color: '#5a5a5a', cellColor: (v) => v < 0 ? RED : (v > 0 ? '#15803d' : '#5a5a5a') })
  summaryRow('Remaining Balance', calc.remaining, calc.ending, { color: '#5a5a5a', cellColor: (v) => v < 0 ? RED : '#15803d' })
  y += 8

  // ── detail ──
  doc.sections.forEach((sec) => {
    const income = sec.kind === 'income'
    newPageIf(40)
    header((income ? '▲ CASH IN — ' : '') + sec.name)
    sec.subsections.forEach((sub) => {
      newPageIf(26)
      fillRow('#efe9df', 12)
      txt(sub.name, cols[0], { bold: true, size: 7, color: NAVY })
      y += 12
      sub.items.forEach((it) => {
        newPageIf(12)
        const opt = it.deferred ? { italic: true, color: GOLD } : {}
        txt(it.name, cols[0], { size: 6.8, ...opt })
        txt(it.notes, cols[1], { size: 6.5, color: it.deferred ? GOLD : '#888', italic: it.deferred })
        it.values.forEach((v, i) => txt(fmtMoney(v), cols[2 + i], { size: 6.8, ...opt }))
        txt(fmtMoney(sum(it.values)), cols[cols.length - 1], { size: 6.8, bold: true, color: it.deferred ? GOLD : '#1a1a2e' })
        pdf.setDrawColor('#eee'); pdf.line(M, y + 11, PW - M, y + 11)
        y += 11
      })
      // subtotal
      newPageIf(13)
      fillRow('#f6f2ec', 12)
      txt(sub.name + ' Subtotal', cols[0], { bold: true, size: 6.8, color: '#5a5a5a' })
      months.forEach((_, i) => txt(fmtMoney(colSum(sub.items, i)), cols[2 + i], { bold: true, size: 6.8 }))
      txt(fmtMoney(sum(sub.items.map((it) => sum(it.values)))), cols[cols.length - 1], { bold: true, size: 6.8 })
      y += 12
    })
    // section total
    newPageIf(14)
    const accent = income ? '#15803d' : ORANGE
    fillRow(income ? '#e7f5ec' : '#fdebd9', 13)
    const secMonth = months.map((_, i) => sec.subsections.reduce((s, sub) => s + colSum(sub.items, i), 0))
    txt(sec.name + ' TOTAL' + (income ? ' (IN)' : ''), cols[0], { bold: true, size: 7, color: accent })
    secMonth.forEach((v, i) => txt(fmtMoney(v), cols[2 + i], { bold: true, size: 7, color: accent }))
    txt(fmtMoney(sum(secMonth)), cols[cols.length - 1], { bold: true, size: 7, color: accent })
    y += 17
  })

  newPageIf(20)
  pdf.setFont('helvetica', 'italic'); pdf.setFontSize(6.5); pdf.setTextColor('#999')
  pdf.text(doc.source || '', M, y + 8)

  pdf.save('Sunrise_CashFlow_Projection_' + new Date().toISOString().slice(0, 10) + '.pdf')
}

/* ── PIN gate ──────────────────────────────────────────────────────── */
function PinGate({ onUnlock }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const submit = () => {
    if (pin === PIN_EDIT) { onUnlock('edit'); return }
    if (pin === PIN_VIEW) { onUnlock('view'); return }
    setErr('Incorrect PIN'); setPin('')
  }
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'linear-gradient(160deg,#fbf8f3,#efe9df)' }}>
      <div style={{ width: 'min(420px,100%)', background: CARD, borderRadius: 14, padding: '38px 32px', boxShadow: '0 18px 50px rgba(30,58,95,.16)', textAlign: 'center', border: '1px solid ' + BORDER }}>
        <img src={LOGO} alt="SRC" style={{ width: 130, height: 'auto', margin: '0 auto 18px', display: 'block' }} />
        <div style={{ ...BB, fontSize: 30, letterSpacing: 2, color: NAVY, lineHeight: 1 }}>Cash Flow Projection</div>
        <div style={{ ...NB, fontSize: 14, color: MID, marginTop: 6, letterSpacing: 1 }}>Enter your access PIN to continue</div>
        <input
          value={pin} type="password" inputMode="numeric" autoFocus
          onChange={(e) => { setErr(''); setPin(e.target.value.replace(/\D/g, '').slice(0, 8)) }}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          placeholder="••••"
          style={{ ...NB, marginTop: 24, width: '100%', textAlign: 'center', fontSize: 28, letterSpacing: 10, padding: '12px 0', border: '2px solid ' + (err ? RED : BORDER), borderRadius: 10, background: '#fff', color: NAVY }}
        />
        {err && <div style={{ ...NB, color: RED, fontSize: 14, marginTop: 10, letterSpacing: 1 }}>{err}</div>}
        <button className="cf-btn" onClick={submit} style={{ marginTop: 20, width: '100%', background: ORANGE, color: '#1a1206', padding: '14px 0', borderRadius: 10, fontSize: 16, letterSpacing: 3 }}>Unlock</button>
        <div style={{ ...NB, fontSize: 12, color: DIM, marginTop: 18, lineHeight: 1.5 }}>
          Read-only PIN allows viewing &amp; PDF export.<br />Editor PIN allows full changes.
        </div>
      </div>
    </div>
  )
}

/* ── small UI atoms ────────────────────────────────────────────────── */
const IconBtn = ({ children, onClick, title, color = MID }) => (
  <button className="cf-btn" title={title} onClick={onClick}
    style={{ background: 'transparent', color, padding: '2px 6px', borderRadius: 5, fontSize: 13, lineHeight: 1, border: '1px solid ' + BORDER }}>
    {children}
  </button>
)

/* ── main tool ─────────────────────────────────────────────────────── */
export default function CashFlow() {
  const [role, setRole] = useState(() => { try { return sessionStorage.getItem('cf_role') } catch (e) { return null } })
  const [doc, setDoc] = useState(null)
  const [status, setStatus] = useState('loading') // loading | ready | offline
  const [save, setSave] = useState('idle')        // idle | saving | saved | error
  const [mob, setMob] = useState(typeof window !== 'undefined' ? window.innerWidth < 820 : false)
  const saveTimer = useRef(null)
  const skipSave = useRef(true)

  const editable = role === 'edit'

  useEffect(() => { const h = () => setMob(window.innerWidth < 820); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h) }, [])

  // load shared doc once unlocked
  useEffect(() => {
    if (!role) return
    let live = true
    setStatus('loading')
    fetch('/.netlify/functions/cashflow', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((j) => {
        if (!live) return
        if (j && Array.isArray(j.sections)) { setDoc(normalize(j)); setStatus('ready') }
        else {
          try { const ls = JSON.parse(localStorage.getItem('cf_doc') || 'null'); if (ls && ls.sections) { setDoc(normalize(ls)); setStatus('offline'); return } } catch (e) {}
          setDoc(normalize(seedDoc())); setStatus('ready')
        }
      })
      .catch(() => {
        if (!live) return
        try { const ls = JSON.parse(localStorage.getItem('cf_doc') || 'null'); if (ls && ls.sections) { setDoc(normalize(ls)); setStatus('offline'); return } } catch (e) {}
        setDoc(normalize(seedDoc())); setStatus('offline')
      })
      .finally(() => { setTimeout(() => { skipSave.current = false }, 400) })
    return () => { live = false }
  }, [role])

  const unlock = (r) => { setRole(r); try { sessionStorage.setItem('cf_role', r) } catch (e) {} }
  const lock = () => { setRole(null); try { sessionStorage.removeItem('cf_role') } catch (e) {} }

  // persist (editor only) — debounced
  useEffect(() => {
    if (!doc || !editable || skipSave.current) return
    try { localStorage.setItem('cf_doc', JSON.stringify(doc)) } catch (e) {}
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSave('saving')
    saveTimer.current = setTimeout(() => {
      const payload = Object.assign({}, doc, { savedAt: Date.now() })
      fetch('/.netlify/functions/cashflow', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
        .then((r) => r.ok ? r.json() : Promise.reject())
        .then((j) => { if (j && j.rev != null) setDoc((d) => Object.assign({}, d, { rev: j.rev })); setSave('saved'); setTimeout(() => setSave('idle'), 1800) })
        .catch(() => setSave('error'))
    }, 900)
  }, [doc, editable])

  // ── editor mutators ──
  const mutate = useCallback((fn) => setDoc((d) => { const c = clone(d); fn(c); return c }), [])
  const findSub = (c, secId, subId) => { const s = c.sections.find((x) => x.id === secId); return s && s.subsections.find((x) => x.id === subId) }

  const setItemVal = (secId, subId, itemId, mi, raw) => mutate((c) => {
    const sub = findSub(c, secId, subId); if (!sub) return
    const it = sub.items.find((x) => x.id === itemId); if (!it) return
    const n = Number(String(raw).replace(/[^0-9.-]/g, '')); it.values[mi] = isNaN(n) ? 0 : n
  })
  const setItemField = (secId, subId, itemId, field, val) => mutate((c) => {
    const sub = findSub(c, secId, subId); if (!sub) return
    const it = sub.items.find((x) => x.id === itemId); if (it) it[field] = val
  })
  const toggleDeferred = (secId, subId, itemId) => mutate((c) => {
    const sub = findSub(c, secId, subId); if (!sub) return
    const it = sub.items.find((x) => x.id === itemId); if (it) it.deferred = !it.deferred
  })
  const addItem = (secId, subId) => mutate((c) => {
    const sub = findSub(c, secId, subId); if (!sub) return
    sub.items.push({ id: uid('it'), name: 'New Line Item', notes: '', values: new Array(c.months.length).fill(0), deferred: false })
  })
  const delItem = (secId, subId, itemId) => mutate((c) => {
    const sub = findSub(c, secId, subId); if (!sub) return
    sub.items = sub.items.filter((x) => x.id !== itemId)
  })
  const addSub = (secId) => mutate((c) => {
    const s = c.sections.find((x) => x.id === secId); if (!s) return
    s.subsections.push({ id: uid('sub'), name: 'NEW SUBSECTION', items: [] })
  })
  const renameSub = (secId, subId, name) => mutate((c) => { const sub = findSub(c, secId, subId); if (sub) sub.name = name })
  const delSub = (secId, subId) => mutate((c) => { const s = c.sections.find((x) => x.id === secId); if (s) s.subsections = s.subsections.filter((x) => x.id !== subId) })
  const addSection = (kind = 'expense') => mutate((c) => { c.sections.push({ id: uid('sec'), name: kind === 'income' ? 'NEW CASH-IN SECTION' : 'NEW SECTION', kind, subsections: [{ id: uid('sub'), name: 'NEW SUBSECTION', items: [{ id: uid('it'), name: 'New Line Item', notes: '', values: new Array(c.months.length).fill(0), deferred: false }] }] }) })
  const toggleKind = (secId) => mutate((c) => { const s = c.sections.find((x) => x.id === secId); if (s) s.kind = isIncome(s) ? 'expense' : 'income' })
  const renameSection = (secId, name) => mutate((c) => { const s = c.sections.find((x) => x.id === secId); if (s) s.name = name })
  const delSection = (secId) => mutate((c) => { c.sections = c.sections.filter((x) => x.id !== secId) })
  const setMeta = (field, val) => mutate((c) => { c[field] = val })
  const setCapital = (val) => mutate((c) => { c.startingCapital = Number(String(val).replace(/[^0-9.-]/g, '')) || 0 })

  // ── derived calc ──
  const calc = useMemo(() => {
    if (!doc) return null
    const N = doc.months.length
    const monthIn = new Array(N).fill(0), monthOut = new Array(N).fill(0)
    doc.sections.forEach((sec) => {
      const bucket = isIncome(sec) ? monthIn : monthOut
      sec.subsections.forEach((sub) => sub.items.forEach((it) => {
        for (let i = 0; i < N; i++) bucket[i] += Number(it.values[i]) || 0
      }))
    })
    const net = monthIn.map((v, i) => v - monthOut[i])
    const cumOut = []; const remaining = []
    let ro = 0, bal = doc.startingCapital || 0
    for (let i = 0; i < N; i++) { ro += monthOut[i]; cumOut.push(ro); bal += net[i]; remaining.push(bal) }
    const totalIn = monthIn.reduce((s, v) => s + v, 0)
    const totalOut = monthOut.reduce((s, v) => s + v, 0)
    const hasIncome = doc.sections.some(isIncome)
    return { monthIn, monthOut, net, cumOut, remaining, totalIn, totalOut, grand: totalOut, ending: remaining[N - 1], hasIncome }
  }, [doc])

  if (!role) return (<><style>{STYLE}</style><PinGate onUnlock={unlock} /></>)
  if (!doc || !calc) return (<><style>{STYLE}</style><div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', ...NB, color: MID, fontSize: 18, letterSpacing: 2 }}>Loading projection…</div></>)

  const N = doc.months.length

  // shared cell styles
  const th = { padding: '8px 6px', ...NB, fontSize: 12, fontWeight: 700, letterSpacing: .5, color: '#fff', textTransform: 'uppercase', whiteSpace: 'nowrap' }
  const td = { padding: '4px 6px', ...NB, fontSize: 13, borderBottom: '1px solid #eee', whiteSpace: 'nowrap' }
  const numTd = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }

  const MonthHeaderRow = ({ label, dark }) => (
    <tr style={{ background: dark ? NAVY : '#efe9df' }}>
      <th style={{ ...th, textAlign: 'left', color: dark ? '#fff' : NAVY, position: 'sticky', left: 0, background: dark ? NAVY : '#efe9df', zIndex: 2, minWidth: mob ? 150 : 230 }}>{label}</th>
      {!dark && <th style={{ ...th, color: NAVY }} />}
      {dark && <th style={{ ...th, textAlign: 'left' }}>Notes</th>}
      {doc.months.map((mo, i) => <th key={i} style={{ ...th, textAlign: 'right', color: dark ? '#fff' : NAVY }}>{mo}</th>)}
      <th style={{ ...th, textAlign: 'right', color: dark ? '#fff' : NAVY }}>Total</th>
    </tr>
  )

  return (
    <>
      <style>{STYLE}</style>
      <div style={{ minHeight: '100vh', background: BG, paddingBottom: 60 }}>
        {/* top bar */}
        <div className="cf-noprint" style={{ position: 'sticky', top: 0, zIndex: 30, background: NAVY, color: '#fff', display: 'flex', alignItems: 'center', gap: 12, padding: mob ? '10px 12px' : '12px 22px', flexWrap: 'wrap', boxShadow: '0 2px 10px rgba(0,0,0,.18)' }}>
          <img src={LOGO} alt="SRC" style={{ height: 34, width: 'auto', background: '#fff', borderRadius: 6, padding: 2 }} />
          <div style={{ ...BB, fontSize: mob ? 18 : 22, letterSpacing: 1.5, lineHeight: 1, flex: '0 1 auto' }}>SUNRISE CASH FLOW</div>
          <span style={{ ...NB, fontSize: 11, fontWeight: 700, letterSpacing: 1, padding: '3px 9px', borderRadius: 20, background: editable ? ORANGE : 'rgba(255,255,255,.18)', color: editable ? '#1a1206' : '#fff', textTransform: 'uppercase' }}>
            {editable ? 'Editor' : 'Read-only'}
          </span>
          <div style={{ flex: 1 }} />
          {editable && (
            <span style={{ ...NB, fontSize: 12, letterSpacing: 1, color: save === 'error' ? '#ffb4a8' : 'rgba(255,255,255,.7)', minWidth: 64 }}>
              {save === 'saving' ? 'Saving…' : save === 'saved' ? 'Saved ✓' : save === 'error' ? 'Save failed' : status === 'offline' ? 'Offline' : ''}
            </span>
          )}
          <button className="cf-btn" onClick={() => exportPdf(doc, calc)} style={{ background: ORANGE, color: '#1a1206', padding: '8px 14px', borderRadius: 7, fontSize: 13, letterSpacing: 1.5 }}>Export PDF</button>
          <button className="cf-btn" onClick={lock} style={{ background: 'rgba(255,255,255,.14)', color: '#fff', padding: '8px 12px', borderRadius: 7, fontSize: 13, letterSpacing: 1.5 }}>Lock</button>
        </div>

        <div style={{ maxWidth: 1500, margin: '0 auto', padding: mob ? '16px 10px' : '24px 22px' }}>
          {/* title block */}
          <div style={{ background: CARD, borderRadius: 12, padding: mob ? 16 : '22px 26px', border: '1px solid ' + BORDER, boxShadow: '0 6px 22px rgba(30,58,95,.06)' }}>
            <div style={{ ...NB, fontSize: 11, letterSpacing: 2, color: RED, fontWeight: 700, textTransform: 'uppercase' }}>{doc.confidential}</div>
            {editable
              ? <input className="cf-input" value={doc.title} onChange={(e) => setMeta('title', e.target.value)} style={{ ...BB, fontSize: mob ? 24 : 32, letterSpacing: 1, color: NAVY, marginTop: 4 }} />
              : <div style={{ ...BB, fontSize: mob ? 24 : 32, letterSpacing: 1, color: NAVY, marginTop: 4 }}>{doc.title}</div>}
            {editable
              ? <input className="cf-input" value={doc.subtitle} onChange={(e) => setMeta('subtitle', e.target.value)} style={{ ...NB, fontSize: 15, color: MID, marginTop: 2 }} />
              : <div style={{ ...NB, fontSize: 15, color: MID, marginTop: 2 }}>{doc.subtitle}</div>}
            {editable
              ? <input className="cf-input" value={doc.meta} onChange={(e) => setMeta('meta', e.target.value)} style={{ ...NB, fontSize: 13, color: DIM, marginTop: 6 }} />
              : <div style={{ ...NB, fontSize: 13, color: DIM, marginTop: 6 }}>{doc.meta}</div>}
          </div>

          {/* KPI strip */}
          <div style={{ display: 'grid', gridTemplateColumns: mob ? '1fr 1fr' : 'repeat(4,1fr)', gap: 12, marginTop: 16 }}>
            {[
              ['Starting Capital', fmtMoney(doc.startingCapital, '$0'), NAVY, true],
              ['Total Cash In', fmtMoney(calc.totalIn), GREEN],
              ['Total Cash Out', fmtMoney(calc.totalOut), ORANGE],
              ['Ending Balance', fmtMoney(calc.ending, '$0'), calc.ending < 0 ? RED : GREEN],
            ].map(([label, val, color, capEdit], i) => (
              <div key={i} style={{ background: CARD, borderRadius: 10, padding: '14px 16px', border: '1px solid ' + BORDER }}>
                <div style={{ ...NB, fontSize: 11, letterSpacing: 1, color: DIM, textTransform: 'uppercase' }}>{label}</div>
                {capEdit && editable
                  ? <input className="cf-input cf-num" value={Math.round(doc.startingCapital)} onChange={(e) => setCapital(e.target.value)} style={{ ...BB, fontSize: 24, color, textAlign: 'left' }} />
                  : <div style={{ ...BB, fontSize: 24, color, marginTop: 2 }}>{val}</div>}
              </div>
            ))}
          </div>

          {/* TABLE */}
          <div style={{ background: CARD, borderRadius: 12, border: '1px solid ' + BORDER, marginTop: 18, overflow: 'hidden', boxShadow: '0 6px 22px rgba(30,58,95,.06)' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1100 }}>
                {/* ── summary ── */}
                <thead>
                  <MonthHeaderRow label="Cash Position Summary" dark />
                </thead>
                <tbody>
                  <tr>
                    <td style={{ ...td, position: 'sticky', left: 0, background: CARD, fontWeight: 700 }}>Deposit Date</td>
                    <td style={{ ...td, color: DIM }} />
                    {doc.depositDates.map((d, i) => <td key={i} style={{ ...numTd, color: DIM }}>{d}</td>)}
                    <td style={numTd} />
                  </tr>
                  <tr style={{ background: '#f1f8f2' }}>
                    <td style={{ ...td, position: 'sticky', left: 0, background: '#f1f8f2', fontWeight: 700, color: GREEN }}>Expected Cash In</td>
                    <td style={{ ...td, color: DIM, fontSize: 11 }}>Inflows</td>
                    {calc.monthIn.map((v, i) => <td key={i} style={{ ...numTd, fontWeight: 600, color: v ? GREEN : DIM }}>{fmtMoney(v)}</td>)}
                    <td style={{ ...numTd, fontWeight: 700, color: GREEN }}>{fmtMoney(calc.totalIn)}</td>
                  </tr>
                  <tr style={{ background: '#fdf6ee' }}>
                    <td style={{ ...td, position: 'sticky', left: 0, background: '#fdf6ee', fontWeight: 700, color: NAVY }}>Cash Out (Spend)</td>
                    <td style={{ ...td, color: DIM, fontSize: 11 }}>Outflows</td>
                    {calc.monthOut.map((v, i) => <td key={i} style={{ ...numTd, fontWeight: 700 }}>{fmtMoney(v)}</td>)}
                    <td style={{ ...numTd, fontWeight: 700, color: ORANGE }}>{fmtMoney(calc.totalOut)}</td>
                  </tr>
                  <tr>
                    <td style={{ ...td, position: 'sticky', left: 0, background: CARD, fontWeight: 600 }}>Net Cash Flow</td>
                    <td style={{ ...td, color: DIM, fontSize: 11 }}>In − Out</td>
                    {calc.net.map((v, i) => <td key={i} style={{ ...numTd, color: v < 0 ? RED : (v > 0 ? GREEN : MID) }}>{fmtMoney(v)}</td>)}
                    <td style={{ ...numTd, fontWeight: 700, color: (calc.totalIn - calc.totalOut) < 0 ? RED : GREEN }}>{fmtMoney(calc.totalIn - calc.totalOut)}</td>
                  </tr>
                  <tr style={{ background: '#f7f9f7' }}>
                    <td style={{ ...td, position: 'sticky', left: 0, background: '#f7f9f7', fontWeight: 700 }}>Remaining Balance</td>
                    <td style={{ ...td, color: DIM, fontSize: 11 }}>start {fmtMoney(doc.startingCapital, '$0')}</td>
                    {calc.remaining.map((v, i) => <td key={i} style={{ ...numTd, fontWeight: 600, color: v < 0 ? RED : GREEN }}>{fmtMoney(v)}</td>)}
                    <td style={{ ...numTd, fontWeight: 700, color: calc.ending < 0 ? RED : GREEN }}>{fmtMoney(calc.ending)}</td>
                  </tr>
                </tbody>

                {/* ── line item detail ── */}
                <thead>
                  <tr><td colSpan={N + 3} style={{ height: 14, background: BG }} /></tr>
                  <tr style={{ background: '#2b2b3a' }}>
                    <td colSpan={N + 3} style={{ padding: '8px 10px', ...NB, fontSize: 13, fontWeight: 700, letterSpacing: 1, color: '#fff' }}>
                      LINE ITEM DETAIL <span style={{ color: GOLD, fontWeight: 400, fontStyle: 'italic', fontSize: 12 }}>● Deferred items shown in gold italic</span>
                    </td>
                  </tr>
                </thead>

                {doc.sections.map((sec) => {
                  const secMonth = doc.months.map((_, i) => sec.subsections.reduce((s, sub) => s + colSum(sub.items, i), 0))
                  const secTotal = sum(secMonth)
                  const income = isIncome(sec)
                  const secBg = income ? '#15543b' : NAVY        // green header for cash-in sections
                  const secAccent = income ? GREEN : ORANGE      // totals accent
                  return (
                    <tbody key={sec.id}>
                      {/* section header */}
                      <tr style={{ background: secBg }}>
                        <td style={{ padding: '7px 8px', position: 'sticky', left: 0, background: secBg, zIndex: 1 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ ...NB, fontSize: 9.5, fontWeight: 700, letterSpacing: 1, padding: '2px 7px', borderRadius: 4, background: income ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.14)', color: '#fff', whiteSpace: 'nowrap' }}>{income ? '▲ CASH IN' : '▼ CASH OUT'}</span>
                            {editable
                              ? <input className="cf-input" value={sec.name} onChange={(e) => renameSection(sec.id, e.target.value)} style={{ ...NB, fontSize: 14, fontWeight: 700, letterSpacing: .5, color: '#fff', textTransform: 'uppercase' }} />
                              : <span style={{ ...NB, fontSize: 14, fontWeight: 700, letterSpacing: .5, color: '#fff', textTransform: 'uppercase' }}>{sec.name}</span>}
                          </span>
                        </td>
                        <td colSpan={N + 1} style={{ background: secBg }} />
                        <td style={{ background: secBg, textAlign: 'right', padding: '0 6px', whiteSpace: 'nowrap' }} className="cf-noprint">
                          {editable && <>
                            <IconBtn title={income ? 'Switch to Cash Out (expense)' : 'Switch to Cash In (income)'} color="#fff" onClick={() => toggleKind(sec.id)}>⇄</IconBtn>{' '}
                            <IconBtn title="Delete section" color="#ffb4a8" onClick={() => { if (confirm('Delete section "' + sec.name + '" and all its items?')) delSection(sec.id) }}>✕</IconBtn>
                          </>}
                        </td>
                      </tr>

                      {sec.subsections.map((sub) => {
                        const subTotal = sum(sub.items.map((it) => sum(it.values)))
                        return (
                          <React.Fragment key={sub.id}>
                            {/* subsection header */}
                            <tr style={{ background: '#efe9df' }}>
                              <td style={{ padding: '5px 8px', position: 'sticky', left: 0, background: '#efe9df' }}>
                                {editable
                                  ? <input className="cf-input" value={sub.name} onChange={(e) => renameSub(sec.id, sub.id, e.target.value)} style={{ ...NB, fontSize: 12.5, fontWeight: 700, letterSpacing: .5, color: NAVY, textTransform: 'uppercase' }} />
                                  : <span style={{ ...NB, fontSize: 12.5, fontWeight: 700, letterSpacing: .5, color: NAVY, textTransform: 'uppercase' }}>{sub.name}</span>}
                              </td>
                              <td colSpan={N + 1} style={{ background: '#efe9df' }} />
                              <td style={{ background: '#efe9df', textAlign: 'right', padding: '0 6px' }} className="cf-noprint">
                                {editable && <IconBtn title="Delete subsection" color={RED} onClick={() => { if (confirm('Delete subsection "' + sub.name + '"?')) delSub(sec.id, sub.id) }}>✕</IconBtn>}
                              </td>
                            </tr>

                            {/* items */}
                            {sub.items.map((it) => {
                              const itColor = it.deferred ? GOLD : TEXT
                              const itStyle = it.deferred ? { color: GOLD, fontStyle: 'italic' } : { color: TEXT }
                              return (
                                <tr key={it.id} className="cf-row">
                                  <td style={{ ...td, position: 'sticky', left: 0, background: CARD, ...itStyle, minWidth: mob ? 150 : 230 }}>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      {editable && (
                                        <button className="cf-rowdel cf-btn cf-noprint" title="Delete line item" onClick={() => delItem(sec.id, sub.id, it.id)}
                                          style={{ opacity: 0, background: 'transparent', color: RED, fontSize: 13, padding: 0, lineHeight: 1, transition: 'opacity .15s' }}>✕</button>
                                      )}
                                      {editable
                                        ? <input className="cf-input" value={it.name} onChange={(e) => setItemField(sec.id, sub.id, it.id, 'name', e.target.value)} style={{ ...itStyle, fontSize: 13 }} />
                                        : <span>{it.name}</span>}
                                    </span>
                                  </td>
                                  <td style={{ ...td, color: it.deferred ? GOLD : DIM, fontSize: 11.5, fontStyle: it.deferred ? 'italic' : 'normal', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {editable
                                      ? <input className="cf-input" value={it.notes} placeholder="notes" onChange={(e) => setItemField(sec.id, sub.id, it.id, 'notes', e.target.value)} style={{ fontSize: 11.5, color: it.deferred ? GOLD : DIM }} />
                                      : (it.notes || '')}
                                  </td>
                                  {it.values.map((v, mi) => (
                                    <td key={mi} style={{ ...numTd, ...itStyle, padding: editable ? '2px 3px' : '4px 6px' }}>
                                      {editable
                                        ? <input className="cf-input cf-num" value={v === 0 ? '' : v} placeholder="–" onChange={(e) => setItemVal(sec.id, sub.id, it.id, mi, e.target.value)} style={{ fontSize: 12.5, ...itStyle, minWidth: 56 }} />
                                        : fmtMoney(v)}
                                    </td>
                                  ))}
                                  <td style={{ ...numTd, fontWeight: 700, color: itColor }}>{fmtMoney(sum(it.values))}</td>
                                </tr>
                              )
                            })}

                            {/* add item (editor) */}
                            {editable && (
                              <tr className="cf-noprint">
                                <td colSpan={N + 3} style={{ ...td, borderBottom: '1px solid #eee', background: '#fcfbf9' }}>
                                  <button className="cf-btn" onClick={() => addItem(sec.id, sub.id)} style={{ background: 'transparent', color: ORANGE, fontSize: 12, padding: '2px 6px', border: '1px dashed ' + ORANGE, borderRadius: 5 }}>+ Add line item</button>
                                </td>
                              </tr>
                            )}

                            {/* subsection subtotal */}
                            <tr style={{ background: '#f6f2ec' }}>
                              <td style={{ ...td, position: 'sticky', left: 0, background: '#f6f2ec', fontWeight: 700, color: MID, fontSize: 12 }}>{sub.name} Subtotal</td>
                              <td style={{ ...td, background: '#f6f2ec' }} />
                              {doc.months.map((_, i) => <td key={i} style={{ ...numTd, fontWeight: 700, fontSize: 12 }}>{fmtMoney(colSum(sub.items, i))}</td>)}
                              <td style={{ ...numTd, fontWeight: 700, fontSize: 12 }}>{fmtMoney(subTotal)}</td>
                            </tr>
                          </React.Fragment>
                        )
                      })}

                      {/* add subsection (editor) */}
                      {editable && (
                        <tr className="cf-noprint">
                          <td colSpan={N + 3} style={{ ...td, background: '#fcfbf9', borderBottom: '1px solid #eee' }}>
                            <button className="cf-btn" onClick={() => addSub(sec.id)} style={{ background: 'transparent', color: NAVY, fontSize: 12, padding: '3px 8px', border: '1px dashed ' + NAVY, borderRadius: 5 }}>+ Add subsection</button>
                          </td>
                        </tr>
                      )}

                      {/* section total */}
                      <tr style={{ background: income ? '#e7f5ec' : '#fdebd9' }}>
                        <td style={{ ...td, position: 'sticky', left: 0, background: income ? '#e7f5ec' : '#fdebd9', fontWeight: 700, color: secAccent, fontSize: 13 }}>{sec.name} TOTAL {income ? '(IN)' : ''}</td>
                        <td style={{ ...td, background: income ? '#e7f5ec' : '#fdebd9' }} />
                        {secMonth.map((v, i) => <td key={i} style={{ ...numTd, fontWeight: 700, color: secAccent, fontSize: 13 }}>{fmtMoney(v)}</td>)}
                        <td style={{ ...numTd, fontWeight: 700, color: secAccent, fontSize: 13 }}>{fmtMoney(secTotal)}</td>
                      </tr>
                      <tr><td colSpan={N + 3} style={{ height: 10, background: BG }} /></tr>
                    </tbody>
                  )
                })}
              </table>
            </div>

            {editable && (
              <div className="cf-noprint" style={{ padding: 16, textAlign: 'center', borderTop: '1px solid ' + BORDER, display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button className="cf-btn" onClick={() => addSection('income')} style={{ background: GREEN, color: '#fff', fontSize: 13, padding: '10px 20px', borderRadius: 8, letterSpacing: 1.5 }}>+ Add Cash-In Section</button>
                <button className="cf-btn" onClick={() => addSection('expense')} style={{ background: NAVY, color: '#fff', fontSize: 13, padding: '10px 20px', borderRadius: 8, letterSpacing: 1.5 }}>+ Add Cash-Out Section</button>
              </div>
            )}
          </div>

          <div style={{ ...NB, fontSize: 12, color: DIM, marginTop: 16, fontStyle: 'italic' }}>{doc.source}</div>
        </div>
      </div>
    </>
  )
}
