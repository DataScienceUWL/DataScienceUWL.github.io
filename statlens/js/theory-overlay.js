// @ts-check
/**
 * Theoretical distribution overlay for simulation charts.
 *
 * Draws a scaled PDF curve on top of an existing histogram SVG.
 * Used to visually compare simulation-based results with theoretical distributions.
 *
 * Includes a built-in normal PDF so no jStat dependency is needed.
 */

import * as d3Selection from 'd3-selection';
import * as d3Shape from 'd3-shape';
import { renderStatLabel } from './chart-utils.js';

/** Color for the theoretical curve (IMS red). */
const THEORY_COLOR = '#F05133';

/** Number of evaluation points for the curve. */
const N_POINTS = 150;

/** @type {number} */
const SQRT2PI = Math.sqrt(2 * Math.PI);

/**
 * Normal PDF (no external dependency).
 * @param {number} x
 * @param {number} mu
 * @param {number} sigma
 * @returns {number}
 */
export function normalPdf(x, mu, sigma) {
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * SQRT2PI);
}

/**
 * Overlay a theoretical PDF curve on an existing histogram chart.
 *
 * The curve is scaled to match the histogram's frequency scale:
 *   frequency_y = n × binWidth × pdf(x)
 *
 * Accepts the actual D3 scales and chart frame so we don't have to
 * reverse-engineer SVG structure.
 *
 * @param {object} options
 * @param {HTMLElement} options.container - Chart container div (parent of the SVG)
 * @param {(x: number) => number} options.pdf - Probability density function
 * @param {number} options.totalN - Total sample count in the histogram
 * @param {number} options.binWidth - Bin width in data units
 * @param {(x: number) => number} options.xScale - D3 x scale function
 * @param {(y: number) => number} options.yScale - D3 y scale function
 * @param {[number, number]} options.xDomain - [min, max] x-domain
 * @param {string} [options.label] - Label for the curve (e.g., "N(50, 3.2)")
 * @param {string} [options.color] - Curve stroke color
 */
export function overlayTheoryCurve(options) {
  const {
    container, pdf, totalN, binWidth, xScale, yScale, xDomain,
    label, color = THEORY_COLOR,
  } = options;

  const svg = container.querySelector('svg');
  if (!svg) return;

  // Find the plot area <g> (the .chart-inner group)
  const plotG = svg.querySelector('.chart-inner') || svg.querySelector('g[transform]');
  if (!plotG) return;

  // Remove any previous overlay
  const prev = plotG.querySelector('.theory-overlay');
  if (prev) prev.remove();

  // Scale factor: histogram shows frequency, so y = totalN * binWidth * pdf(x)
  const scaleFactor = totalN * binWidth;

  // Generate curve points
  /** @type {[number, number][]} */
  const points = [];
  for (let i = 0; i <= N_POINTS; i++) {
    const x = xDomain[0] + (xDomain[1] - xDomain[0]) * i / N_POINTS;
    const freqY = scaleFactor * pdf(x);
    points.push([xScale(x), yScale(freqY)]);
  }

  // Draw
  const g = d3Selection.select(plotG)
    .append('g')
    .attr('class', 'theory-overlay');

  const line = d3Shape.line()
    .x(d => d[0])
    .y(d => d[1]);

  g.append('path')
    .attr('d', line(points))
    .attr('fill', 'none')
    .attr('stroke', color)
    .attr('stroke-width', 2.5)
    .attr('stroke-dasharray', '6,3')
    .attr('opacity', 0.85);

  // Label near the peak
  if (label) {
    let peakX = (xDomain[0] + xDomain[1]) / 2;
    let peakY = 0;
    for (let i = 0; i <= 50; i++) {
      const x = xDomain[0] + (xDomain[1] - xDomain[0]) * i / 50;
      const y = pdf(x);
      if (y > peakY) { peakY = y; peakX = x; }
    }
    const lx = xScale(peakX);
    const ly = yScale(scaleFactor * peakY);
    const textEl = g.append('text')
      .attr('x', lx + 10)
      .attr('y', Math.max(ly - 6, 14))
      .attr('fill', color)
      .attr('class', 'stat-marker-label')
      .attr('font-weight', '700')
      .attr('font-family', 'var(--font-body, sans-serif)');
    renderStatLabel(textEl, label);
  }
}

/**
 * Remove the theoretical overlay from a chart container.
 * @param {HTMLElement} container
 */
export function removeTheoryOverlay(container) {
  const overlay = container.querySelector('.theory-overlay');
  if (overlay) overlay.remove();
}

/**
 * Create a "Show theoretical curve" toggle checkbox.
 * Inserts it into the given parent element.
 *
 * @param {HTMLElement} parent - Where to insert the toggle
 * @param {(checked: boolean) => void} onChange - Called when toggled
 * @returns {HTMLInputElement} The checkbox element
 */
export function createTheoryToggle(parent, onChange) {
  const label = document.createElement('label');
  label.className = 'theory-toggle';
  label.style.cssText = 'display:inline-flex;align-items:center;gap:0.35rem;font-size:0.85rem;margin:0.25rem 0.5rem;cursor:pointer;';

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.setAttribute('aria-label', 'Show theoretical distribution curve');

  label.appendChild(cb);
  label.appendChild(document.createTextNode('Show theoretical curve'));
  parent.appendChild(label);

  cb.addEventListener('change', () => onChange(cb.checked));
  return cb;
}
