import { getStore } from '@netlify/blobs';

// Shared cash-flow projection document. Single shared doc keyed by 'state'.
// Last-write-wins on the whole document by client-supplied `rev`/`savedAt`.
// The PIN gate lives entirely client-side; this endpoint only stores/serves
// the projection JSON so editor changes persist across devices.

const KEY = 'state';

export default async (req) => {
  let store;
  try { store = getStore('cashflow'); } catch (e) { return Response.json({ error: 'store unavailable' }, { status: 500 }); }

  if (req.method === 'GET') {
    const doc = await store.get(KEY, { type: 'json' });
    return Response.json(doc || null, { headers: { 'cache-control': 'no-store' } });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
    if (!body || !Array.isArray(body.sections)) {
      return Response.json({ error: 'invalid document' }, { status: 400 });
    }
    const cur = (await store.get(KEY, { type: 'json' })) || { rev: 0 };
    // Last-write-wins: only accept if this save is newer than what we have.
    if ((body.savedAt || 0) < (cur.savedAt || 0)) {
      return Response.json(cur, { headers: { 'cache-control': 'no-store' } });
    }
    const doc = Object.assign({}, body, { rev: (cur.rev || 0) + 1, savedAt: body.savedAt || Date.now() });
    await store.setJSON(KEY, doc);
    return Response.json(doc, { headers: { 'cache-control': 'no-store' } });
  }

  return Response.json({ error: 'method not allowed' }, { status: 405 });
};
