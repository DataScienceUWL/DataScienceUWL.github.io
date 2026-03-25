/**
 * page-number.js — Page utilities loaded on every page.
 *
 * 1. Embed mode detection (?embed=true) — sets data-embed attribute, skips SW registration
 * 2. Iframe safety — prevents service worker registration and dangerous navigation in iframes
 * 3. Page number badge (temporary revision aid)
 */

// ─── Embed mode & iframe safety ─────────────────────────────────────────────

(function initEmbedSafety() {
  const params = new URLSearchParams(location.search);
  const isEmbed = params.get('embed') === 'true';
  const isStatic = params.get('static') === 'true';
  const isIframe = window.parent !== window;

  // Set data-embed attribute for CSS to hide chrome
  if (isEmbed) {
    document.body?.setAttribute('data-embed', 'true');
    // Also set on documentElement in case body isn't ready yet
    document.documentElement.setAttribute('data-embed', 'true');
  }

  // Set data-guided attribute for textbook embed mode (hides controls row)
  // Only meaningful when embed mode is also active
  if (isEmbed && params.get('guided') === 'true') {
    document.body?.setAttribute('data-guided', 'true');
    document.documentElement.setAttribute('data-guided', 'true');
  }

  // Set data-static attribute for screenshot-optimized rendering
  if (isStatic) {
    document.body?.setAttribute('data-static', 'true');
    document.documentElement.setAttribute('data-static', 'true');
    // Also implies embed mode
    document.body?.setAttribute('data-embed', 'true');
    document.documentElement.setAttribute('data-embed', 'true');
  }

  // Share button: inject on all pages (not embed)
  if (!isEmbed && !isStatic) {
    const shareScript = document.createElement('script');
    const shareLink = document.querySelector('link[rel="stylesheet"][href*="style.css"]');
    const sharePrefix = shareLink ? shareLink.getAttribute('href')?.replace(/css\/style\.css$/, '') || '' : '';
    shareScript.src = `${sharePrefix}js/share.js?v=${Date.now()}`;
    shareScript.defer = true;
    (document.body || document.documentElement).appendChild(shareScript);
  }

  // Activity panel: load guided instructions from JSON.
  // We start the fetch HERE (in a synchronous script) so the activity JSON's
  // default params (e.g. dataset=immigration) are injected into the URL BEFORE
  // any module scripts run. This prevents the race condition where initDataPanel
  // reads URL params before activity defaults are applied (REQ-020).
  const activityUrl = params.get('activity');
  if (activityUrl) {
    const link = document.querySelector('link[rel="stylesheet"][href*="style.css"]');
    const prefix = link ? link.getAttribute('href')?.replace(/css\/style\.css$/, '') || '' : '';

    // Resolve the activity URL (same logic as activity-panel.js)
    let resolvedUrl;
    if (activityUrl.startsWith('http://') || activityUrl.startsWith('https://')) {
      resolvedUrl = activityUrl;
    } else if (activityUrl.startsWith('/')) {
      resolvedUrl = activityUrl;
    } else {
      resolvedUrl = `${prefix}activities/${activityUrl}`;
    }

    // Fetch and inject params early; store promise so activity-panel.js can reuse it
    window.__activityParamsReady = fetch(resolvedUrl)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(activity => {
        // Inject activity params as URL defaults (existing URL params win)
        const current = new URLSearchParams(location.search);
        let changed = false;
        for (const [key, value] of Object.entries(activity.params || {})) {
          if (key === 'activity') continue;
          if (!current.has(key)) {
            current.set(key, String(value));
            changed = true;
          }
        }
        if (changed) {
          history.replaceState(null, '', '?' + current.toString());
        }
        return activity;
      })
      .catch(err => {
        console.warn('Activity panel: failed to load', resolvedUrl, err);
        return null;
      });

    // Also load the activity panel UI script (uses window.__activityParamsReady)
    const script = document.createElement('script');
    script.src = `${prefix}js/activity-panel.js`;
    script.defer = true;
    (document.body || document.documentElement).appendChild(script);
  }

  // In iframes: disable service worker registration (cross-origin issues)
  // and prevent the update toast's location.reload() from breaking the parent
  if (isIframe || isEmbed) {
    // Override SW registration — the inline <script> blocks in each page check
    // 'serviceWorker' in navigator, so we can't prevent that check.
    // Instead, we neuter the reload button in update toasts.
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node instanceof HTMLElement && node.classList.contains('update-toast')) {
            node.remove(); // Don't show update toasts in iframes
          }
        }
      }
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

    // Disable home button navigation (would navigate parent frame away)
    document.addEventListener('click', (e) => {
      const link = /** @type {HTMLElement} */ (e.target).closest('.home-btn');
      if (link) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  }
})();

