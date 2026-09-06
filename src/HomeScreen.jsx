import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Users, Wrench, DraftingCompass, HardHat, FileText, ShieldAlert, BarChart3, Clock, Truck, Contact, ListChecks, Settings, Map as MapIcon, Layers, ShieldCheck, TriangleAlert, ChevronDown, CircleUser, Check } from 'lucide-react'
import { getTaskTrackerKPI, fetchTaskTrackerKPI, setActiveProject } from './pile_plan.jsx'

/* Phone home screen: the illustrated site with every module pinned to it as
   a callout, under a live "project health" strip. Numbers are real —
   Task Tracker progress and QC flags, who is clocked in right now, and open
   Project Tracker items. Desktop keeps the classic tile dashboard. */

const A = '#F97316'
const CREAM = '#F5F0EB'
const MUTE = '#9a958d'
const BB = { fontFamily: "'Bebas Neue', sans-serif" }
const NB = { fontFamily: "'Barlow Condensed', sans-serif" }
const PANEL = { background: 'rgba(6,8,18,.93)', border: '1px solid rgba(249,115,22,.42)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,.55)' }

const ICONS = {
  hr: Users, equipment: Wrench, precon: DraftingCompass, field: HardHat, compliance: FileText, hse: ShieldAlert,
  stakeholders: BarChart3, timekeeping: Clock, loads: Truck, crm: Contact, projecttracker: ListChecks, admin: Settings,
  mytimecard: Clock, pileplan: MapIcon, documents: FileText,
}
/* Where each callout sits on the illustration (percent of the art box),
   mirroring the concept art: offices top-left, laydown yard top-right,
   blueprints right, gate and loads at the bottom. Two columns, no overlaps
   down to 340px-wide phones. */
/* Percent positions measured off the concept image (941×1198): each callout
   sits on the part of the site it belongs to — offices top-left, laydown
   yard top-right, blueprints, safety gate, loads at the road. Right-column
   cards anchor to their right edge so they never spill off screen. */
const POS = {
  hr:             { left: 3.8,  y: 3.8 },
  equipment:      { right: 25,  y: 1.9 },
  precon:         { right: 2.2, y: 12 },
  field:          { left: 3,    y: 21.1 },
  compliance:     { right: 9.2, y: 27.9 },
  hse:            { right: 1.2, y: 40 },
  stakeholders:   { left: 2.8,  y: 45.3 },
  loads:          { right: 2.2, y: 57 },
  timekeeping:    { left: 14,   y: 58.7 },
  crm:            { left: 2.8,  y: 69 },
  projecttracker: { right: 2.2, y: 76.6 },
  admin:          { left: 38,   y: 87 },
}
/* the picture is shown whole so the percentages above land where they should */
const ART_ASPECT = '941 / 1198'

