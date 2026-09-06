import React, { useEffect, useRef, useState } from 'react'
import { StatusBar } from '@capacitor/status-bar'
import { isNative } from './platform.js'
import { hideSplash } from './bootstrap.js'

/* Launch intro for the Android app: the Sunrise brand clip plays full-screen
   once per cold start, then fades into whatever the app opens on (login,
   dashboard or the biometric lock). The native splash image is the clip's
   first frame, so the hand-off from splash → video → app is one continuous
   picture. Tap anywhere to skip; anything going wrong (autoplay refused,
   decode error, slow load) ends the intro instead of blocking the app. */

let played = false
export function introPending() { return isNative && !played }

const APP_BAR = '#0a0a14'

export default function IntroSplash({ onDone }) {
  const [fading, setFading] = useState(false)
  const vid = useRef(null)
  const doneRef = useRef(false)
  const onDoneRef = useRef(onDone); useEffect(() => { onDoneRef.current = onDone }, [onDone])

  useEffect(() => {
    played = true
    const v = vid.current
    if (!v) { hideSplash(); onDoneRef.current(); return }
    try { StatusBar.setBackgroundColor({ color: '#000000' }).catch(() => {}) } catch (e) { /* web */ }

    let started = false
    const finish = () => {
      if (doneRef.current) return
      doneRef.current = true
      hideSplash()
      setFading(true)
      try { StatusBar.setBackgroundColor({ color: APP_BAR }).catch(() => {}) } catch (e) { /* web */ }
      setTimeout(() => onDoneRef.current(), 450)
    }
    const onPlaying = () => { started = true; hideSplash() }
    const onEnded = () => setTimeout(finish, 350)   // hold the final frame a beat
    const onError = () => finish()
    v.addEventListener('playing', onPlaying)
    v.addEventListener('ended', onEnded)
    v.addEventListener('error', onError)
    try { const p = v.play(); if (p && p.catch) p.catch(() => finish()) } catch (e) { finish() }

    const guard = setTimeout(() => { if (!started) finish() }, 2500)  // autoplay blocked / slow decode
    const hard = setTimeout(finish, 7000)                                // never hold the app hostage
    v.__finish = finish
    return () => {
      clearTimeout(guard); clearTimeout(hard)
      v.removeEventListener('playing', onPlaying); v.removeEventListener('ended', onEnded); v.removeEventListener('error', onError)
    }
  }, [])

  const skip = () => { const v = vid.current; if (v && v.__finish) v.__finish() }

  return (
    <div onClick={skip} aria-hidden="true"
      style={{ position: 'fixed', inset: 0, zIndex: 9000, background: '#000', opacity: fading ? 0 : 1, transition: 'opacity .45s ease', pointerEvents: fading ? 'none' : 'auto' }}>
      <video ref={vid} src="/intro.mp4" muted playsInline autoPlay preload="auto" disablePictureInPicture
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#000' }} />
    </div>
  )
}
