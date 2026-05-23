import { getStore } from '@netlify/blobs';

const KEY = 'state';
const MAX_LOG = 200;
const EMPTY = { tasks: null, assign: null, log: [], lastModified: 0, rev: 0 };

function mergeLogs(a, b) {
  const seen = new Set();
  const out = [];
  for (const e of [...(a || []), ...(b || [])]) {
    if (e && e.id && !seen.has(e.id)) { seen.add(e.id); out.push(e); }
  }
  out.sort((x, y) => (y.ts || 0) - (x.ts || 0));
  return out.slice(0, MAX_LOG);
}

export default async (req) => {
  let store;
  try { store = getStore('pileplan'); }
  catch (e) { return Response.json({ error: 'store unavailable' }, { status: 500 }); }

  if (req.method === 'GET') {
    const doc = (await store.get(KEY, { type: 'json' })) || EMPTY;
    return Response.json(doc, { headers: { 'cache-control': 'no-store' } });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
    const cur = (await store.get(KEY, { type: 'json' })) || EMPTY;

    const log = mergeLogs(body.entries, cur.log);
    let { tasks, assign, lastModified } = cur;
    if ((body.lastModified || 0) >= (cur.lastModified || 0) && Array.isArray(body.tasks) && Array.isArray(body.assign)) {
      tasks = body.tasks; assign = body.assign; lastModified = body.lastModified;
    }
    const doc = { tasks, assign, log, lastModified: lastModified || 0, rev: (cur.rev || 0) + 1 };
    await store.setJSON(KEY, doc);
    return Response.json(doc);
  }

  return Response.json({ error: 'method not allowed' }, { status: 405 });
};
