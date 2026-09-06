// Android system print sheet for a self-contained HTML document.
//
// The Bid Estimator (public/estimator/index.html) expects the native shell to
// hand its page to the Android print service (`window.Android.savePdf(name)`),
// where the user picks "Save as PDF" or a printer. The portal's Capacitor
// WebView has no window.print(), so EstimatorFrame snapshots the frame's DOM
// and passes it to the local `Print` plugin (android/.../PrintPlugin.java),
// which renders it in an offscreen WebView and opens the print sheet.
import { registerPlugin } from '@capacitor/core'
import { isNative } from './platform.js'

const Print = registerPlugin('Print')

/* Resolves true when the print sheet was opened, false off native. */
export async function printHtml(html, name) {
  if (!isNative) return false
  await Print.printHtml({ html: String(html), name: String(name || 'Document').slice(0, 120) })
  return true
}
