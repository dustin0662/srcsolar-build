// Post-build step. By default leaves the portal (index.html) at the site root.
// On a dedicated scanner deploy, set the env var APP_TARGET=scanner and the
// standalone scanner (scan.html) is promoted to the site root (/), so the whole
// site IS the Panel Scanner. The portal deploy (no env var) is unaffected.
import { copyFileSync, existsSync } from 'node:fs'

const target = (process.env.APP_TARGET || '').toLowerCase()

if (target === 'scanner') {
  const from = 'dist/scan.html'
  const to = 'dist/index.html'
  if (existsSync(from)) {
    copyFileSync(from, to)
    console.log('[finalize-build] APP_TARGET=scanner — Panel Scanner now served at site root (/)')
  } else {
    console.warn('[finalize-build] expected', from, 'but it was not found; root left unchanged')
  }
} else {
  console.log('[finalize-build] default target — portal served at /, scanner at /scan')
}
