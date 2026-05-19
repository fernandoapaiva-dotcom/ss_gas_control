const CACHE_NAME = 'ss-gas-v7';
const ASSETS = [
  '/',
  '/index.html?v=7',
  '/style.css?v=7',
  '/app.js?v=7',
  '/assets/logo/SERVSOLDAPNG.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((res) => res || fetch(e.request))
  );
});
