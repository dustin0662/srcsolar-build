import { getStore } from '@netlify/blobs';

/* Storage for the Photogrammetry Studio: capture projects, their photos and
   the models built from them.

   Function requests are capped at ~6 MB, so photos arrive as raw binary parts
   that the browser reassembles on the way back out. Keys:
     projects                     → project index (json)
     ph:<project>                 → photo index for a project (json)
     pb:<project>:<photo>:<part>  → one binary slice of a photo
     th:<project>:<photo>         → small jpeg thumbnail
     md:<project>                 → model index (json)
     mc:<project>:<model>:<chunk> → base64 slice of a saved model         */

const MAX_MODELS = 24;
const idx = (p) => 'ph:' + p;
const part = (p, ph, i) => 'pb:' + p + ':' + ph + ':' + i;
const thumb = (p, ph) => 'th:' + p + ':' + ph;
const mIdx = (p) => 'md:' + p;
const mChunk = (p, m, i) => 'mc:' + p + ':' + m + ':' + i;

const json = (body, status) => Response.json(body, { status: status || 200, headers: { 'cache-control': 'no-store' } });
const bad = (msg, status) => json({ error: msg }, status || 400);

export default async (req) => {
  let store;
  try { store = getStore('photogrammetry'); } catch (e) { return bad('store unavailable', 500); }

  const url = new URL(req.url);
  const q = (k) => url.searchParams.get(k);
  const project = q('project');

  if (req.method === 'GET') {
    if (q('projects') != null) {
      const list = (await store.get('projects', { type: 'json' })) || { projects: [], rev: 0 };
      return json(list);
    }
    if (!project) return bad('project required');

    if (q('photos') != null) {
      const list = (await store.get(idx(project), { type: 'json' })) || { photos: [], rev: 0 };
      return json(list);
    }
    if (q('photo') != null) {
      const id = q('photo'), i = q('part') || '0';
      const buf = await store.get(part(project, id, i), { type: 'arrayBuffer' });
      if (!buf) return bad('not found', 404);
      // photo parts never change once written, so let the browser keep them —
      // the reconstruction re-reads every photo during the dense pass
      return new Response(buf, {
        headers: { 'content-type': 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable' },
      });
    }
    if (q('thumb') != null) {
      const buf = await store.get(thumb(project, q('thumb')), { type: 'arrayBuffer' });
      if (!buf) return bad('not found', 404);
      return new Response(buf, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' } });
    }
    if (q('models') != null) {
      const list = (await store.get(mIdx(project), { type: 'json' })) || { models: [], rev: 0 };
      return json(list);
    }
    if (q('modelChunk') != null) {
      const data = await store.get(mChunk(project, q('model'), q('modelChunk')), { type: 'text' });
      return json({ data: data || '' });
    }
    return bad('bad request');
  }

  if (req.method !== 'POST') return bad('method not allowed', 405);

  /* binary uploads carry the payload as the raw body */
  if (q('upload') != null) {
    if (!project || !q('photo')) return bad('project and photo required');
    const buf = await req.arrayBuffer();
    if (!buf || !buf.byteLength) return bad('empty part');
    if (buf.byteLength > 6 * 1024 * 1024) return bad('part too large', 413);
    const key = q('thumbFor') != null ? thumb(project, q('photo')) : part(project, q('photo'), q('part') || '0');
    await store.set(key, buf);
    return json({ ok: true, bytes: buf.byteLength });
  }

  let body;
  try { body = await req.json(); } catch (e) { return bad('bad json'); }

  if (q('saveProject') != null) {
    const cur = (await store.get('projects', { type: 'json' })) || { projects: [], rev: 0 };
    const p = body.project || {};
    if (!p.id) return bad('project id required');
    const rest = (cur.projects || []).filter((x) => x.id !== p.id);
    cur.projects = [Object.assign({}, p, { updatedAt: Date.now() })].concat(rest);
    cur.rev = (cur.rev || 0) + 1;
    await store.setJSON('projects', cur);
    return json(cur);
  }

  if (q('deleteProject') != null) {
    const cur = (await store.get('projects', { type: 'json' })) || { projects: [], rev: 0 };
    const id = body.id;
    cur.projects = (cur.projects || []).filter((x) => x.id !== id);
    cur.rev = (cur.rev || 0) + 1;
    await store.setJSON('projects', cur);
    // photos and models go with it
    const photos = (await store.get(idx(id), { type: 'json' })) || { photos: [] };
    for (const ph of photos.photos || []) {
      for (let i = 0; i < (ph.parts || 1); i++) { try { await store.delete(part(id, ph.id, i)); } catch (e) { /* already gone */ } }
      try { await store.delete(thumb(id, ph.id)); } catch (e) { /* already gone */ }
    }
    const models = (await store.get(mIdx(id), { type: 'json' })) || { models: [] };
    for (const m of models.models || []) {
      for (let i = 0; i < (m.chunks || 0); i++) { try { await store.delete(mChunk(id, m.id, i)); } catch (e) { /* already gone */ } }
    }
    try { await store.delete(idx(id)); } catch (e) { /* already gone */ }
    try { await store.delete(mIdx(id)); } catch (e) { /* already gone */ }
    return json(cur);
  }

  if (!project) return bad('project required');

  if (q('photoMeta') != null) {
    const cur = (await store.get(idx(project), { type: 'json' })) || { photos: [], rev: 0 };
    const p = body.photo || {};
    if (!p.id) return bad('photo id required');
    cur.photos = (cur.photos || []).filter((x) => x.id !== p.id).concat([p]);
    cur.photos.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
    cur.rev = (cur.rev || 0) + 1;
    await store.setJSON(idx(project), cur);
    return json(cur);
  }

  if (q('photoMetaBatch') != null) {
    // one index write per batch instead of per photo: a 600-photo upload
    // otherwise rewrites the index six hundred times
    const cur = (await store.get(idx(project), { type: 'json' })) || { photos: [], rev: 0 };
    const incoming = Array.isArray(body.photos) ? body.photos.filter((p) => p && p.id) : [];
    if (!incoming.length) return bad('no photos in batch');
    const dead = new Set(incoming.map((p) => p.id));
    cur.photos = (cur.photos || []).filter((x) => !dead.has(x.id)).concat(incoming);
    cur.photos.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
    cur.rev = (cur.rev || 0) + 1;
    await store.setJSON(idx(project), cur);
    return json(cur);
  }

  if (q('deletePhoto') != null) {
    const cur = (await store.get(idx(project), { type: 'json' })) || { photos: [], rev: 0 };
    const ids = body.ids || (body.id ? [body.id] : []);
    const dead = new Set(ids);
    const targets = (cur.photos || []).filter((x) => dead.has(x.id));
    cur.photos = (cur.photos || []).filter((x) => !dead.has(x.id));
    cur.rev = (cur.rev || 0) + 1;
    await store.setJSON(idx(project), cur);
    for (const t of targets) {
      for (let i = 0; i < (t.parts || 1); i++) { try { await store.delete(part(project, t.id, i)); } catch (e) { /* already gone */ } }
      try { await store.delete(thumb(project, t.id)); } catch (e) { /* already gone */ }
    }
    return json(cur);
  }

  if (q('modelChunk') != null) {
    if (!body.modelId || body.index == null) return bad('bad chunk');
    await store.set(mChunk(project, body.modelId, body.index), String(body.data || ''));
    return json({ ok: true });
  }

  if (q('modelFinalize') != null) {
    const cur = (await store.get(mIdx(project), { type: 'json' })) || { models: [], rev: 0 };
    const m = body.model || {};
    if (!m.id) return bad('model id required');
    const kept = [m].concat((cur.models || []).filter((x) => x.id !== m.id));
    const drop = kept.slice(MAX_MODELS);
    cur.models = kept.slice(0, MAX_MODELS);
    cur.rev = (cur.rev || 0) + 1;
    await store.setJSON(mIdx(project), cur);
    for (const d of drop) {
      for (let i = 0; i < (d.chunks || 0); i++) { try { await store.delete(mChunk(project, d.id, i)); } catch (e) { /* already gone */ } }
    }
    return json(cur);
  }

  if (q('deleteModel') != null) {
    const cur = (await store.get(mIdx(project), { type: 'json' })) || { models: [], rev: 0 };
    const target = (cur.models || []).find((x) => x.id === body.modelId);
    cur.models = (cur.models || []).filter((x) => x.id !== body.modelId);
    cur.rev = (cur.rev || 0) + 1;
    await store.setJSON(mIdx(project), cur);
    if (target) for (let i = 0; i < (target.chunks || 0); i++) { try { await store.delete(mChunk(project, body.modelId, i)); } catch (e) { /* already gone */ } }
    return json(cur);
  }

  return bad('bad request');
};
