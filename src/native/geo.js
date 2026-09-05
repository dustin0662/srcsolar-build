// Location for Timekeeping clock-in/out and the GPS trail.
//
// In the Android shell the WebView's navigator.geolocation does not trigger
// the runtime permission prompt reliably; @capacitor/geolocation does, and
// it uses the fused provider. Same shape as the browser API so call sites
// stay one-liners. Foreground only — the trail pauses while the app is in
// the background (a foreground service is a follow-up).
import { Geolocation } from '@capacitor/geolocation'
import { isNative } from './platform.js'

const DEFAULTS = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }

async function ensurePermission() {
  try {
    let s = await Geolocation.checkPermissions()
    if (s.location !== 'granted' && s.coarseLocation !== 'granted') s = await Geolocation.requestPermissions({ permissions: ['location'] })
    return s.location === 'granted' || s.coarseLocation === 'granted'
  } catch (e) { return false }
}

export function getCurrentPosition(onOk, onErr, opts) {
  const o = Object.assign({}, DEFAULTS, opts || {})
  if (!isNative) {
    if (!navigator.geolocation) { onErr && onErr({ code: 0, message: 'Geolocation not supported' }); return }
    return navigator.geolocation.getCurrentPosition(onOk, onErr, o)
  }
  ensurePermission().then((ok) => {
    if (!ok) { onErr && onErr({ code: 1, message: 'Location permission denied' }); return }
    return Geolocation.getCurrentPosition(o).then(onOk)
  }).catch((e) => onErr && onErr({ code: 2, message: (e && e.message) || String(e) }))
}

/* Returns a watch id (string on native, number on web). */
export function watchPosition(onOk, onErr, opts) {
  const o = Object.assign({}, DEFAULTS, opts || {})
  if (!isNative) return navigator.geolocation ? navigator.geolocation.watchPosition(onOk, onErr, o) : null
  const handle = { id: null, cancelled: false }
  ensurePermission().then((ok) => {
    if (!ok) { onErr && onErr({ code: 1, message: 'Location permission denied' }); return }
    return Geolocation.watchPosition(o, (pos, err) => { if (err) onErr && onErr(err); else if (pos) onOk(pos) })
      .then((id) => { if (handle.cancelled) Geolocation.clearWatch({ id }).catch(() => {}); else handle.id = id })
  }).catch((e) => onErr && onErr({ code: 2, message: (e && e.message) || String(e) }))
  return handle
}

export function clearWatch(id) {
  if (id == null) return
  if (!isNative) { navigator.geolocation && navigator.geolocation.clearWatch(id); return }
  if (typeof id === 'object') { id.cancelled = true; if (id.id) Geolocation.clearWatch({ id: id.id }).catch(() => {}); return }
  Geolocation.clearWatch({ id }).catch(() => {})
}

export const isSupported = () => isNative || !!(typeof navigator !== 'undefined' && navigator.geolocation)
