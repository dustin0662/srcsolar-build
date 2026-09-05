import React, { useEffect, useState } from 'react'
import { Home, Clock, Map as MapIcon, FileText, LayoutGrid, X } from 'lucide-react'

const A = '#F97316'
const BB = { fontFamily: "'Bebas Neue', sans-serif" }
const NB = { fontFamily: "'Barlow Condensed', sans-serif" }

// Pages that get the bottom tab bar. Modules with their own bottom chrome
// (Task Tracker toolbar, Screening Solutions nav, the field-reporting iframe)
// and the public/sign-in surfaces are excluded.
export const TABBAR_PAGES = new Set(['dashboard', 'mytimecard', 'documents', 'projecttracker', 'timekeeping', 'admin', 'request', 'hse', 'apply', 'equipment', 'precon', 'compliance', 'crm', 'stakeholders'])

const PRIMARY = [
  { key: 'dashboard',  label: 'Home',  Icon: Home },
  { key: 'mytimecard', label: 'Time',  Icon: Clock },
  { key: 'pileplan',   label: 'Tasks', Icon: MapIcon },
  { key: 'documents',  label: 'Docs',  Icon: FileText },
]

/* Fixed bottom bar: four primary destinations + "More" sheet listing every
   other tool the user can open. `tiles` is the dashboard's already-filtered
   tile list ({key,label,desc,href}). Sits above module overlays (z 2000). */
export default function MobileTabBar({ page, setPage, tiles, onOpenTile }) {
  const [more, setMore] = useState(false)
  useEffect(() => { setMore(false) }, [page])

  const allowed = new Set((tiles || []).map(t => t.key))
  const primary = PRIMARY.filter(t => t.key === 'dashboard' || allowed.has(t.key))
  const primaryKeys = new Set(primary.map(t => t.key))
  const rest = (tiles || []).filter(t => !primaryKeys.has(t.key))

  const go = (key) => { setMore(false); if (key === page) return; setPage(key) }

  return (
    <>
      {more && (
        <div onClick={() => setMore(false)} style={{ position: 'fixed', inset: 0, zIndex: 2190, background: 'rgba(2,2,12,.55)', backdropFilter: 'blur(2px)' }}>
          <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: 'calc(64px + var(--sab))', background: '#0b0b16', borderTop: '1px solid rgba(249,115,22,.3)', borderRadius: '18px 18px 0 0', maxHeight: '70vh', overflowY: 'auto', boxShadow: '0 -20px 50px rgba(0,0,0,.6)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px 6px' }}>
              <div style={{ ...BB, fontSize: 20, letterSpacing: 3, color: A }}>ALL TOOLS</div>
              <button aria-label="Close" onClick={() => setMore(false)} style={{ background: 'transparent', border: 'none', color: '#CCC8C2', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><X size={20} /></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '4px 14px 14px' }}>
              {rest.map(t => (
                <button key={t.key} onClick={() => { setMore(false); onOpenTile ? onOpenTile(t) : go(t.key) }}
                  style={{ ...NB, textAlign: 'left', background: page === t.key ? 'rgba(249,115,22,.14)' : 'rgba(255,255,255,.04)', border: '1px solid ' + (page === t.key ? 'rgba(249,115,22,.5)' : 'rgba(255,255,255,.08)'), color: '#F5F0EB', padding: '12px 12px', minHeight: 56, borderRadius: 8, cursor: 'pointer' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>{t.label}{t.href ? ' ↗' : ''}</div>
                  {t.desc && <div style={{ fontSize: 11, color: '#9a958d', marginTop: 2, lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{t.desc}</div>}
                </button>
              ))}
              {rest.length === 0 && <div style={{ ...NB, color: '#9a958d', fontSize: 13, padding: 10, gridColumn: '1/-1' }}>No additional tools assigned to your account.</div>}
            </div>
          </div>
        </div>
      )}
      <nav aria-label="Primary" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 2200, height: 'calc(64px + var(--sab))', paddingBottom: 'var(--sab)', display: 'flex', background: 'rgba(6,6,15,.96)', backdropFilter: 'blur(14px)', borderTop: '1px solid rgba(249,115,22,.25)' }}>
        {primary.map(({ key, label, Icon }) => {
          const on = page === key
          return (
            <button key={key} onClick={() => go(key)} aria-current={on ? 'page' : undefined}
              style={{ flex: 1, background: 'transparent', border: 'none', color: on ? A : '#9a958d', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, cursor: 'pointer', minHeight: 64 }}>
              <Icon size={22} strokeWidth={on ? 2.4 : 1.8} />
              <span style={{ ...NB, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: on ? 700 : 500 }}>{label}</span>
              <span style={{ position: 'absolute', bottom: 'calc(6px + var(--sab))', width: 18, height: 2, background: on ? A : 'transparent', borderRadius: 1 }} />
            </button>
          )
        })}
        <button onClick={() => setMore(v => !v)} aria-expanded={more}
          style={{ flex: 1, background: 'transparent', border: 'none', color: more ? A : '#9a958d', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, cursor: 'pointer', minHeight: 64 }}>
          <LayoutGrid size={22} strokeWidth={more ? 2.4 : 1.8} />
          <span style={{ ...NB, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: more ? 700 : 500 }}>More</span>
        </button>
      </nav>
    </>
  )
}
