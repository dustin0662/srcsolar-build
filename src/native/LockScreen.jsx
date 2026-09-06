import React, { useEffect, useRef, useState } from 'react'
import { biometricVerify } from './biometric.js'

const A = '#F97316'
const BB = { fontFamily: "'Bebas Neue', sans-serif" }
const NB = { fontFamily: "'Barlow Condensed', sans-serif" }

/* Full-screen gate shown on launch when biometric unlock is enabled and a
   saved session exists. Prompts automatically, offers retry and a password
   fallback (which signs the saved session out). */
export default function LockScreen({ userName, onUnlocked, onUsePassword, paused }) {
  const [state, setState] = useState('checking') // checking | failed
  const once = useRef(false)

  const attempt = async () => {
    setState('checking')
    const ok = await biometricVerify('Unlock Sunrise Portal')
    if (ok) onUnlocked(); else setState('failed')
  }
  /* `paused` holds the prompt back while the launch intro is still playing */
  useEffect(() => { if (!paused && !once.current) { once.current = true; attempt() } }, [paused]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="sunrise-admin" style={{ position: 'fixed', inset: 0, zIndex: 5000, background: 'radial-gradient(120% 80% at 50% 0%, rgba(19,26,46,.55) 0%, rgba(2,8,17,.45) 55%, rgba(2,8,17,.35) 100%)', color: '#f6f3ec', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px', textAlign: 'center' }}>
      <img src="/logo.webp" alt="" style={{ width: 84, height: 84, objectFit: 'contain', marginBottom: 18, filter: 'drop-shadow(0 0 22px rgba(249,115,22,.35))' }} />
      <div style={{ ...BB, fontSize: 30, letterSpacing: 3 }}>SUNRISE PORTAL</div>
      <div style={{ ...NB, fontSize: 15, color: '#9a958d', marginTop: 6 }}>{userName ? 'Signed in as ' + userName : 'Locked'}</div>

      <div style={{ marginTop: 34, width: 96, height: 96, borderRadius: 48, border: '2px solid ' + (state === 'failed' ? '#dc2626' : A), display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: state === 'checking' ? '0 0 0 10px rgba(249,115,22,.08)' : 'none', transition: 'box-shadow .3s' }}>
        {/* fingerprint glyph */}
        <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke={state === 'failed' ? '#dc2626' : A} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4" /><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" /><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" /><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" /><path d="M8.65 22c.21-.66.45-1.32.57-2" /><path d="M14 13.12c0 2.38 0 6.38-1 8.88" /><path d="M2 16h.01" /><path d="M21.8 16c.2-2 .131-5.354 0-6" /><path d="M9 6.8a6 6 0 0 1 9 5.2c0 .47 0 1.17-.02 2" />
        </svg>
      </div>

      <div style={{ ...NB, fontSize: 16, marginTop: 22, minHeight: 24, color: state === 'failed' ? '#f87171' : '#CCC8C2' }}>
        {state === 'checking' ? 'Waiting for fingerprint or face…' : 'Not recognised.'}
      </div>

      <button onClick={attempt} style={{ marginTop: 22, background: A, color: '#1a1206', border: 'none', padding: '14px 32px', minHeight: 48, ...NB, fontWeight: 700, fontSize: 15, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', clipPath: 'polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%)' }}>
        {state === 'failed' ? 'Try again' : 'Unlock'}
      </button>
      <button onClick={onUsePassword} style={{ marginTop: 14, background: 'transparent', color: '#9a958d', border: 'none', padding: '12px 16px', minHeight: 44, ...NB, fontSize: 14, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer', textDecoration: 'underline' }}>
        Use password instead
      </button>
    </div>
  )
}
