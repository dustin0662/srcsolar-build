// One-time native setup, called from src/main.jsx before React mounts.
// Everything here is a no-op on the plain web build.
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { StatusBar, Style } from '@capacitor/status-bar'
import { SplashScreen } from '@capacitor/splash-screen'
import { isNative, API_ORIGIN } from './platform.js'

const FUNCTIONS_PREFIX = '/.netlify/'

function rewriteUrl(input) {
  const url = typeof input === 'string' ? input : (input && input.url) || ''
  if (!url.startsWith(FUNCTIONS_PREFIX)) return input
  const abs = API_ORIGIN + url
  return typeof input === 'string' ? abs : new Request(abs, input)
}

export function installNativeBootstrap() {
  if (!isNative) return

  document.documentElement.classList.add('native', 'native-' + Capacitor.getPlatform())

  // 1. Route every relative /.netlify/functions/* call at the live backend.
  //    The app has ~55 relative fetch sites; patching fetch once keeps them
  //    untouched. CapacitorHttp (enabled in capacitor.config.json) already
  //    replaced window.fetch with a native implementation, so we wrap that.
  const baseFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    try { input = rewriteUrl(input) } catch (e) { /* fall through with original */ }
    return baseFetch(input, init)
  }

  // 2. System chrome: dark status bar that does NOT overlay the WebView, so
  //    the page starts below it and only the bottom gesture inset matters.
  StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {})
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {})
  StatusBar.setBackgroundColor({ color: '#0a0a14' }).catch(() => {})

  // 3. Hardware back button → let the app's nav stack handle it. If nothing
  //    claims the event (preventDefault) we are at the root: background the app
  //    instead of exiting so state survives.
  CapApp.addListener('backButton', () => {
    const ev = new CustomEvent('native:back', { cancelable: true })
    window.dispatchEvent(ev)
    if (!ev.defaultPrevented) CapApp.minimizeApp().catch(() => CapApp.exitApp())
  })

  // 4. Deep links (?invite=, ?sign=, ?form=) arriving via an intent: hand the
  //    query string to the app, which already knows how to parse those params.
  CapApp.addListener('appUrlOpen', ({ url }) => {
    try {
      const u = new URL(url)
      if (u.search) window.dispatchEvent(new CustomEvent('native:deeplink', { detail: { search: u.search } }))
    } catch (e) { /* ignore malformed */ }
  })

  // 5. Keep the splash up until React has painted its first frame.
  window.addEventListener('load', () => {
    requestAnimationFrame(() => setTimeout(() => SplashScreen.hide().catch(() => {}), 120))
  })
}
