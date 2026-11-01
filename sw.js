// Garage — self-destructing service worker.
//
// The app has moved to a Google Apps Script web app, so this one exists only
// to get itself out of the way. Browsers re-fetch sw.js in the background and
// byte-compare it against the installed copy; because this file differs from
// the old caching worker, that check installs this one, which immediately
// unregisters itself and deletes every cache it left behind.
//
// index.html unregisters the worker too. Either path is enough — keeping both
// covers clients that check for a worker update before they next navigate.
//
// Note it does NOT touch localStorage: the old offline data stays readable so
// index.html can still offer it as a download.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    await self.registration.unregister();

    // Reload any open window so it drops this worker and fetches the live
    // page instead of whatever the old shell had cached.
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(client => client.navigate(client.url));
  })());
});

// No fetch handler on purpose: every request goes straight to the network.
