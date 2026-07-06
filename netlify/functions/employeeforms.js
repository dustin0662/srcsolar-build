import { getStore } from '@netlify/blobs';

// Employee Information Form (HR-003) submissions.
// The full record (incl. SSN, bank details, and the generated PDF) is stored
// under a per-id blob and is only ever returned when the request carries the
// correct admin PIN. The public form may POST new submissions without auth.

const INDEX = 'index';
const MAX = 5000;
const PIN = process.env.ADMIN_PIN || '08241998';
const subKey = (id) => 'sub:' + id;
const authed = (req) => (req.headers.get('x-admin-pin') || '') === PIN;

export default async (req) => {
  let store;
  try { store = getStore('employee_forms'); } catch (e) { return Response.json({ error: 'store unavailable' }, { status: 500 }); }
  const url = new URL(req.url);

  if (req.method === 'GET') {
    if (!authed(req)) return Response.json({ error: 'unauthorized' }, { status: 401 });
    const id = url.searchParams.get('item');
    if (id) {
      const rec = (await store.get(subKey(id), { type: 'json' })) || null;
      if (!rec) return Response.json({ error: 'not found' }, { status: 404 });
      return Response.json({ item: rec }, { headers: { 'cache-control': 'no-store' } });
    }
    const idx = (await store.get(INDEX, { type: 'json' })) || { items: [], rev: 0 };
    return Response.json({ items: idx.items || [], rev: idx.rev || 0 }, { headers: { 'cache-control': 'no-store' } });
  }

  if (req.method === 'POST') {
    let body; try { body = await req.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
    const it = body && body.item;
    if (!it || !it.id) return Response.json({ error: 'item required' }, { status: 400 });

    const idx = (await store.get(INDEX, { type: 'json' })) || { items: [], rev: 0 };
    if ((idx.items || []).some((x) => x && x.id === it.id)) {
      return Response.json({ ok: true, rev: idx.rev || 0, duplicate: true });
    }
    const submittedAt = it.submittedAt || new Date().toISOString();
    // Full record (heavy — includes PDF + sensitive fields) in its own blob.
    await store.setJSON(subKey(it.id), Object.assign({}, it, { submittedAt }));
    // Lightweight index for the admin list.
    const meta = { id: it.id, name: it.fullLegalName || it.preferredName || '', department: it.department || '', jobTitle: it.jobTitle || '', submittedAt };
    idx.items = (idx.items || []).concat([meta]);
    if (idx.items.length > MAX) idx.items = idx.items.slice(idx.items.length - MAX);
    idx.rev = (idx.rev || 0) + 1;
    await store.setJSON(INDEX, idx);
    return Response.json({ ok: true, rev: idx.rev, id: it.id });
  }

  return Response.json({ error: 'method not allowed' }, { status: 405 });
};
