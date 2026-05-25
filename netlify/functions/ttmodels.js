import { getStore } from '@netlify/blobs';

const MAX_VERSIONS = 60;
const idxKey = (p) => 'idx:' + p;
const chunkKey = (p, m, i) => 'c:' + p + ':' + m + ':' + i;

export default async (req) => {
  let store;
  try { store = getStore('ttmodels'); } catch (e) { return Response.json({ error: 'store unavailable' }, { status: 500 }); }
  const url = new URL(req.url);
  const project = url.searchParams.get('project');
  if (!project) return Response.json({ error: 'project required' }, { status: 400 });

  if (req.method === 'GET') {
    if (url.searchParams.get('list')) {
      const idx = (await store.get(idxKey(project), { type: 'json' })) || { models: [], rev: 0 };
      return Response.json(idx, { headers: { 'cache-control': 'no-store' } });
    }
    if (url.searchParams.get('chunk')) {
      const m = url.searchParams.get('model'); const i = url.searchParams.get('index');
      const data = await store.get(chunkKey(project, m, i), { type: 'text' });
      return Response.json({ data: data || '' }, { headers: { 'cache-control': 'no-store' } });
    }
    return Response.json({ error: 'bad request' }, { status: 400 });
  }

  if (req.method === 'POST') {
    let body; try { body = await req.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
    if (url.searchParams.get('chunk')) {
      if (!body.modelId || body.index == null) return Response.json({ error: 'bad chunk' }, { status: 400 });
      await store.set(chunkKey(project, body.modelId, body.index), String(body.data || ''));
      return Response.json({ ok: true });
    }
    if (url.searchParams.get('finalize')) {
      const idx = (await store.get(idxKey(project), { type: 'json' })) || { models: [], rev: 0 };
      idx.models = [body.model, ...(idx.models || []).filter((m) => m.id !== (body.model && body.model.id))].slice(0, MAX_VERSIONS);
      idx.rev = (idx.rev || 0) + 1;
      await store.setJSON(idxKey(project), idx);
      return Response.json(idx);
    }
    if (url.searchParams.get('delete')) {
      const idx = (await store.get(idxKey(project), { type: 'json' })) || { models: [], rev: 0 };
      const target = (idx.models || []).find((m) => m.id === body.modelId);
      idx.models = (idx.models || []).filter((m) => m.id !== body.modelId);
      idx.rev = (idx.rev || 0) + 1;
      await store.setJSON(idxKey(project), idx);
      if (target) { for (let i = 0; i < (target.chunks || 0); i++) { try { await store.delete(chunkKey(project, body.modelId, i)); } catch (e) {} } }
      return Response.json(idx);
    }
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
  return Response.json({ error: 'method not allowed' }, { status: 405 });
};
