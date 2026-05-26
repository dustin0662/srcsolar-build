import { getStore } from '@netlify/blobs';

const userKey = (uid) => 'u:' + uid;

export default async (req) => {
  let store;
  try { store = getStore('signatures'); } catch (e) { return Response.json({ error: 'store unavailable' }, { status: 500 }); }
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const uid = url.searchParams.get('userId');
    if (!uid) return Response.json({ error: 'userId required' }, { status: 400 });
    const doc = (await store.get(userKey(uid), { type: 'json' })) || { signatures: [] };
    return Response.json(doc, { headers: { 'cache-control': 'no-store' } });
  }
  if (req.method === 'POST') {
    let body; try { body = await req.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
    if (!body.userId) return Response.json({ error: 'userId required' }, { status: 400 });
    const cur = (await store.get(userKey(body.userId), { type: 'json' })) || { signatures: [] };
    if (body.signature) cur.signatures = (cur.signatures || []).concat([body.signature]).slice(-20);
    if (body.deleteId) cur.signatures = (cur.signatures || []).filter((s) => s.id !== body.deleteId);
    await store.setJSON(userKey(body.userId), cur);
    return Response.json(cur);
  }
  return Response.json({ error: 'method not allowed' }, { status: 405 });
};
