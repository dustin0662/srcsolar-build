// Minimal service worker — required for PWA installability on Android.
// Intentionally network-only (no caching): the scanner is a live tool that must
// always run the latest code and reach its functions/data, so we never serve
// stale assets. Its only job is to exist with a fetch handler.
self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()))
self.addEventListener("fetch", () => { /* pass through to network */ })
