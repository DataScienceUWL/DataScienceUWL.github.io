/**
 * page-number.js — Page utilities loaded on every page.
 *
 * 1. Embed mode detection (?embed=true) — sets data-embed attribute, skips SW registration
 * 2. Iframe safety — prevents service worker registration and dangerous navigation in iframes
 * 3. Page number badge (temporary revision aid)
 */

// ─── Embed mode & iframe safety ─────────────────────────────────────────────

(function initEmbedSafety() {
  const isEmbed = new URLSearchParams(location.search).get('embed') === 'true';
  const isIframe = window.parent !== window;

  // Set data-embed attribute for CSS to hide chrome
  if (isEmbed) {
    document.body?.setAttribute('data-embed', 'true');
    // Also set on documentElement in case body isn't ready yet
    document.documentElement.setAttribute('data-embed', 'true');
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
  '/':                                   1,
  '/simulate/':                          2,
  '/simulate/bootstrap-mean/':           3,
  '/simulate/bootstrap-prop/':           4,
  '/simulate/bootstrap-paired/':         5,
  '/simulate/bootstrap-two-means/':      6,
  '/simulate/bootstrap-slope/':          7,
  '/simulate/randomization-one-prop/':   8,
  '/simulate/randomization-diff-props/': 9,
  '/simulate/randomization-one-mean/':  10,
  '/simulate/randomization-diff-means/':11,
  '/simulate/randomization-chisq/':     12,
  '/distribution/':                     13,
  '/distribution/normal/':              14,
  '/distribution/t/':                   15,
  '/distribution/chisq/':               16,
  '/distribution/f/':                   17,
  '/distribution/binomial/':            18,
  '/explore/':                          19,
  '/explore/descriptive/':              20,
  '/explore/regression/':               21,
  '/explore/categorical/':              22,
  '/explore/grouped/':                  23,
  '/inference/':                        24,
  '/inference/one-mean/':               25,
  '/inference/one-prop/':               26,
  '/inference/two-means/':              27,
  '/inference/paired/':                 28,
  '/inference/two-props/':              29,
  '/inference/chisq/':                  30,
  '/inference/slope/':                  31,
  '/conceptual/':                       32,
  '/conceptual/sampling-dist/':         33,
  '/conceptual/ci-coverage/':           34,
  '/conceptual/randomization-test/':    35,
  '/practice/conclusions/':             36,
  '/practice/correlation/':             37,
};

(function injectPageNumber() {
  // Normalize path: strip base path prefix (e.g. /statbench/) and trailing index.html
  let path = location.pathname
    .replace(/\/statbench/, '')   // GitHub Pages prefix
    .replace(/index\.html$/, '')
    .replace(/([^/])$/, '$1/');   // ensure trailing slash
  if (path === '') path = '/';

  const num = PAGE_MAP[path];
  if (!num) return;

  const badge = document.createElement('div');
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
