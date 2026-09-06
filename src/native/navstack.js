// Gives the portal's flat `page` state a real back stack.
//
// `page` is a plain useState in App.jsx and nothing ever touched history, so
// the Android hardware back button (and the browser back button) left the
// app from every screen. This hook mirrors page changes into history.pushState
// (URL unchanged — the landing page's #anchor links keep working), pops them
// on popstate, and answers the shell's native:back event:
//   - inside a module → history.back() → previous page
//   - on a root page   → let the shell minimize the app (state survives)
import { useEffect, useRef } from 'react'
import { isNative } from './platform.js'

export const ROOT_PAGES = new Set(['landing', 'dashboard', 'client', 'login'])

export function useNavStack(page, setPage, fallbackPage) {
  const pageRef = useRef(page)
  const lastRef = useRef(null)
  const fromPopRef = useRef(false)
  const depthRef = useRef(0)
  const fallbackRef = useRef(fallbackPage)
  fallbackRef.current = fallbackPage
  pageRef.current = page

  // Mirror forward navigation into history.
  useEffect(() => {
    if (lastRef.current === null) {
      try { window.history.replaceState({ page }, '') } catch (e) { /* ignore */ }
      lastRef.current = page
      return
    }
    if (page === lastRef.current) return
    if (fromPopRef.current) { fromPopRef.current = false; lastRef.current = page; return }
    try { window.history.pushState({ page }, ''); depthRef.current += 1 } catch (e) { /* ignore */ }
    lastRef.current = page
  }, [page])

  useEffect(() => {
    function onPop(e) {
      const p = e.state && e.state.page
      if (!p) return                      // #anchor navigation on the landing page
      depthRef.current = Math.max(0, depthRef.current - 1)
      if (p === pageRef.current) return
      fromPopRef.current = true
      setPage(p)
    }
    function onNativeBack(ev) {
      if (ev.defaultPrevented) return    // a module (e.g. the Task Tracker's map view) handled it
      const cur = pageRef.current
      if (ROOT_PAGES.has(cur)) return     // default: shell minimizes the app
      ev.preventDefault()
      if (depthRef.current > 0) { window.history.back(); return }
      // No history to pop (e.g. restored session opened straight into a
      // module) — go to the caller's fallback.
      fromPopRef.current = false
      setPage(fallbackRef.current || 'dashboard')
    }
    window.addEventListener('popstate', onPop)
    window.addEventListener('native:back', onNativeBack)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('native:back', onNativeBack)
    }
  }, [setPage])

  return { isNative }
}
