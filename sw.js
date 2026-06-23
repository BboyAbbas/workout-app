/* Service worker — offline support with always-fresh code.
   Strategy: NETWORK-FIRST for same-origin GETs. Online -> newest files win
   (no more stale-cache surprises while iterating). Offline -> fall back to the
   cached copy. Bump CACHE on release to drop the old precache. */
const CACHE = 'workout-v34';
const SHELL = [
  './',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'js/db.js',
  'js/ui.js',
  'js/sync.js',
  'js/push.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

/* Web Push message lookup (the push is payload-less; the text is fetched here).
   The service worker can't read localStorage, so the sync id is the device default. */
const PUSH_BASE = 'https://workout-sync.bboy-abbass.workers.dev';
const PUSH_TOKEN = '0287ce3007c80cc07c109b8317cc541bc546912489b0b652';
const PUSH_USER = 'abbas-main';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    // refresh the cache copy for offline use
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
    return res;
  } catch (_) {
    const cached = await caches.match(req);
    if (cached) return cached;
    // navigation offline with no exact match -> serve the app shell
    if (req.mode === 'navigate') {
      return (await caches.match('index.html')) || (await caches.match('./'));
    }
    throw _;
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(networkFirst(req));
});

/* ---- Web Push: the online rest-done alert (server fires it at rest end) ---- */
// The push wakes this worker even when the PWA is closed/backgrounded/locked, and
// the notification's sound + vibration are governed by the phone's settings.
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    // The push is payload-less, so the message text lives server-side: fetch the
    // latest queued notification (rest / idle / auto-finish) and show it. Falls
    // back to the rest wording if a payload is present or the lookup fails.
    let d = {};
    try { if (e.data) d = e.data.json(); } catch (_) {}
    if (!d || !d.title) {
      try {
        const r = await fetch(`${PUSH_BASE}/push/notif?id=${encodeURIComponent(PUSH_USER)}`,
          { headers: { Authorization: 'Bearer ' + PUSH_TOKEN } });
        if (r.ok) d = await r.json();
      } catch (_) {}
    }
    await self.registration.showNotification((d && d.title) || 'Rest done 💪', {
      body: (d && d.body) || 'Time for your next set',
      tag: (d && d.tag) || 'rest',
      renotify: true,
      silent: false,
      vibrate: [400, 120, 400],
      icon: 'icons/icon-192.png',
      data: { url: './' },
    });
  })());
});

// Tapping the notification focuses an open tab, or opens the app.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      for (const c of cs) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
