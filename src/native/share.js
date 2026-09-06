// "Save & share" for exports inside the Android shell.
//
// Every export in the portal ends in an <a download> click — SheetJS'
// writeFile, jsPDF's save (FileSaver), and the hand-rolled blob downloads in
// Document Portal / Employee Form / Screening Solutions. A WebView cannot
// honour that click, so on native we intercept it at the anchor prototype,
// write the blob to the app's cache directory and hand it to the Android
// share sheet (Drive, Gmail, WhatsApp, Files, a PDF viewer, …).
import { Filesystem, Directory } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { isNative } from './platform.js'

const MIME = {
  pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel', csv: 'text/csv', json: 'application/json', html: 'text/html',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', txt: 'text/plain',
}
const safeName = (n) => String(n || 'export').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120)
const extOf = (n) => (String(n).split('.').pop() || '').toLowerCase()

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

async function toBlob(src) {
  if (src instanceof Blob) return src
  const res = await fetch(src)        // blob: or data: URL
  return res.blob()
}

let busy = false

/* Save `blob` as `filename` and open the share sheet. On the web this is a
   normal download so callers can use it unconditionally. */
export async function saveAndShare(blobOrUrl, filename, opts = {}) {
  const name = safeName(filename)
  if (!isNative) {
    const blob = await toBlob(blobOrUrl)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = name
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    return { shared: false }
  }
  if (busy) return { shared: false, busy: true }
  busy = true
  try {
    let blob = await toBlob(blobOrUrl)
    const mime = blob.type || MIME[extOf(name)] || 'application/octet-stream'
    if (!blob.type) blob = new Blob([blob], { type: mime })
    const path = 'exports/' + name
    await Filesystem.writeFile({ path, data: await blobToBase64(blob), directory: Directory.Cache, recursive: true })
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache })
    try {
      await Share.share({ title: opts.title || name, text: opts.text, url: uri, dialogTitle: opts.dialogTitle || 'Share ' + name })
      return { shared: true, uri }
    } catch (e) {
      return { shared: false, uri }     // user dismissed the sheet
    }
  } finally { busy = false }
}

/* Share a generated HTML document (e.g. the bid proposal) as a file. */
export function shareHtml(html, filename, opts) {
  return saveAndShare(new Blob([html], { type: 'text/html' }), filename, opts)
}

/* Intercept <a download href="blob:|data:"> clicks — attached or detached
   anchors, .click() or dispatchEvent — and route them to saveAndShare. */
export function installExportBridges() {
  if (!isNative || typeof HTMLAnchorElement === 'undefined') return
  const proto = HTMLAnchorElement.prototype
  const isDownload = (a) => a && a.hasAttribute && a.hasAttribute('download') && /^(blob:|data:)/i.test(a.href || '')
  const handle = (a) => {
    const name = a.getAttribute('download') || 'download'
    saveAndShare(a.href, name).catch(() => {})
  }
  const origClick = proto.click
  proto.click = function () {
    if (isDownload(this)) { handle(this); return }
    return origClick.call(this)
  }
  const origDispatch = proto.dispatchEvent
  proto.dispatchEvent = function (ev) {
    if (ev && ev.type === 'click' && isDownload(this)) { handle(this); return false }
    return origDispatch.call(this, ev)
  }
  // Belt and braces for anchors the user taps directly (e.g. photo links).
  document.addEventListener('click', (ev) => {
    const a = ev.target && ev.target.closest && ev.target.closest('a[download]')
    if (isDownload(a)) { ev.preventDefault(); ev.stopImmediatePropagation(); handle(a) }
  }, true)
}
