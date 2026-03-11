// @ts-check
/**
 * Shared D3 charting utilities for StatBench.
 * Establishes the D3 margin convention and common helpers.
 *
 * @import { ChartFrame } from './types.js'
 */

import * as d3Selection from 'd3-selection';
import * as d3Axis from 'd3-axis';

/** Standard viewBox width. */
const VIEW_WIDTH = 600;

/** Standard viewBox height (600 * golden ratio inverse). */
const VIEW_HEIGHT = 371;

/** Default margins (desktop). */
const DEFAULT_MARGIN = { top: 28, right: 20, bottom: 50, left: 60 };

/** Phone margins (viewport < 480px). */
const PHONE_MARGIN = { top: 15, right: 10, bottom: 40, left: 45 };

/**
 * Standard transition duration (ms). Use for D3 transitions on explore tools.
 * Simulation animations use requestAnimationFrame instead.
 * @type {number}
 */
export const TRANSITION_MS = 300;

/**
 * Okabe-Ito accessible color palette.
 * @type {readonly string[]}
 */
const OKABE_ITO = [
  '#0072B2',   // blue (5.19:1)
  '#C08700',   // orange (3.13:1) — darkened from #E69F00 for WCAG 3:1
  '#009E73',   // teal (3.42:1)
  '#D55E00',   // vermillion (3.87:1)
  '#CC79A7',   // rose (3.06:1)
  '#2E8BC0',   // sky blue (3.77:1) — darkened from #56B4E9 for WCAG 3:1
  '#9A8C00',   // gold (3.43:1) — darkened from #F0E442 for WCAG 3:1
  '#767676',   // gray (4.54:1) — darkened from #999999 for WCAG 3:1
];

/**
 * Check if the user prefers reduced motion.
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  if (typeof globalThis.matchMedia !== 'function') return false;
  if (globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
  // Also suppress animation if d3-transition isn't loaded
  try {
    const tmp = d3Selection.select(
      typeof document !== 'undefined'
        ? document.createElementNS('http://www.w3.org/2000/svg', 'g')
        : null
    );
    if (typeof tmp.transition !== 'function') return true;
  } catch {
    return true;
  }
  return false;
}

/**
 * Debounce a function call.
 * @param {Function} fn
 * @param {number} [ms=150]
 * @returns {Function}
 */
export function debounce(fn, ms = 150) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

/**
 * Format tick values for display (remove trailing zeros, handle large numbers).
 * @param {number} value
 * @returns {string}
 */
export function formatTick(value) {
  if (value === 0) return '0';
  const abs = Math.abs(value);
  // Large numbers: use SI-like suffix
  if (abs >= 1e9) return (value / 1e9).toPrecision(3) + 'B';
  if (abs >= 1e6) return (value / 1e6).toPrecision(3) + 'M';
  if (abs >= 1e4) return (value / 1e3).toPrecision(3) + 'K';
  // Small decimals: up to 4 significant digits, strip trailing zeros
  if (abs < 0.001) return value.toExponential(2);
  // General case: up to 4 significant digits
  const s = Number(value.toPrecision(4));
  return String(s);
}

/**
 * Get the Okabe-Ito accessible color palette for chart data elements.
 * @param {number} [n=5] - Number of colors needed
 * @returns {string[]} Array of hex color strings
 */
export function getColors(n = 5) {
  const count = Math.max(1, Math.min(n, OKABE_ITO.length));
  return OKABE_ITO.slice(0, count);
}

/**
 * Create a responsive SVG chart inside a container element.
 * Applies the D3 margin convention with StatBench's standard dimensions.
 *
 * @param {string|Element} container - CSS selector or DOM element
 * @param {object} [options]
 * @param {number} [options.viewWidth=600] - SVG viewBox width
 * @param {number} [options.viewHeight=371] - SVG viewBox height
 * @param {{top:number,right:number,bottom:number,left:number}} [options.margin]
 * @param {string} [options.titleText] - Text for <title> element
 * @param {string} [options.descText] - Text for <desc> element
 * @param {string} [options.id] - Unique ID prefix for ARIA references
 * @returns {ChartFrame}
 */
