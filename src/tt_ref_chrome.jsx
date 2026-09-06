import React from 'react'
import { ArrowLeft, Bell, User, FileText, Home, Clock, Map as MapIcon, LayoutGrid, RotateCcw } from 'lucide-react'
import { RefSprite } from './tt_glyphs.jsx'

/* "Reference skin" chrome for the Task Tracker — a pixel-faithful rebuild of
   the concept mock (864×1536, treated as a 2× render of a 432×768 phone).
   Every measurement here is the mock's value ÷ 2, in CSS px. Only active when
   window.__TT_SKIN === 'reference' (the standalone demo sets it); the app
   never renders these. */

export const REF = typeof window !== 'undefined' && window.__TT_SKIN === 'reference'
const SPR = (REF && typeof window !== 'undefined' && window.__TT_REF_SPRITES) || {}

export const REF_C = {
  bgTop: '#001528', bgBot: '#010F1C', panel: '#010F1C', border: '#4C626F',
  orange: '#F96B02', onOrange: '#1A0A00', amber: '#F1AB32', project: '#D68B52', navActive: '#F17922',
  track: '#233750', selTop: '#261C12', selMid: '#5E2806', selBot: '#AA4801', selBorder: '#E37E22', slash: '#3A495E',
  text: '#FFFFFF', swatch: '#DCE3EE',
}
export const BG_GRAD = 'linear-gradient(180deg,#001528 0%,#010F1C 100%)'
export const RULE = '2px solid rgba(249,107,2,.7)'
const BBF = "'Bebas Neue', 'Barlow Condensed', sans-serif"
const NBF = "'Barlow Condensed', 'Roboto Condensed', sans-serif"
const BF = "'Barlow', Roboto, sans-serif"
const caps = (size, extra) => ({ fontFamily: NBF, fontWeight: 700, fontSize: size, letterSpacing: '0.07em', textTransform: 'uppercase', lineHeight: 1, ...extra })
const abs = (left, top, extra) => ({ position: 'absolute', left, top, ...extra })
const btnReset = { background: 'transparent', border: 'none', padding: 0, margin: 0, cursor: 'pointer', color: 'inherit', font: 'inherit' }

