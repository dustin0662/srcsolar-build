import React from 'react'
import { Bell, File, FileText, Home, Clock, Map as MapIcon, LayoutGrid } from 'lucide-react'
import { RefSprite } from './tt_glyphs.jsx'

/* "Reference skin" chrome for the Task Tracker — a pixel-faithful rebuild of
   the concept mock (864×1536, treated as a 2× render of a 432×768 phone).
   Every measurement here is the mock's value ÷ 2, in CSS px. This is the
   product skin on every platform; RefNav is only used by the standalone demo
   (the app renders the shell's MobileTabBar with the same RefTabButton). */

import { REF_SPRITES as SPR } from './tt_ref_sprites.js'
export const REF_LOGO_URI = SPR.logo ? SPR.logo.uri : null
export const REF_NAV_H = 62.5

export const REF_C = {
  bgTop: '#001528', bgBot: '#010F1C', panel: '#010F1C', border: '#4C626F',
  orange: '#F96B02', onOrange: '#1A0A00', amber: '#EC8A16', project: '#CF6524', navActive: '#F17922',
  track: '#233750', selTop: '#261C12', selMid: '#5E2806', selBot: '#AA4801', selBorder: '#E37E22', slash: '#3A495E',
  text: '#FFFFFF', swatch: '#AAB7CE',
}
export const BG_GRAD = 'linear-gradient(180deg,#000E1B 0%,#000F1E 100%)'
export const RULE = '1px solid #F96B02'
export const RULE_SOFT = '1px solid #E0701A'
const BBF = "'Bebas Neue', 'Barlow Condensed', sans-serif"
const NBF = "'Barlow Condensed', 'Roboto Condensed', sans-serif"
const BF = "'Barlow', Roboto, sans-serif"
const caps = (size, extra) => ({ fontFamily: NBF, fontWeight: 700, fontSize: size, letterSpacing: '0.07em', textTransform: 'uppercase', lineHeight: 1, ...extra })
const abs = (left, top, extra) => ({ position: 'absolute', left, top, ...extra })
const btnReset = { background: 'transparent', border: 'none', padding: 0, margin: 0, cursor: 'pointer', color: 'inherit', font: 'inherit' }

