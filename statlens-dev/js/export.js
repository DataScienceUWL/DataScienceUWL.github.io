// @ts-check
/**
 * Chart and table export utilities for StatLens.
 *
 * - downloadChartPNG: SVG → Canvas → PNG download
 * - copyTableToClipboard: HTML table → tab-delimited clipboard text
 * - createExportBar: builds a small button bar for chart/table export
 * - addChartSaveButton: floating save icon overlaid on chart container
 */

/**
 * Download an SVG element as a PNG image.
 * Renders the SVG onto a canvas at 2× resolution for crisp output.
 *
 * @param {SVGSVGElement} svgEl - The SVG element to export
 * @param {string} [filename='chart.png'] - Download filename
 * @param {object} [opts]
 * @param {number} [opts.scale=2] - Resolution multiplier (2 = retina)
 * @returns {Promise<void>}
 */
export async function downloadChartPNG(svgEl, filename = 'chart.png', opts = {}) {
  const scale = opts.scale ?? 2;

  // Clone SVG so we can inject computed styles without mutating the original
  const clone = /** @type {SVGSVGElement} */ (svgEl.cloneNode(true));

  // Inline critical computed styles from the original SVG
  inlineStyles(svgEl, clone);

  // Get dimensions from viewBox
  const vb = svgEl.viewBox.baseVal;
  const width = vb.width || svgEl.clientWidth || 600;
  const height = vb.height || svgEl.clientHeight || 371;

  // Set explicit dimensions on clone for consistent rendering
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.removeAttribute('style');

  // Serialize to data URL
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(clone);
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  // Draw onto canvas
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);

      // Trigger download
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('Canvas toBlob failed')); return; }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
        resolve();
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('SVG image load failed'));
    };
    img.src = url;
  });
}

/**
 * Inline computed styles from source SVG elements onto clone elements.
 * Ensures fonts, colors, and sizes render correctly when detached from the DOM.
 *
 * @param {Element} source
 * @param {Element} clone
 */
function inlineStyles(source, clone) {
  const props = [
    'font-family', 'font-size', 'font-weight', 'font-style',
    'fill', 'stroke', 'stroke-width', 'stroke-dasharray',
    'opacity', 'text-anchor', 'dominant-baseline',
  ];

  if (source instanceof SVGElement && clone instanceof SVGElement) {
    const computed = window.getComputedStyle(source);
    for (const prop of props) {
      const val = computed.getPropertyValue(prop);
      if (val) {
        /** @type {SVGElement} */ (clone).style.setProperty(prop, val);
      }
    }
  }

  const srcChildren = source.children;
  const cloneChildren = clone.children;
  for (let i = 0; i < srcChildren.length && i < cloneChildren.length; i++) {
    inlineStyles(srcChildren[i], cloneChildren[i]);
  }
}

/**
 * Copy an HTML table's content to the clipboard as tab-delimited text.
 * Suitable for pasting into spreadsheets or word processors.
 *
 * @param {HTMLTableElement} tableEl - The table to copy
 * @returns {Promise<boolean>} true if copy succeeded
 */
export async function copyTableToClipboard(tableEl) {
  const rows = [];

  for (const tr of tableEl.querySelectorAll('tr')) {
    const cells = [];
    for (const cell of tr.querySelectorAll('th, td')) {
      cells.push(/** @type {HTMLElement} */ (cell).textContent?.trim() ?? '');
    }
    rows.push(cells.join('\t'));
  }

  const text = rows.join('\n');
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  }
}

/**
 * Copy an HTML table to the clipboard in rich format (HTML + plain text).
 * Pasting into Word/Google Docs produces a formatted table;
 * pasting into a plain text editor produces tab-delimited text.
 *
 * @param {HTMLTableElement} tableEl - The table to copy
 * @returns {Promise<boolean>} true if copy succeeded
 */
