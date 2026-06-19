import { getStore } from '@netlify/blobs';

// Panel Scanner backing store.
// Blob layout (store: 'scanner'):
//   'state'        -> { rev, webhook, projects:[...], scans:[...] }
//   'photo:<id>'   -> compressed jpeg data URL string for a scan
//
// projects: [ { id, name, color, createdAt,
//               sections:[ { id, name, createdAt, panelsPerRow,
//                            rows:[ { id, name, panelTarget, complete, createdAt } ] } ] } ]
// scans:    [ { id, projectId, sectionId, rowId, panel, serial, raw, format,
//               ts, by, photoKey, note, status } ]

const KEY = 'state';
const MAX_SCANS = 20000;

const json = (data, status = 200) =>
  Response.json(data, { status, headers: { 'cache-control': 'no-store' } });

function empty() {
  return { rev: 0, webhook: '', projects: [], scans: [] };
}

// Fire the configured Apps Script webhook. Best-effort, never blocks the response on failure.
async function forward(webhook, payload) {
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    // swallow — sheet sync is best-effort, the blob record is the source of truth
  }
}

export default async (req) => {
  let store;
  try { store = getStore('scanner'); } catch (e) { return json({ error: 'store unavailable' }, 500); }
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const photo = url.searchParams.get('photo');
    if (photo) {
      const data = await store.get('photo:' + photo);
      if (!data) return new Response('', { status: 404 });
      return new Response(data, {
        headers: { 'content-type': 'text/plain', 'cache-control': 'public, max-age=31536000, immutable' },
      });
    }
    const doc = (await store.get(KEY, { type: 'json' })) || empty();
    return json(doc);
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
    const action = url.searchParams.get('action');
    const cur = (await store.get(KEY, { type: 'json' })) || empty();

    // Replace the whole project/section/row tree.
    if (action === 'projects') {
      cur.projects = Array.isArray(body.projects) ? body.projects : [];
      cur.rev = (cur.rev || 0) + 1;
      await store.setJSON(KEY, cur);
      return json({ ok: true, rev: cur.rev });
    }

    // Save the Apps Script webhook URL.
    if (action === 'webhook') {
      cur.webhook = typeof body.webhook === 'string' ? body.webhook.trim() : '';
      cur.rev = (cur.rev || 0) + 1;
      await store.setJSON(KEY, cur);
      return json({ ok: true, rev: cur.rev });
    }

    // Append a new scan (panel). Photo, if present, is stored as a separate blob.
    if (action === 'scan') {
      const s = body && body.scan;
      if (!s || !s.id) return json({ error: 'scan required' }, 400);
      const dup = (cur.scans || []).some((x) => x && x.id === s.id);
      if (!dup) {
        if (body.photo) {
          try { await store.set('photo:' + s.id, String(body.photo)); s.photoKey = s.id; } catch (e) {}
        }
        cur.scans = (cur.scans || []).concat([s]);
        if (cur.scans.length > MAX_SCANS) cur.scans = cur.scans.slice(cur.scans.length - MAX_SCANS);
        cur.rev = (cur.rev || 0) + 1;
        await store.setJSON(KEY, cur);
        await forward(cur.webhook, Object.assign({ mode: 'create' }, scanRow(cur, s)));
      }
      return json({ ok: true, rev: cur.rev });
    }

    // Correct an existing scan.
    if (action === 'updateScan') {
      const id = body && body.id;
      const patch = (body && body.patch) || {};
      if (!id) return json({ error: 'id required' }, 400);
      if (body.photo) { try { await store.set('photo:' + id, String(body.photo)); patch.photoKey = id; } catch (e) {} }
      let next = null;
      cur.scans = (cur.scans || []).map((x) => {
        if (!x || x.id !== id) return x;
        next = Object.assign({}, x, patch);
        return next;
      });
      if (next) {
        cur.rev = (cur.rev || 0) + 1;
        await store.setJSON(KEY, cur);
        await forward(cur.webhook, Object.assign({ mode: 'update' }, scanRow(cur, next)));
      }
      return json({ ok: true, rev: cur.rev });
    }

    // Delete a scan and its photo.
    if (action === 'deleteScan') {
      const id = body && body.id;
      if (!id) return json({ error: 'id required' }, 400);
      const before = (cur.scans || []).length;
      const removed = (cur.scans || []).find((x) => x && x.id === id);
      cur.scans = (cur.scans || []).filter((x) => !x || x.id !== id);
      if (cur.scans.length !== before) {
        try { await store.delete('photo:' + id); } catch (e) {}
        cur.rev = (cur.rev || 0) + 1;
        await store.setJSON(KEY, cur);
        if (removed) await forward(cur.webhook, Object.assign({ mode: 'delete' }, scanRow(cur, removed)));
      }
      return json({ ok: true, rev: cur.rev });
    }

    return json({ error: 'bad request' }, 400);
  }

  return json({ error: 'method not allowed' }, 405);
};

// Flatten a scan into the labelled payload sent to the Google Sheet.
function scanRow(cur, s) {
  const proj = (cur.projects || []).find((p) => p && p.id === s.projectId);
  const sec = proj && (proj.sections || []).find((x) => x && x.id === s.sectionId);
  const row = sec && (sec.rows || []).find((x) => x && x.id === s.rowId);
  return {
    id: s.id,
    serial: s.serial || '',
    raw: s.raw || s.serial || '',
    format: s.format || '',
    project: proj ? proj.name : '',
    section: sec ? sec.name : '',
    row: row ? row.name : '',
    panel: s.panel,
    timestamp: s.ts ? new Date(s.ts).toISOString() : new Date().toISOString(),
    by: s.by || '',
    note: s.note || '',
    status: s.status || 'ok',
  };
}
