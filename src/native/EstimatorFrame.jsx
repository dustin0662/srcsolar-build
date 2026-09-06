import React, { useEffect, useRef, useState } from 'react'
import { isNative } from './platform.js'
import { printHtml } from './print.js'
import { SrModuleHeader } from '../admin_skin.jsx'
import { readLocal, writeLocal, rawLocal, mergeProjects, sameLists, detectDeletes, buildCloud, normalizeCloud } from './estimator_sync.js'

export const ESTIMATOR_URL = '/estimator/index.html'

/* Host overrides injected into the framed document after it loads. The
   estimator's own bottom nav is hidden (Projects / Estimate / Cash / PDF all
   have in-page equivalents) and --nav-h:0 lets its sticky total bar, toasts
   and body padding sit on the frame's bottom edge instead of above a nav
   that is no longer there. */
const HOST_CSS = ':root{--nav-h:0px}.bnav{display:none!important}'

/* A static, script-free copy of the live estimator page for the print
   service: live input values are baked into attributes first, because
   outerHTML only serialises attributes. */
function snapshotHtml(d) {
  d.querySelectorAll('input').forEach((i) => {
    if (i.type === 'checkbox' || i.type === 'radio') i.toggleAttribute('checked', i.checked)
    else i.setAttribute('value', i.value)
  })
  d.querySelectorAll('select').forEach((s) => Array.from(s.options).forEach((o) => o.toggleAttribute('selected', o.selected)))
  d.querySelectorAll('textarea').forEach((t) => { t.textContent = t.value })
  const root = d.documentElement.cloneNode(true)
  root.querySelectorAll('script,#splash,video,#sunrise-host').forEach((n) => n.remove())
  return '<!DOCTYPE html>' + root.outerHTML
}

/* The Bid Estimator (public/estimator/index.html, shipped verbatim from the
   standalone app) framed under the portal's masthead. Same origin, so it
   shares localStorage/sessionStorage with the shell; the host suppresses its
   splash, hides its bottom nav, supplies the Android print bridge it expects,
   unwinds its own UI on the hardware back button, and mirrors its project
   list to the cloud key store so estimates follow the user across devices. */
