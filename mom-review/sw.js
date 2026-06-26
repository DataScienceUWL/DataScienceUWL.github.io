
const SHELL = 'mom-shell-v5';
const DATA  = 'mom-data-v1';
const ASSETS = ['./','./index.html','./app.js','./manifest.webmanifest',
                './icon-192.png','./icon-512.png','./data/bundle.json'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(
    ks.filter(k => k !== SHELL && k !== DATA).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(resp => {
    if (/\/(shots|data)\//.test(e.request.url)) {
      const copy = resp.clone(); caches.open(DATA).then(c => c.put(e.request, copy));
    }
    return resp;
  }).catch(() => caches.match('./index.html'))));
});
