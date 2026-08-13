const CACHE_NAME = 'schengen-guard-v2';
const CORE_FILES = [
  './', 'index.html', 'style.css', 'script.js', 'manifest.json', 'icon-192.png', 'icon-512.png',
  'fonts/source-serif-4/source-serif-4-400.woff2', 'fonts/source-serif-4/source-serif-4-400-italic.woff2'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Network-first: always try to get the freshest version of the app itself,
// falling back to the cached copy only if offline. Trip data never goes over
// the network — it lives entirely in this device's IndexedDB.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
