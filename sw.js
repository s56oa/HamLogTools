// VHF Logger — Service Worker v1.5
// Cache version: bump this string when releasing a new version of the app
// so that users automatically get fresh files on next online visit.
const CACHE = 'vhf-logger-v1.5';

// Files that must be cached on install (app shell)
const PRECACHE = [
  './vhf-logger.html',
  './vhf-logger.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
];

// ── Install: pre-cache the app shell ──────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(PRECACHE);
    // Optional: cache the crosscheck baseline if it exists
    // (may be absent; failure is silently ignored)
    await c.add('./crosscheck-baseline.json').catch(() => {});
    await self.skipWaiting();
  })());
});

// ── Activate: delete stale caches from previous versions ──────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Google Fonts: stale-while-revalidate
  // Serve instantly from cache while refreshing in the background.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Same-origin requests: cache-first, fall back to network
  // Keeps the app working with zero signal.
  if (url.origin === self.location.origin) {
    e.respondWith(cacheFirst(request));
    return;
  }
  // All other origins (QRZ API etc.): network only — no caching
});

// ── Strategies ─────────────────────────────────────────────────────────────

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) {
      const c = await caches.open(CACHE);
      await c.put(req, res.clone());
    }
    return res;
  } catch {
    return new Response('Brez signala — stran ni v predpomnilniku.\nOffline — page not in cache.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    });
  }
}

async function staleWhileRevalidate(req) {
  const c      = await caches.open(CACHE);
  const cached = await c.match(req);
  const fresh  = fetch(req).then(res => {
    if (res.ok) c.put(req, res.clone());
    return res;
  }).catch(() => null);
  return cached ?? await fresh;
}
