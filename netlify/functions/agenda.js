import { getStore } from '@netlify/blobs';

// ── Daily Agenda store ────────────────────────────────────────────────
// Source of truth lives in Netlify Blobs. Every task mutation is also
// mirrored to a Google Sheet via an Apps Script web-app webhook (set the
// SHEETS_WEBHOOK_URL env var). The sheet keeps one row per task with an
// "Opened At" timestamp and a "Closed At" timestamp, so it doubles as an
// append/upsert audit log of every task and its status over time.

const KEY = 'state';
const MAX = 5000;

// Server-side "today" as YYYY-MM-DD. Honors AGENDA_TZ_OFFSET (minutes east
// of UTC, e.g. -300 for US Central CDT) so rollover happens at local
// midnight rather than UTC midnight.
function todayStr() {
  const off = parseInt(process.env.AGENDA_TZ_OFFSET || '0', 10) || 0;
  const d = new Date(Date.now() + off * 60 * 1000);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0');
}

function uid() {
  return 't_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

const SEED_TASKS = [
  'Go over open bids and enter into cashflow projections in live tool for testing',
  'Follow up with Kaleb on general liability and workmans comp',
  'Ask Rolando what panel remediation is bid at on labor. Follow up with recalculating margin based on what Kaiden wants to actually pay crew',
  'Meeting to gameplan both projects — start RWE then roll into the remediation with complete team, or leave Ethan at Power Ray so he can collect PTO next week?',
  'Finish setup on timekeeping for payroll',
  "Reach out to employees from applicants so we aren't going with Andy's guys if possible",
  'Reach out to Matthew for additional work recommended by Guillermo',
];

function emptyState() {
  return { items: [], rev: 0, seeded: false };
}

function seedIfNeeded(state) {
  if (state.seeded) return false;
  const today = todayStr();
  const now = Date.now();
  state.items = SEED_TASKS.map((title, i) => ({
    id: uid(),
    title,
    detail: '',
    status: 'open',
    date: today,
    parentId: null,
    source: 'seed',
    rollovers: 0,
    order: i,
    createdAt: now,
    openedAt: now,
    completedAt: null,
  }));
  state.seeded = true;
  return true;
}

// Move every still-open task from a past day forward to today, bumping a
// rollover counter so the sheet shows how many days a task has carried.
function rollForward(state) {
  const today = todayStr();
  const rolled = [];
  for (const it of state.items) {
    if (it.status === 'open' && it.date < today) {
      it.date = today;
      it.rollovers = (it.rollovers || 0) + 1;
      rolled.push(it);
    }
  }
  return rolled;
}

// Fire-and-forget mirror of a task to the Google Sheet. Never blocks or
// fails the main request if the webhook is unset or errors.
async function logToSheet(item, event) {
  const url = process.env.SHEETS_WEBHOOK_URL;
  if (!url || !item) return;
  const iso = (ms) => (ms ? new Date(ms).toISOString() : '');
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        secret: process.env.SHEETS_WEBHOOK_SECRET || '',
        event,
        id: item.id,
        title: item.title,
        detail: item.detail || '',
        status: item.status,
        date: item.date,
        parentId: item.parentId || '',
        rollovers: item.rollovers || 0,
        openedAt: iso(item.openedAt || item.createdAt),
        closedAt: iso(item.completedAt),
        loggedAt: new Date().toISOString(),
      }),
    });
  } catch (e) {
    /* logging is best-effort */
  }
}

function publicView(state) {
  return {
    today: todayStr(),
    tomorrow: addDays(todayStr(), 1),
    rev: state.rev || 0,
    items: (state.items || []).slice().sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.order || 0) - (b.order || 0);
    }),
  };
}

export default async (req) => {
  let store;
  try { store = getStore('agenda'); } catch (e) { return Response.json({ error: 'store unavailable' }, { status: 500 }); }
  const url = new URL(req.url);

  // Load + auto-maintain (seed once, roll incomplete tasks into today).
  const load = async () => (await store.get(KEY, { type: 'json' })) || emptyState();
  const save = async (s) => { s.rev = (s.rev || 0) + 1; await store.setJSON(KEY, s); };

  if (req.method === 'GET') {
    const state = await load();
    let changed = false;
    if (seedIfNeeded(state)) changed = true;
    const rolled = rollForward(state);
    if (rolled.length) changed = true;
    if (changed) {
      await save(state);
      for (const it of rolled) await logToSheet(it, 'rollover');
    }
    return Response.json(publicView(state), { headers: { 'cache-control': 'no-store' } });
  }

  if (req.method === 'POST') {
    let body; try { body = await req.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
    const action = url.searchParams.get('action') || (body && body.action) || '';
    const state = await load();
    seedIfNeeded(state);
    rollForward(state);

    if (action === 'add') {
      const title = (body.title || '').trim();
      if (!title) return Response.json({ error: 'title required' }, { status: 400 });
      const now = Date.now();
      const date = body.date === 'tomorrow' ? addDays(todayStr(), 1) : (body.date || todayStr());
      const maxOrder = state.items.reduce((m, x) => Math.max(m, x.order || 0), 0);
      const item = {
        id: uid(),
        title,
        detail: (body.detail || '').trim(),
        status: 'open',
        date,
        parentId: body.parentId || null,
        source: 'manual',
        rollovers: 0,
        order: maxOrder + 1,
        createdAt: now,
        openedAt: now,
        completedAt: null,
      };
      state.items.push(item);
      if (state.items.length > MAX) state.items = state.items.slice(state.items.length - MAX);
      await save(state);
      await logToSheet(item, 'opened');
      return Response.json(publicView(state));
    }

    if (action === 'complete' || action === 'reopen') {
      const id = body.id;
      const item = state.items.find((x) => x.id === id);
      if (!item) return Response.json({ error: 'not found' }, { status: 404 });
      if (action === 'complete') {
        item.status = 'done';
        item.completedAt = Date.now();
      } else {
        item.status = 'open';
        item.completedAt = null;
        if (item.date < todayStr()) item.date = todayStr();
      }
      await save(state);
      await logToSheet(item, action === 'complete' ? 'completed' : 'reopened');
      return Response.json(publicView(state));
    }

    if (action === 'edit') {
      const id = body.id;
      const item = state.items.find((x) => x.id === id);
      if (!item) return Response.json({ error: 'not found' }, { status: 404 });
      if (typeof body.title === 'string' && body.title.trim()) item.title = body.title.trim();
      if (typeof body.detail === 'string') item.detail = body.detail.trim();
      await save(state);
      await logToSheet(item, 'edited');
      return Response.json(publicView(state));
    }

    if (action === 'delete') {
      const id = body.id;
      const before = state.items.length;
      state.items = state.items.filter((x) => x.id !== id);
      if (state.items.length !== before) await save(state);
      return Response.json(publicView(state));
    }

    return Response.json({ error: 'unknown action' }, { status: 400 });
  }

  return Response.json({ error: 'method not allowed' }, { status: 405 });
};
