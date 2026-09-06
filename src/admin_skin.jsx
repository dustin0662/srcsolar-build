// Presentational primitives for the Admin Dashboard dark skin. They only emit
// the classes defined in src/admin-skin.css — no state, no data.
import React from 'react'

export function SrTabs({ items, value, onChange, small }) {
  return (
    <div className={small ? 'sr-subtabs' : 'sr-admin-tabs'} role="tablist">
      {items.map(([k, label]) => (
        <button type="button" key={k} role="tab" className="sr-tab" aria-selected={value === k} onClick={() => onChange(k)}>{label}</button>
      ))}
    </div>
  )
}

export function SrCard({ title, bar, right, children, style }) {
  return (
    <section className="sr-card" style={style}>
      {(title || right) && (
        <div className="sr-card-head">
          {title && <h2 className={'sr-card-title' + (bar ? ' sr-card-title--bar' : '')}>{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  )
}

export function SrField({ label, note, children }) {
  return (
    <div className="sr-field">
      <span className="sr-label">{label}</span>
      {children}
      {note && <div className="sr-note">{note}</div>}
    </div>
  )
}

export function SrChip({ on, onClick, meta, children }) {
  return <button type="button" className={'sr-chip' + (meta ? ' sr-chip--meta' : '')} aria-pressed={!!on} onClick={onClick}>{children}</button>
}

export function SrBtn({ variant = 'outline', block, onClick, disabled, style, children }) {
  return <button type="button" className={'sr-button sr-button--' + variant + (block ? ' sr-button--block' : '')} onClick={onClick} disabled={disabled} style={style}>{children}</button>
}

const DOT = { login: 'success', logout: 'dim', tool_enter: '', tool_exit: 'leave', change: 'accent', action: 'accent' }
export function SrDot({ type }) {
  const mod = DOT[type]
  return <span className={'sr-dot' + (mod ? ' sr-dot--' + mod : '')} aria-hidden="true" />
}

export function SrSkeleton() {
  return <div className="sr-skeleton" aria-hidden="true"><span /><span /><span /></div>
}

/* ---------- operations layer (Timekeeping / Equipment / Documents) ---------- */
export function SrModuleHeader({ onBack, backLabel = 'Dashboard', title, right }) {
  return (
    <div className="sr-module-header">
      <button type="button" className="sr-kicker sr-back" onClick={onBack}>&#8592; {backLabel}</button>
      <span className="sr-module-divider" aria-hidden="true" />
      <h1 className="sr-module-title">{title}</h1>
      {right && <div className="sr-module-right">{right}</div>}
    </div>
  )
}

export function SrModuleTabs({ items, value, onChange }) {
  return (
    <div className="sr-module-tabs" role="tablist">
      {items.map(([k, label]) => (
        <button type="button" key={k} role="tab" className="sr-tab" aria-selected={value === k} onClick={() => onChange(k)}>{label}</button>
      ))}
    </div>
  )
}

export function SrEmpty({ Icon, title, hint, children }) {
  return (
    <div className="sr-empty-state">
      {Icon && <div className="sr-empty-state__icon"><Icon size={40} strokeWidth={1.6} /></div>}
      {title && <div className="sr-empty-state__title">{title}</div>}
      {hint && <div className="sr-empty-state__hint">{hint}</div>}
      {children}
    </div>
  )
}

export function SrBadge({ tone, children, style }) {
  return <span className={'sr-badge' + (tone ? ' sr-badge--' + tone : '')} style={style}>{children}</span>
}