export default function EstimatorFrame({ onExit, mob, cloudGet, cloudSet }) {
  const ref = useRef(null)
  const [src, setSrc] = useState('')           // set once the cloud pull has settled
  const [loaded, setLoaded] = useState(false)
  const cloudRef = useRef(null)                // last cloud blob seen
  const lastRef = useRef([])                   // last local list we reconciled
  const rawRef = useRef('')                    // last raw localStorage string
  const timerRef = useRef(null)
  const busyRef = useRef(false)

  /* ---- pull before boot ---- */
  useEffect(() => {
    let alive = true
    try { sessionStorage.setItem('se.splashSeen', '1') } catch (e) { /* ignore */ }
    const local = readLocal()
    const finish = (cloud) => {
      if (!alive) return
      cloudRef.current = normalizeCloud(cloud)
      const merged = mergeProjects(local, cloudRef.current)
      if (!sameLists(merged, local)) writeLocal(merged)
      lastRef.current = merged
      rawRef.current = rawLocal()
      setSrc(ESTIMATOR_URL)
    }
    const timeout = setTimeout(() => finish(null), 4000)
    Promise.resolve().then(() => (cloudGet ? cloudGet() : null))
      .then((c) => { clearTimeout(timeout); finish(c) })
      .catch(() => { clearTimeout(timeout); finish(null) })
    return () => { alive = false; clearTimeout(timeout) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- push while open ---- */
  const push = async () => {
    if (busyRef.current || !cloudSet) return
    const local = readLocal()
    const deletedIds = detectDeletes(lastRef.current, local)
    if (sameLists(local, lastRef.current) && deletedIds.length === 0) return
    busyRef.current = true
    try {
      let cloud = cloudRef.current
      try { if (cloudGet) cloud = normalizeCloud(await cloudGet()) } catch (e) { /* offline: push over what we know */ }
      const now = Date.now()
      // a local delete beats the cloud copy of the same project
      const cloudMinusDeleted = Object.assign({}, cloud, { projects: (cloud.projects || []).filter((p) => deletedIds.indexOf(p.id) < 0) })
      const merged = mergeProjects(local, cloudMinusDeleted)
      const blob = buildCloud(cloud, merged, deletedIds, now)
      cloudRef.current = blob
      lastRef.current = merged
      if (!sameLists(merged, local)) { writeLocal(merged); rawRef.current = rawLocal() }
      await cloudSet(blob)
    } catch (e) { /* keep local; next change retries */ }
    finally { busyRef.current = false }
  }
  const schedule = () => { clearTimeout(timerRef.current); timerRef.current = setTimeout(push, 1500) }
  useEffect(() => {
    if (!src) return
    const onStorage = (e) => { if (!e.key || e.key === 'se.projects') schedule() }
    const poll = setInterval(() => { const r = rawLocal(); if (r !== rawRef.current) { rawRef.current = r; schedule() } }, 3000)
    const onVis = () => { if (document.hidden) { clearTimeout(timerRef.current); push() } }
    window.addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('storage', onStorage)
      document.removeEventListener('visibilitychange', onVis)
      clearInterval(poll); clearTimeout(timerRef.current)
      push()
    }
  }, [src]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- frame integration ---- */
  function onLoad() {
    const w = ref.current && ref.current.contentWindow
    const d = w && w.document
    if (!d) { setLoaded(true); return }
    const sp = d.getElementById('splash'); if (sp) sp.remove()
    if (!d.getElementById('sunrise-host')) {
      const st = d.createElement('style'); st.id = 'sunrise-host'; st.textContent = HOST_CSS; d.head.appendChild(st)
    }
    if (isNative) {
      w.Android = {
        isApp() { return true },
        savePdf(name) { printHtml(snapshotHtml(d), name).catch(() => {}) },
      }
    }
    setLoaded(true)
  }

  /* hardware back: unwind the estimator's own UI first; at its project list
     the shell's nav stack takes over and returns to the dashboard */
  useEffect(() => {
    const h = (ev) => {
      const d = ref.current && ref.current.contentDocument
      if (!d || !d.body) return
      const click = (sel) => { const el = d.querySelector(sel); if (el) el.click() }
      if (d.querySelector('#sheet.on')) { ev.preventDefault(); click('#sheetNo'); return }
      if (d.querySelector('#wiz.on')) { ev.preventDefault(); click('#wzCancel'); return }
      if (!d.body.classList.contains('athome')) { ev.preventDefault(); click('#homeBtn') }
    }
    window.addEventListener('native:back', h, true)
    return () => window.removeEventListener('native:back', h, true)
  }, [])

  return (
    <div className="sunrise-admin" style={{ position: 'fixed', top: mob ? 'calc(64px + var(--sat, 0px))' : 60, left: 0, right: 0, bottom: 'var(--tabbar-h, 0px)', zIndex: 2000, display: 'flex', flexDirection: 'column', minHeight: 0, background: '#050A14' }}>
      <div style={{ padding: mob ? '0 12px' : '0 16px', flexShrink: 0 }}>
        <SrModuleHeader onBack={onExit} title="Bid Estimator" />
      </div>
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {!loaded && <div className="sr-meta" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', letterSpacing: '.08em', textTransform: 'uppercase' }}>Loading Bid Estimator…</div>}
        {src && <iframe ref={ref} title="Bid Estimator" src={src} onLoad={onLoad}
          style={{ width: '100%', height: '100%', border: 'none', display: 'block', background: '#050A14', opacity: loaded ? 1 : 0, transition: 'opacity .2s' }} />}
      </div>
    </div>
  )
}
