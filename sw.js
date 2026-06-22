/* Service worker — offline support with always-fresh code.
   Strategy: NETWORK-FIRST for same-origin GETs. Online -> newest files win
   (no more stale-cache surprises while iterating). Offline -> fall back to the
   cached copy. Bump CACHE on release to drop the old precache. */
const CACHE = 'workout-v21';
const SHELL = [
  './',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'js/db.js',
  'js/ui.js',
  'js/sync.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

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
