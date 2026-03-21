// @ts-check
/**
 * Activity Panel — loads step-by-step guided activities from JSON.
 *
 * When ?activity=URL is present, fetches the JSON and renders an
 * instruction panel alongside the tool. Desktop: left side panel.
 * Mobile: bottom sheet with floating action button.
 *
 * Activity JSON params are injected as URL defaults (existing URL
 * params take precedence) so the calling URL can be simple:
 *   ?activity=ch08-bootstrap-explore.json
 */

(function initActivityPanel() {
  const params = new URLSearchParams(location.search);
  const activityUrl = params.get('activity');
  if (!activityUrl) return;

  // Resolve relative URLs against the page's activities/ directory
  const resolvedUrl = resolveActivityUrl(activityUrl);

  fetch(resolvedUrl)
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(activity => {
      applyDefaultParams(activity.params || {});
      triggerDatasetLoad(activity.params || {});
      renderPanel(activity);
    })
    .catch(err => {
      console.warn('Activity panel: failed to load', resolvedUrl, err);
    });

  /**
   * Resolve an activity URL. Supports:
   * - Absolute URLs (https://...)
   * - Root-relative (/activities/foo.json)
   * - Bare filenames (foo.json → ../../activities/foo.json)
   */
  function resolveActivityUrl(url) {
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (url.startsWith('/')) return url;
    // Bare filename — resolve relative to StatLens activities/ dir
    const link = document.querySelector('link[rel="stylesheet"][href*="style.css"]');
    if (link) {
      const href = link.getAttribute('href') || '';
      const prefix = href.replace(/css\/style\.css$/, '');
      return `${prefix}activities/${url}`;
    }
    return `/activities/${url}`;
  }

  /**
   * Inject activity params as URL defaults. Existing URL params win.
   * This lets the activity JSON specify dataset, ci, seed, etc.
   * without requiring them in the textbook's link URL.
   */
  function applyDefaultParams(defaults) {
    const current = new URLSearchParams(location.search);
    let changed = false;
    for (const [key, value] of Object.entries(defaults)) {
      if (key === 'activity') continue; // don't recurse
      if (!current.has(key)) {
        current.set(key, String(value));
        changed = true;
      }
    }
    if (changed) {
      history.replaceState(null, '', '?' + current.toString());
    }
  }

  /**
   * After injecting params into the URL, trigger dataset loading if the page
   * already initialized its data panel (race condition fix for REQ-004).
   * The dataset select is already populated by the time this fetch completes —
   * we just need to set its value and fire change to load the data.
   */
  function triggerDatasetLoad(defaults) {
    // Set CI level if specified (page already parsed URL before our params were injected)
    if (defaults.ci) {
      const ciSel = /** @type {HTMLSelectElement|null} */ (document.getElementById('ci-level'));
      if (ciSel) {
        ciSel.value = String(defaults.ci);
        ciSel.dispatchEvent(new Event('change'));
      }
    }

    const dsId = defaults.dataset;
    if (!dsId) return;
    const sel = /** @type {HTMLSelectElement|null} */ (document.getElementById('dataset-select'));
    if (!sel) return;
    // Only trigger if no dataset is already loaded
    if (sel.value) return;
    // The dataset select options may still be populating (datasets.json fetch in progress)
    const trySet = () => {
      const opt = sel.querySelector(`option[value="${dsId}"]`);
      if (opt) {
        sel.value = dsId;
        sel.dispatchEvent(new Event('change'));
      } else {
        // Retry after datasets.json fetch completes
        setTimeout(() => {
          sel.value = dsId;
          sel.dispatchEvent(new Event('change'));
        }, 500);
      }
    };
    trySet();
  }

  /**
   * Simple inline markdown: **bold**, *italic*, `code`, [text](url)
   */
  function md(text) {
    if (!text) return '';
    return text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  /**
   * Build and insert the activity panel into the DOM.
   * @param {{ title: string, steps: Array<{instruction: string, observe?: string, reveal?: string}> }} activity
   */
  function renderPanel(activity) {
    const steps = activity.steps || [];
    if (steps.length === 0) return;

    let currentStep = 0;
    /** @type {Set<number>} */
    const revealed = new Set();

    // Mark body so CSS can adjust layout
    document.body.setAttribute('data-activity', 'true');
    // Also hide data panel and controls row
    document.body.setAttribute('data-guided', 'true');

    // ─── Desktop side panel ──────────────────────────────────────
    const panel = document.createElement('aside');
    panel.className = 'activity-panel';
    panel.setAttribute('aria-label', 'Activity instructions');

    // ─── Mobile FAB + bottom sheet ───────────────────────────────
    const fab = document.createElement('button');
    fab.className = 'activity-fab';
    fab.setAttribute('aria-label', 'Show activity instructions');
    fab.type = 'button';

    const sheet = document.createElement('div');
    sheet.className = 'activity-sheet';
    const sheetBackdrop = document.createElement('div');
    sheetBackdrop.className = 'activity-sheet-backdrop';

    // Build panel content
    function render() {
      const step = steps[currentStep];
      const isFirst = currentStep === 0;
      const isLast = currentStep === steps.length - 1;
      const isRevealed = revealed.has(currentStep);

      const html = `
        <div class="activity-header">
          <span class="activity-title">${md(activity.title)}</span>
          <span class="activity-step-count">Step ${currentStep + 1} of ${steps.length}</span>
        </div>
        <div class="activity-body">
          <div class="activity-instruction">${md(step.instruction)}</div>
          ${step.observe ? `<div class="activity-observe"><span class="activity-observe-label">Look for:</span> ${md(step.observe)}</div>` : ''}
          ${step.reveal ? `
            <div class="activity-reveal-section">
              <button type="button" class="activity-reveal-btn">${isRevealed ? 'Hide explanation' : 'Show explanation'}</button>
              <div class="activity-reveal ${isRevealed ? 'open' : ''}">${md(step.reveal)}</div>
            </div>
          ` : ''}
        </div>
        <div class="activity-nav">
          <button type="button" class="activity-prev" ${isFirst ? 'disabled' : ''}>← Back</button>
          <button type="button" class="activity-next" ${isLast ? 'disabled' : ''}>Next →</button>
        </div>
      `;

      panel.innerHTML = html;
      sheet.innerHTML = `<div class="activity-sheet-handle"></div>${html}<button type="button" class="activity-sheet-close" aria-label="Minimize">✕</button>`;
      fab.textContent = `${currentStep + 1}/${steps.length}`;

      // Wire events — panel
      const prevBtn = panel.querySelector('.activity-prev');
      const nextBtn = panel.querySelector('.activity-next');
      const revealBtn = panel.querySelector('.activity-reveal-btn');
      if (prevBtn) prevBtn.addEventListener('click', () => { currentStep--; render(); });
      if (nextBtn) nextBtn.addEventListener('click', () => { currentStep++; render(); });
      if (revealBtn) revealBtn.addEventListener('click', () => { toggleReveal(); });

      // Wire events — sheet
      const sPrev = sheet.querySelector('.activity-prev');
      const sNext = sheet.querySelector('.activity-next');
      const sReveal = sheet.querySelector('.activity-reveal-btn');
      const sClose = sheet.querySelector('.activity-sheet-close');
      if (sPrev) sPrev.addEventListener('click', () => { currentStep--; render(); });
      if (sNext) sNext.addEventListener('click', () => { currentStep++; render(); });
      if (sReveal) sReveal.addEventListener('click', () => { toggleReveal(); });
      if (sClose) sClose.addEventListener('click', () => { closeSheet(); });
    }

    function toggleReveal() {
      if (revealed.has(currentStep)) {
        revealed.delete(currentStep);
      } else {
        revealed.add(currentStep);
      }
      render();
    }

    function openSheet() {
      sheet.classList.add('open');
      sheetBackdrop.classList.add('open');
      fab.classList.add('hidden');
    }

    function closeSheet() {
      sheet.classList.remove('open');
      sheetBackdrop.classList.remove('open');
      fab.classList.remove('hidden');
    }

    fab.addEventListener('click', () => openSheet());
    sheetBackdrop.addEventListener('click', () => closeSheet());

    // Insert into DOM
    document.body.appendChild(panel);
    document.body.appendChild(fab);
    document.body.appendChild(sheetBackdrop);
    document.body.appendChild(sheet);

    render();

    // Auto-open sheet on mobile on first load
    if (window.innerWidth <= 768) {
      setTimeout(() => openSheet(), 500);
    }
  }
})();
