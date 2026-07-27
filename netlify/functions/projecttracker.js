import { getStore } from '@netlify/blobs';

const EMPTY = { projects: [], items: [], rev: 0, lastModified: 0 };

function mergeById(local, incoming) {
  const out = new Map();
  for (const x of Array.isArray(local) ? local : []) if (x && x.id) out.set(x.id, x);
  for (const x of Array.isArray(incoming) ? incoming : []) if (x && x.id) {
    const cur = out.get(x.id);
    if (!cur) { out.set(x.id, x); continue; }
    const cm = cur.lastModified || 0, im = x.lastModified || 0;
    out.set(x.id, im >= cm ? x : cur);
  }
  return [...out.values()];
}

function mergeDelete(list, tombstones) {
  if (!Array.isArray(tombstones) || !tombstones.length) return list;
  const dead = new Set(tombstones);
  return list.filter((x) => !dead.has(x.id));
}

export default async (req) => {
  let store;
  try { store = getStore('projecttracker'); } catch (e) { return Response.json({ error: 'store unavailable' }, { status: 500 }); }

  if (req.method === 'GET') {
    const doc = (await store.get('state', { type: 'json' })) || EMPTY;
    return Response.json(doc, { headers: { 'cache-control': 'no-store' } });
  }
  if (req.method === 'POST') {
    let body; try { body = await req.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
    const cur = (await store.get('state', { type: 'json' })) || EMPTY;
    let projects = mergeById(cur.projects, body.projects);
    let items = mergeById(cur.items, body.items);
    projects = mergeDelete(projects, body.deletedProjects);
    items = mergeDelete(items, body.deletedItems);
    if (Array.isArray(body.deletedProjects) && body.deletedProjects.length) {
      const dead = new Set(body.deletedProjects);
      items = items.filter((x) => !dead.has(x.projectId));
    }
    const doc = { projects, items, rev: (cur.rev || 0) + 1, lastModified: Date.now() };
    await store.setJSON('state', doc);
    return Response.json(doc);
  }
  return Response.json({ error: 'method not allowed' }, { status: 405 });
};