function fmtWhen(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
function todayKey() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
/* tk_punches is { "<workerId>_<YYYY-MM-DD>": [{type:'in'|'out',time}] } */
function crewOnSite(punches) {
  if (!punches || typeof punches !== 'object') return 0
  const suffix = '_' + todayKey(); let n = 0
  for (const k of Object.keys(punches)) {
    if (!k.endsWith(suffix)) continue
    const arr = punches[k]; if (!Array.isArray(arr) || !arr.length) continue
    if (arr[arr.length - 1] && arr[arr.length - 1].type === 'in') n++
  }
  return n
}

function Ring({ pct, size = 64 }) {
  const r = (size - 8) / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct || 0))
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth={7} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={A} strokeWidth={7} strokeLinecap="round" strokeDasharray={`${c * p / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dasharray .6s ease' }} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fill={CREAM} style={{ ...BB, fontSize: size * 0.3 }}>{p.toFixed(1)}%</text>
    </svg>
  )
}

function Stat({ icon: Icon, value, label, dot, note }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
      <Icon size={26} color={A} strokeWidth={2.2} style={{ flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ ...BB, fontSize: 26, lineHeight: 1, color: CREAM }}>{value}</div>
        <div style={{ ...NB, fontSize: 12, color: '#c9c4bc', letterSpacing: .3, lineHeight: 1.15 }}>{label}</div>
        <div style={{ ...NB, fontSize: 11, color: MUTE, display: 'flex', alignItems: 'center', gap: 5, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <span style={{ width: 7, height: 7, borderRadius: 4, background: dot, boxShadow: `0 0 6px ${dot}`, flexShrink: 0 }} />{note}
        </div>
      </div>
    </div>
  )
}

/* Compact callout like the concept art: icon, name, one-line hint. The tap
   target is the whole outer box — the card, its leader line and the dot,
   plus a margin — so the "section" is the button, not just the label. */
function Callout({ left, right, y, icon: Icon, label, desc, onClick, accent }) {
  const col = accent || A
  const anchor = right != null ? { right: `calc(${right}% - 8px)` } : { left: `calc(${left}% - 8px)` }
  return (
    <div onClick={onClick} role="button" aria-label={label} title={desc} style={{ position: 'absolute', ...anchor, top: `calc(${y}% - 8px)`, width: 'calc(36% + 16px)', padding: '8px 8px 30px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(3,4,10,.92)', border: '1px solid ' + col, borderRadius: 6, padding: '4px 7px', minHeight: 32, boxShadow: '0 6px 16px rgba(0,0,0,.6), 0 0 0 1px rgba(0,0,0,.7)' }}>
          <div style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', color: col, flexShrink: 0 }}><Icon size={18} strokeWidth={2.1} /></div>
          <div style={{ ...NB, fontWeight: 700, fontSize: 10.5, letterSpacing: .4, textTransform: 'uppercase', color: CREAM, lineHeight: 1.05, minWidth: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{label}</div>
        </div>
        <div style={{ position: 'absolute', left: '50%', top: '100%', width: 2, height: 13, background: col, marginLeft: -1 }} />
        <div style={{ position: 'absolute', left: '50%', top: 'calc(100% + 11px)', width: 9, height: 9, borderRadius: 5, marginLeft: -4.5, background: '#fff4e8', boxShadow: `0 0 0 2.5px ${col}, 0 0 12px 4px ${col}` }} />
      </div>
    </div>
  )
}

export default function HomeScreen({ user, tiles, hideKeys, isAdmin, onOpen, onOpenPage, onChangePassword, onSignOut }) {
  const [kpi, setKpi] = useState(() => { try { return getTaskTrackerKPI() } catch (e) { return null } })
  const [crew, setCrew] = useState(null)
  const [issues, setIssues] = useState(null)
  const [projOpen, setProjOpen] = useState(false)
  const [busy, setBusy] = useState(false)          // board refreshing after a project switch
  const aliveRef = useRef(true)

  useEffect(() => {
    let alive = true
    aliveRef.current = true
    fetchTaskTrackerKPI().then((k) => { if (alive && k) setKpi(k) })
    fetch('/.netlify/functions/portal?key=tk_punches', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive) setCrew(crewOnSite(j && j.value)) }).catch(() => { if (alive) setCrew(0) })
    fetch('/.netlify/functions/projecttracker', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!alive) return; const items = (d && Array.isArray(d.items)) ? d.items : []; setIssues(items.filter((i) => i && i.status !== 'closed').length) })
      .catch(() => { if (alive) setIssues(0) })
    return () => { alive = false; aliveRef.current = false }
  }, [])

  /* the project toggle only switches the board below it — the Task Tracker
     itself opens from the Tasks tab / tile, never from here */
  const pickProject = (p) => {
    setProjOpen(false)
    if (!kpi || p.id === kpi.id) return
    setActiveProject(p.id)
    setKpi((k) => ({ ...k, id: p.id, name: p.name }))
    setBusy(true)
    fetchTaskTrackerKPI(p.id).then((k) => { if (aliveRef.current && k) setKpi(k) }).finally(() => { if (aliveRef.current) setBusy(false) })
  }

  const hidden = useMemo(() => new Set(hideKeys || []), [hideKeys])
  const all = useMemo(() => {
    const list = (tiles || []).filter((t) => !hidden.has(t.key)).map((t) => ({ ...t, Icon: ICONS[t.key] || Layers }))
    if (isAdmin) list.push({ key: 'admin', label: 'Admin Dashboard', desc: 'Users, invites, access & site editor', Icon: Settings, accent: '#ef4444', page: 'admin' })
    return list
  }, [tiles, hidden, isAdmin])
  const pinned = all.filter((t) => POS[t.key])
  const rest = all.filter((t) => !POS[t.key])
  const open = (t) => { if (t.page) onOpenPage(t.page); else onOpen(t) }

  const flags = kpi ? kpi.flags || 0 : 0
  const projName = kpi ? kpi.name : 'Task Tracker'
  const first = user && user.name ? String(user.name).split(' ')[0] : ''

  return (
    <div style={{ minHeight: '100vh', background: '#05070f', color: CREAM, paddingTop: 'calc(64px + var(--sat, 0px))', paddingBottom: 'calc(var(--tabbar-h, 0px) + 18px)', position: 'relative', zIndex: 10 }}>
      {/* project chip + who's signed in */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px 0' }}>
        <div onClick={() => { if (kpi && kpi.projects && kpi.projects.length) setProjOpen((v) => !v) }}
          style={{ ...PANEL, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px', minHeight: 46, flex: 1, minWidth: 0, cursor: kpi && kpi.projects && kpi.projects.length ? 'pointer' : 'default', position: 'relative' }}>
          <div style={{ width: 34, height: 26, borderRadius: 4, background: 'linear-gradient(135deg,#1d4ed8,#3b82f6)', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, padding: 2, flexShrink: 0 }}>
            {[0, 1, 2, 3, 4, 5].map((i) => <span key={i} style={{ background: 'rgba(255,255,255,.22)', borderRadius: 1 }} />)}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ ...NB, fontWeight: 700, fontSize: 14.5, color: CREAM, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.1 }}>{projName}</div>
            <div style={{ ...NB, fontSize: 11, color: MUTE, lineHeight: 1.1, marginTop: 2 }}>{kpi ? `${kpi.total.toLocaleString()} points${kpi.blocks ? ` · ${kpi.blocks} blocks` : ''}` : 'Task Tracker'}</div>
          </div>
          <ChevronDown size={18} color={CREAM} />
          {projOpen && kpi && kpi.projects && (
            <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 20, ...PANEL, padding: 6 }}>
              {kpi.projects.map((p) => (
                <div key={p.id} onClick={() => pickProject(p)}
                  style={{ ...NB, fontSize: 14, padding: '10px 10px', minHeight: 42, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: p.id === kpi.id ? A : CREAM, borderBottom: '1px solid rgba(255,255,255,.06)', cursor: 'pointer' }}>
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>{p.id === kpi.id && <Check size={16} />}
                </div>
              ))}
            </div>
          )}
        </div>
        <div onClick={onChangePassword} title="Account" style={{ width: 46, height: 46, borderRadius: 23, border: '1px solid rgba(255,255,255,.18)', background: 'rgba(6,8,18,.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}>
          <CircleUser size={26} color={CREAM} strokeWidth={1.8} />
        </div>
      </div>

      {/* project health */}
      <div style={{ ...PANEL, margin: '12px 12px 0', padding: '10px 12px 12px', opacity: busy ? 0.55 : 1, transition: 'opacity .2s' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
          <div style={{ ...NB, fontSize: 11.5, letterSpacing: 2, textTransform: 'uppercase', color: A, borderLeft: '2px solid ' + A, paddingLeft: 7, whiteSpace: 'nowrap' }}>Project Health</div>
          <div style={{ ...NB, fontSize: 9.5, letterSpacing: 1, textTransform: 'uppercase', color: MUTE, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Updated {fmtWhen(kpi && kpi.lastModified)}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
            <Ring pct={kpi ? kpi.overall : 0} />
            <div style={{ minWidth: 0 }}>
              <div style={{ ...NB, fontSize: 13, color: CREAM, fontWeight: 600, lineHeight: 1.15 }}>Overall<br />Progress</div>
              <div style={{ ...NB, fontSize: 11, color: MUTE, marginTop: 3 }}>{kpi ? `${kpi.tasks[0].pct.toFixed(0)}% piles · ${kpi.tasks[3].pct.toFixed(0)}% modules` : '—'}</div>
            </div>
          </div>
          <Stat icon={Users} value={crew == null ? '—' : crew} label="Crew On Site" dot={crew ? '#22c55e' : '#6b7280'} note={crew == null ? 'Checking…' : crew ? 'Clocked in now' : 'No one clocked in'} />
          <Stat icon={TriangleAlert} value={issues == null ? '—' : issues} label="Open Issues" dot={issues ? '#ef4444' : '#22c55e'} note={issues == null ? 'Checking…' : issues ? 'Action required' : 'All clear'} />
          <Stat icon={ShieldCheck} value={flags} label="QC Flags" dot={flags ? '#eab308' : '#22c55e'} note={flags ? `${kpi.attention} attention · ${kpi.flagged} flagged` : 'Good standing'} />
        </div>
      </div>

      {/* the site, with every module pinned where it lives */}
      <div style={{ position: 'relative', width: '100%', aspectRatio: ART_ASPECT, marginTop: 12, overflow: 'hidden', background: '#05070f' }}>
        <img src="/home-site.jpg" alt="" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', userSelect: 'none' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, #05070f 0%, rgba(5,7,15,0) 9%, rgba(5,7,15,0) 90%, #05070f 100%)', pointerEvents: 'none' }} />
        {pinned.map((t) => <Callout key={t.key} {...POS[t.key]} icon={t.Icon} label={t.label} desc={t.desc} accent={t.accent} onClick={() => open(t)} />)}
      </div>

      {rest.length > 0 && (
        <div style={{ padding: '4px 12px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {rest.map((t) => (
            <div key={t.key} onClick={() => open(t)} style={{ ...PANEL, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', minHeight: 50, cursor: 'pointer' }}>
              <t.Icon size={22} color={t.accent || A} />
              <div style={{ ...NB, fontWeight: 700, fontSize: 12.5, letterSpacing: 1, textTransform: 'uppercase', color: CREAM }}>{t.label}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '14px 14px 0' }}>
        <div style={{ ...NB, fontSize: 12, color: MUTE }}>{first ? `Signed in as ${first}` : ''}{user && user.role ? ` · ${String(user.role).toUpperCase()}` : ''}</div>
        <div style={{ display: 'flex', gap: 14 }}>
          {!isAdmin && <div onClick={() => onOpenPage('request')} style={{ ...NB, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: A, cursor: 'pointer', padding: '8px 0', minHeight: 36 }}>Request access</div>}
          <div onClick={onSignOut} style={{ ...NB, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: '#f87171', cursor: 'pointer', padding: '8px 0', minHeight: 36 }}>Sign out</div>
        </div>
      </div>
    </div>
  )
}
