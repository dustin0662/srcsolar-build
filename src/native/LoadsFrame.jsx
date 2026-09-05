import React, { useState } from 'react'

const A = '#F97316'
const BB = { fontFamily: "'Bebas Neue', sans-serif" }
const NB = { fontFamily: "'Barlow Condensed', sans-serif" }

export const LOADS_URL = 'https://srcsolar.netlify.app/loads-admin'

/* Loads Admin lives on its own Netlify site. Inside the app it is framed
   full-screen with the portal's header instead of bouncing out to Chrome,
   so it feels like every other module and the hardware back button returns
   to the dashboard. */
export default function LoadsFrame({ onExit, mob }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: '#0a0a14', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: mob ? '8px 10px' : '10px 16px', paddingTop: mob ? 'calc(8px + var(--sat, 0px))' : '10px', background: 'rgba(2,2,12,.95)', borderBottom: '1px solid rgba(249,115,22,.25)', flexShrink: 0 }}>
        <button onClick={onExit} aria-label="Back to dashboard" style={{ background: 'transparent', border: '1px solid rgba(249,115,22,.35)', color: '#F5F0EB', minWidth: 44, minHeight: 44, borderRadius: 6, cursor: 'pointer', ...NB, fontSize: 18 }}>←</button>
        <div style={{ minWidth: 0 }}>
          <div style={{ ...BB, fontSize: mob ? 20 : 24, letterSpacing: 3, color: A, lineHeight: 1 }}>LOADS ADMIN</div>
          <div style={{ ...NB, fontSize: 11, letterSpacing: 2, color: '#9a958d', textTransform: 'uppercase' }}>Material load scheduling &amp; dispatch</div>
        </div>
        <a href={LOADS_URL} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', ...NB, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9a958d', textDecoration: 'none', padding: '10px 8px', minHeight: 44, display: 'flex', alignItems: 'center' }}>Open ↗</a>
      </div>
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {!loaded && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', ...NB, color: '#9a958d', fontSize: 14, letterSpacing: 1.5 }}>Loading Loads Admin…</div>}
        <iframe title="Loads Admin" src={LOADS_URL} onLoad={() => setLoaded(true)} allow="camera;microphone;geolocation;fullscreen;clipboard-write"
          style={{ width: '100%', height: '100%', border: 'none', display: 'block', background: '#0a0a14', opacity: loaded ? 1 : 0, transition: 'opacity .2s' }} />
      </div>
    </div>
  )
}
