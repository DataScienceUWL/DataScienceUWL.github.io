// @ts-check
/**
 * Chart and table export utilities for StatBench.
 *
 * - downloadChartPNG: SVG → Canvas → PNG download
 * - copyTableToClipboard: HTML table → tab-delimited clipboard text
 * - createExportBar: builds a small button bar for chart/table export
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

  const parent = opts.parent ?? opts.chartContainer?.parentElement;
  if (parent) parent.appendChild(bar);

  return bar;
}