export function createChart(container, options = {}) {
  const {
    viewWidth = VIEW_WIDTH,
    viewHeight = VIEW_HEIGHT,
    margin = detectPhoneMargin() ? PHONE_MARGIN : DEFAULT_MARGIN,
    titleText = 'Chart',
    descText = '',
    id = 'chart-' + Math.random().toString(36).slice(2, 8),
  } = options;

  const innerWidth = viewWidth - margin.left - margin.right;
  const innerHeight = viewHeight - margin.top - margin.bottom;

  const el = typeof container === 'string'
    ? d3Selection.select(container)
    : d3Selection.select(container);

  const svg = el.append('svg')
    .attr('role', 'img')
    .attr('aria-labelledby', `${id}-title ${id}-desc`)
    .attr('viewBox', `0 0 ${viewWidth} ${viewHeight}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .style('width', '100%')
    .style('height', 'auto');

  svg.append('title').attr('id', `${id}-title`).text(titleText);
  svg.append('desc').attr('id', `${id}-desc`).text(descText);

  const inner = svg.append('g')
    .attr('class', 'chart-inner')
    .attr('transform', `translate(${margin.left}, ${margin.top})`);

  inner.append('g').attr('class', 'axes');
  inner.append('g').attr('class', 'data');
  inner.append('g').attr('class', 'overlays');
  inner.append('g').attr('class', 'annotations');

  return {
    svg: svg.node(),
    inner: inner.node(),
    width: innerWidth,
    height: innerHeight,
    margin,
  };
}

/**
 * Add X and Y axes to a chart frame.
 * @param {ChartFrame} frame
 * @param {*} xAxis - d3.axisBottom scale
 * @param {*} yAxis - d3.axisLeft scale
 * @param {string} [xLabel] - X-axis label text
 * @param {string} [yLabel] - Y-axis label text
 */
export function addAxes(frame, xAxis, yAxis, xLabel, yLabel) {
  const inner = d3Selection.select(frame.inner);
  const axes = inner.select('.axes');

  // X axis
  axes.append('g')
    .attr('class', 'x-axis')
    .attr('transform', `translate(0, ${frame.height})`)
    .call(xAxis);

  // Y axis
  axes.append('g')
    .attr('class', 'y-axis')
    .call(yAxis);

  // X-axis label
  if (xLabel) {
    axes.append('text')
      .attr('class', 'x-label')
      .attr('text-anchor', 'middle')
      .attr('x', frame.width / 2)
      .attr('y', frame.height + frame.margin.bottom - 8)
      .text(xLabel);
  }

  // Y-axis label (rotated) — positioned dynamically based on tick width
  if (yLabel) {
    // Measure widest y-axis tick label
    let maxTickWidth = 0;
    axes.select('.y-axis').selectAll('.tick text').each(function () {
      try {
        const w = /** @type {SVGTextElement} */ (this).getBBox().width;
        if (w > maxTickWidth) maxTickWidth = w;
      } catch { /* getBBox fails in JSDOM */ }
    });
    // Place label just outside the tick labels with a small gap
    const labelY = -(maxTickWidth + 14);

    axes.append('text')
      .attr('class', 'y-label')
      .attr('text-anchor', 'middle')
      .attr('transform', 'rotate(-90)')
      .attr('x', -frame.height / 2)
      .attr('y', labelY)
      .text(yLabel);
  }
}

/**
 * Detect if phone margins should be used.
 * @returns {boolean}
 */
function detectPhoneMargin() {
  if (typeof globalThis.matchMedia !== 'function') return false;
  return globalThis.matchMedia('(max-width: 480px)').matches;
}

/**
 * Render a p-value annotation on a hypothesis test chart.
 * Positions the label in the tail area(s) with a white background for contrast.
 *
 * @param {ChartFrame} frame - Chart frame from createChart
 * @param {d3Selection.Selection|any} xScale - D3 linear scale for x-axis
 * @param {number} pValue - Computed p-value
 * @param {number} observedStat - Observed test statistic
 * @param {'left'|'right'|'both'} direction - Tail direction
 */
export function renderPValueAnnotation(frame, xScale, pValue, observedStat, direction) {
  const annotations = d3Selection.select(frame.inner).select('.annotations');
  annotations.selectAll('.p-value-group').remove();

  // Format p-value text
  let pText;
  if (pValue === 0) pText = 'p ≈ 0';
  else if (pValue < 0.0001) pText = 'p < 0.0001';
  else if (pValue < 0.001) pText = `p = ${pValue.toFixed(4)}`;
  else pText = `p = ${pValue.toFixed(4)}`;

  const obsX = xScale(observedStat);
  const h = frame.height;
  const w = frame.width;

  if (direction === 'both') {
    // Two-sided: label near observed stat, slightly above mid-height
    const labelX = Math.max(60, Math.min(w - 60, obsX));
    _addPLabel(annotations, `${pText}  (two-tailed)`, labelX, h * 0.18);
  } else if (direction === 'left') {
    // Left tail: label between left edge and observed
    const tailMidX = obsX / 2;
    const labelX = Math.max(50, Math.min(obsX - 10, tailMidX));
    _addPLabel(annotations, pText, labelX, h * 0.25);
  } else {
    // Right tail: label between observed and right edge
    const tailMidX = (obsX + w) / 2;
    const labelX = Math.min(w - 50, Math.max(obsX + 10, tailMidX));
    _addPLabel(annotations, pText, labelX, h * 0.25);
  }
}

/**
 * Add a p-value text label with white background rect.
 * @param {d3Selection.Selection} group
 * @param {string} text
 * @param {number} x
 * @param {number} y
 */
function _addPLabel(group, text, x, y) {
  const g = group.append('g').attr('class', 'p-value-group');

  // Add text first to measure, then add background rect
  const textEl = g.append('text')
    .attr('class', 'p-value-label')
    .attr('x', x)
    .attr('y', y)
    .attr('text-anchor', 'middle')
    .attr('fill', '#B71C1C')
    .text(text);

  // Add background rect behind text for readability
  try {
    const bbox = /** @type {SVGTextElement} */ (textEl.node()).getBBox();
    const pad = 4;
    g.insert('rect', 'text')
      .attr('x', bbox.x - pad)
      .attr('y', bbox.y - pad)
      .attr('width', bbox.width + pad * 2)
      .attr('height', bbox.height + pad * 2)
      .attr('fill', 'white')
      .attr('fill-opacity', 0.85)
      .attr('rx', 3);
  } catch {
    // getBBox may fail in test/JSDOM — skip background
  }
}