export async function copyTableRich(tableEl) {
  // Build plain-text (tab-delimited) version
  const plainRows = [];
  for (const tr of tableEl.querySelectorAll('tr')) {
    const cells = [];
    for (const cell of tr.querySelectorAll('th, td')) {
      cells.push(/** @type {HTMLElement} */ (cell).textContent?.trim() ?? '');
    }
    plainRows.push(cells.join('\t'));
  }
  const plainText = plainRows.join('\n');

  // Build minimal HTML version (inline basic styling for Word compatibility)
  const htmlTable = tableEl.outerHTML;
  const html = `<meta charset="utf-8"><style>table{border-collapse:collapse}th,td{border:1px solid #ccc;padding:4px 8px;text-align:right}th:first-child,td:first-child{text-align:left}th{font-weight:bold;border-bottom:2px solid #666}</style>${htmlTable}`;

  try {
    // Modern ClipboardItem API — writes both formats
    const item = new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([plainText], { type: 'text/plain' }),
    });
    await navigator.clipboard.write([item]);
    return true;
  } catch {
    // Fallback to plain text copy
    return copyTableToClipboard(tableEl);
  }
}

/**
 * Copy a chart (SVG) to the clipboard as a PNG image.
 * Uses the same rendering pipeline as downloadChartPNG.
 *
 * @param {SVGSVGElement} svgEl - The SVG element to copy
 * @param {object} [opts]
 * @param {number} [opts.scale=2] - Resolution multiplier
 * @returns {Promise<boolean>} true if copy succeeded
 */
export async function copyChartToClipboard(svgEl, opts = {}) {
  const scale = opts.scale ?? 2;

  const clone = /** @type {SVGSVGElement} */ (svgEl.cloneNode(true));
  inlineStyles(svgEl, clone);

  const vb = svgEl.viewBox.baseVal;
  const width = vb.width || svgEl.clientWidth || 600;
  const height = vb.height || svgEl.clientHeight || 371;
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.removeAttribute('style');

  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(clone);
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = async () => {
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      try {
        const blob = await new Promise((res) =>
          canvas.toBlob((b) => res(b), 'image/png'));
        if (!blob) { resolve(false); return; }
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': /** @type {Blob} */ (blob) }),
        ]);
        resolve(true);
      } catch {
        resolve(false);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(false); };
    img.src = url;
  });
}

/**
 * Create an export button bar with chart download and/or table copy buttons.
 *
 * @param {object} opts
 * @param {HTMLElement} [opts.chartContainer] - Container with an SVG chart to export
 * @param {string} [opts.chartFilename='chart.png'] - PNG download filename
 * @param {HTMLTableElement} [opts.table] - Table element for clipboard copy
 * @param {HTMLElement} [opts.parent] - Where to append the bar (default: after chartContainer)
 * @returns {HTMLDivElement}
 */
export function createExportBar(opts) {
  const parent = opts.parent ?? opts.chartContainer?.parentElement;
  // Remove any existing export bar in the same parent to prevent duplicates
  if (parent) {
    const existing = parent.querySelector('.export-bar');
    if (existing) existing.remove();
  }

  const bar = document.createElement('div');
  bar.className = 'export-bar';

  if (opts.chartContainer) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-secondary export-btn';
    btn.textContent = 'Save chart';
    btn.title = 'Download chart as PNG image';
    btn.addEventListener('click', async () => {
      const svg = /** @type {SVGSVGElement|null} */ (
        opts.chartContainer?.querySelector('svg'));
      if (!svg) return;
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        await downloadChartPNG(svg, opts.chartFilename ?? 'chart.png');
      } catch (e) {
        console.error('Chart export failed:', e);
      }
      btn.disabled = false;
      btn.textContent = 'Save chart';
    });
    bar.appendChild(btn);
  }

  if (opts.table) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-secondary export-btn';
    btn.textContent = 'Copy table';
    btn.title = 'Copy statistics table to clipboard';
    btn.addEventListener('click', async () => {
      const ok = await copyTableToClipboard(/** @type {HTMLTableElement} */ (opts.table));
      btn.textContent = ok ? 'Copied!' : 'Failed';
      setTimeout(() => { btn.textContent = 'Copy table'; }, 1500);
    });
    bar.appendChild(btn);
  }

  if (parent) parent.appendChild(bar);

  return bar;
}