/* ---------- header: status band + 45.5 px content + 2 px orange rule ---------- */
export function RefHeader({ projName, pct, onBack, onProject, onExport, logoUri }) {
  const fill = Math.max(0, Math.min(100, +pct || 0))
  return (
    <div style={{ position: 'relative', flexShrink: 0, paddingTop: 'max(24px, var(--sat, 0px))', height: 45.5, boxSizing: 'content-box', background: BG_GRAD, borderBottom: RULE, color: REF_C.text, zIndex: 5 }}>
      <div style={{ position: 'relative', height: 45.5 }}>
        {onBack && (
          <button onClick={onBack} aria-label="Back to projects" style={{ ...btnReset, ...abs(1, -1, { width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }) }}>
            <ArrowLeft size={23} strokeWidth={2.2} />
          </button>
        )}
        {logoUri && <img src={logoUri} alt="" draggable={false} style={abs(44, -2, { width: 47, height: 43, objectFit: 'contain' })} />}
        <div style={abs(105, 6, { fontFamily: BBF, fontSize: 19.5, letterSpacing: '0.04em', lineHeight: 1, color: '#fff', whiteSpace: 'nowrap' })}>TASK TRACKER</div>
        <button onClick={onProject} style={{ ...btnReset, ...abs(107, 26, { ...caps(12, { color: REF_C.project, letterSpacing: '0.1em' }), maxWidth: 120, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left' }) }}>
          {projName} <span style={{ fontSize: 9 }}>&#9662;</span>
        </button>
        <div style={{ position: 'absolute', right: 126.5, top: 8, fontFamily: BBF, fontSize: 20, lineHeight: 1, color: REF_C.amber, whiteSpace: 'nowrap' }}>{fill.toFixed(0)}%</div>
        <div style={{ position: 'absolute', right: 123, top: 28.5, width: 53.5, height: 6.5, borderRadius: 3.5, background: REF_C.track, overflow: 'hidden' }}>
          <div style={{ width: fill + '%', height: '100%', borderRadius: 3.5, background: '#F76808' }} />
        </div>
        <div style={{ position: 'absolute', right: 92, top: 14.5, width: 20, height: 20, color: '#fff' }}>
          <Bell size={20} strokeWidth={1.8} />
          <span style={{ position: 'absolute', right: -2, top: -2, width: 6.5, height: 6.5, borderRadius: 4, background: REF_C.orange }} />
        </div>
        <div style={{ position: 'absolute', right: 53.5, top: 10.5, width: 27, height: 27, borderRadius: 14, background: '#0A1D30', border: '1.5px solid #556070', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#C9D0DC' }}>
          <User size={15} strokeWidth={2} />
        </div>
        <button onClick={onExport} aria-label="Export PDF" style={{ ...btnReset, position: 'absolute', right: 13, top: 6, width: 29.5, height: 34, borderRadius: 5, background: REF_C.orange, color: REF_C.onOrange, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
          <FileText size={15} strokeWidth={2.2} />
          <span style={caps(8.5, { letterSpacing: '0.06em' })}>PDF</span>
        </button>
      </div>
    </div>
  )
}

/* ---------- floating map controls ---------- */
const FLOAT_PANEL = { background: 'rgba(1,15,28,.95)', border: '1px solid ' + REF_C.border, borderRadius: 5, boxShadow: '0 3px 10px rgba(0,0,0,.45)' }

export function RefZoom({ onIn, onOut, style }) {
  const b = { ...btnReset, width: 28.5, height: 29, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: BF, fontWeight: 600, fontSize: 20, lineHeight: 1 }
  return (
    <div style={{ position: 'absolute', zIndex: 600, width: 28.5, height: 59, ...FLOAT_PANEL, display: 'flex', flexDirection: 'column', overflow: 'hidden', ...style }}>
      <button onClick={onIn} aria-label="Zoom in" style={{ ...b, borderBottom: '1px solid ' + REF_C.border }}>+</button>
      <button onClick={onOut} aria-label="Zoom out" style={b}>&minus;</button>
    </div>
  )
}

/* items: [[key, label, show?]]; segWidths: px per segment (mock-measured) */
export function RefSeg({ items, value, onChange, segWidths, style }) {
  const visible = items.filter((it) => it[2] !== false)
  return (
    <div style={{ position: 'absolute', zIndex: 600, height: 32, ...FLOAT_PANEL, display: 'flex', alignItems: 'center', padding: 4.5, gap: 0, ...style }}>
      {visible.map((it, i) => {
        const on = value === it[0]
        return (
          <button key={it[0]} onClick={() => onChange(it[0])} aria-selected={on} style={{ ...btnReset, width: segWidths ? segWidths[i] : undefined, flex: segWidths ? undefined : 1, height: 23, borderRadius: 4, background: on ? REF_C.orange : 'transparent', color: on ? REF_C.onOrange : '#fff', ...caps(11, { letterSpacing: '0.09em' }), display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap', transition: 'background 160ms ease-out, color 160ms ease-out' }}>
            {it[1]}
          </button>
        )
      })}
    </div>
  )
}

export function RefCompass({ style }) {
  if (!SPR.compass) return null
  return <img src={SPR.compass.uri} alt="North" draggable={false} style={{ position: 'absolute', zIndex: 600, width: 39.5, height: 39.5, pointerEvents: 'none', ...style }} />
}

export function RefLegend({ style }) {
  const row = { display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }
  const lab = caps(8, { letterSpacing: '0.08em', color: '#fff', whiteSpace: 'nowrap' })
  return (
    <div style={{ position: 'absolute', left: 8.5, bottom: 7, zIndex: 600, width: 122.5, height: 42, background: 'rgba(2,6,15,.92)', border: '1px solid ' + REF_C.border, borderRadius: 5, display: 'grid', gridTemplateColumns: '70px 1fr', gridTemplateRows: '1fr 1fr', padding: '4px 6px', boxSizing: 'border-box', ...style }}>
      <div style={row}><RefSprite code="s1" size={16} /><span style={lab}>Pile</span></div>
      <div style={row}><RefSprite code="s2" size={15} /><span style={lab}>Post cap</span></div>
      <div style={row}><RefSprite code="s3" size={12} rotate={66} style={{ margin: '0 2px' }} /><span style={lab}>Torque tube</span></div>
      <div style={row}><RefSprite code="s4" size={9} rotate={90} style={{ margin: '0 4px' }} /><span style={lab}>Module</span></div>
    </div>
  )
}

/* ---------- tool drawer pieces ---------- */
export function RefStatusChip({ onClick, style }) {
  return (
    <button onClick={onClick} style={{ ...btnReset, position: 'absolute', width: 96.5, height: 25.5, background: REF_C.orange, clipPath: 'polygon(7px 0,100% 0,calc(100% - 8.5px) 100%,0 100%)', color: REF_C.onOrange, ...caps(14, { letterSpacing: '0.08em' }), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, ...style }}>
      Status <span style={{ fontSize: 10, position: 'relative', top: -0.5 }}>&#9650;</span>
    </button>
  )
}

export function RefUndo({ onClick, disabled, style }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label="Undo" style={{ ...btnReset, position: 'absolute', width: 34.5, height: 27.5, borderRadius: 5, border: '2px solid ' + REF_C.orange, color: REF_C.orange, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : 1, ...style }}>
      <RotateCcw size={15} strokeWidth={2.4} />
    </button>
  )
}

export function RefToolCard({ on, Icon, title, hint, onClick, style }) {
  return (
    <button onClick={onClick} aria-pressed={on} style={{ ...btnReset, position: 'relative', flex: 1, minWidth: 0, height: 66, borderRadius: 5, border: '1px solid ' + (on ? REF_C.selBorder : REF_C.border), background: on ? 'linear-gradient(180deg,#261C12 0%,#5E2806 55%,#AA4801 100%)' : REF_C.panel, color: on ? REF_C.orange : '#fff', boxShadow: on ? '0 0 6px rgba(249,107,2,.35)' : 'none', transition: 'background 160ms ease-out, border-color 160ms ease-out', ...style }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 9, display: 'flex', justifyContent: 'center' }}><Icon size={20} strokeWidth={2} /></div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 35.5, textAlign: 'center', ...caps(12.5, { letterSpacing: '0.08em' }) }}>{title}</div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 49, textAlign: 'center', fontFamily: BF, fontSize: 11, lineHeight: 1, color: on ? '#F5A25A' : 'rgba(255,255,255,.9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 3px' }}>{hint}</div>
    </button>
  )
}

/* ---------- bottom navigation ---------- */
const NAV = [['home', 'Home', Home], ['time', 'Time', Clock], ['tasks', 'Tasks', MapIcon], ['docs', 'Docs', FileText], ['more', 'More', LayoutGrid]]
export function RefNav({ active = 'tasks', onSelect }) {
  return (
    <nav style={{ flexShrink: 0, height: 'calc(62.5px + var(--sab, 0px))', paddingBottom: 'var(--sab, 0px)', boxSizing: 'content-box', background: BG_GRAD, borderTop: '2px solid rgba(249,107,2,.4)', display: 'flex', zIndex: 5 }}>
      {NAV.map(([k, label, Icon]) => {
        const on = k === active
        return (
          <button key={k} onClick={() => onSelect && onSelect(k)} aria-current={on ? 'page' : undefined} style={{ ...btnReset, position: 'relative', flex: 1, height: 62.5, color: on ? REF_C.navActive : 'rgba(255,255,255,.82)' }}>
            <div style={{ position: 'absolute', left: 0, right: 0, top: 7.5, display: 'flex', justifyContent: 'center' }}><Icon size={22} strokeWidth={1.9} /></div>
            <div style={{ position: 'absolute', left: 0, right: 0, top: 34.5, textAlign: 'center', ...caps(12.5, { letterSpacing: '0.16em' }) }}>{label}</div>
            {on && <div style={{ position: 'absolute', left: '50%', top: 49, width: 44, height: 3, marginLeft: -22, borderRadius: 1.5, background: REF_C.navActive }} />}
          </button>
        )
      })}
    </nav>
  )
}
