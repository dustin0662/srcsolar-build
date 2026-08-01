/* pg_checkpoint.js — save and restore a build in progress.

   The reconstruction runs in the page, so closing the tab stops the work.
   What it must not do is lose it: every expensive stage writes its result to
   the same Netlify Blobs store the photos live in, and a reopened capture
   picks up from the last completed piece instead of starting over.

   Each artefact is a small self-describing container — a JSON header followed
   by 4-byte aligned typed-array blocks — split into parts that fit inside the
   function's request limit. */

const MAGIC = 0x53524b50;            // 'SRKP'
const PART_BYTES = 3 * 1024 * 1024;  // well under the 6 MB function body cap

const pad4 = (n) => (n + 3) & ~3;

/* meta: any JSON value. blocks: array of typed arrays (order matters). */
export function pack(meta, blocks) {
  const json = new TextEncoder().encode(JSON.stringify(meta));
  const views = blocks.map((b) => (b ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(0)));
  let total = 12 + pad4(json.length);
  for (const v of views) total += pad4(v.length);
  const out = new ArrayBuffer(total);
  const dv = new DataView(out), u8 = new Uint8Array(out);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, views.length, true);
  dv.setUint32(8, json.length, true);
  u8.set(json, 12);
  let off = 12 + pad4(json.length);
  for (const v of views) { u8.set(v, off); off += pad4(v.length); }
  return out;
}

/* returns { meta, at(index, Type, count) } — blocks are read by the caller,
   which knows the element type and count from the meta */
export function unpack(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('not a checkpoint');
  const nBlocks = dv.getUint32(4, true);
  const jsonLen = dv.getUint32(8, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, jsonLen)));
  const offsets = [];
  let off = 12 + pad4(jsonLen);
  for (let i = 0; i < nBlocks; i++) { offsets.push(off); off += pad4(meta.__sizes[i]); }
  // validate the whole layout up front, so a write cut short by a closing tab
  // is reported as a missing checkpoint rather than as short arrays
  if (off > buf.byteLength) throw new Error('checkpoint is incomplete');
  return {
    meta: meta,
    at(i, Type, count) {
      const bytes = meta.__sizes[i];
      if (!bytes) return new Type(0);
      const want = count * Type.BYTES_PER_ELEMENT;
      // a checkpoint truncated by a tab closing mid-write must fail loudly, not
      // hand back a short array that looks like data
      if (offsets[i] + want > buf.byteLength) throw new Error('checkpoint is incomplete');
      // copy: the slice must be independent of the transport buffer
      return new Type(buf.slice(offsets[i], offsets[i] + want));
    },
  };
}

/* pack() with the block sizes recorded, which unpack() needs to walk them */
export function packWithSizes(meta, blocks) {
  const sizes = blocks.map((b) => (b ? b.byteLength : 0));
  return pack(Object.assign({}, meta, { __sizes: sizes }), blocks);
}

/* ── transport ─────────────────────────────────────────────────────── */

/* A checkpoint client bound to one project and build. Every call is
   best-effort: a build must never fail because a checkpoint could not be
   written — the worst case is repeating that stage after a reopen. */
export function createCheckpoint(endpoint, projectId, buildId, opts) {
  const o = opts || {};
  const onError = o.onError || function () { };
  const base = endpoint + '?project=' + encodeURIComponent(projectId) + '&build=' + encodeURIComponent(buildId);

  async function put(name, buffer) {
    const u8 = new Uint8Array(buffer);
    const parts = Math.max(1, Math.ceil(u8.length / PART_BYTES));
    for (let i = 0; i < parts; i++) {
      const slice = u8.subarray(i * PART_BYTES, Math.min(u8.length, (i + 1) * PART_BYTES));
      const res = await fetch(base + '&ckptPut=1&name=' + encodeURIComponent(name + (parts > 1 ? ':' + i : '')), {
        method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: slice,
      });
      if (!res.ok) throw new Error('checkpoint write failed (' + res.status + ')');
    }
    return parts;
  }

  async function get(name, parts) {
    const chunks = [];
    let total = 0;
    for (let i = 0; i < (parts || 1); i++) {
      const key = name + ((parts || 1) > 1 ? ':' + i : '');
      const res = await fetch(base + '&ckptGet=1&name=' + encodeURIComponent(key));
      if (!res.ok) return null;
      const b = await res.arrayBuffer();
      chunks.push(new Uint8Array(b)); total += b.byteLength;
    }
    if (!chunks.length) return null;
    if (chunks.length === 1) return chunks[0].buffer;
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out.buffer;
  }

  return {
    buildId: buildId,
    /* store a packed artefact; returns the part count to record in the index */
    async save(name, meta, blocks) {
      try { return await put(name, packWithSizes(meta, blocks)); }
      catch (e) { onError(e); return 0; }
    },
    /* load a packed artefact, or null when it is missing or unreadable */
    async load(name, parts) {
      try {
        const buf = await get(name, parts);
        return buf ? unpack(buf) : null;
      } catch (e) { onError(e); return null; }
    },
    async list(prefix) {
      try {
        const res = await fetch(base + '&ckptList=1&prefix=' + encodeURIComponent(prefix || ''));
        if (!res.ok) return [];
        const j = await res.json();
        return j.names || [];
      } catch (e) { onError(e); return []; }
    },
    /* the index doubles as the resume point and as what the interface shows
       for an unfinished build */
    async writeIndex(index) {
      try {
        const res = await fetch(base + '&ckptIndex=1', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ index: index }),
        });
        return res.ok;
      } catch (e) { onError(e); return false; }
    },
    async readIndex() {
      try {
        const res = await fetch(base + '&ckptIndex=1');
        if (!res.ok) return null;
        const j = await res.json();
        return j.index || null;
      } catch (e) { onError(e); return null; }
    },
  };
}

/* Identity of a build: resuming into a different photo set or different
   settings would splice two unrelated reconstructions together, so the
   checkpoint records this and a mismatch starts fresh. */
export function buildSignature(photoIds, settings) {
  const s = photoIds.slice().sort().join(',') + '|' + JSON.stringify(settings);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c, 2246822519) >>> 0;
  }
  return photoIds.length + '-' + h1.toString(36) + h2.toString(36);
}
