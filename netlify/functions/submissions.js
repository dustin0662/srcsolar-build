import { getStore } from '@netlify/blobs';

const KEY = 'submissions';
const MAX = 5000;

export default async (req) => {
  let store;
  try { store = getStore('crm'); } catch (e) { return Response.json({ error: 'store unavailable' }, { status: 500 }); }
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const doc = (await store.get(KEY, { type: 'json' })) || { items: [], rev: 0 };
    const kind = url.searchParams.get('kind');
    const items = kind ? (doc.items || []).filter((x) => x && x.kind === kind) : (doc.items || []);
    return Response.json({ items, rev: doc.rev || 0 }, { headers: { 'cache-control': 'no-store' } });
  }

  if (req.method === 'POST') {
    let body; try { body = await req.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
    const cur = (await store.get(KEY, { type: 'json' })) || { items: [], rev: 0 };
    if (url.searchParams.get('append')) {
      const it = body && body.item;
      if (!it || !it.id) return Response.json({ error: 'item required' }, { status: 400 });
      const has = (cur.items || []).some((x) => x && x.id === it.id);
      if (!has) {
        cur.items = (cur.items || []).concat([Object.assign({ log: [{ ts: it.submittedAt || Date.now(), action: 'submitted' }] }, it)]);
        if (cur.items.length > MAX) cur.items = cur.items.slice(cur.items.length - MAX);
        cur.rev = (cur.rev || 0) + 1;
        await store.setJSON(KEY, cur);
      }
      return Response.json({ ok: true, rev: cur.rev });
    }
    if (url.searchParams.get('update')) {
      const id = body && body.id; const patch = (body && body.patch) || {}; const by = (body && body.by) || '';
      if (!id) return Response.json({ error: 'id required' }, { status: 400 });
      let touched = false;
      cur.items = (cur.items || []).map((x) => {
        if (!x || x.id !== id) return x;
        touched = true;
        const next = Object.assign({}, x, patch);
        const action = patch && patch.status ? ('status → ' + patch.status) : 'updated';
        next.log = (Array.isArray(x.log) ? x.log : []).concat([{ ts: Date.now(), action, by }]);
        return next;
      });
      if (touched) { cur.rev = (cur.rev || 0) + 1; await store.setJSON(KEY, cur); }
      return Response.json({ ok: true, rev: cur.rev });
    }
    if (url.searchParams.get('delete')) {
      const id = body && body.id;
      if (!id) return Response.json({ error: 'id required' }, { status: 400 });
      const before = (cur.items || []).length;
      cur.items = (cur.items || []).filter((x) => !x || x.id !== id);
      if (cur.items.length !== before) { cur.rev = (cur.rev || 0) + 1; await store.setJSON(KEY, cur); }
      return Response.json({ ok: true, rev: cur.rev });
    }
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
  return Response.json({ error: 'method not allowed' }, { status: 405 });
};
