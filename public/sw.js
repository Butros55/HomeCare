/**
 * Service Worker (Anforderung 21).
 *
 * Strategien:
 *  - Navigationen: Netz zuerst, bei Offline die zwischengespeicherte Seite
 *    bzw. /offline als Fallback.
 *  - /_next/static & Icons: Cache zuerst (unveränderliche Assets).
 *  - /api/my/today: Netz zuerst mit Cache-Fallback – heutige Termine und die
 *    gespeicherte Route bleiben offline lesbar.
 *
 * Offline-Mutationen sind bewusst NICHT implementiert (kein Datenverlust
 * durch scheinbare Synchronisation); schreibende Aktionen schlagen offline
 * sichtbar fehl. Details: docs/architecture.md.
 */
const VERSION = 'hcp-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const DATA_CACHE = `${VERSION}-data`;

const PRECACHE_URLS = [
  '/offline',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Heutige Daten: Netz zuerst, sonst Cache (Offline-Lesezugriff).
  if (url.pathname === '/api/my/today') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(DATA_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached ?? Response.error())),
    );
    return;
  }

  // Statische Assets: Cache zuerst.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Seiten-Navigationen: Netz zuerst, Offline-Fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches
            .match(request)
            .then((cached) => cached ?? caches.match('/offline'))
            .then((fallback) => fallback ?? Response.error()),
        ),
    );
  }
});
