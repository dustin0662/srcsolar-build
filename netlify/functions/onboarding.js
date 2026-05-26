import { getStore } from '@netlify/blobs';

const docKey = (uid) => 'doc:' + uid;

export default async (req) => {
  let store;
  try { store = getStore('onboarding'); } catch (e) { return Response.json({ error: 'store unavailable' }, { status: 500 }); }
  const url = new URL(req.url);

  if (req.method === 'GET') {
    if (url.searchParams.get('list')) {
      const idx = (await store.get('index', { type: 'json' })) || { users: [] };
      return Response.json({ users: idx.users || [] }, { headers: { 'cache-control': 'no-store' } });
    }
    const uid = url.searchParams.get('userId');
    if (!uid) return Response.json({ error: 'userId required' }, { status: 400 });
    const doc = (await store.get(docKey(uid), { type: 'json' })) || null;
    return Response.json({ doc }, { headers: { 'cache-control': 'no-store' } });
  }

  if (req.method === 'POST') {
    let body; try { body = await req.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
    const uid = body && body.userId;
    if (!uid) return Response.json({ error: 'userId required' }, { status: 400 });
    const cur = (await store.get(docKey(uid), { type: 'json' })) || {};
    const next = Object.assign({}, cur, body.patch || {}, { userId: uid, updatedAt: Date.now() });
    if (next.ssn && next.id && next.handbook && next.handbook.signedAt && !next.completedAt) next.completedAt = Date.now();
    await store.setJSON(docKey(uid), next);
    // maintain a lightweight index for the admin list
    const idx = (await store.get('index', { type: 'json' })) || { users: [] };
    const others = (idx.users || []).filter((u) => u.userId !== uid);
    idx.users = others.concat([{ userId: uid, name: body.name || cur.name || '', email: body.email || cur.email || '', startedAt: cur.startedAt || Date.now(), updatedAt: next.updatedAt, completedAt: next.completedAt || null }]);
    await store.setJSON('index', idx);
    return Response.json({ ok: true, doc: next });
  }

  return Response.json({ error: 'method not allowed' }, { status: 405 });
};
