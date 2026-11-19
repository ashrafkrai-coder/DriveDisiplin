const CACHE_NAME = 'fail-disiplin-v12';
const APP_SHELL = [
  './', './index.html', './manifest.json',
  './icons/launchericon-192x192.png', './icons/launchericon-512x512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
  )));
  self.clients.claim();
});

// Rangkaian dahulu supaya kemas kini sampai tanpa perlu naikkan versi; cache sebagai sandaran luar talian.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok) {
          const salinan = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, salinan));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) =>
        cached || (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
