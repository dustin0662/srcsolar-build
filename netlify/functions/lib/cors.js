/* CORS for the portal functions.

   The web app calls these same-origin, so it never needed CORS. The Android
   app is served from https://localhost inside a Capacitor WebView and calls
   the live backend cross-origin, which means:
     - every POST (content-type: application/json) is preflighted, and
     - every response needs access-control-allow-origin or the WebView hides it.

   No cookies or Authorization headers are used anywhere, so this is a plain
   origin allowlist without credentials. */

const SITE = 'https://srcsolar-build.netlify.app';

function allowedOrigin(origin) {
  if (!origin) return SITE;
  let host = '';
  try { host = new URL(origin).hostname; } catch { return SITE; }
  if (origin === SITE) return origin;
  if (host === 'localhost' || host === '127.0.0.1') return origin;          // Capacitor WebView, vite dev
  if (/\.netlify\.app$/.test(host)) return origin;                          // deploy previews / branch deploys
  if (/(^|\.)sunriseconstructionco\.com$/.test(host)) return origin;        // custom domain, if/when mapped
  return SITE;
}

export function corsHeaders(req) {
  return {
    'access-control-allow-origin': allowedOrigin(req.headers.get('origin')),
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,x-admin-pin',
    'access-control-max-age': '86400',
    'vary': 'origin',
  };
}

/* Wrap a Netlify v2 handler: answer OPTIONS preflights and stamp CORS headers
   on every response the handler returns. */
export function withCors(handler) {
  return async (req, ctx) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
    const res = await handler(req, ctx);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(corsHeaders(req))) headers.set(k, v);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}