/**
 * Wrap an HTML table in a `.statlens-table` div with a "Copy table" button.
 * Replaces ad-hoc copy button code across explore pages.
 *
 * @param {HTMLTableElement} tableEl - The table to wrap
 * @param {object} [opts]
 * @param {string} [opts.copyTitle='Copy table to clipboard'] - Button tooltip
 * @param {boolean} [opts.showCopy] - Show copy button (default: true)
 * @returns {HTMLDivElement} The wrapper div
 */
export function wrapTable(tableEl, opts = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'statlens-table';

  // Insert wrapper where the table currently is, then move table inside
  if (tableEl.parentNode) {
    tableEl.parentNode.insertBefore(wrapper, tableEl);
  }
  wrapper.appendChild(tableEl);

  if (opts.showCopy !== false) {
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn-secondary export-btn';
    copyBtn.textContent = 'Copy table';
    copyBtn.title = opts.copyTitle ?? 'Copy table to clipboard';
    copyBtn.style.cssText = 'margin-top:0.3rem;font-size:0.8rem;';
    copyBtn.addEventListener('click', async () => {
      const ok = await copyTableRich(tableEl);
      copyBtn.textContent = ok ? 'Copied!' : 'Failed';
      setTimeout(() => { copyBtn.textContent = 'Copy table'; }, 1500);
    });
    wrapper.appendChild(copyBtn);
  }

  return wrapper;
}

/**
 * Add floating save-as-PNG and copy-to-clipboard buttons to a chart container.
 * Buttons appear as small icons in the top-right corner, semi-transparent
 * until hovered. Safe to call repeatedly — removes existing buttons first.
 *
 * @param {HTMLElement} container - The element containing an SVG chart
 * @param {string} [filename='chart.png'] - Download filename
 * @param {object} [opts]
 * @param {boolean} [opts.showCopy=false] - Show a copy-to-clipboard button
 * @returns {HTMLButtonElement} The save button element
 */
export function addChartSaveButton(container, filename = 'chart.png', opts = {}) {
  // Remove existing buttons to prevent duplicates on re-render
  const existing = container.querySelector('.chart-save-btn');
  if (existing) existing.remove();
  const existingCopy = container.querySelector('.chart-copy-btn');
  if (existingCopy) existingCopy.remove();

  // Ensure container is positioned for absolute child
  const pos = typeof getComputedStyle === 'function'
    ? getComputedStyle(container).position : '';
  if (pos === 'static' || pos === '') {
    container.style.position = 'relative';
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chart-save-btn';
  btn.setAttribute('aria-label', 'Save chart as PNG');
  btn.title = 'Save chart as PNG';

  // Download icon (arrow pointing down into tray)
  btn.innerHTML = `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
    <path d="M10 2v10M10 12l-3.5-3.5M10 12l3.5-3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <path d="M3 14v2a1 1 0 001 1h12a1 1 0 001-1v-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>
  </svg>`;

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const svg = /** @type {SVGSVGElement|null} */ (container.querySelector('svg'));
    if (!svg) return;
    btn.classList.add('saving');
    try {
      await downloadChartPNG(svg, filename);
    } catch (err) {
      console.error('Chart save failed:', err);
    }
    btn.classList.remove('saving');
  });

  container.appendChild(btn);

  // Copy-to-clipboard button (default: on)
  if (opts.showCopy !== false) {
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'chart-copy-btn';
    copyBtn.setAttribute('aria-label', 'Copy chart to clipboard');
    copyBtn.title = 'Copy chart to clipboard';

    // Clipboard icon
    copyBtn.innerHTML = `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <rect x="5" y="3" width="10" height="14" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/>
      <path d="M8 1h4v3a1 1 0 01-1 1H9a1 1 0 01-1-1V1z" fill="currentColor" opacity="0.4"/>
      <line x1="8" y1="8" x2="12" y2="8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      <line x1="8" y1="11" x2="12" y2="11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
    </svg>`;

    copyBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const svg = /** @type {SVGSVGElement|null} */ (container.querySelector('svg'));
      if (!svg) return;
      copyBtn.classList.add('saving');
      const ok = await copyChartToClipboard(svg);
      copyBtn.classList.remove('saving');
      if (ok) {
        copyBtn.title = 'Copied!';
        setTimeout(() => { copyBtn.title = 'Copy chart to clipboard'; }, 1500);
      }
    });

    container.appendChild(copyBtn);
  }

  return btn;
}
