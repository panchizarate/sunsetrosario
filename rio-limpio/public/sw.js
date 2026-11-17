// Service worker mínimo: cachea los archivos para jugar offline (PWA).
const CACHE = 'rio-limpio-v1';
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      try {
        const res = await fetch(e.request);
        if (res.ok && new URL(e.request.url).origin === location.origin) c.put(e.request, res.clone());
        return res;
      } catch {
        const hit = await c.match(e.request);
        if (hit) return hit;
        throw new Error('offline');
      }
    }),
  );
});
