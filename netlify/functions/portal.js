import { getStore } from '@netlify/blobs';

/* Shared key/value store behind the portal's sGet/sSet helpers.
   Without this, portal_users lived only in the browser tab that created it —
   an invited employee could set a password, land in the portal, and then be
   told "no account" on their next visit. */

const norm = (e) => String(e || '').trim().toLowerCase();

/* Records keyed by email get union-merged so a client holding a stale copy of
   the list can't delete an account somebody else just created. Removals are
   explicit, via the `deleted` id list. */
const MERGE_BY_EMAIL = new Set(['portal_users', 'portal_invites']);

function mergeUsers(cur, incoming, deleted) {
  const out = new Map();
  for (const r of Array.isArray(cur) ? cur : []) if (r && r.email) out.set(norm(r.email), r);
  for (const r of Array.isArray(incoming) ? incoming : []) {
    if (!r || !r.email) continue;
    const k = norm(r.email);
    const prev = out.get(k);
    if (!prev) { out.set(k, r); continue; }
    out.set(k, (r.updatedAt || 0) >= (prev.updatedAt || 0) ? r : prev);
  }
  const dead = new Set((deleted || []).map(String));
  return [...out.values()].filter((r) => !dead.has(String(r.id)) && !dead.has(norm(r.email)));
}

export default async (req) => {
  let store;
  try { store = getStore('portal'); } catch (e) { return Response.json({ error: 'store unavailable' }, { status: 500 }); }
  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  if (!key || !/^[\w.-]{1,80}$/.test(key)) return Response.json({ error: 'bad key' }, { status: 400 });

  if (req.method === 'GET') {
    const doc = (await store.get('k:' + key, { type: 'json' })) || { value: null, rev: 0 };
    return Response.json(doc, { headers: { 'cache-control': 'no-store' } });
  }
  if (req.method === 'POST') {
    let body; try { body = await req.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
    const cur = (await store.get('k:' + key, { type: 'json' })) || { value: null, rev: 0 };
    let value = body.value;
    if (MERGE_BY_EMAIL.has(key) && Array.isArray(value)) value = mergeUsers(cur.value, value, body.deleted);
    const doc = { value, rev: (cur.rev || 0) + 1, lastModified: Date.now() };
    await store.setJSON('k:' + key, doc);
    return Response.json(doc);
  }
  return Response.json({ error: 'method not allowed' }, { status: 405 });
};
