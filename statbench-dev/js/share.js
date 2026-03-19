/**
 * share.js — Share button with URL + SVG QR code dialog.
 *
 * Loaded by page-number.js on every page. Adds a share icon to .header-actions.
 * On click, opens a dialog showing the current page URL and an SVG QR code
 * with the StatBench logo embedded in the center.
 *
 * QR generation uses qrcode-generator (lazy-loaded from CDN on first use)
 * with error correction level H (30% recovery) to accommodate the logo overlay.
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
  // Share icon (box with arrow)
  btn.innerHTML = '<svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16"><path d="M13 3l4 4-4 4m4-4H7a4 4 0 00-4 4v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

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

  btn.addEventListener('click', () => {
    showShareDialog();
  });

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

  // StatBench favicon as inline SVG (blue circle + bell curve)
  const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="15" fill="#569BBD"/>
    <path d="M4 24 C4 24, 8 23, 10 20 C12 17, 13 8, 16 8 C19 8, 20 17, 22 20 C24 23, 28 24, 28 24"
          fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`;

  /**
   * Generate an SVG string for a QR code with centered StatBench logo.
   * Uses EC level H (30% recovery) so the logo overlay doesn't break scanning.
   * @param {string} text
   * @returns {string} SVG markup
   */
  function generateQrSvg(text) {
    // @ts-ignore — qrcode is loaded dynamically
    const qr = qrcode(0, 'H'); // type 0 = auto version, H = high EC
    qr.addData(text);
    qr.make();

    const count = qr.getModuleCount();
    const cellSize = 6;
    const margin = cellSize * 2;
    const size = count * cellSize + margin * 2;
    const qrSize = count * cellSize;

    // Logo dimensions — ~18% of QR area (well within H's 30% capacity)
    const logoSize = Math.round(qrSize * 0.22);
    const logoX = margin + (qrSize - logoSize) / 2;
    const logoY = margin + (qrSize - logoSize) / 2;
    const logoPad = Math.round(cellSize * 0.6);

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges">`;
    svg += `<rect width="${size}" height="${size}" fill="#fff"/>`;

    // Draw QR modules (skip the area covered by logo)
    const logoLeft = logoX - logoPad;
    const logoRight = logoX + logoSize + logoPad;
    const logoTop = logoY - logoPad;
    const logoBottom = logoY + logoSize + logoPad;

    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) {
          const px = col * cellSize + margin;
          const py = row * cellSize + margin;
          // Skip modules under logo area (they're covered anyway)
          if (px + cellSize > logoLeft && px < logoRight &&
              py + cellSize > logoTop && py < logoBottom) {
            continue;
          }
          svg += `<rect x="${px}" y="${py}" width="${cellSize}" height="${cellSize}" fill="#000"/>`;
        }
      }
    }

    // White background circle behind logo (slightly larger than logo)
    const circR = (logoSize + logoPad * 2) / 2;
    const circCx = logoX + logoSize / 2;
    const circCy = logoY + logoSize / 2;
    svg += `<circle cx="${circCx}" cy="${circCy}" r="${circR}" fill="#fff"/>`;

    // Embed logo SVG using foreignObject for clean rendering
    svg += `<foreignObject x="${logoX}" y="${logoY}" width="${logoSize}" height="${logoSize}">`;
    svg += `<body xmlns="http://www.w3.org/1999/xhtml" style="margin:0;padding:0;background:transparent">`;
    svg += `<img src="data:image/svg+xml;base64,${btoa(LOGO_SVG)}" width="${logoSize}" height="${logoSize}" alt="" style="display:block"/>`;
    svg += `</body></foreignObject>`;

    svg += '</svg>';
    return svg;
  }

  /**
   * Generate a downloadable SVG (without foreignObject — uses native SVG elements for logo).
   * @param {string} text
   * @returns {string}
   */
  function generateDownloadableSvg(text) {
    // @ts-ignore
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

    let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    svg += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges">`;
    svg += `<rect width="${size}" height="${size}" fill="#fff"/>`;

    const logoLeft = logoX - logoPad;
    const logoRight = logoX + logoSize + logoPad;
    const logoTop = logoY - logoPad;
    const logoBottom = logoY + logoSize + logoPad;

    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) {
          const px = col * cellSize + margin;
          const py = row * cellSize + margin;
          if (px + cellSize > logoLeft && px < logoRight &&
              py + cellSize > logoTop && py < logoBottom) {
            continue;
          }
          svg += `<rect x="${px}" y="${py}" width="${cellSize}" height="${cellSize}" fill="#000"/>`;
        }
      }
    }

    // White circle + native SVG logo (works standalone without foreignObject)
    const circR = (logoSize + logoPad * 2) / 2;
    const circCx = logoX + logoSize / 2;
    const circCy = logoY + logoSize / 2;
    svg += `<circle cx="${circCx}" cy="${circCy}" r="${circR}" fill="#fff"/>`;

    // Recreate the favicon as native SVG elements, scaled to logoSize
    const s = logoSize / 32; // scale factor from 32x32 viewBox
    const lx = logoX;
    const ly = logoY;
    svg += `<circle cx="${lx + 16 * s}" cy="${ly + 16 * s}" r="${15 * s}" fill="#569BBD"/>`;
    svg += `<path d="M${lx + 4 * s} ${ly + 24 * s} C${lx + 4 * s} ${ly + 24 * s}, ${lx + 8 * s} ${ly + 23 * s}, ${lx + 10 * s} ${ly + 20 * s} C${lx + 12 * s} ${ly + 17 * s}, ${lx + 13 * s} ${ly + 8 * s}, ${lx + 16 * s} ${ly + 8 * s} C${lx + 19 * s} ${ly + 8 * s}, ${lx + 20 * s} ${ly + 17 * s}, ${lx + 22 * s} ${ly + 20 * s} C${lx + 24 * s} ${ly + 23 * s}, ${lx + 28 * s} ${ly + 24 * s}, ${lx + 28 * s} ${ly + 24 * s}" fill="none" stroke="#fff" stroke-width="${2.2 * s}" stroke-linecap="round"/>`;

    svg += '</svg>';
    return svg;
  }

  async function showShareDialog() {
    const url = location.href;

    dialog.innerHTML = `
      <h2>Share this page</h2>
      <div class="share-url-row">
        <input type="text" class="share-url-input" value="${url.replace(/"/g, '&quot;')}" readonly>
        <button type="button" class="share-copy-btn" title="Copy URL">Copy</button>
      </div>
      <div class="share-qr-container">
        <p class="share-qr-loading">Generating QR code...</p>
      </div>
      <div class="share-actions">
        <button type="button" class="share-download-btn" disabled>Download SVG</button>
        <button type="button" class="share-close-btn" autofocus>Close</button>
      </div>
    `;

    dialog.showModal();

    // Wire copy button
    const copyBtn = /** @type {HTMLButtonElement} */ (dialog.querySelector('.share-copy-btn'));
    const urlInput = /** @type {HTMLInputElement} */ (dialog.querySelector('.share-url-input'));
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(url).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
      }).catch(() => {
        urlInput.select();
      });
    });

    // Wire close
    dialog.querySelector('.share-close-btn')?.addEventListener('click', () => dialog.close());

    // Generate QR
    const qrContainer = /** @type {HTMLElement} */ (dialog.querySelector('.share-qr-container'));
    const downloadBtn = /** @type {HTMLButtonElement} */ (dialog.querySelector('.share-download-btn'));

    try {
      await loadQrLib();
      const svgStr = generateQrSvg(url);
      qrContainer.innerHTML = svgStr;

      // Wire download button
      const downloadSvg = generateDownloadableSvg(url);
      downloadBtn.disabled = false;
      downloadBtn.addEventListener('click', () => {
        const blob = new Blob([downloadSvg], { type: 'image/svg+xml' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        // Generate a reasonable filename from the page path
        const pageName = location.pathname
          .replace(/\/statbench(-dev)?/, '')
          .replace(/\//g, '-')
          .replace(/^-|-$/g, '') || 'statbench';
        a.download = `${pageName}-qr.svg`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
    } catch {
      qrContainer.innerHTML = '<p class="share-qr-error">Could not generate QR code (no internet?)</p>';
    }
  }

  // Close on backdrop click
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
})();
