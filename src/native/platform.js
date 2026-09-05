// Platform detection + origin constants shared by the web build and the
// Capacitor Android shell. Safe to import from any module: on the web build
// every export degrades to the browser's own origin.
import { Capacitor } from '@capacitor/core'

export const isNative = Capacitor.isNativePlatform()
export const platform = Capacitor.getPlatform() // 'android' | 'ios' | 'web'

// Where the Netlify Functions live. On the web this is the page's own origin
// (relative fetches keep working); in the APK it must be absolute because the
// WebView is served from https://localhost.
export const API_ORIGIN =
  (import.meta.env && import.meta.env.VITE_API_ORIGIN) || 'https://srcsolar-build.netlify.app'

// Origin to bake into links that leave the app (invite links, signing links,
// logo URLs inside exported proposals). Never https://localhost.
export const PUBLIC_ORIGIN =
  isNative || typeof window === 'undefined' ? API_ORIGIN : window.location.origin

export function publicUrl(pathAndQuery) {
  return PUBLIC_ORIGIN + (pathAndQuery || '/')
}

// Human host for "Go to sunriseconstructionco.com"-style buttons.
export function publicHost() {
  try { return new URL(PUBLIC_ORIGIN).hostname.replace(/^www\./, '') } catch (e) { return 'sunriseconstructionco.com' }
}
