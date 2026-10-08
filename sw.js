// Offline support: cache the app shell. Bump VERSION when files change.
const VERSION = 'resell-v6';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'js/app.js',
  'js/db.js',
  'js/pricing.js',
  'js/platforms.js',
  'js/reminders.js',
  'js/writer.js',
  'js/ai.js',
  'js/sheets.js',
  'js/shipping.js',
  'js/ready.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Network first for our own files (so updates show up), cache as offline fallback.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    // no-cache: always check the server, so a phone never mixes old and new app files.
    fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(self.registration.scope);
  target.hash = (e.notification.data && e.notification.data.url) || '';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) {
          w.navigate(target.href);
          return w.focus();
        }
      }
      return self.clients.openWindow(target.href);
    })
  );
});
