// Fingerprint / face unlock for the Android app.
//
// The portal's sign-in is a client-side password check with no server token,
// so biometrics can't "log in" by themselves. What they can do is guard the
// saved session: after a normal sign-in the user opts in, and from then on a
// cold launch (or returning after a long background) asks for a fingerprint
// or face before the saved session is used. "Use password" clears the
// session and drops to the login page.
import { NativeBiometric } from '@capgo/capacitor-native-biometric'
import { isNative } from './platform.js'

const KEY = 'bio_unlock'          // '1' when the user opted in
const ASKED = 'bio_unlock_asked'  // so we only offer it once
export const RELOCK_AFTER_MS = 5 * 60 * 1000

export async function biometricAvailable() {
  if (!isNative) return false
  try { const r = await NativeBiometric.isAvailable(); return !!(r && r.isAvailable) } catch (e) { return false }
}

export function biometricEnabled() {
  try { return localStorage.getItem(KEY) === '1' } catch (e) { return false }
}
export function setBiometricEnabled(on) {
  try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY) } catch (e) { /* ignore */ }
}
export function biometricAsked() {
  try { return localStorage.getItem(ASKED) === '1' } catch (e) { return true }
}
export function markBiometricAsked() {
  try { localStorage.setItem(ASKED, '1') } catch (e) { /* ignore */ }
}

/* Resolves true on success, false on cancel / failure / unavailable. */
export async function biometricVerify(reason) {
  if (!isNative) return false
  try {
    await NativeBiometric.verifyIdentity({
      reason: reason || 'Unlock Sunrise Portal',
      title: 'Sunrise Portal',
      subtitle: 'Confirm it’s you',
      negativeButtonText: 'Use password',
      useFallback: false,
      maxAttempts: 3,
    })
    return true
  } catch (e) { return false }
}

/* Offer biometric unlock once, right after a successful password sign-in. */
export async function offerBiometricUnlock() {
  if (!isNative || biometricAsked()) return
  if (!(await biometricAvailable())) return
  markBiometricAsked()
  let yes = false
  try { yes = window.confirm('Use fingerprint or face unlock to open the app next time?') } catch (e) { yes = false }
  if (yes && await biometricVerify('Confirm to enable fingerprint / face unlock')) setBiometricEnabled(true)
}
