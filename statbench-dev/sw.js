// StatBench Service Worker — stale-while-revalidate with update notification.
// DEPLOY_VERSION is replaced by deploy.sh on each deploy.
const CACHE_NAME = 'statbench-0de717db';

// App shell — the core files needed for the app to work
const APP_SHELL = [
  '/statbench/',
  '/statbench/index.html',
  '/statbench/css/style.css',
  '/statbench/favicon.svg',
  '/statbench/icon-192.png',
  '/statbench/icon-512.png',
  '/statbench/manifest.json',
  // Core JS modules
  '/statbench/js/stats.js',
  '/statbench/js/prng.js',
  '/statbench/js/csv-parser.js',
  '/statbench/js/url-params.js',
  '/statbench/js/types.js',
  '/statbench/js/chart-utils.js',
  '/statbench/js/histogram.js',
  '/statbench/js/dotplot.js',
  '/statbench/js/boxplot.js',
  '/statbench/js/scatterplot.js',
  '/statbench/js/barchart.js',
  '/statbench/js/curve.js',
  '/statbench/js/page-utils.js',
  '/statbench/js/sim-engine.js',
  '/statbench/js/sim-app.js',
  '/statbench/js/dist-app.js',
  '/statbench/js/distributions.js',
  '/statbench/js/inference.js',
  '/statbench/js/conclusions.js',
  '/statbench/js/theory-overlay.js',
  '/statbench/js/chart-interactions.js',
  '/statbench/js/spike.js',
  '/statbench/js/settings.js',
  '/statbench/js/one-sample-sim.js',
  '/statbench/js/chart-defaults.js',
  '/statbench/js/kde.js',
  '/statbench/js/export.js',
  '/statbench/js/share.js',
  // Dataset index
  '/statbench/data/datasets.json',
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

        return cached || fetchPromise;
      })
    )
  );
});