// ─── Page number badge (temporary) ──────────────────────────────────────────
const PAGE_MAP = {
  '/':                                    1,
  '/simulate/':                           2,
  '/simulate/bootstrap-mean/':            3,
  '/simulate/bootstrap-prop/':            4,
  '/simulate/bootstrap-paired/':          5,
  '/simulate/bootstrap-two-means/':       6,
  '/simulate/bootstrap-two-props/':       7,
  '/simulate/bootstrap-slope/':           8,
  '/simulate/randomization-one-prop/':    9,
  '/simulate/randomization-diff-props/': 10,
  '/simulate/randomization-one-mean/':   11,
  '/simulate/randomization-diff-means/': 12,
  '/simulate/randomization-paired/':     13,
  '/simulate/randomization-chisq/':      14,
  '/simulate/randomization-correlation/':15,
  '/simulate/randomization-anova/':      16,
  '/distribution/':                      17,
  '/distribution/normal/':               18,
  '/distribution/t/':                    19,
  '/distribution/chisq/':                20,
  '/distribution/f/':                    21,
  '/distribution/binomial/':             22,
  '/explore/':                           23,
  '/explore/descriptive/':               24,
  '/explore/regression/':                25,
  '/explore/categorical/':               26,
  '/explore/one-cat/':                   27,
  '/explore/grouped/':                   28,
  '/explore/dotplot-editor/':            29,
  '/explore/regression-by-eye/':         30,
  '/inference/':                         31,
  '/inference/one-mean/':                32,
  '/inference/one-prop/':                33,
  '/inference/two-means/':               34,
  '/inference/paired/':                  35,
  '/inference/two-props/':               36,
  '/inference/chisq/':                   37,
  '/inference/slope/':                   38,
  '/inference/anova/':                   39,
  '/conceptual/':                        40,
  '/conceptual/sampling-dist/':          41,
  '/conceptual/ci-coverage/':            42,
  '/conceptual/randomization-test/':     43,
  '/practice/conclusions/':              44,
  '/practice/correlation/':              45,
};

(function injectPageNumber() {
  // Normalize path: strip base path prefix (e.g. /statlens/) and trailing index.html
  let path = location.pathname
    .replace(/\/statlens(-dev)?/, '')   // GitHub Pages prefix (prod or dev)
    .replace(/index\.html$/, '')
    .replace(/([^/])$/, '$1/');   // ensure trailing slash
  if (path === '') path = '/';

  const num = PAGE_MAP[path];
  if (!num) return;

  const badge = document.createElement('div');
  badge.className = 'page-number';
  badge.textContent = `P${num}`;
  badge.title = `Page ${num} of ${Object.keys(PAGE_MAP).length} — revision reference`;
  badge.setAttribute('aria-hidden', 'true'); // decorative, not for screen readers
  Object.assign(badge.style, {
    position: 'fixed',
    top: '6px',
    right: '6px',
    background: '#114B5F',
    color: '#fff',
    fontSize: '11px',
    fontFamily: 'monospace',
    fontWeight: '700',
    padding: '2px 6px',
    borderRadius: '4px',
    zIndex: '9999',
    opacity: '0.75',
    pointerEvents: 'none',
    lineHeight: '1.3',
  });
  document.body.appendChild(badge);
})();
