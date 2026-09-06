// Persist the signed-in portal user between launches.
//
// The portal keeps `user` in React state only, so every reload (and every
// cold start of the Android app) lands on the login screen. We mirror the
// user record to localStorage on sign-in and restore it on boot; the boot
// path still re-validates against the live portal_users list so a removed or
// changed account signs out on its next launch.
const KEY = 'sv_session'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export function saveSession(user) {
  try {
    if (!user || !user.email) return
    localStorage.setItem(KEY, JSON.stringify({ user, at: Date.now() }))
  } catch (e) { /* storage unavailable */ }
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw)
    if (!s || !s.user || !s.user.email) return null
    if (Date.now() - (s.at || 0) > MAX_AGE_MS) { clearSession(); return null }
    return s.user
  } catch (e) { return null }
}

export function clearSession() {
  try { localStorage.removeItem(KEY) } catch (e) { /* ignore */ }
}

// Where a restored user should land, mirroring finishLogin() in App.jsx.
export function homePageFor(u) {
  if (!u) return 'landing'
  if (u.role === 'client') return 'client'
  if (u.onboardingRequired && !u.onboardingComplete) return 'onboarding'
  return 'dashboard'
}