/* ---------- header: status band + 45.5 px content + 2 px orange rule ---------- */
export function RefHeader({ projName, pct, onBack, onProject, onExport, logoUri, nameMax = 120 }) {
  const fill = Math.max(0, Math.min(100, +pct || 0))
  return (
    <div style={{ position: 'relative', flexShrink: 0, paddingTop: 'var(--sat, 0px)', height: 45.5, boxSizing: 'content-box', background: BG_GRAD, borderBottom: RULE, color: REF_C.text, zIndex: 5 }}>
      <div style={{ position: 'relative', height: 45.5 }}>
        {onBack && (
          <button onClick={onBack} aria-label="Back to projects" style={{ ...btnReset, ...abs(1, 1.5, { width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F0F0F2' }) }}>
            <svg width={18} height={12} viewBox="0 0 18 12" fill="none" stroke="#F0F0F2" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M17 6H1M6.5 1 1 6l5.5 5" /></svg>
          </button>
        )}
        {logoUri && <img src={logoUri} alt="" draggable={false} style={abs(44, -2, { width: 47, height: 43, objectFit: 'contain' })} />}
        <div style={abs(105, 5, { fontFamily: NBF, fontWeight: 700, fontSize: 19, letterSpacing: '0.06em', lineHeight: 1, color: '#fff', whiteSpace: 'nowrap', textTransform: 'uppercase' })}>Task Tracker</div>
        <button onClick={onProject} style={{ ...btnReset, ...abs(107, 23.5, { ...caps(12, { color: REF_C.project, letterSpacing: '0.17em', fontWeight: 600 }), maxWidth: nameMax, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left' }) }}>
          {projName} <span style={{ fontSize: 9, color: '#E86616' }}>&#9662;</span>
        </button>
        <div style={{ position: 'absolute', right: 126.5, top: 6.5, fontFamily: NBF, fontWeight: 700, fontSize: 20, lineHeight: 1, color: REF_C.amber, whiteSpace: 'nowrap' }}>{fill.toFixed(0)}%</div>
        <div style={{ position: 'absolute', right: 123, top: 28.5, width: 53.5, height: 6.5, borderRadius: 3.5, background: REF_C.track, overflow: 'hidden' }}>
          <div style={{ width: fill + '%', height: '100%', borderRadius: 3.5, background: '#F76808' }} />
        </div>
        <div style={{ position: 'absolute', right: 92, top: 14.5, width: 20, height: 20, color: '#C4CCDC' }}>
          <Bell size={20} strokeWidth={1.8} />
          <span style={{ position: 'absolute', right: -2, top: -2, width: 6.5, height: 6.5, borderRadius: 4, background: REF_C.orange }} />
        </div>
        <div style={{ position: 'absolute', right: 53.5, top: 10.5, width: 27, height: 27, borderRadius: 14, background: '#040C16', border: '1px solid #98A2B2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#BEC8DD' }}>
          <svg width={17} height={17} viewBox="0 0 24 24" fill="currentColor"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-5 0-8 2.5-8 6v1h16v-1c0-3.5-3-6-8-6Z" /></svg>
        </div>
        <button onClick={onExport} aria-label="Export PDF" style={{ ...btnReset, position: 'absolute', right: 13, top: 6, width: 29.5, height: 34, borderRadius: 3, clipPath: 'polygon(0 0, calc(100% - 4.5px) 0, 100% 4.5px, 100% 100%, 0 100%)', background: REF_C.orange, color: REF_C.onOrange, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0 }}>
          <File size={19} strokeWidth={2} />
          <span style={caps(10, { letterSpacing: '0.04em' })}>PDF</span>
        </button>
      </div>
    </div>
  )
}

/* ---------- floating map controls ---------- */
const FLOAT_PANEL = { background: 'rgba(1,15,28,.95)', border: '0.5px solid #5E6E80', borderRadius: 5, boxShadow: '0 3px 10px rgba(0,0,0,.45)' }

export function RefZoom({ onIn, onOut, onFit, style }) {
  const b = { ...btnReset, width: 28.5, height: 29, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: BF, fontWeight: 700, fontSize: 26, lineHeight: 1 }
  return (
    <div style={{ position: 'absolute', zIndex: 600, width: 28.5, height: onFit ? 78 : 59, ...FLOAT_PANEL, display: 'flex', flexDirection: 'column', overflow: 'hidden', ...style }}>
      <button onClick={onIn} aria-label="Zoom in" style={{ ...b, borderBottom: '1px solid ' + REF_C.border }}>+</button>
      <button onClick={onOut} aria-label="Zoom out" style={onFit ? { ...b, borderBottom: '1px solid ' + REF_C.border } : b}>&minus;</button>
      {onFit && <button onClick={onFit} aria-label="Fit to view" style={{ ...b, height: 19, ...caps(9, { letterSpacing: '0.1em', color: '#E7E9EF' }) }}>Fit</button>}
    </div>
  )
}

/* items: [[key, label, show?]]; segWidths: px per segment (mock-measured) */
export function RefSeg({ items, value, onChange, segWidths, style }) {
  const visible = items.filter((it) => it[2] !== false)
  return (
    <div style={{ position: 'absolute', zIndex: 600, height: 32, ...FLOAT_PANEL, display: 'flex', alignItems: 'center', padding: 3.5, gap: 0, ...style }}>
      {visible.map((it, i) => {
        const on = value === it[0]
        const prevOn = i > 0 && value === visible[i - 1][0]
        return (
          <React.Fragment key={it[0]}>
            {i > 0 && !on && !prevOn && <div style={{ width: 1, height: 14, background: '#1E3046', flexShrink: 0 }} />}
            <button onClick={() => onChange(it[0])} aria-selected={on} style={{ ...btnReset, width: segWidths ? segWidths[i] : undefined, flex: segWidths ? undefined : 1, height: 23.5, borderRadius: 1.5, background: on ? REF_C.orange : 'transparent', color: on ? REF_C.onOrange : '#E7E9EF', ...caps(10, { letterSpacing: '0.07em' }), display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap', transition: 'background 160ms ease-out, color 160ms ease-out' }}>
              {it[1]}
            </button>
          </React.Fragment>
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
  /* every icon and label sits where it does in the mock (CSS px from the box's top-left) */
  const lab = caps(8, { letterSpacing: 0, color: '#D5DAE0', whiteSpace: 'nowrap', position: 'absolute', transform: 'translateY(-50%)', lineHeight: 1 })
  const ic = (cx, cy) => ({ position: 'absolute', left: cx, top: cy, transform: 'translate(-50%,-50%)', display: 'flex', alignItems: 'center', justifyContent: 'center' })
  const tube = SPR.ltube ? <RefSprite code="ltube" size={13} /> : <RefSprite code="s3" size={16} rotate={66} />
  const mod = SPR.lmod ? <RefSprite code="lmod" size={14} /> : <RefSprite code="s4" size={12} rotate={90} />
  return (
    <div style={{ position: 'absolute', left: 8.5, bottom: 7, zIndex: 600, width: 122.5, height: 42, background: 'rgba(1,13,25,.92)', border: '0.5px solid #5E6E80', borderRadius: 5, boxSizing: 'border-box', ...style }}>
      <div style={ic(14.5, 12.5)}><RefSprite code="s1" size={17} /></div><span style={{ ...lab, left: 28, top: 12.5 }}>Pile</span>
      <div style={ic(69.5, 12.5)}><RefSprite code="s2" size={16} /></div><span style={{ ...lab, left: 81.5, top: 12.5 }}>Post cap</span>
      <div style={ic(14.5, 31.5)}>{tube}</div><span style={{ ...lab, left: 28, top: 30.5 }}>Torque tube</span>
      <div style={ic(78.5, 31)}>{mod}</div><span style={{ ...lab, left: 91.5, top: 30.5 }}>Module</span>
    </div>
  )
}

/* ---------- tool drawer pieces ---------- */
export function RefStatusChip({ onClick, style }) {
  return (
    <button onClick={onClick} style={{ ...btnReset, position: 'absolute', width: 96.5, height: 25.5, background: REF_C.orange, clipPath: 'polygon(7px 0,100% 0,calc(100% - 8.5px) 100%,0 100%)', color: REF_C.onOrange, ...caps(14, { letterSpacing: '0.08em' }), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, paddingLeft: 5, ...style }}>
      Status <span style={{ fontSize: 13, position: 'relative', top: -0.5 }}>&#9650;</span>
    </button>
  )
}

export function RefUndo({ onClick, disabled, style }) {
  /* the mock's glyph: a bold three-quarter ring with a filled arrowhead at the top-left */
  return (
    <button onClick={disabled ? undefined : onClick} aria-disabled={disabled} aria-label="Undo" style={{ ...btnReset, position: 'absolute', width: 34.5, height: 27.5, borderRadius: 5, border: '1.5px solid #8A3A22', color: disabled ? 'rgba(249,107,2,.8)' : REF_C.orange, display: 'flex', alignItems: 'center', justifyContent: 'center', ...style }}>
      <svg width="15" height="16" viewBox="0 0 24 25" fill="none" aria-hidden="true">
        <path d="M 9.26 5.98 A 8 8 0 1 1 4.27 11.43" stroke="currentColor" strokeWidth="3.1" strokeLinecap="round" />
        <path d="M 3.6 7.9 L 11.2 1.7 L 11.0 10.2 Z" fill="currentColor" />
      </svg>
    </button>
  )
}

export function RefToolCard({ on, Icon, title, hint, onClick, style }) {
  return (
    <button onClick={onClick} aria-pressed={on} style={{ ...btnReset, position: 'relative', flex: 1, minWidth: 0, height: 66, borderRadius: 5, border: on ? '1px solid ' + REF_C.selBorder : '0.5px solid #505870', background: on ? 'linear-gradient(180deg,#261C12 0%,#5E2806 55%,#AA4801 100%)' : REF_C.panel, color: on ? REF_C.orange : '#fff', boxShadow: on ? '0 0 6px rgba(249,107,2,.35)' : 'none', transition: 'background 160ms ease-out, border-color 160ms ease-out', ...style }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 8, display: 'flex', justifyContent: 'center', color: on ? REF_C.orange : (title === 'Delete' ? '#B7C2D7' : '#D8DDE6') }}><Icon size={22} strokeWidth={2.3} /></div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 31.5, textAlign: 'center', ...caps(12.5, { letterSpacing: '0.08em' }) }}>{title}</div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 45, textAlign: 'center', fontFamily: NBF, fontWeight: 400, fontSize: 12.5, lineHeight: 1, color: on ? '#FFDAC0' : '#BDC1CA', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 3px' }}>{hint}</div>
    </button>
  )
}

/* ---------- bottom navigation ---------- */
const NAV = [['home', 'Home', Home], ['time', 'Time', Clock], ['tasks', 'Tasks', MapIcon], ['docs', 'Docs', FileText], ['more', 'More', LayoutGrid]]
/* one tab of the bottom nav — shared by the demo's RefNav and the app's MobileTabBar */
export function RefTabButton({ on, label, Icon, onClick, style, ...aria }) {
  return (
    <button onClick={onClick} {...aria} style={{ ...btnReset, position: 'relative', flex: 1, height: REF_NAV_H, color: on ? REF_C.navActive : '#E0E2E7', ...style }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 7, display: 'flex', justifyContent: 'center', color: on ? REF_C.navActive : '#BBC2D4' }}><Icon size={24} strokeWidth={2.2} /></div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 32.5, textAlign: 'center', ...caps(13, { letterSpacing: '0.2em', fontWeight: 500 }) }}>{label}</div>
      {on && <div style={{ position: 'absolute', left: '50%', top: 49, width: 44, height: 3, marginLeft: -22, borderRadius: 1.5, background: REF_C.navActive }} />}
    </button>
  )
}
export const NAV_BAR_STYLE = { flexShrink: 0, height: 'calc(' + REF_NAV_H + 'px + var(--sab, 0px))', paddingBottom: 'var(--sab, 0px)', boxSizing: 'content-box', background: BG_GRAD, borderTop: '1px solid rgba(249,107,2,.6)', display: 'flex', zIndex: 5 }
/* demo only: the mock's five tabs, inert except Tasks */
export function RefNav({ active = 'tasks', onSelect }) {
  return (
    <nav style={NAV_BAR_STYLE}>
      {NAV.map(([k, label, Icon]) => <RefTabButton key={k} on={k === active} label={label} Icon={Icon} onClick={() => onSelect && onSelect(k)} aria-current={k === active ? 'page' : undefined} />)}
    </nav>
  )
}
