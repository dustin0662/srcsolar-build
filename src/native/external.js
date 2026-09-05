// Open a URL outside the app. In the Android shell, window.open() would
// navigate the WebView away from the bundled app with no way back; the
// Browser plugin opens a Chrome Custom Tab that returns to the app on close.
import { Browser } from '@capacitor/browser'
import { isNative } from './platform.js'

export function openExternal(url, target) {
  if (isNative) {
    Browser.open({ url }).catch(() => { try { window.location.href = url } catch (e) {} })
    return {}                       // truthy, like a window handle
  }
  try { return window.open(url, target || '_blank', 'noopener,noreferrer') } catch (e) { return null }
}
