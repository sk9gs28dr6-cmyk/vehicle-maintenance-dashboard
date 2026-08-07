// Garage — service worker
// Caches the app shell for offline/installable use, and opportunistically
// caches the Tesseract.js OCR engine (CDN) the first time it's used so
// scanning still works without a network connection afterward.

const CACHE_VERSION = 'garage-v1';

const APP_SHELL = [
  '.',
  'index.html',
  'style.css',
  'app.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-180.png',
].map(p => new URL(p, self.registration.scope).href);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache our own local-server sync API — always hit the network so
  // the dashboard reflects the latest data (falls back to {} if offline).
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req).catch(() => new Response('{}', { headers: { 'Content-Type': 'application/json' } }))
    );
    return;
  }

  // Cache-first for everything else: app shell files and third-party OCR
  // assets (Tesseract.js core/worker/wasm/trained-data from the CDN) get
  // cached the first time they're fetched, so OCR keeps working offline.
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
