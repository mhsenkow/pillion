const CACHE = 'pillion-lobby-v1';
const OFFLINE_SHELL = ['/join', '/join.html', '/gun.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(OFFLINE_SHELL.filter(Boolean))).catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.pathname === '/join' || url.pathname === '/join.html') {
    event.respondWith(
      caches.match(event.request).then((hit) => hit || fetch(event.request).catch(() => caches.match('/join.html'))),
    );
    return;
  }
  if (url.pathname === '/gun.html' || url.pathname === '/manifest.webmanifest') {
    event.respondWith(
      caches.match(event.request).then((hit) => hit || fetch(event.request)),
    );
  }
});