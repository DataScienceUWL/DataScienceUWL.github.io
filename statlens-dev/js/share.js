/**
 * share.js — Share button with URL + SVG QR code dialog.
 *
 * Loaded by page-number.js on every page. Adds a share icon to .header-actions.
 * On click, opens a dialog with two sharing modes:
 *   - "Include current settings" ON  → full URL with all query params (dataset, ci, seed, etc.)
 *   - "Include current settings" OFF → bare tool URL (just the page path)
 *
 * QR code includes the StatLens logo (EC level H for 30% recovery).
 * QR library (qrcode-generator) is lazy-loaded from CDN on first use.
 */

(function initShare() {
  const actions = document.querySelector('.header-actions');
  if (!actions) return;

  // Don't show share button in embed mode
  if (document.body?.getAttribute('data-embed') === 'true' ||
      document.documentElement.getAttribute('data-embed') === 'true') return;

  // ─── Share button ───
  const btn = document.createElement('button');
  btn.className = 'share-btn';
  btn.setAttribute('aria-label', 'Share page');
  btn.title = 'Share';
  btn.type = 'button';
  // Share icon (three dots connected by two lines)
  btn.innerHTML = '<svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16"><circle cx="14" cy="4" r="2.5" fill="currentColor"/><circle cx="14" cy="16" r="2.5" fill="currentColor"/><circle cx="4" cy="10" r="2.5" fill="currentColor"/><line x1="6.2" y1="8.9" x2="11.8" y2="5.1" stroke="currentColor" stroke-width="1.5"/><line x1="6.2" y1="11.1" x2="11.8" y2="14.9" stroke="currentColor" stroke-width="1.5"/></svg>';

  // Insert before help button
  const helpBtn = actions.querySelector('.help-btn');
  if (helpBtn) {
    actions.insertBefore(btn, helpBtn);
    actions.insertBefore(document.createTextNode(' '), helpBtn);
  } else {
    actions.appendChild(btn);
  }

  // ─── Dialog ───
  const dialog = document.createElement('dialog');
  dialog.className = 'share-dialog';
  dialog.setAttribute('aria-label', 'Share this page');
  document.body.appendChild(dialog);

  btn.addEventListener('click', () => showShareDialog());

  /** @type {boolean} */
  let qrLibLoaded = false;

  async function loadQrLib() {
    if (qrLibLoaded || typeof window['qrcode'] !== 'undefined') {
      qrLibLoaded = true;
      return;
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
      script.onload = () => { qrLibLoaded = true; resolve(undefined); };
      script.onerror = () => reject(new Error('Failed to load QR library'));
      document.head.appendChild(script);
    });
  }

  // StatLens favicon as inline SVG (blue circle + bell curve)
  const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="15" fill="#569BBD"/>
    <path d="M4 24 C4 24, 8 23, 10 20 C12 17, 13 8, 16 8 C19 8, 20 17, 22 20 C24 23, 28 24, 28 24"
          fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`;

  // ─── URL helpers ───

  /** Human-readable labels for known URL params */
  const PARAM_LABELS = {
    dataset: 'Dataset',
    data: 'Inline data',
    seed: 'Seed',
    ci: 'CI level',
    direction: 'Direction',
    p: 'Null proportion',
    null_value: 'Null value',
    var: 'Variable',
    x: 'X variable',
    y: 'Y variable',
    group: 'Group variable',
    response: 'Response variable',
    success: 'Success label',
    failure: 'Failure label',
    group1: 'Group 1',
    group2: 'Group 2',
    var1: 'Variable 1',
    var2: 'Variable 2',
    label: 'Label',
    units: 'Units',
    expert: 'Expert mode',
    interpret: 'Show interpretations',
    mode: 'Activity mode',
    activity: 'Activity',
    mu: 'Population mean',
    sigma: 'Population SD',
    n: 'Sample size',
    mean: 'Mean',
    sd: 'Std dev',
    df: 'Degrees of freedom',
    df1: 'df₁',
    df2: 'df₂',
    tail: 'Tail',
    trials: 'Trials',
    prob: 'Probability',
    stat: 'Statistic',
  };

  /** Params that are display/mode-only (not data settings) — excluded from summary */
  const DISPLAY_PARAMS = new Set(['embed', 'guided', 'static', 'readonly']);

  /**
   * Get the base URL (no query params) for the current page.
   * @returns {string}
   */
  function getBaseUrl() {
    return location.origin + location.pathname;
  }

  /**
   * Get current URL params as an array of {key, value, label} objects.
   * Filters out display-only params.
   * @returns {Array<{key: string, value: string, label: string}>}
   */
  function getUrlParams() {
    const params = new URLSearchParams(location.search);
    const result = [];
    for (const [key, value] of params) {
      if (DISPLAY_PARAMS.has(key)) continue;
      result.push({
        key,
        value,
        label: PARAM_LABELS[key] || key,
      });
    }
    return result;
  }

  // ─── QR generation ───

  /**
   * Core QR module renderer (shared by display and download versions).
   * @param {string} text
   * @returns {{qr: any, count: number, cellSize: number, margin: number, size: number, qrSize: number, logoSize: number, logoX: number, logoY: number, logoPad: number}}
   */
  function makeQr(text) {
    // @ts-ignore — qrcode is loaded dynamically
    const qr = qrcode(0, 'H');
    qr.addData(text);
    qr.make();

    const count = qr.getModuleCount();
    const cellSize = 6;
    const margin = cellSize * 2;
    const size = count * cellSize + margin * 2;
    const qrSize = count * cellSize;
    const logoSize = Math.round(qrSize * 0.22);
    const logoX = margin + (qrSize - logoSize) / 2;
    const logoY = margin + (qrSize - logoSize) / 2;
    const logoPad = Math.round(cellSize * 0.6);

    return { qr, count, cellSize, margin, size, qrSize, logoSize, logoX, logoY, logoPad };
  }

  /**
   * Render QR modules as SVG rects, skipping the logo area.
   * @param {ReturnType<typeof makeQr>} q
   * @returns {string}
   */
  function renderModules(q) {
    const { qr, count, cellSize, margin, logoX, logoY, logoSize, logoPad } = q;
    const logoLeft = logoX - logoPad;
    const logoRight = logoX + logoSize + logoPad;
    const logoTop = logoY - logoPad;
    const logoBottom = logoY + logoSize + logoPad;

    let rects = '';
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) {
          const px = col * cellSize + margin;
          const py = row * cellSize + margin;
          if (px + cellSize > logoLeft && px < logoRight &&
              py + cellSize > logoTop && py < logoBottom) continue;
          rects += `<rect x="${px}" y="${py}" width="${cellSize}" height="${cellSize}" fill="#000"/>`;
        }
      }
    }
    return rects;
  }

  /**
   * White circle behind logo.
   * @param {ReturnType<typeof makeQr>} q
   * @returns {string}
   */
  function renderLogoBackground(q) {
    const circR = (q.logoSize + q.logoPad * 2) / 2;
    const circCx = q.logoX + q.logoSize / 2;
    const circCy = q.logoY + q.logoSize / 2;
    return `<circle cx="${circCx}" cy="${circCy}" r="${circR}" fill="#fff"/>`;
  }

  /**
   * Generate display SVG (uses foreignObject for logo — works in browsers).
   * @param {string} text
   * @returns {string}
   */
  function generateQrSvg(text) {
    const q = makeQr(text);
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${q.size} ${q.size}" width="${q.size}" height="${q.size}" shape-rendering="crispEdges">`;
    svg += `<rect width="${q.size}" height="${q.size}" fill="#fff"/>`;
    svg += renderModules(q);
    svg += renderLogoBackground(q);
    svg += `<foreignObject x="${q.logoX}" y="${q.logoY}" width="${q.logoSize}" height="${q.logoSize}">`;
    svg += `<body xmlns="http://www.w3.org/1999/xhtml" style="margin:0;padding:0;background:transparent">`;
    svg += `<img src="data:image/svg+xml;base64,${btoa(LOGO_SVG)}" width="${q.logoSize}" height="${q.logoSize}" alt="" style="display:block"/>`;
    svg += `</body></foreignObject>`;
    svg += '</svg>';
    return svg;
  }

  /**
   * Generate downloadable SVG (native SVG logo — works standalone).
   * @param {string} text
   * @returns {string}
   */
  function generateDownloadableSvg(text) {
    const q = makeQr(text);
    let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    svg += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${q.size} ${q.size}" width="${q.size}" height="${q.size}" shape-rendering="crispEdges">`;
    svg += `<rect width="${q.size}" height="${q.size}" fill="#fff"/>`;
    svg += renderModules(q);
    svg += renderLogoBackground(q);

    // Native SVG logo (scaled from 32x32 viewBox)
    const s = q.logoSize / 32;
    const lx = q.logoX;
    const ly = q.logoY;
    svg += `<circle cx="${lx + 16 * s}" cy="${ly + 16 * s}" r="${15 * s}" fill="#569BBD"/>`;
    svg += `<path d="M${lx + 4 * s} ${ly + 24 * s} C${lx + 4 * s} ${ly + 24 * s}, ${lx + 8 * s} ${ly + 23 * s}, ${lx + 10 * s} ${ly + 20 * s} C${lx + 12 * s} ${ly + 17 * s}, ${lx + 13 * s} ${ly + 8 * s}, ${lx + 16 * s} ${ly + 8 * s} C${lx + 19 * s} ${ly + 8 * s}, ${lx + 20 * s} ${ly + 17 * s}, ${lx + 22 * s} ${ly + 20 * s} C${lx + 24 * s} ${ly + 23 * s}, ${lx + 28 * s} ${ly + 24 * s}, ${lx + 28 * s} ${ly + 24 * s}" fill="none" stroke="#fff" stroke-width="${2.2 * s}" stroke-linecap="round"/>`;

    svg += '</svg>';
    return svg;
  }

  // ─── Dialog ───

  async function showShareDialog() {
    const urlParams = getUrlParams();
    const hasParams = urlParams.length > 0;

    dialog.innerHTML = `
      <h2>Share this page</h2>
      ${hasParams ? `
        <label class="share-toggle">
          <input type="checkbox" class="share-settings-cb" checked>
          <span>Include current settings</span>
        </label>
        <div class="share-param-summary"></div>
      ` : ''}
      <div class="share-url-row">
        <input type="text" class="share-url-input" readonly>
        <button type="button" class="share-copy-btn" title="Copy URL">Copy</button>
      </div>
      <div class="share-qr-container">
        <p class="share-qr-loading">Generating QR code...</p>
      </div>
      <div class="share-actions">
        <button type="button" class="share-download-btn" disabled>Download SVG</button>
        <button type="button" class="share-close-btn">Close</button>
      </div>
    `;

    dialog.showModal();

    const urlInput = /** @type {HTMLInputElement} */ (dialog.querySelector('.share-url-input'));
    const copyBtn = /** @type {HTMLButtonElement} */ (dialog.querySelector('.share-copy-btn'));
    const qrContainer = /** @type {HTMLElement} */ (dialog.querySelector('.share-qr-container'));
    const downloadBtn = /** @type {HTMLButtonElement} */ (dialog.querySelector('.share-download-btn'));
    const settingsCb = /** @type {HTMLInputElement|null} */ (dialog.querySelector('.share-settings-cb'));
    const paramSummary = dialog.querySelector('.share-param-summary');

    /** Build the param summary HTML */
    function renderParamSummary(includeSettings) {
      if (!paramSummary || !hasParams) return;
      if (!includeSettings) {
        paramSummary.innerHTML = '<p class="share-param-hint">Students will arrive at the blank tool.</p>';
        return;
      }
      let html = '<table class="share-param-table">';
      for (const p of urlParams) {
        // Truncate long values (e.g., inline data)
        const displayVal = p.value.length > 40 ? p.value.slice(0, 37) + '...' : p.value;
        html += `<tr><td class="share-param-key">${p.label}</td><td class="share-param-val">${escapeHtml(displayVal)}</td></tr>`;
      }
      html += '</table>';
      paramSummary.innerHTML = html;
    }

    /** Get the URL to share based on toggle state */
    function getShareUrl() {
      if (settingsCb && !settingsCb.checked) return getBaseUrl();
      return location.href;
    }

    /** Update URL input, QR, and download button */
    async function updateShare() {
      const url = getShareUrl();
      const includeSettings = settingsCb ? settingsCb.checked : false;

      urlInput.value = url;
      renderParamSummary(includeSettings);

      if (!qrLibLoaded) return; // QR not loaded yet, will be set on initial load

      qrContainer.innerHTML = generateQrSvg(url);
      downloadBtn.disabled = false;
    }

    // Wire toggle
    if (settingsCb) {
      settingsCb.addEventListener('change', () => updateShare());
    }

    // Wire copy button
    copyBtn.addEventListener('click', () => {
      const url = getShareUrl();
      navigator.clipboard.writeText(url).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
      }).catch(() => {
        urlInput.select();
      });
    });

    // Wire close
    dialog.querySelector('.share-close-btn')?.addEventListener('click', () => dialog.close());

    // Wire download button
    downloadBtn.addEventListener('click', () => {
      const url = getShareUrl();
      const svgStr = generateDownloadableSvg(url);
      const blob = new Blob([svgStr], { type: 'image/svg+xml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const pageName = location.pathname
        .replace(/\/statlens(-dev)?/, '')
        .replace(/\//g, '-')
        .replace(/^-|-$/g, '') || 'statlens';
      a.download = `${pageName}-qr.svg`;
      a.click();
      URL.revokeObjectURL(a.href);
    });

    // Set initial state
    urlInput.value = getShareUrl();
    renderParamSummary(hasParams);

    // Load QR library and generate
    try {
      await loadQrLib();
      await updateShare();
    } catch {
      qrContainer.innerHTML = '<p class="share-qr-error">Could not generate QR code (no internet?)</p>';
    }
  }

  /**
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Close on backdrop click
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
})();
