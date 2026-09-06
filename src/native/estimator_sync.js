// Cloud sync for the Bid Estimator's project list.
//
// The estimator (public/estimator/index.html) keeps its projects in the
// WebView's localStorage under `se.projects` and reads that key once at boot.
// To make estimates show up on every device the portal mirrors that list to
// the shared key store under `estimator_projects`:
//   { v:1, projects:[…estimator project objects…], deleted:{ [id]: deletedAtMs }, updatedAt }
// Conflict policy: per project id the newer `updated` stamp wins; a delete
// (tombstone) wins over any edit older than it. Both stores are whole blobs,
// so two people editing the same estimate at the same moment keep the
// last save — acceptable for a small estimating team.

export const LOCAL_KEY = 'se.projects'
export const CLOUD_KEY = 'estimator_projects'

export function readLocal() {
  try { const v = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); return Array.isArray(v) ? v : [] } catch (e) { return [] }
}
export function writeLocal(list) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)) } catch (e) { /* quota / private mode */ }
}
export function rawLocal() {
  try { return localStorage.getItem(LOCAL_KEY) || '' } catch (e) { return '' }
}

export function normalizeCloud(c) {
  if (!c || typeof c !== 'object') return { v: 1, projects: [], deleted: {}, updatedAt: 0 }
  return { v: 1, projects: Array.isArray(c.projects) ? c.projects : [], deleted: c.deleted && typeof c.deleted === 'object' ? c.deleted : {}, updatedAt: c.updatedAt || 0 }
}

const stamp = (p) => (p && (p.updated || p.created)) || 0

/* Merge two project lists honouring tombstones. Returns the merged list,
   newest first, and whether either side contributed something the other lacked. */
export function mergeProjects(local, cloud) {
  const c = normalizeCloud(cloud)
  const byId = new Map()
  const consider = (p) => {
    if (!p || !p.id) return
    const cur = byId.get(p.id)
    if (!cur || stamp(p) > stamp(cur)) byId.set(p.id, p)
  }
  c.projects.forEach(consider)
  ;(local || []).forEach(consider)
  const out = []
  byId.forEach((p, id) => { const dead = c.deleted[id]; if (!(dead && dead >= stamp(p))) out.push(p) })
  out.sort((a, b) => stamp(b) - stamp(a))
  return out
}

/* Compare two lists by id + stamp (order-insensitive). */
export function sameLists(a, b) {
  if (a.length !== b.length) return false
  const m = new Map(a.map((p) => [p.id, stamp(p)]))
  return b.every((p) => m.has(p.id) && m.get(p.id) === stamp(p))
}

/* Ids that were in `before` but are gone from `after` — local deletions. */
export function detectDeletes(before, after) {
  const now = new Set(after.map((p) => p.id))
  return before.map((p) => p.id).filter((id) => !now.has(id))
}

export function buildCloud(prev, merged, deletedIds, now) {
  const c = normalizeCloud(prev)
  const deleted = Object.assign({}, c.deleted)
  deletedIds.forEach((id) => { deleted[id] = now })
  const live = new Set(merged.map((p) => p.id))
  // drop tombstones for ids that came back with a newer stamp
  Object.keys(deleted).forEach((id) => { if (live.has(id)) delete deleted[id] })
  return { v: 1, projects: merged, deleted, updatedAt: now }
}
