import { getStore } from '@netlify/blobs';

const MAX_PER_DAY = 6000;
const dayKey = (d) => 'log:' + d;
const dstr = (ts) => { const d = new Date(ts || Date.now()); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

export default async (req) => {
  let store;
  try { store = getStore('activity'); } catch (e) { return Response.json({ error: 'store unavailable' }, { status: 500 }); }
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const days = Math.min(90, Math.max(1, parseInt(url.searchParams.get('days') || '21', 10)));
    const idx = (await store.get('days', { type: 'json' })) || { days: [] };
    const want = (idx.days || []).slice(-days);
    let events = [];
    for (const d of want) { const doc = await store.get(dayKey(d), { type: 'json' }); if (doc && Array.isArray(doc.events)) events = events.concat(doc.events); }
    events.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return Response.json({ events, days: idx.days || [] }, { headers: { 'cache-control': 'no-store' } });
  }

  if (req.method === 'POST') {
    let b; try { b = await req.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
    const incoming = Array.isArray(b.events) ? b.events : [];
    if (!incoming.length) return Response.json({ ok: true });
    const byDay = {};
    for (const e of incoming) { const k = dstr(e && e.ts); (byDay[k] = byDay[k] || []).push(e); }
    const idx = (await store.get('days', { type: 'json' })) || { days: [] };
    let changed = false;
    for (const d of Object.keys(byDay)) {
      const cur = (await store.get(dayKey(d), { type: 'json' })) || { events: [] };
      const seen = new Set(cur.events.map((e) => e.id));
      for (const e of byDay[d]) { if (e && e.id && !seen.has(e.id)) { cur.events.push(e); seen.add(e.id); } }
      if (cur.events.length > MAX_PER_DAY) cur.events = cur.events.slice(cur.events.length - MAX_PER_DAY);
      await store.setJSON(dayKey(d), cur);
      if ((idx.days || []).indexOf(d) < 0) { idx.days = (idx.days || []).concat([d]); changed = true; }
    }
    if (changed) { idx.days.sort(); await store.setJSON('days', idx); }
    return Response.json({ ok: true });
  }
  return Response.json({ error: 'method not allowed' }, { status: 405 });
};
