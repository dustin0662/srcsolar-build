import { getStore } from '@netlify/blobs';

const MAX_LOG = 200;
const EMPTY = { name: '', points: null, w: 0, h: 0, sections: null, sectionCount: 0, stage: null, qc: null, by: null, at: null, notes: null, bg: null, bgT: 0, log: [], lastModified: 0, rev: 0 };
const META = ['name', 'points', 'w', 'h', 'sections', 'sectionCount', 'notes'];

function mergeLogs(a, b) {
  const seen = new Set(); const out = [];
  for (const e of [...(a || []), ...(b || [])]) { if (e && e.id && !seen.has(e.id)) { seen.add(e.id); out.push(e); } }
  out.sort((x, y) => (y.ts || 0) - (x.ts || 0));
  return out.slice(0, MAX_LOG);
}

/* per-point merge: pick each point from whichever side has the newer at[] timestamp,
   so simultaneous edits by different employees don't clobber each other */
function mergePoints(cur, body) {
  const inStage = body.stage;
  if (!Array.isArray(inStage)) return null;
  const N = inStage.length;
  const inQc = body.qc, inBy = body.by, inAt = body.at;
  const sameLayout = Array.isArray(cur.stage) && cur.stage.length === N;
  if (!sameLayout || !Array.isArray(inAt)) {
    // new layout (re-import) or legacy client without per-point timestamps → take incoming wholesale
    return { stage: inStage, qc: Array.isArray(inQc) ? inQc : new Array(N).fill(0), by: Array.isArray(inBy) ? inBy : new Array(N).fill(''), at: Array.isArray(inAt) ? inAt : new Array(N).fill(0) };
  }
  const outStage = cur.stage.slice();
  const outQc = Array.isArray(cur.qc) ? cur.qc.slice() : new Array(N).fill(0);
  const outAt = Array.isArray(cur.at) ? cur.at.slice() : new Array(N).fill(0);
  const outBy = Array.isArray(cur.by) ? cur.by.slice() : new Array(N).fill('');
  for (let i = 0; i < N; i++) {
    if (outQc[i] == null) outQc[i] = 0;
    if (outAt[i] == null) outAt[i] = 0;
    if (outBy[i] == null) outBy[i] = '';
    const ia = inAt[i] || 0, ca = outAt[i] || 0;
    if (ia >= ca) { outStage[i] = inStage[i] || 0; outQc[i] = (inQc ? inQc[i] : 0) || 0; outBy[i] = (inBy ? inBy[i] : '') || ''; outAt[i] = ia; }
  }
  return { stage: outStage, qc: outQc, by: outBy, at: outAt };
}

export default async (req) => {
  let store;
  try { store = getStore('pileplan'); } catch (e) { return Response.json({ error: 'store unavailable' }, { status: 500 }); }
  const url = new URL(req.url);
  const project = url.searchParams.get('project');
  const isRegistry = url.searchParams.get('registry');

  // ---- project registry ----
  if (isRegistry) {
    if (req.method === 'GET') {
      const r = (await store.get('registry', { type: 'json' })) || { projects: [], rev: 0 };
      return Response.json(r, { headers: { 'cache-control': 'no-store' } });
    }
    if (req.method === 'POST') {
      let b; try { b = await req.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
      const cur = (await store.get('registry', { type: 'json' })) || { projects: [], rev: 0 };
      const doc = { projects: Array.isArray(b.projects) ? b.projects : (cur.projects || []), rev: (cur.rev || 0) + 1 };
      await store.setJSON('registry', doc);
      return Response.json(doc);
    }
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }

  // ---- per-project (or legacy single) state ----
  const KEY = project ? 'state:' + project : 'state';
  if (req.method === 'GET') {
    const doc = (await store.get(KEY, { type: 'json' })) || EMPTY;
    return Response.json(doc, { headers: { 'cache-control': 'no-store' } });
  }
  if (req.method === 'POST') {
    let body; try { body = await req.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
    const cur = (await store.get(KEY, { type: 'json' })) || EMPTY;
    const doc = Object.assign({}, EMPTY, cur);
    doc.log = mergeLogs(body.entries, cur.log);
    // metadata: last-write-wins by lastModified
    if ((body.lastModified || 0) >= (cur.lastModified || 0)) {
      META.forEach((k) => { if (body[k] !== undefined) doc[k] = body[k]; });
    }
    // per-point statuses: merge by per-point timestamp
    const merged = mergePoints(cur, body);
    if (merged) { doc.stage = merged.stage; doc.qc = merged.qc; doc.by = merged.by; doc.at = merged.at; }
    // background photo: last-write-wins by its own timestamp
    if ((body.bgT || 0) >= (cur.bgT || 0)) { if (body.bg !== undefined) doc.bg = body.bg; doc.bgT = body.bgT || cur.bgT || 0; }
    doc.lastModified = Math.max(cur.lastModified || 0, body.lastModified || 0);
    doc.rev = (cur.rev || 0) + 1;
    await store.setJSON(KEY, doc);
    return Response.json(doc);
  }
  return Response.json({ error: 'method not allowed' }, { status: 405 });
};
