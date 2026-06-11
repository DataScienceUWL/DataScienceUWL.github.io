// StatLens Service Worker — stale-while-revalidate with update notification.
// DEPLOY_VERSION is replaced by deploy.sh on each deploy.
const CACHE_NAME = 'statlens-a1610823';

// App shell — the core files needed for the app to work
const APP_SHELL = [
  '/statlens/',
  '/statlens/index.html',
  '/statlens/css/style.css',
  '/statlens/favicon.svg',
  '/statlens/icon-192.png',
  '/statlens/icon-512.png',
  '/statlens/manifest.json',
  // Core JS modules
  '/statlens/js/stats.js',
  '/statlens/js/prng.js',
  '/statlens/js/csv-parser.js',
  '/statlens/js/url-params.js',
  '/statlens/js/types.js',
  '/statlens/js/chart-utils.js',
  '/statlens/js/histogram.js',
  '/statlens/js/dotplot.js',
  '/statlens/js/boxplot.js',
  '/statlens/js/scatterplot.js',
  '/statlens/js/barchart.js',
  '/statlens/js/curve.js',
  '/statlens/js/page-utils.js',
  '/statlens/js/sim-engine.js',
  '/statlens/js/sim-app.js',
  '/statlens/js/dist-app.js',
  '/statlens/js/distributions.js',
  '/statlens/js/inference.js',
  '/statlens/js/conclusions.js',
  '/statlens/js/theory-overlay.js',
  '/statlens/js/chart-interactions.js',
  '/statlens/js/spike.js',
  '/statlens/js/settings.js',
  '/statlens/js/one-sample-sim.js',
  '/statlens/js/chart-defaults.js',
  '/statlens/js/kde.js',
  '/statlens/js/export.js',
  '/statlens/js/share.js',
  // Dataset index
  '/statlens/data/datasets.json',
];

// Install: cache app shell (best-effort — don't block install on individual fetch failures)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        APP_SHELL.map((url) =>
          cache.add(url).catch(() => {
            // Individual file failed (network error, 404) — log but continue
            console.warn('[SW] Failed to cache:', url);
          })
        )
      )
    )
  );
  // Activate immediately — don't wait for old tabs to close
  self.skipWaiting();
});

// Activate: clean old caches, notify clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => {
      // Tell all open pages that a new version is active
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: 'SW_UPDATED' });
        }
      });
    })
  );
  self.clients.claim();
});

// Fetch: stale-while-revalidate for local, network-first for CDN
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // CDN requests — network first, fall back to cache
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // Local resources: stale-while-revalidate
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request).then((response) => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        }).catch(() => cached);

        // Ensure we always return a valid Response (never undefined)
        return cached || fetchPromise.then(r => r || fetch(event.request));
      })
    )
  );
});
