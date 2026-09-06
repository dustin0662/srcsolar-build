import React, { useState } from 'react'

export const LOADS_URL = 'https://srcsolar.netlify.app/loads-admin'

/* Loads Admin lives on its own Netlify site. Inside the app it is framed
   full-screen under the portal's own masthead (SUNRISE Loads Admin dark
   skin: bordered back button, orange condensed title, muted subtitle,
   "Open" link) instead of bouncing out to Chrome, so it feels like every
   other module and the hardware back button returns to the dashboard.
   The frame ends above the shell's bottom tab bar, where MORE is active. */
export default function LoadsFrame({ onExit, mob }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div className="sunrise-admin" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 'var(--tabbar-h, 0px)', zIndex: 2000, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: mob ? '10px 12px' : '10px 16px', paddingTop: mob ? 'calc(10px + var(--sat, 0px))' : 10, background: 'rgba(1,7,14,.92)', borderBottom: '1px solid #a7461e', flexShrink: 0 }}>
        <button type="button" onClick={onExit} aria-label="Back to dashboard" className="sr-button sr-button--outline" style={{ minWidth: 48, minHeight: 48, padding: 0, fontSize: 22, borderColor: '#e65e20', color: '#f6f3ec' }}>&#8592;</button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: mob ? 24 : 26, letterSpacing: '.14em', textTransform: 'uppercase', color: '#ff7a21', lineHeight: 1 }}>Loads Admin</div>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 12, letterSpacing: '.16em', color: '#e8e2d8', textTransform: 'uppercase', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Material load scheduling &amp; dispatch</div>
        </div>
        <a href={LOADS_URL} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, fontSize: 13, letterSpacing: '.16em', textTransform: 'uppercase', color: '#e8e2d8', textDecoration: 'none', padding: '10px 6px', minHeight: 44, display: 'flex', alignItems: 'center', flexShrink: 0 }}>Open &#8599;</a>
      </div>
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {!loaded && <div className="sr-meta" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', letterSpacing: '.08em', textTransform: 'uppercase' }}>Loading Loads Admin…</div>}
        <iframe title="Loads Admin" src={LOADS_URL} onLoad={() => setLoaded(true)} allow="camera;microphone;geolocation;fullscreen;clipboard-write"
          style={{ width: '100%', height: '100%', border: 'none', display: 'block', background: '#020811', opacity: loaded ? 1 : 0, transition: 'opacity .2s' }} />
      </div>
    </div>
  )
}
