import { getStore } from '@netlify/blobs';

// Panel Scanner backing store — built for ~20k scans/project and concurrent,
// login-free field use. Data is sharded so a row's scans are isolated:
//
//   'tree'         -> { rev, webhook, projects:[...] }   (structure only, small)
//   'summary'      -> { [rowId]: { c:count, x:maxPanel } } (lightweight index)
//   'row:<rowId>'  -> { scans:[ {..} ] }                 (one row's panels)
//   'photo:<id>'   -> compressed jpeg data URL string
//
// projects: [ { id, name, color, createdAt,
//               sections:[ { id, name, createdAt, panelsPerRow,
//                            rows:[ { id, name, panelTarget, complete, createdAt } ] } ] } ]
// scan:     { id, projectId, sectionId, rowId, panel, serial, raw, format,
//             ts, by, photoKey, note, status }

const MAX_PER_ROW = 2000;

const json = (data, status = 200) =>
  Response.json(data, { status, headers: { 'cache-control': 'no-store' } });

const emptyTree = () => ({ rev: 0, webhook: '', projects: [] });

// Optimistic concurrency: read with etag, mutate, write only if unchanged.
// mutate(cur) returns the next value, or undefined to abort with no write.
async function cas(store, key, mutate, makeDefault) {
  for (let i = 0; i < 8; i++) {
    let cur = null, etag;
    try {
      const res = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
      if (res) { cur = res.data; etag = res.etag; }
    } catch (e) { /* treat as missing */ }
    const base = cur != null ? cur : (makeDefault ? makeDefault() : null);
    const next = mutate(base);
    if (next === undefined) return base; // no-op
    const opts = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
    let w;
    try { w = await store.setJSON(key, next, opts); } catch (e) { w = { modified: false }; }
    if (w && w.modified) return next;
    await new Promise((r) => setTimeout(r, 30 * (i + 1))); // contended — back off and retry
  }
  throw new Error('write conflict');
}

