import { getStore } from '@netlify/blobs';

const INDEX_KEY = 'index';
const MAX_DOCS = 2000;
const fileKey = (id, kind, i) => 'file:' + id + ':' + (kind || 'orig') + ':' + i;

export default async (req) => {
  let store;
  try { store = getStore('documents'); } catch (e) { return Response.json({ error: 'store unavailable' }, { status: 500 }); }
  const url = new URL(req.url);

  // ── chunked file read/write ───────────────────────────────────────────
  if (url.searchParams.get('file')) {
    if (req.method === 'GET') {
      const id = url.searchParams.get('id'); const kind = url.searchParams.get('kind') || 'orig'; const i = url.searchParams.get('index');
      if (!id || i == null) return Response.json({ error: 'id+index required' }, { status: 400 });
      const data = await store.get(fileKey(id, kind, i), { type: 'text' });
      return Response.json({ data: data || '' }, { headers: { 'cache-control': 'no-store' } });
    }
    if (req.method === 'POST') {
      let body; try { body = await req.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
      if (!body.id || body.index == null) return Response.json({ error: 'id+index required' }, { status: 400 });
      await store.set(fileKey(body.id, body.kind || 'orig', body.index), String(body.data || ''));
      return Response.json({ ok: true });
    }
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }

  // ── signing links: a token stands in for an account ───────────────────
  // The token is the only thing a recipient has, so everything it can reach is
  // scoped to it here rather than trusted from the client.
  const token = url.searchParams.get('token');
  if (token) {
    const idx = (await store.get(INDEX_KEY, { type: 'json' })) || { folders: [], docs: [], rev: 0 };
    let doc = null, signer = null;
    for (const d of idx.docs || []) {
      const s = ((d && d.workflow && d.workflow.signers) || []).find((x) => x && x.token === token);
      if (s) { doc = d; signer = s; break; }
    }
    if (!doc || !signer) return Response.json({ error: 'This signing link is not valid.' }, { status: 404 });
    if (doc.workflow.status === 'void') return Response.json({ error: 'This document has been voided.' }, { status: 410 });

    if (req.method === 'GET') {
      if (!signer.openedAt) {
        signer.openedAt = Date.now();
        idx.rev = (idx.rev || 0) + 1;
        await store.setJSON(INDEX_KEY, idx);
      }
      // only what the signer needs — no folder tree, no other documents
      return Response.json({
        doc: { id: doc.id, name: doc.name, chunks: doc.chunks, mime: doc.mime, workflow: doc.workflow },
        signerId: signer.id,
      }, { headers: { 'cache-control': 'no-store' } });
    }
    if (req.method === 'POST') {
      let body; try { body = await req.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
      if (signer.signedAt) return Response.json({ error: 'You have already signed this document.' }, { status: 409 });
      const values = body.values || {};
      const now = Date.now();
      const wf = doc.workflow;
      const mine = new Set((wf.fields || []).filter((f) => f.signerEmail === signer.email).map((f) => f.id));
      // a field id that is not this signer's is ignored, not trusted
      wf.fields = (wf.fields || []).map((f) => (mine.has(f.id) && values[f.id] != null && values[f.id] !== '')
        ? Object.assign({}, f, { value: values[f.id], signedAt: now, signedBy: signer.name, signedByEmail: signer.email })
        : f);
      for (const s of wf.signers) if (s.id === signer.id) {
        s.signedAt = now; s.via = 'link';
        if (body.signatureLabel) s.signatureLabel = body.signatureLabel;
        if (body.signatureKind) s.signatureKind = body.signatureKind;
      }
      if (wf.signers.every((s) => s.signedAt)) { wf.status = 'completed'; wf.completedAt = now; }
      idx.rev = (idx.rev || 0) + 1;
      await store.setJSON(INDEX_KEY, idx);
      return Response.json({ ok: true, completed: wf.status === 'completed' });
    }
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }

  // ── metadata index (folders + docs) ───────────────────────────────────
  if (req.method === 'GET') {
    const idx = (await store.get(INDEX_KEY, { type: 'json' })) || { folders: [], docs: [], rev: 0 };
    if (url.searchParams.get('doc')) {
      const id = url.searchParams.get('doc');
      const doc = (idx.docs || []).find((d) => d && d.id === id) || null;
      return Response.json({ doc }, { headers: { 'cache-control': 'no-store' } });
    }
    return Response.json(idx, { headers: { 'cache-control': 'no-store' } });
  }

  if (req.method === 'POST') {
    let body; try { body = await req.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
    const idx = (await store.get(INDEX_KEY, { type: 'json' })) || { folders: [], docs: [], rev: 0 };

    if (url.searchParams.get('folder')) {
      const f = body.folder; if (!f || !f.id) return Response.json({ error: 'folder.id required' }, { status: 400 });
      idx.folders = (idx.folders || []).filter((x) => x && x.id !== f.id).concat([f]);
      idx.rev = (idx.rev || 0) + 1;
      await store.setJSON(INDEX_KEY, idx);
      return Response.json(idx);
    }
    if (url.searchParams.get('upsert')) {
      const d = body.doc; if (!d || !d.id) return Response.json({ error: 'doc.id required' }, { status: 400 });
      idx.docs = (idx.docs || []).filter((x) => x && x.id !== d.id).concat([d]);
      if (idx.docs.length > MAX_DOCS) idx.docs = idx.docs.slice(idx.docs.length - MAX_DOCS);
      idx.rev = (idx.rev || 0) + 1;
      await store.setJSON(INDEX_KEY, idx);
      return Response.json({ ok: true, rev: idx.rev });
    }
    if (url.searchParams.get('delete')) {
      const kind = body.kind; const id = body.id;
      if (!kind || !id) return Response.json({ error: 'kind+id required' }, { status: 400 });
      if (kind === 'folder') {
        idx.folders = (idx.folders || []).filter((x) => x && x.id !== id);
        idx.docs = (idx.docs || []).map((d) => (d && d.folderId === id ? Object.assign({}, d, { folderId: null }) : d));
      } else if (kind === 'doc') {
        const target = (idx.docs || []).find((d) => d && d.id === id);
        idx.docs = (idx.docs || []).filter((x) => x && x.id !== id);
        if (target) {
          const total = (target.chunks || 0) + ((target.workflow && target.workflow.signedChunks) || 0);
          for (let i = 0; i < (target.chunks || 0); i++) { try { await store.delete(fileKey(id, 'orig', i)); } catch (e) {} }
          for (let i = 0; i < ((target.workflow && target.workflow.signedChunks) || 0); i++) { try { await store.delete(fileKey(id, 'signed', i)); } catch (e) {} }
        }
      }
      idx.rev = (idx.rev || 0) + 1;
      await store.setJSON(INDEX_KEY, idx);
      return Response.json(idx);
    }
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
  return Response.json({ error: 'method not allowed' }, { status: 405 });
};
