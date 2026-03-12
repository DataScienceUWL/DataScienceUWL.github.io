// StatBench Service Worker — offline-first caching strategy
// Caches app shell and datasets for offline use.

const CACHE_NAME = 'statbench-v1';

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
  // Dataset index
  '/statbench/data/datasets.json',
];

// Install: cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Use addAll for app shell, but don't fail install if CDN resources aren't available
      return cache.addAll(APP_SHELL);
    })
  );
  // Activate immediately
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for HTML pages, cache-first for assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip CDN requests (D3, jStat, KaTeX, fonts) — let browser handle normally
  if (url.origin !== self.location.origin) {
    // Try network, fall back to cache for CDN resources
    event.respondWith(
      fetch(event.request).then((response) => {
        // Cache CDN resources on first successful fetch
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // For local resources: stale-while-revalidate
  // Serve from cache immediately, update cache in background
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
