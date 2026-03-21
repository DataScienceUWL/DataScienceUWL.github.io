// @ts-check
/**
 * Shared interactive chart helpers for StatLens.
 * Provides draggable boundary lines and click-to-edit value labels.
 */

/**
 * Convert a pointer event to a data-space x value within a chart frame.
 * @param {PointerEvent} e
 * @param {SVGSVGElement} svgEl
 * @param {import('./types.js').ChartFrame} frame
 * @param {import('d3-scale').ScaleLinear<number,number>} xScale
 * @returns {number}
 */
function pointerToDataX(e, svgEl, frame, xScale) {
  const pt = svgEl.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const svgPt = pt.matrixTransform(svgEl.getScreenCTM().inverse());
  return xScale.invert(svgPt.x - frame.margin.left);
}

/**
 * Enable horizontal dragging on an SVG element within a chart.
 * Uses pointer capture for reliable cross-browser drag behavior.
 *
 * @param {SVGElement} handleEl - The element to attach drag events to
 * @param {SVGSVGElement} svgEl - The root SVG element
 * @param {import('./types.js').ChartFrame} frame
 * @param {import('d3-scale').ScaleLinear<number,number>} xScale
 * @param {(value: number) => void} onDrag - Called on each drag move with the data-space x value
 * @param {(value: number) => void} [onDragEnd] - Called when drag ends
 */
export function enableHorizontalDrag(handleEl, svgEl, frame, xScale, onDrag, onDragEnd) {
  let dragging = false;

  handleEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    handleEl.setPointerCapture(e.pointerId);
  });

  handleEl.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dataX = pointerToDataX(e, svgEl, frame, xScale);
    const [lo, hi] = xScale.domain();
    const clamped = Math.max(lo, Math.min(hi, dataX));
    onDrag(clamped);
  });

  handleEl.addEventListener('pointerup', () => {
    if (dragging) {
      dragging = false;
      if (onDragEnd) {
        const val = xScale.invert(
          parseFloat(handleEl.getAttribute('x')) +
          parseFloat(handleEl.getAttribute('width')) / 2
        );
        onDragEnd(val);
      }
    }
  });

  handleEl.addEventListener('lostpointercapture', () => {
    dragging = false;
  });
}

/**
 * Show an inline text input overlaying an SVG text element.
 * Resolves with the entered numeric value, or null if cancelled/invalid.
 *
 * @param {HTMLElement} containerEl - The chart's containing HTML element
 * @param {SVGTextElement} textEl - The SVG text element to overlay
 * @param {number} currentValue - The current numeric value
 * @returns {Promise<number|null>}
 */
export function showInlineEdit(containerEl, textEl, currentValue, displayValue) {
  return new Promise((resolve) => {
    const svgEl = textEl.ownerSVGElement;
    if (!svgEl) { resolve(null); return; }
    const containerRect = containerEl.getBoundingClientRect();

    // Convert SVG text bbox corners to screen coordinates
    const bbox = textEl.getBBox();
    const pt1 = svgEl.createSVGPoint();
    pt1.x = bbox.x;
    pt1.y = bbox.y;
    const pt2 = svgEl.createSVGPoint();
    pt2.x = bbox.x + bbox.width;
    pt2.y = bbox.y + bbox.height;
    const ctm = textEl.getScreenCTM();
    if (!ctm) { resolve(null); return; }
    const screenTL = pt1.matrixTransform(ctm);
    const screenBR = pt2.matrixTransform(ctm);

    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.value = displayValue ?? formatEditValue(currentValue);
    input.className = 'chart-inline-edit';

    const left = screenTL.x - containerRect.left - 4;
    const top = screenTL.y - containerRect.top - 2;
    const w = Math.max(72, screenBR.x - screenTL.x + 16);
    const h = screenBR.y - screenTL.y + 8;
    input.style.cssText = `
      position: absolute;
      left: ${left}px;
      top: ${top}px;
      width: ${w}px;
      height: ${h}px;
      font-family: "Source Code Pro", monospace;
      font-size: 13px;
      text-align: center;
      border: 2px solid var(--ims-blue, #569BBD);
      border-radius: 3px;
      padding: 0 4px;
      background: #fff;
      z-index: 10;
      outline: none;
    `;

    containerEl.style.position = 'relative';
    containerEl.appendChild(input);
    input.select();
    textEl.setAttribute('visibility', 'hidden');

    let resolved = false;
    function finish(accept) {
      if (resolved) return;
      resolved = true;
      textEl.removeAttribute('visibility');
      input.remove();
      if (accept) {
        const val = parseFloat(input.value);
        resolve(isFinite(val) ? val : null);
      } else {
        resolve(null);
      }
    }

    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
  });
}

/**
 * Format a numeric value for display in chart annotations.
 * @param {number} v
 * @returns {string}
 */
export function formatEditValue(v) {
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(2);
  if (abs >= 10) return v.toFixed(3);
  return v.toFixed(4);
}