// Fire the configured Apps Script webhook. Best-effort; never blocks on failure.
async function forward(webhook, payload) {
  if (!webhook) return;
  try {
    await fetch(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  } catch (e) { /* sheet sync is best-effort; the blob record is source of truth */ }
}

function locate(tree, s) {
  const proj = (tree.projects || []).find((p) => p && p.id === s.projectId);
  const sec = proj && (proj.sections || []).find((x) => x && x.id === s.sectionId);
  const row = sec && (sec.rows || []).find((x) => x && x.id === s.rowId);
  return { proj, sec, row };
}

function scanRow(tree, s, origin) {
  const { proj, sec, row } = locate(tree, s);
  // Prefer names carried on the scan payload; fall back to the tree lookup only
  // when absent. A freshly-created row may not be in the tree snapshot yet, so
  // the lookup can return blank — the payload name keeps the sheet correct.
  return {
    id: s.id, serial: s.serial || '', raw: s.raw || s.serial || '', format: s.format || '',
    qcSerial: s.qcSerial || '', qc: s.qcResult || '',
    projectId: s.projectId || '', project: s.project || (proj ? proj.name : ''), section: s.section || (sec ? sec.name : ''), row: s.row || (row ? row.name : ''),
    panel: s.panel, timestamp: s.ts ? new Date(s.ts).toISOString() : new Date().toISOString(),
    by: s.by || '', note: s.note || '', status: s.status || 'ok',
  };
}

// Apply one granular structure operation to the tree in place. Returns true if
// it changed something, false if the parent was missing (caller reports error).
// Children are deduped by id so a retried op never creates duplicates.
function applyTreeOp(tree, op) {
  const projects = tree.projects || (tree.projects = []);
  const findProj = (id) => projects.find((p) => p && p.id === id);
  const findSec = (p, id) => p && (p.sections || []).find((x) => x && x.id === id);
  const findRow = (s, id) => s && (s.rows || []).find((x) => x && x.id === id);
  switch (op && op.type) {
    case 'addProject': {
      const pr = op.project; if (!pr || !pr.id) return false;
      if (!findProj(pr.id)) projects.push(pr);
      return true;
    }
    case 'editProject': {
      const p = findProj(op.projectId); if (!p) return false;
      if (typeof op.name === 'string') p.name = op.name;
      return true;
    }
    case 'addSection': {
      const p = findProj(op.projectId); if (!p) return false;
      const sec = op.section; if (!sec || !sec.id) return false;
      p.sections = p.sections || [];
      if (!findSec(p, sec.id)) p.sections.push(sec);
      return true;
    }
    case 'addRow': {
      const p = findProj(op.projectId); const s = findSec(p, op.sectionId); if (!s) return false;
      const row = op.row; if (!row || !row.id) return false;
      s.rows = s.rows || [];
      if (!findRow(s, row.id)) s.rows.push(row);
      return true;
    }
    case 'editRow': {
      const p = findProj(op.projectId); const s = findSec(p, op.sectionId); const r = findRow(s, op.rowId); if (!r) return false;
      if (typeof op.name === 'string') r.name = op.name;
      if (op.panelTarget != null) r.panelTarget = Math.max(0, parseInt(op.panelTarget, 10) || 0);
      return true;
    }
    case 'setRowComplete': {
      const p = findProj(op.projectId); const s = findSec(p, op.sectionId); const r = findRow(s, op.rowId); if (!r) return false;
      r.complete = !!op.complete;
      return true;
    }
    default:
      return false;
  }
}

export default async (req) => {
  let store;
  try { store = getStore('scanner'); } catch (e) { return json({ error: 'store unavailable' }, 500); }
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const photo = url.searchParams.get('photo');
    if (photo) {
      const data = await store.get('photo:' + photo); // stored as a data URL string
      if (!data) return new Response('', { status: 404 });
      const cache = 'public, max-age=31536000, immutable';
      // Decode the data URL to real image bytes so <img> can render it.
      const m = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(String(data));
      if (m) {
        const mime = m[1] || 'image/jpeg';
        const body = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
        return new Response(body, { headers: { 'content-type': mime, 'cache-control': cache } });
      }
      return new Response(data, { headers: { 'content-type': 'text/plain', 'cache-control': cache } });
    }
    const rowId = url.searchParams.get('row');
    if (rowId) {
      const doc = (await store.get('row:' + rowId, { type: 'json' })) || { scans: [] };
      return json({ scans: doc.scans || [] });
    }
    if (url.searchParams.get('summary') !== null) {
      const sum = (await store.get('summary', { type: 'json' })) || {};
      return json({ summary: sum });
    }
    const tree = (await store.get('tree', { type: 'json', consistency: 'strong' })) || emptyTree();
    return json(tree);
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
    const action = url.searchParams.get('action');

    // Apply ONE granular structure change to the authoritative server tree.
    // Unlike a full-blob replace, this can never drop sections/rows the client
    // doesn't currently know about, so a stale phone can't erase data.
    if (action === 'treeOp') {
      const op = body && body.op;
      if (!op || !op.type) return json({ error: 'op required' }, 400);
      let ok = true;
      const next = await cas(store, 'tree', (t) => { ok = applyTreeOp(t, op); if (!ok) return undefined; t.rev = (t.rev || 0) + 1; return t; }, emptyTree);
      if (!ok) return json({ error: 'parent not found', rev: next && next.rev }, 409);
      return json({ ok: true, rev: next.rev });
    }

    // Legacy full-structure replace. Kept for compatibility, but hardened: it
    // refuses to drop any row that currently holds scans (a data-bearing node),
    // so an out-of-date client build can never wipe logged work.
    if (action === 'projects') {
      const incoming = Array.isArray(body.projects) ? body.projects : [];
      const sum = (await store.get('summary', { type: 'json', consistency: 'strong' })) || {};
      const liveRowIds = Object.keys(sum).filter((id) => sum[id] && sum[id].c > 0);
      const incomingRowIds = new Set();
      incoming.forEach((p) => (p.sections || []).forEach((s) => (s.rows || []).forEach((r) => incomingRowIds.add(r.id))));
      const dropped = liveRowIds.filter((id) => !incomingRowIds.has(id));
      if (dropped.length) return json({ error: 'refused: would drop ' + dropped.length + ' row(s) with scans', dropped }, 409);
      const next = await cas(store, 'tree', (t) => { t.projects = incoming; t.rev = (t.rev || 0) + 1; return t; }, emptyTree);
      return json({ ok: true, rev: next.rev });
    }

    if (action === 'webhook') {
      const next = await cas(store, 'tree', (t) => { t.webhook = typeof body.webhook === 'string' ? body.webhook.trim() : ''; t.rev = (t.rev || 0) + 1; return t; }, emptyTree);
      return json({ ok: true, rev: next.rev });
    }

    // Append a scan to its row's shard. Concurrency-safe: row + summary use CAS.
    if (action === 'scan') {
      const s = body && body.scan;
      if (!s || !s.id || !s.rowId) return json({ error: 'scan + rowId required' }, 400);
      if (body.photo) { try { await store.set('photo:' + s.id, String(body.photo)); s.photoKey = s.id; } catch (e) {} }

      let added = true;
      await cas(store, 'row:' + s.rowId, (doc) => {
        const scans = (doc && doc.scans) || [];
        if (scans.some((x) => x && x.id === s.id)) { added = false; return undefined; }
        const nextScans = scans.concat([s]);
        return { scans: nextScans.length > MAX_PER_ROW ? nextScans.slice(nextScans.length - MAX_PER_ROW) : nextScans };
      }, () => ({ scans: [] }));

      if (added) {
        await cas(store, 'summary', (sum) => {
          const cur = sum[s.rowId] || { c: 0, x: 0 };
          sum[s.rowId] = { c: cur.c + 1, x: Math.max(cur.x, s.panel || 0), q: cur.q || 0 };
          return sum;
        }, () => ({}));
        const tree = (await store.get('tree', { type: 'json', consistency: 'strong' })) || emptyTree();
        await forward(tree.webhook, Object.assign({ mode: 'create' }, scanRow(tree, s, url.origin)));
      }
      return json({ ok: true });
    }

    // Correct an existing scan. rowId may change (moved to another row/section).
    if (action === 'updateScan') {
      const id = body && body.id;
      const patch = (body && body.patch) || {};
      const fromRow = body && body.fromRow;
      if (!id || !fromRow) return json({ error: 'id + fromRow required' }, 400);
      if (body.photo) { try { await store.set('photo:' + id, String(body.photo)); patch.photoKey = id; } catch (e) {} }

      const toRow = patch.rowId && patch.rowId !== fromRow ? patch.rowId : null;
      let updated = null, removedPanel = 0;

      // Apply to source row (or remove if moving).
      await cas(store, 'row:' + fromRow, (doc) => {
        const scans = (doc && doc.scans) || [];
        if (!scans.some((x) => x && x.id === id)) return undefined;
        if (toRow) {
          const found = scans.find((x) => x && x.id === id);
          removedPanel = (found && found.panel) || 0;
          updated = Object.assign({}, found, patch);
          return { scans: scans.filter((x) => !x || x.id !== id) };
        }
        return { scans: scans.map((x) => { if (!x || x.id !== id) return x; updated = Object.assign({}, x, patch); return updated; }) };
      }, () => ({ scans: [] }));

      if (toRow && updated) {
        await cas(store, 'row:' + toRow, (doc) => { const scans = (doc && doc.scans) || []; return { scans: scans.concat([updated]) }; }, () => ({ scans: [] }));
        // recount both rows from authoritative shards
        await recount(store, fromRow);
        await recount(store, toRow);
      } else if (updated) {
        await recount(store, fromRow);
      }

      if (updated) {
        const tree = (await store.get('tree', { type: 'json' })) || emptyTree();
        await forward(tree.webhook, Object.assign({ mode: 'update' }, scanRow(tree, updated, url.origin)));
      }
      return json({ ok: true });
    }

    if (action === 'deleteScan') {
      const id = body && body.id;
      const fromRow = body && body.fromRow;
      if (!id || !fromRow) return json({ error: 'id + fromRow required' }, 400);
      let removed = null;
      await cas(store, 'row:' + fromRow, (doc) => {
        const scans = (doc && doc.scans) || [];
        const found = scans.find((x) => x && x.id === id);
        if (!found) return undefined;
        removed = found;
        return { scans: scans.filter((x) => !x || x.id !== id) };
      }, () => ({ scans: [] }));
      if (removed) {
        try { await store.delete('photo:' + id); } catch (e) {}
        await recount(store, fromRow);
        const tree = (await store.get('tree', { type: 'json' })) || emptyTree();
        await forward(tree.webhook, Object.assign({ mode: 'delete' }, scanRow(tree, removed, url.origin)));
      }
      return json({ ok: true });
    }

    return json({ error: 'bad request' }, 400);
  }

  return json({ error: 'method not allowed' }, 405);
};

// Rebuild a row's summary entry from its authoritative shard.
async function recount(store, rowId) {
  const doc = (await store.get('row:' + rowId, { type: 'json' })) || { scans: [] };
  const scans = doc.scans || [];
  const c = scans.length;
  const x = scans.reduce((mx, s) => Math.max(mx, (s && s.panel) || 0), 0);
  const q = scans.reduce((n, s) => n + (s && s.qc ? 1 : 0), 0);
  await cas(store, 'summary', (sum) => { if (c === 0) delete sum[rowId]; else sum[rowId] = { c, x, q }; return sum; }, () => ({}));
}
